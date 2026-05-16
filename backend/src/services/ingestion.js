import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { embedBatch } from './embeddings.js';
import supabase from '../utils/supabase.js';

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE) || 500;       // chars (approx 125 tokens)
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP) || 50;  // overlap chars

/**
 * Split text into overlapping chunks.
 * Tries to break on sentence boundaries for cleaner chunks.
 */
function chunkText(text) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + CHUNK_SIZE;

    // Try to end on a sentence boundary (period, ?, !)
    if (end < text.length) {
      const breakPoint = text.lastIndexOf('.', end);
      if (breakPoint > start + CHUNK_SIZE / 2) {
        end = breakPoint + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 30) { // skip tiny fragments
      chunks.push(chunk);
    }

    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

/**
 * Extract text per page from PDF buffer.
 * Returns { fullText, pages: [{ pageNum, text }], pageCount }
 */
async function extractPdfPages(buffer) {
  const data = await pdfParse(buffer);
  const pageCount = data.numpages;

  // pdf-parse gives us full text — split roughly by page
  // For production you'd use pdf.js for true per-page extraction
  const fullText = data.text;
  const approxPerPage = Math.ceil(fullText.length / pageCount);

  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push({
      pageNum: i + 1,
      text: fullText.slice(i * approxPerPage, (i + 1) * approxPerPage)
    });
  }

  return { fullText, pages, pageCount };
}

/**
 * Full ingestion pipeline:
 * PDF buffer → extract → chunk → embed → store in pgvector
 *
 * @param {Buffer} fileBuffer
 * @param {string} filename
 * @param {number} fileSize
 * @returns {Promise<{ documentId: string, chunkCount: number, pageCount: number }>}
 */
export async function ingestPdf(fileBuffer, filename, fileSize) {
  const documentId = uuidv4();

  // 1. Create document record (status: processing)
  const { error: docError } = await supabase
    .from('documents')
    .insert({
      id: documentId,
      filename,
      file_size: fileSize,
      status: 'processing',
    });

  if (docError) throw new Error(`DB insert failed: ${docError.message}`);

  try {
    // 2. Extract text from PDF
    console.log(`[ingest] Parsing PDF: ${filename}`);
    const { fullText, pages, pageCount } = await extractPdfPages(fileBuffer);

    if (!fullText || fullText.trim().length < 50) {
      throw new Error('PDF appears to be empty or image-only (no extractable text)');
    }

    // 3. Chunk the text
    console.log(`[ingest] Chunking ${fullText.length} chars...`);
    const rawChunks = chunkText(fullText);

    // Assign approximate page numbers to chunks
    const chunks = rawChunks.map((content, index) => ({
      id: uuidv4(),
      document_id: documentId,
      chunk_index: index,
      content,
      token_count: Math.ceil(content.length / 4), // rough estimate
      page_number: Math.ceil((index / rawChunks.length) * pageCount) || 1,
    }));

    console.log(`[ingest] Created ${chunks.length} chunks`);

    // 4. Generate embeddings in batch
    console.log(`[ingest] Embedding ${chunks.length} chunks via OpenAI...`);
    const texts = chunks.map(c => c.content);
    const embeddings = await embedBatch(texts);

    // 5. Attach embeddings to chunk objects
    const chunksWithEmbeddings = chunks.map((chunk, i) => ({
      ...chunk,
      embedding: JSON.stringify(embeddings[i]), // Supabase expects JSON array
    }));

    // 6. Store in Supabase in batches of 50
    const BATCH = 50;
    for (let i = 0; i < chunksWithEmbeddings.length; i += BATCH) {
      const batch = chunksWithEmbeddings.slice(i, i + BATCH);
      const { error: chunkError } = await supabase
        .from('document_chunks')
        .insert(batch);

      if (chunkError) throw new Error(`Chunk insert failed: ${chunkError.message}`);
    }

    // 7. Update document status → ready
    await supabase
      .from('documents')
      .update({ status: 'ready', page_count: pageCount, chunk_count: chunks.length })
      .eq('id', documentId);

    console.log(`[ingest] ✅ Done: ${filename} → ${chunks.length} chunks stored`);

    return { documentId, chunkCount: chunks.length, pageCount };

  } catch (err) {
    // Mark document as error so UI can show it
    await supabase
      .from('documents')
      .update({ status: 'error' })
      .eq('id', documentId);

    throw err;
  }
}

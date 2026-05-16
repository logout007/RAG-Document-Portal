import { embedText, openai } from './embeddings.js';
import supabase from '../utils/supabase.js';

const TOP_K = parseInt(process.env.TOP_K) || 5;

/**
 * Retrieve top-K most similar chunks for a query.
 * Uses pgvector cosine similarity via Supabase RPC.
 *
 * @param {number[]} queryEmbedding
 * @param {string|null} documentId - optional: restrict to one document
 * @returns {Promise<Array>}
 */
async function retrieveChunks(queryEmbedding, documentId = null) {
  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: queryEmbedding,
    match_count: TOP_K,
    filter_doc_id: documentId || null,
  });

  if (error) throw new Error(`Vector search failed: ${error.message}`);
  return data || [];
}

/**
 * Build the system prompt for GPT-4o-mini synthesis.
 */
function buildSystemPrompt() {
  return `You are a precise document assistant. Answer questions using ONLY the provided context chunks.

Rules:
- If the answer is in the context, answer clearly and cite which part helped.
- If the context does not contain enough information, say: "I could not find a clear answer in the uploaded documents."
- Never make up information not present in the context.
- Be concise. Prefer bullet points for multi-part answers.
- If asked to summarize, give a structured summary with key points.`;
}

/**
 * Build the user prompt with retrieved context injected.
 */
function buildUserPrompt(query, chunks) {
  const contextBlock = chunks
    .map((c, i) =>
      `[Chunk ${i + 1} | Page ${c.page_number} | Similarity: ${(c.similarity * 100).toFixed(1)}%]\n${c.content}`
    )
    .join('\n\n---\n\n');

  return `Context from uploaded documents:\n\n${contextBlock}\n\n---\n\nQuestion: ${query}`;
}

/**
 * Full RAG pipeline:
 * query → embed → vector search → GPT-4o-mini synthesis
 *
 * @param {string} query
 * @param {string|null} documentId - optional: scope to one document
 * @returns {Promise<{ answer: string, sources: Array, latencyMs: number }>}
 */
export async function ragSearch(query, documentId = null) {
  const startTime = Date.now();

  if (!query || query.trim().length < 3) {
    throw new Error('Query too short — please provide more detail.');
  }

  // 1. Embed the query
  const queryEmbedding = await embedText(query);

  // 2. Retrieve similar chunks
  const chunks = await retrieveChunks(queryEmbedding, documentId);

  if (!chunks.length) {
    return {
      answer: 'No relevant content found in the uploaded documents. Try uploading a PDF first or rephrasing your question.',
      sources: [],
      latencyMs: Date.now() - startTime,
    };
  }

  // 3. Filter low-similarity chunks (below 30% cosine similarity)
  const relevantChunks = chunks.filter(c => c.similarity > 0.3);

  if (!relevantChunks.length) {
    return {
      answer: 'I could not find a clear answer in the uploaded documents — the content may not be relevant to your question.',
      sources: [],
      latencyMs: Date.now() - startTime,
    };
  }

  // 4. Synthesize with GPT-4o-mini
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(query, relevantChunks) },
    ],
    temperature: 0.1,      // low temp = more factual, less hallucination
    max_tokens: 800,
  });

  const answer = completion.choices[0].message.content;
  const latencyMs = Date.now() - startTime;

  // 5. Return answer + source attribution
  const sources = relevantChunks.map(c => ({
    documentId: c.document_id,
    chunkIndex: c.chunk_index,
    pageNumber: c.page_number,
    similarity: parseFloat((c.similarity * 100).toFixed(1)),
    preview: c.content.slice(0, 150) + (c.content.length > 150 ? '…' : ''),
  }));

  console.log(`[search] Query: "${query}" → ${relevantChunks.length} chunks → ${latencyMs}ms`);

  return { answer, sources, latencyMs };
}

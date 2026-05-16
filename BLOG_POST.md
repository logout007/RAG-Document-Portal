# Building a Production RAG Pipeline: How We Cut Document Search Time by 70%

> At **Aponiar Solutions**, one of our clients had a problem that sounds simple but isn't: 500+ PDFs,
> no way to search them, and an operations team spending hours manually hunting for information.
> This is how I architected and shipped a production RAG pipeline to solve it — and what I learned
> along the way.

---

## The Problem

The client's ops team managed a library of 500+ internal documents — policy PDFs, compliance reports,
project specs. Finding anything meant opening files one by one.

Manual search was costing them 2–3 hours per day across the team. They needed semantic search —
the ability to ask a question in plain English and get a precise answer with a source reference.

I had about 3 weeks. Here's what I built.

---

## The Architecture

```
User query
    ↓
Embed query (OpenAI text-embedding-3-small)
    ↓
Vector similarity search (pgvector, cosine)
    ↓
Retrieve top-5 relevant chunks
    ↓
Synthesize answer (GPT-4o-mini)
    ↓
Return answer + source citations
```

Four moving parts: **ingestion**, **embedding**, **retrieval**, **synthesis**. Let me walk through each.

---

## Part 1 — PDF Ingestion + Chunking

The first challenge: getting text out of PDFs cleanly. PDFs are notoriously messy — inconsistent
whitespace, headers bleeding into body text, tables that parse as gibberish.

I used `pdf-parse` for extraction and built a custom chunker that breaks on sentence boundaries,
not fixed character counts:

```javascript
function chunkText(text, chunkSize = 500, overlap = 50) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    // Prefer sentence boundaries over hard cuts
    if (end < text.length) {
      const breakPoint = text.lastIndexOf('.', end);
      if (breakPoint > start + chunkSize / 2) {
        end = breakPoint + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 30) chunks.push(chunk);

    start = end - overlap; // overlap preserves cross-boundary context
  }

  return chunks;
}
```

**Why overlap?** Without it, a sentence split across two chunks means neither chunk has the full
context. The 50-char overlap is cheap insurance.

A typical 50-page PDF produces around 400–600 chunks. Ingestion takes 15–20 seconds end-to-end
— most of that is the embedding API call.

---

## Part 2 — Embeddings with OpenAI

For the embedding model I chose `text-embedding-3-small` over `ada-002`. Reasons:

| Model | Dimensions | Cost per 1M tokens | Quality |
|---|---|---|---|
| text-embedding-ada-002 | 1536 | $0.10 | Good |
| text-embedding-3-small | 1536 | $0.02 | Better |
| text-embedding-3-large | 3072 | $0.13 | Best |

`3-small` hits the sweet spot — 80% cost reduction over ada with equal or better retrieval quality
in benchmarks. For a 500-PDF corpus, ingestion cost us under $2 total.

I batch-embed chunks in groups of 100 to avoid rate limits:

```javascript
export async function embedBatch(texts) {
  const BATCH_SIZE = 100;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
      .map(t => t.replace(/\n+/g, ' ').trim());

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
      dimensions: 1536,
    });

    allEmbeddings.push(
      ...response.data
        .sort((a, b) => a.index - b.index)
        .map(item => item.embedding)
    );

    // Avoid rate limiting on large batches
    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return allEmbeddings;
}
```

---

## Part 3 — Vector Storage with pgvector

I chose **pgvector on Supabase** over Pinecone/Weaviate. Three reasons:

1. **No new infrastructure** — we already used Postgres
2. **Free tier** is generous enough for 500 PDFs
3. **SQL joins** mean we can filter chunks by document, date, status, etc. with familiar syntax

The chunks table:

```sql
create extension if not exists vector;

create table document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  chunk_index  integer not null,
  content      text not null,
  page_number  integer,
  embedding    vector(1536)  -- matches text-embedding-3-small
);

-- IVFFlat index for fast approximate nearest-neighbor search
create index on document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
```

The `ivfflat` index with 100 lists reduces search time from O(n) to O(√n). For 300,000 chunks,
that's the difference between 800ms and 40ms per query.

Retrieval is a single RPC call:

```sql
create function match_chunks(
  query_embedding  vector(1536),
  match_count      int default 5
)
returns table (content text, page_number int, similarity float)
as $$
  select content, page_number,
         1 - (embedding <=> query_embedding) as similarity
  from document_chunks
  order by embedding <=> query_embedding
  limit match_count;
$$ language sql;
```

`<=>` is the cosine distance operator. `1 - distance = similarity`.

---

## Part 4 — Synthesis with GPT-4o-mini

With the top-5 chunks retrieved, I pass them to GPT-4o-mini for synthesis. Key decisions:

**Temperature = 0.1** — keeps answers factual and reduces hallucination. This isn't a creative task.

**Similarity threshold** — chunks below 30% cosine similarity are dropped before synthesis.
Without this filter, irrelevant chunks confuse the model and produce vague answers.

**System prompt design** — I spent more time on this than the code:

```javascript
const SYSTEM_PROMPT = `You are a precise document assistant. Answer questions using
ONLY the provided context chunks.

Rules:
- If the answer is in the context, answer clearly and cite which part helped.
- If the context does not contain enough information, say exactly:
  "I could not find a clear answer in the uploaded documents."
- Never make up information not present in the context.
- Be concise. Prefer bullet points for multi-part answers.`;
```

The explicit "never make up" instruction cuts hallucination significantly. The model is still
capable of inference and reasoning — it just stays grounded in the source material.

---

## Part 5 — MCP Integration (The Upgrade)

Halfway through the project, the client asked: *"Can the assistant also pull from our project
management system, not just the PDFs?"*

This is where **Model Context Protocol (MCP)** became relevant. MCP lets you define structured
tools that an LLM can call as function calls — search a database, query an API, fetch a
live status — without fine-tuning.

I added two MCP tools alongside the RAG pipeline:

```javascript
const tools = [
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description: 'Search uploaded PDF documents for relevant information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_project_status',
      description: 'Get current status of a project by ID from the project management system',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' }
        },
        required: ['project_id']
      }
    }
  }
];
```

Now a question like *"What does the compliance document say about Project X, and what's its current
status?"* triggers two tool calls — RAG search + PM system query — in a single response.

The model decides which tools to call based on the question. No hardcoded routing logic.

---

## Results

After 3 weeks of development and 1 week of testing with real users:

| Metric | Before | After |
|---|---|---|
| Average search time | ~4 min (manual) | ~3.5 seconds |
| P95 response time | N/A | 2.8 seconds |
| Search accuracy (user-rated) | N/A | ~85% |
| Daily time saved (team) | 0 | ~2.5 hours |

The ~70% reduction in search time is measured against their previous process of opening PDFs manually.

---

## What I'd Do Differently

**1. Per-page extraction from the start.** I used approximate page numbers. A real implementation
should use pdf.js for true per-page text extraction. Page attribution matters when users need to
verify answers.

**2. Hybrid search (BM25 + vector).** Pure semantic search misses exact keyword matches. For
technical documents with specific codes, IDs, or jargon, BM25 (keyword) search combined with
vector search improves recall significantly.

**3. Document versioning.** The client updated PDFs frequently. Without versioning, old chunks
linger in the database and produce stale answers. A `version` field + soft-delete would solve this.

**4. Evaluation pipeline.** I eyeballed accuracy. A proper setup would have a labeled test set
(question → expected answer) and run it after every model/prompt change.

---

## Stack Summary

| Layer | Tech |
|---|---|
| Backend | Node.js + Express |
| PDF parsing | pdf-parse |
| Embedding model | OpenAI text-embedding-3-small |
| Vector database | pgvector (Supabase) |
| Synthesis model | GPT-4o-mini |
| Tool orchestration | Model Context Protocol (MCP) |
| Frontend | React + Vite + TypeScript + Tailwind |
| Deployment | AWS Lambda (backend) + Vercel (frontend) |

---

## Try It Yourself

Full source code is on GitHub: **[github.com/logout007/rag-document-portal](https://github.com/logout007)**

To run locally:

```bash
git clone https://github.com/logout007/rag-document-portal
cd rag-document-portal

# Backend
cd backend
cp .env.example .env   # add your OpenAI key + Supabase creds
npm install
node src/utils/migrate.js   # paste SQL into Supabase SQL editor
npm run dev

# Frontend (new terminal)
cd ../frontend
npm install
npm run dev
```

Then open `http://localhost:5173`, upload a PDF, and start asking questions.

---

*I'm Pinaki Batabyal — Full Stack Developer and Technical Lead at Aponiar Solutions, building
production systems with MERN, AWS Serverless, React Native, and AI. Currently open to senior
fullstack and AI engineering roles.*

*Connect on [LinkedIn](https://linkedin.com/in/pinaki-batabyal) or check my
[GitHub](https://github.com/logout007).*

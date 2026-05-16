# RAG Document Portal

> Semantic document search built with OpenAI embeddings + pgvector + GPT-4o-mini.
> Upload PDFs, ask questions in plain English, get precise answers with source citations.

Built at **Aponiar Solutions** to cut internal document search time by ~70%.

---

## Demo

```
User: "What are the key compliance requirements in section 4?"

Answer: Based on the documents, section 4 outlines three requirements:
  1. All transactions above ₹10L must be logged within 24 hours
  2. Audit trails must be retained for 7 years
  3. ...

Sources: Page 12 (94.2% match), Page 13 (88.7% match)
Response time: 2.4s
```

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js 20 + Express |
| PDF parsing | pdf-parse |
| Embeddings | OpenAI text-embedding-3-small (1536-dim) |
| Vector store | pgvector on Supabase |
| LLM synthesis | GPT-4o-mini |
| Tool calling | Model Context Protocol (MCP) |
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |

---

## Quick Start

**Prerequisites:** Node.js 20+, Supabase account (free), OpenAI API key

```bash
git clone https://github.com/logout007/rag-document-portal
cd rag-document-portal
```

### 1. Backend setup

```bash
cd backend
cp .env.example .env
# Edit .env — add OPENAI_API_KEY and SUPABASE_URL + SUPABASE_SERVICE_KEY

npm install
node src/utils/migrate.js   # outputs SQL to run in Supabase SQL editor
npm run dev                 # starts on port 3001
```

### 2. Frontend setup

```bash
cd frontend
npm install
npm run dev                 # starts on port 5173
```

### 3. Open `http://localhost:5173`

Upload a PDF → ask a question → get an answer with sources.

---

## Architecture

```
Upload PDF
    ↓ pdf-parse
Extract text → chunk (500 chars, 50 overlap)
    ↓ OpenAI text-embedding-3-small
Generate embeddings (batch of 100)
    ↓ Supabase pgvector
Store chunks + vectors

Query
    ↓ Embed query
    ↓ pgvector cosine similarity (IVFFlat index)
Retrieve top-5 chunks (>30% similarity threshold)
    ↓ GPT-4o-mini (temp=0.1)
Synthesize answer
    ↓
Return answer + page citations + latency
```

---

## API Endpoints

```
POST /api/documents/upload   — Upload a PDF (multipart/form-data, field: "file")
GET  /api/documents          — List all documents
DELETE /api/documents/:id    — Delete document + all its chunks

POST /api/search             — { query: string, documentId?: string }
GET  /api/health             — Service health check
```

---

## Performance

| Metric | Value |
|---|---|
| P95 response time | ~2.8 seconds |
| Embedding cost (500 PDFs) | ~$2 total |
| Chunks per 50-page PDF | ~400-600 |
| Ingestion time per PDF | 15-20 seconds |

---

## Read the full write-up

[Building a Production RAG Pipeline: How We Cut Document Search Time by 70%](./BLOG_POST.md)

---

## Author

**Pinaki Batabyal** — Full Stack Developer & Technical Lead at Aponiar Solutions

[LinkedIn](https://linkedin.com/in/pinaki-batabyal) · [GitHub](https://github.com/logout007)
# RAG-Document-Portal

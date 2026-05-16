/**
 * Run once: node src/utils/migrate.js
 * Creates the pgvector extension + documents + chunks tables in Supabase
 */
import 'dotenv/config';
import supabase from './supabase.js';

const SQL = `
-- Enable pgvector extension
create extension if not exists vector;

-- Documents table — tracks uploaded PDFs
create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  filename    text not null,
  file_size   integer not null,
  page_count  integer,
  chunk_count integer,
  status      text not null default 'processing',  -- processing | ready | error
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Chunks table — stores text chunks + embeddings
create table if not exists document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  chunk_index  integer not null,
  content      text not null,
  token_count  integer,
  page_number  integer,
  embedding    vector(1536),  -- text-embedding-3-small dimension
  created_at   timestamptz not null default now()
);

-- Index for fast similarity search
create index if not exists document_chunks_embedding_idx
  on document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- RPC function for similarity search (called from Node.js)
create or replace function match_chunks(
  query_embedding  vector(1536),
  match_count      int default 5,
  filter_doc_id    uuid default null
)
returns table (
  id           uuid,
  document_id  uuid,
  chunk_index  integer,
  content      text,
  page_number  integer,
  similarity   float
)
language plpgsql
as $$
begin
  return query
  select
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    dc.page_number,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  where
    dc.embedding is not null
    and (filter_doc_id is null or dc.document_id = filter_doc_id)
  order by dc.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Auto-update updated_at on documents
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists documents_updated_at on documents;
create trigger documents_updated_at
  before update on documents
  for each row execute function update_updated_at();
`;

async function migrate() {
  console.log('Running migration...');
  const { error } = await supabase.rpc('exec_sql', { sql: SQL }).catch(() => ({ error: 'rpc_not_available' }));

  if (error) {
    console.log('\n⚠️  Cannot run SQL directly via RPC.');
    console.log('   Copy the SQL below and run it in your Supabase SQL Editor:\n');
    console.log('   https://supabase.com/dashboard/project/_/sql\n');
    console.log('━'.repeat(60));
    console.log(SQL);
    console.log('━'.repeat(60));
  } else {
    console.log('✅ Migration complete!');
  }
}

migrate();

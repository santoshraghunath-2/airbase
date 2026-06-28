-- Migration 016: pgvector extension + equipment manual chunks for Tech Assistant

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE manual_chunks (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  document_name TEXT NOT NULL,
  chunk_index   INT  NOT NULL,
  chunk_text    TEXT NOT NULL,
  embedding     vector(1536),
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE manual_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manual_chunks_tenant_isolation" ON manual_chunks
  FOR ALL USING (tenant_id = get_my_tenant_id());

-- IVFFlat index for fast approximate nearest-neighbor search.
-- Rebuild with CREATE INDEX ... WITH (lists = N) after bulk ingestion.
CREATE INDEX idx_manual_chunks_embedding
  ON manual_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX idx_manual_chunks_tenant ON manual_chunks(tenant_id);
CREATE INDEX idx_manual_chunks_document ON manual_chunks(tenant_id, document_name);

-- Convenience function: returns the N chunks most similar to a query embedding.
CREATE OR REPLACE FUNCTION match_manual_chunks(
  p_tenant_id   UUID,
  p_embedding   vector(1536),
  p_match_count INT DEFAULT 5
)
RETURNS TABLE(id UUID, document_name TEXT, chunk_text TEXT, similarity FLOAT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    mc.id,
    mc.document_name,
    mc.chunk_text,
    1 - (mc.embedding <=> p_embedding) AS similarity
  FROM manual_chunks mc
  WHERE mc.tenant_id = p_tenant_id
    AND mc.embedding IS NOT NULL
  ORDER BY mc.embedding <=> p_embedding
  LIMIT p_match_count;
END;
$$;

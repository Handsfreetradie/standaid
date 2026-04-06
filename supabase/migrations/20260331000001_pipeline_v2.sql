-- Pipeline v2: processing_jobs table and HNSW index

-- Processing jobs table for status tracking and retry support
CREATE TABLE IF NOT EXISTS processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_id uuid NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS processing_jobs_status_idx ON processing_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS processing_jobs_standard_idx ON processing_jobs(standard_id);

-- RLS: users can only see and manage their own jobs
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own processing jobs"
  ON processing_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own processing jobs"
  ON processing_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own processing jobs"
  ON processing_jobs FOR UPDATE
  USING (auth.uid() = user_id);

-- Replace IVFFlat index with HNSW for better performance at scale
DROP INDEX IF EXISTS standard_chunks_embedding_idx;

CREATE INDEX IF NOT EXISTS standard_chunks_embedding_hnsw_idx
  ON standard_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

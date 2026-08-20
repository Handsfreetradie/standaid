-- Standards Australia declined an AI licence/pilot (2026-08-20). Standards
-- their terms cover (AS/NZS/NZS content) can no longer go through the AI
-- extraction/chunking/embedding pipeline. This new status marks a standard
-- as "stored for PDF viewing only, no AI processing" — see
-- supabase/functions/_shared/standard-licence.ts for the classification
-- logic and the entry points that set this.
ALTER TYPE public.extraction_status ADD VALUE IF NOT EXISTS 'ai_disabled';

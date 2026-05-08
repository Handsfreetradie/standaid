-- Standard figures and tables image store
-- Images are captured during PDF extraction and stored in Supabase Storage.
-- The query function looks up image_url by figure/table number and attaches
-- it to the AI response so the frontend can render them inline.

-- Public storage bucket for figure/table images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'standard-figures',
  'standard-figures',
  true,
  5242880,  -- 5MB per image
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload their own standard images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'standard-figures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow public read (images are referenced in chat responses)
CREATE POLICY "Public read for standard images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'standard-figures');

-- Allow users to delete their own images (e.g. when re-uploading a standard)
CREATE POLICY "Users can delete their own standard images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'standard-figures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Figures extracted from standards PDFs
CREATE TABLE IF NOT EXISTS public.standard_figures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_id UUID NOT NULL REFERENCES public.standards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  figure_number TEXT NOT NULL,
  caption TEXT,
  page_number INTEGER,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_standard_figures_standard_id ON public.standard_figures(standard_id);
CREATE INDEX IF NOT EXISTS idx_standard_figures_user_number ON public.standard_figures(user_id, figure_number);

ALTER TABLE public.standard_figures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own figures"
  ON public.standard_figures FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own figures"
  ON public.standard_figures FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own figures"
  ON public.standard_figures FOR DELETE
  USING (auth.uid() = user_id);

-- Tables extracted from standards PDFs
CREATE TABLE IF NOT EXISTS public.standard_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_id UUID NOT NULL REFERENCES public.standards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  table_number TEXT NOT NULL,
  caption TEXT,
  page_number INTEGER,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_standard_tables_standard_id ON public.standard_tables(standard_id);
CREATE INDEX IF NOT EXISTS idx_standard_tables_user_number ON public.standard_tables(user_id, table_number);

ALTER TABLE public.standard_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tables"
  ON public.standard_tables FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tables"
  ON public.standard_tables FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tables"
  ON public.standard_tables FOR DELETE
  USING (auth.uid() = user_id);

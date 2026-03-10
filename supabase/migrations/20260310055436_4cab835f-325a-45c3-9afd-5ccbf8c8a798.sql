
-- Enable pgvector extension in public schema
CREATE EXTENSION IF NOT EXISTS vector SCHEMA public;

-- Create subscription tier enum
CREATE TYPE public.subscription_tier AS ENUM ('free', 'pro', 'business');

-- Create extraction status enum
CREATE TYPE public.extraction_status AS ENUM ('pending', 'processing', 'complete', 'failed');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  email TEXT,
  trade_type TEXT,
  subscription_tier public.subscription_tier NOT NULL DEFAULT 'free',
  daily_query_count INTEGER NOT NULL DEFAULT 0,
  daily_query_reset_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create standards table
CREATE TABLE public.standards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  standard_code TEXT,
  version TEXT,
  trade_category TEXT,
  file_url TEXT,
  file_path TEXT,
  extraction_status public.extraction_status NOT NULL DEFAULT 'pending',
  extraction_quality_score NUMERIC,
  is_partial BOOLEAN NOT NULL DEFAULT false,
  total_chunks INTEGER DEFAULT 0,
  indexed_chunks INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create standard_chunks table with vector column
CREATE TABLE public.standard_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  standard_id UUID REFERENCES public.standards(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  clause_number TEXT,
  clause_title TEXT,
  content TEXT NOT NULL,
  page_number INTEGER,
  chunk_index INTEGER NOT NULL,
  embedding public.vector(1536),
  is_indexed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create queries table
CREATE TABLE public.queries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  question TEXT NOT NULL,
  response TEXT,
  citations JSONB,
  confidence_score NUMERIC,
  safety_flagged BOOLEAN NOT NULL DEFAULT false,
  subscription_tier_at_time public.subscription_tier,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create citations table
CREATE TABLE public.citations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  query_id UUID REFERENCES public.queries(id) ON DELETE CASCADE NOT NULL,
  standard_id UUID REFERENCES public.standards(id) ON DELETE CASCADE NOT NULL,
  clause_number TEXT,
  standard_code TEXT,
  version TEXT,
  page_number INTEGER,
  confidence_score NUMERIC,
  chunk_content TEXT
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citations ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Standards policies
CREATE POLICY "Users can view own standards" ON public.standards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own standards" ON public.standards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own standards" ON public.standards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own standards" ON public.standards FOR DELETE USING (auth.uid() = user_id);

-- Standard chunks policies
CREATE POLICY "Users can view own chunks" ON public.standard_chunks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chunks" ON public.standard_chunks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own chunks" ON public.standard_chunks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own chunks" ON public.standard_chunks FOR DELETE USING (auth.uid() = user_id);

-- Queries policies
CREATE POLICY "Users can view own queries" ON public.queries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own queries" ON public.queries FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Citations policies
CREATE POLICY "Users can view own citations" ON public.citations FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.queries WHERE id = query_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert own citations" ON public.citations FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.queries WHERE id = query_id AND user_id = auth.uid())
);

-- Vector similarity search function
CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding public.vector(1536),
  match_user_id UUID,
  match_threshold FLOAT DEFAULT 0.72,
  match_count INT DEFAULT 8
)
RETURNS TABLE (
  id UUID,
  standard_id UUID,
  clause_number TEXT,
  clause_title TEXT,
  content TEXT,
  page_number INTEGER,
  chunk_index INTEGER,
  similarity FLOAT
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.id,
    sc.standard_id,
    sc.clause_number,
    sc.clause_title,
    sc.content,
    sc.page_number,
    sc.chunk_index,
    (1 - (sc.embedding <=> query_embedding))::FLOAT AS similarity
  FROM public.standard_chunks sc
  WHERE sc.user_id = match_user_id
    AND sc.is_indexed = true
    AND (1 - (sc.embedding <=> query_embedding)) > match_threshold
  ORDER BY sc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Indexes
CREATE INDEX idx_standard_chunks_embedding ON public.standard_chunks
  USING ivfflat (embedding public.vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_standard_chunks_user_indexed ON public.standard_chunks (user_id, is_indexed);
CREATE INDEX idx_standards_user ON public.standards (user_id);
CREATE INDEX idx_queries_user_created ON public.queries (user_id, created_at DESC);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update timestamp function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_standards_updated_at BEFORE UPDATE ON public.standards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for standards PDFs
INSERT INTO storage.buckets (id, name, public) VALUES ('standards', 'standards', false);

CREATE POLICY "Users can upload own standards" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'standards' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view own standards" ON storage.objects
  FOR SELECT USING (bucket_id = 'standards' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete own standards" ON storage.objects
  FOR DELETE USING (bucket_id = 'standards' AND auth.uid()::text = (storage.foldername(name))[1]);

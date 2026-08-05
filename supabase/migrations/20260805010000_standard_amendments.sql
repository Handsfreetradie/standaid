-- Lets a user link an uploaded document as an amendment to an existing
-- standard, instead of the standard_code-match logic in upload-standard
-- silently deleting and replacing the base standard.
ALTER TABLE public.standards
  ADD COLUMN amends_standard_id UUID REFERENCES public.standards(id) ON DELETE SET NULL;

CREATE INDEX idx_standards_amends_standard_id ON public.standards(amends_standard_id);

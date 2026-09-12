-- A photo point can now hold either an ordinary flat site photo (the
-- existing in-app camera capture) or a 360° panorama the tradie captured in
-- their phone's own camera app (Panorama/Photo Sphere mode) and uploaded —
-- there's no way for a website to trigger a phone's native panorama capture
-- mode, so a true 360° photo always arrives as an existing file, not a live
-- capture. `photo_type` says which viewer to use for it.
ALTER TABLE public.setout_photo_points
  ADD COLUMN IF NOT EXISTS photo_type TEXT NOT NULL DEFAULT 'flat' CHECK (photo_type IN ('flat', '360'));

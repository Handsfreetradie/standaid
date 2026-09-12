-- Lets a tradie customise which fitting presets show in the Setout
-- palette's "Quick pick" grid — an ordered list of preset keys (see
-- ALL_QUICK_PICK_PRESETS in FittingPalette.tsx). NULL means "use the
-- built-in default set" rather than an empty grid, so existing accounts see
-- no change until they actually customise it.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS setout_quick_picks TEXT[];

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Env vars injected by Lovable/Vite — fallback to hardcoded values so the
// app never crashes on missing config (anon key is safe to commit)
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://wyxeqkgpwkcckyntqcns.supabase.co";

// Prefer VITE_SUPABASE_ANON_KEY (JWT format) — required for edge function gateway auth.
// The newer sb_publishable_... format does NOT work as the apikey header.
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5eGVxa2dwd2tjY2t5bnRxY25zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzc4NzUsImV4cCI6MjA4OTgxMzg3NX0.vA_ZhRkgmrOgTIwT4_C-tEEQ81Mf4AvuyTD9Yety2Ao";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
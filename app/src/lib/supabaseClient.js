import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// When env vars are missing the app renders a setup notice instead of crashing.
export const isConfigured = Boolean(url && key);
export const supabase = isConfigured ? createClient(url, key) : null;

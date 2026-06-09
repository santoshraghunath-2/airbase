import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

// Using untyped client — explicit Row types are applied at call sites via `as`.
// Generate typed bindings with `supabase gen types` when the DB is deployed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = createClient<any>(supabaseUrl, supabaseAnonKey);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const realtimeClient = createClient<any>(supabaseUrl, supabaseAnonKey);

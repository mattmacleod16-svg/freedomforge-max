/**
 * FreedomForge — Supabase Client
 *
 * Provides browser and server Supabase clients.
 * Uses NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY for the
 * browser/edge client (safe to expose), and SUPABASE_SERVICE_ROLE_KEY
 * for privileged server-side operations (never sent to the client).
 *
 * Usage:
 *   import { getSupabaseBrowserClient } from '@/lib/supabase/client';
 *   const supabase = getSupabaseBrowserClient();
 *   const { data, error } = await supabase.from('table').select();
 */

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Lazy-load the Supabase JS client and create a browser-safe client.
 * Uses the public anon key — safe for client-side code.
 */
export async function getSupabaseBrowserClient() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !anon) {
    throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, anon);
}

/**
 * Lazy-load and create a privileged server-side Supabase client.
 * Uses the service role key — NEVER expose to the browser.
 */
export async function getSupabaseServerClient() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  || '';
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) {
    throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY for privileged access).');
  }
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

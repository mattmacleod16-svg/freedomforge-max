'use client';

import { useState } from 'react';
import { SessionContextProvider } from '@supabase/auth-helpers-react';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/auth-helpers-nextjs';

interface SupabaseProviderProps {
  children: React.ReactNode;
  initialSession?: Session | null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Wraps the application with Supabase's SessionContextProvider so that
 * client components can call useSupabaseClient() / useSession().
 *
 * When NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not
 * configured the provider silently renders its children without context —
 * allowing the app to build and run without Supabase configured.
 */
export default function SupabaseProvider({
  children,
  initialSession = null,
}: SupabaseProviderProps) {
  const [supabaseClient] = useState<SupabaseClient | null>(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storageKey: 'supabase-auth-token', persistSession: true },
    });
  });

  if (!supabaseClient) {
    return <>{children}</>;
  }

  return (
    <SessionContextProvider
      supabaseClient={supabaseClient}
      initialSession={initialSession}
    >
      {children}
    </SessionContextProvider>
  );
}

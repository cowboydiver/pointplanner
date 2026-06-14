import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { SignIn } from '../components/SignIn';

interface AuthContextValue {
  /** The active Supabase session, or null when signed out. */
  session: Session | null;
  /** Sign the current user out and return to the sign-in screen. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Gates the whole application behind Supabase authentication.
 *
 * - Signed-out → renders <SignIn />.
 * - Signed-in  → renders `children`.
 *
 * Session is hydrated from localStorage by supabase-js on mount, then kept
 * current via `onAuthStateChange`. The `null` initial state renders nothing
 * (avoids a flash of sign-in screen for already-authenticated users) while we
 * await `getSession()`.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  // `undefined` = still loading; `null` = loaded, no session; Session = loaded, authenticated.
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // No credentials configured — show sign-in screen immediately (it will
      // display a "not configured" notice so the user knows what to do).
      // Deferred via Promise so the setState is not synchronous inside the effect body.
      Promise.resolve().then(() => setSession(null));
      return;
    }

    const supabase = getSupabaseClient();

    // Hydrate the session stored in localStorage from a previous visit.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    // Keep the session up to date on every auth event (magic-link callback,
    // token refresh, explicit sign-out, etc.).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut(): Promise<void> {
    if (isSupabaseConfigured()) {
      await getSupabaseClient().auth.signOut();
    }
    setSession(null);
  }

  // Still determining session — render nothing to avoid flicker.
  if (session === undefined) return null;

  const value: AuthContextValue = { session, signOut };

  return (
    <AuthContext.Provider value={value}>
      {session ? children : <SignIn />}
    </AuthContext.Provider>
  );
}

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../data/supabase';

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Maps a Supabase session to our context user, with a lowercased email. */
function userFromSession(session: Session | null): AuthUser | null {
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: (session.user.email ?? '').toLowerCase(),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const u = userFromSession(data.session);
      setUser(u);
      setStatus(u ? 'signed-in' : 'signed-out');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = userFromSession(session);
      setUser(u);
      setStatus(u ? 'signed-in' : 'signed-out');
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    status,
    user,
    async signInWithEmail(email) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          // Magic-link target. window.location.origin is scheme+host only, so
          // it omits the Vite base path — on GitHub Pages the app is served
          // under /pointplanner/, and origin alone would land on the org root
          // (404). import.meta.env.BASE_URL is '/pointplanner/' in the prod
          // build and '/' in dev, so this resolves to the real app URL. The
          // resulting URL must be in the dashboard's Redirect URLs allow-list.
          emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
        },
      });
      return { error: error ? error.message : null };
    },
    async verifyOtp(email, token) {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      return { error: error ? error.message : null };
    },
    async signOut() {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

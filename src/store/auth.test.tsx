import { useEffect } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';

// --- Mock the supabase client module ---
const getSession = vi.fn();
const onAuthStateChange = vi.fn();
const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const signOut = vi.fn();
const unsubscribe = vi.fn();

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: (cb: unknown) => onAuthStateChange(cb),
      signInWithOtp: (args: unknown) => signInWithOtp(args),
      verifyOtp: (args: unknown) => verifyOtp(args),
      signOut: () => signOut(),
    },
  },
}));

import { AuthProvider, useAuth, type AuthContextValue } from './auth';

function makeSession(email: string): Session {
  // Only the fields our code reads matter; cast through unknown for the rest.
  return {
    user: { id: 'user-1', email },
  } as unknown as Session;
}

// Captures the latest context value so tests can call its methods.
const authRef: { current: AuthContextValue | null } = { current: null };

function Probe() {
  const auth = useAuth();
  useEffect(() => {
    authRef.current = auth;
  });
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="email">{auth.user?.email ?? ''}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    authRef.current = null;
    getSession.mockReset();
    onAuthStateChange.mockReset();
    signInWithOtp.mockReset();
    verifyOtp.mockReset();
    signOut.mockReset();
    unsubscribe.mockReset();

    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
  });

  it('starts in loading then transitions to signed-out when no session', async () => {
    // Never-resolving session keeps us in loading initially.
    let resolveSession: (v: { data: { session: Session | null } }) => void = () => {};
    getSession.mockReturnValue(
      new Promise(resolve => {
        resolveSession = resolve;
      }),
    );

    renderProvider();
    expect(screen.getByTestId('status').textContent).toBe('loading');

    await act(async () => {
      resolveSession({ data: { session: null } });
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));
    expect(screen.getByTestId('email').textContent).toBe('');
  });

  it('transitions to signed-in when a session exists, with lowercased email', async () => {
    getSession.mockResolvedValue({ data: { session: makeSession('Jane@Example.COM') } });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-in'));
    expect(screen.getByTestId('email').textContent).toBe('jane@example.com');
  });

  it('signInWithEmail calls signInWithOtp with shouldCreateUser', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderProvider();
    await waitFor(() => expect(authRef.current).not.toBeNull());

    const result = await authRef.current!.signInWithEmail('me@example.com');
    expect(result).toEqual({ error: null });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'me@example.com',
      options: { shouldCreateUser: true },
    });
  });

  it('signInWithEmail surfaces the error message', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    signInWithOtp.mockResolvedValue({ error: { message: 'rate limited' } });
    renderProvider();
    await waitFor(() => expect(authRef.current).not.toBeNull());

    const result = await authRef.current!.signInWithEmail('me@example.com');
    expect(result).toEqual({ error: 'rate limited' });
  });

  it('verifyOtp calls verifyOtp with type email', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderProvider();
    await waitFor(() => expect(authRef.current).not.toBeNull());

    const result = await authRef.current!.verifyOtp('me@example.com', '123456');
    expect(result).toEqual({ error: null });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'me@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('signOut calls through to the client', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderProvider();
    await waitFor(() => expect(authRef.current).not.toBeNull());

    await authRef.current!.signOut();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('keeps status in sync via onAuthStateChange', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));

    // The provider registered exactly one auth-state listener.
    const listener = onAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: Session | null,
    ) => void;

    await act(async () => {
      listener('SIGNED_IN', makeSession('NEW@User.com'));
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-in'));
    expect(screen.getByTestId('email').textContent).toBe('new@user.com');
  });

  it('unsubscribes from auth state changes on unmount', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { unmount } = renderProvider();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('signed-out'));

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

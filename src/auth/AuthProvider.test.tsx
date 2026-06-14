/**
 * Tests for AuthProvider — verifies the gating behaviour:
 *   signed-out → sign-in screen
 *   signed-in  → app shell (children)
 *
 * @supabase/supabase-js is mocked at the module level so no real network or
 * credentials are needed.  The mock exposes a `__mockSession` setter so
 * individual tests can control which session is returned by getSession().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider, useAuth } from './AuthProvider';

// ── Supabase mock ────────────────────────────────────────────────────────────

type AuthStateChangeCb = (event: string, session: object | null) => void;

let _mockSession: object | null = null;
let _authStateListeners: AuthStateChangeCb[] = [];

const mockSignInWithOtp = vi.fn().mockResolvedValue({ error: null });
const mockVerifyOtp = vi.fn().mockResolvedValue({ error: null });
const mockSignOut = vi.fn().mockResolvedValue({ error: null });

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: _mockSession }, error: null }),
      onAuthStateChange: (cb: AuthStateChangeCb) => {
        _authStateListeners.push(cb);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                _authStateListeners = _authStateListeners.filter(l => l !== cb);
              },
            },
          },
        };
      },
      signInWithOtp: mockSignInWithOtp,
      verifyOtp: mockVerifyOtp,
      signOut: mockSignOut,
    },
  }),
  isSupabaseConfigured: () => true,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function simulateAuthChange(event: string, session: object | null) {
  _authStateListeners.forEach(cb => cb(event, session));
}

const fakeSession = { user: { id: 'u1', email: 'ada@example.com' } };

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AuthProvider — gating', () => {
  beforeEach(() => {
    _mockSession = null;
    _authStateListeners = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    _authStateListeners = [];
  });

  it('shows sign-in screen when there is no session', async () => {
    render(
      <AuthProvider>
        <div data-testid="app-shell">App Shell</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });

  it('shows children when there is an active session', async () => {
    _mockSession = fakeSession;

    render(
      <AuthProvider>
        <div data-testid="app-shell">App Shell</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('switches to app shell when auth state changes to SIGNED_IN', async () => {
    render(
      <AuthProvider>
        <div data-testid="app-shell">App Shell</div>
      </AuthProvider>,
    );

    // Starts signed-out
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });

    // Simulate the magic-link callback
    act(() => {
      simulateAuthChange('SIGNED_IN', fakeSession);
    });

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });
  });

  it('returns to sign-in when auth state changes to SIGNED_OUT', async () => {
    _mockSession = fakeSession;

    render(
      <AuthProvider>
        <div data-testid="app-shell">App Shell</div>
      </AuthProvider>,
    );

    // Starts signed-in
    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });

    // Simulate sign-out
    act(() => {
      simulateAuthChange('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    });
  });
});

describe('useAuth hook', () => {
  beforeEach(() => {
    _mockSession = fakeSession;
    _authStateListeners = [];
  });

  afterEach(() => {
    _authStateListeners = [];
  });

  it('exposes session, user email, and signOut', async () => {
    let capturedAuth: ReturnType<typeof useAuth> | null = null;

    function Inspector() {
      capturedAuth = useAuth();
      return null;
    }

    render(
      <AuthProvider>
        <Inspector />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(capturedAuth?.session).toBeTruthy();
    });

    expect(capturedAuth!.session).toEqual(fakeSession);
    expect(capturedAuth!.signOut).toBeTypeOf('function');
  });
});

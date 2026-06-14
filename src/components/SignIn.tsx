import { useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';

/**
 * Sign-in screen shown when there is no active Supabase session.
 *
 * Flow:
 *   1. User enters their email and clicks "Send magic link".
 *      → calls signInWithOtp({ email }) — Supabase sends an email with both a
 *        magic link (handled automatically by detectSessionInUrl) and a 6-digit
 *        OTP code.
 *   2. If the user received the OTP code instead of clicking the link they can
 *      type it into the code field and click "Verify code".
 *      → calls verifyOtp({ email, token, type: 'email' })
 *
 * If Supabase is not configured the form is replaced by a clear notice.
 */
export function SignIn() {
  const configured = isSupabaseConfigured();

  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: authErr } = await getSupabaseClient().auth.signInWithOtp({ email });
      if (authErr) {
        setError(authErr.message);
      } else {
        setCodeSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: authErr } = await getSupabaseClient().auth.verifyOtp({
        email,
        token: otp,
        type: 'email',
      });
      if (authErr) {
        setError(authErr.message);
      }
      // On success, AuthProvider's onAuthStateChange fires and shows the app.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="signin-root">
      <div className="signin-card">
        <div className="brand signin-brand">
          <span className="roundel" />
          PointPlanner
        </div>

        <h1 className="signin-heading">Sign in</h1>

        {!configured ? (
          <p className="signin-notice">
            Supabase is not configured. Set{' '}
            <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>.
          </p>
        ) : !codeSent ? (
          <form onSubmit={handleRequestLink} className="signin-form">
            <label className="signin-label">
              Email address
              <input
                className="signin-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
                placeholder="you@example.com"
              />
            </label>

            {error && <p className="signin-error">{error}</p>}

            <button
              className="signin-btn"
              type="submit"
              disabled={loading || !email}
            >
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="signin-form">
            <p className="signin-check-email">
              Check your email — we sent a link and a 6-digit code to{' '}
              <strong>{email}</strong>. Click the link or enter the code below.
            </p>

            <label className="signin-label">
              One-time code
              <input
                className="signin-input signin-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={loading}
                placeholder="123456"
              />
            </label>

            {error && <p className="signin-error">{error}</p>}

            <button
              className="signin-btn"
              type="submit"
              disabled={loading || otp.length < 6}
            >
              {loading ? 'Verifying…' : 'Verify code'}
            </button>

            <button
              className="signin-btn signin-btn--ghost"
              type="button"
              onClick={() => {
                setCodeSent(false);
                setOtp('');
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

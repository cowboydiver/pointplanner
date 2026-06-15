import { useState } from 'react';
import { useAuth } from '../store/auth';
import { isSupabaseConfigured } from '../data/supabase';

type Step = 'email' | 'code';

export function SignIn() {
  const { signInWithEmail, verifyOtp } = useAuth();
  const configured = isSupabaseConfigured();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter your email address.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await signInWithEmail(trimmed);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setStep('code');
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Enter the code from your email.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await verifyOtp(email.trim(), trimmed);
    setBusy(false);
    if (error) {
      setError(error);
    }
    // On success, the auth state change reveals the app shell.
  }

  return (
    <div className="empty-state-root">
      <header className="topbar empty-state-topbar">
        <div className="brand">
          <span className="roundel" />
          PointPlanner
        </div>
      </header>
      <div className="empty-state-body">
        <div className="empty-state-card">
          {step === 'email' ? (
            <>
              <div className="empty-state-title">Sign in</div>
              <div className="empty-state-sub">
                Enter your email and we'll send you a one-time sign-in code.
              </div>
              <form className="signin-form" onSubmit={handleSendCode}>
                <input
                  className="signin-input"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
                <button className="tb-btn primary signin-btn" type="submit" disabled={busy}>
                  {busy ? 'Sending…' : 'Send code'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="empty-state-title">Check your email</div>
              <div className="empty-state-sub">
                We emailed a code and a sign-in link to <strong>{email.trim()}</strong>. Enter the
                code below, or click the link in the email.
              </div>
              <form className="signin-form" onSubmit={handleVerify}>
                <input
                  className="signin-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
                <button className="tb-btn primary signin-btn" type="submit" disabled={busy}>
                  {busy ? 'Verifying…' : 'Verify'}
                </button>
              </form>
              <button
                className="signin-link"
                type="button"
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                }}
                disabled={busy}
              >
                Use a different email
              </button>
            </>
          )}

          {error && <div className="signin-error">{error}</div>}

          {!configured && (
            <div className="signin-notice">
              Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and{' '}
              <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to enable sign-in.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

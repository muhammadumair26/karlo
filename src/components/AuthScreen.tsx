import { useState } from 'react';
import { supabase } from '../supabase';

const appUrl = () => window.location.origin + window.location.pathname;

/** Invite-only sign-in: accounts are created by the owner in Supabase, there is no public sign-up. */
export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
      if (error) setError(error.message);
      else setInfo('If that email has an account, a reset link is on its way.');
    }
    setBusy(false);
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand"><img className="brand-logo large" src={`${import.meta.env.BASE_URL}karlo-logo.svg`} alt="" />Karlo</div>
        <h2>{mode === 'signin' ? 'Sign in' : 'Reset password'}</h2>
        <p className="muted">
          {mode === 'signin' ? 'Access is by invitation only.' : 'We will email you a link to set a new password.'}
        </p>
        <input
          type="email"
          placeholder="Email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {mode === 'signin' && (
          <input
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
        </button>
        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(mode === 'signin' ? 'forgot' : 'signin');
            setError(null);
            setInfo(null);
          }}
        >
          {mode === 'signin' ? 'Forgot password?' : 'Back to sign in'}
        </button>
      </form>
    </div>
  );
}

/** Shown after opening an invite or password-reset link. */
export function SetPasswordScreen({ email, onDone }: { email: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand"><img className="brand-logo large" src={`${import.meta.env.BASE_URL}karlo-logo.svg`} alt="" />Karlo</div>
        <h2>Set your password</h2>
        <p className="muted">for {email}</p>
        <input
          type="password"
          placeholder="New password (min 6 characters)"
          autoComplete="new-password"
          minLength={6}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          placeholder="Confirm password"
          autoComplete="new-password"
          minLength={6}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <div className="auth-error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  );
}

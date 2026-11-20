import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { REMEMBER_KEY, rememberMe, supabase } from '../supabase';

import { isNativeApp, publicOrigin } from '../lib/platform';

// Email links (confirm / reset) must open the website, even when sent from the phone app.
const appUrl = () => (isNativeApp ? publicOrigin() + '/' : window.location.origin + window.location.pathname);

const EMAIL_KEY = 'karlo-last-email';
const savedEmail = () => {
  try {
    return rememberMe() ? localStorage.getItem(EMAIL_KEY) ?? '' : '';
  } catch {
    return '';
  }
};

/** Password box with a show/hide eye button. */
function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-field">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

type Mode = 'signin' | 'signup' | 'forgot';

const TITLES: Record<Mode, string> = { signin: 'Sign in', signup: 'Create your account', forgot: 'Reset password' };
const SUBTITLES: Record<Mode, string> = {
  signin: 'Welcome back! Your boards sync across all your devices.',
  signup: 'Free to use. Your boards stay private to you.',
  forgot: 'We will email you a link to set a new password.',
};
const SUBMIT: Record<Mode, string> = { signin: 'Sign in', signup: 'Sign up', forgot: 'Send reset link' };

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(rememberMe);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
    setConfirm('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    setInfo(null);
    if (mode === 'signup' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    // Decide where the session is stored before signing in, and remember (or forget) the email.
    try {
      localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
      if (remember) localStorage.setItem(EMAIL_KEY, email.trim());
      else localStorage.removeItem(EMAIL_KEY);
    } catch {
      /* storage blocked */
    }
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error)
        setError(
          error.message === 'Invalid login credentials'
            ? 'Wrong email or password.'
            : error.message === 'Email not confirmed'
              ? 'Please confirm your email first — check your inbox for the link.'
              : error.message,
        );
    } else if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
      if (error) setError(error.message);
      else if (!data.session) {
        setInfo(`Almost done! We sent a confirmation link to ${email}. Click it, then sign in here.`);
        setPassword('');
        setConfirm('');
        setMode('signin');
      }
      // With a session, App switches to the boards automatically.
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
        <img className="auth-wordmark" src={`${import.meta.env.BASE_URL}karlo-wordmark.png`} alt="Karlo" />
        {mode !== 'forgot' && (
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => switchTo('signin')}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchTo('signup')}>
              Sign up
            </button>
          </div>
        )}
        <h2>{TITLES[mode]}</h2>
        <p className="muted">{SUBTITLES[mode]}</p>
        <input
          type="email"
          placeholder="Email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {mode !== 'forgot' && (
          <PasswordInput
            placeholder={mode === 'signup' ? 'Password (min 6 characters)' : 'Password'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={mode === 'signup' ? 6 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {mode === 'signup' && (
          <PasswordInput
            placeholder="Confirm password"
            autoComplete="new-password"
            minLength={6}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
        {mode !== 'forgot' && (
          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me
          </label>
        )}
        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : SUBMIT[mode]}
        </button>
        {mode === 'signin' && (
          <button type="button" className="auth-switch" onClick={() => switchTo('forgot')}>
            Forgot password?
          </button>
        )}
        {mode === 'signup' && (
          <button type="button" className="auth-switch" onClick={() => switchTo('signin')}>
            Already have an account? Sign in
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" className="auth-switch" onClick={() => switchTo('signin')}>
            Back to sign in
          </button>
        )}
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
        <img className="auth-wordmark" src={`${import.meta.env.BASE_URL}karlo-wordmark.png`} alt="Karlo" />
        <h2>Set your password</h2>
        <p className="muted">for {email}</p>
        <PasswordInput
          placeholder="New password (min 6 characters)"
          autoComplete="new-password"
          minLength={6}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordInput
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

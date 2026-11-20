import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import '../index.css';
import './admin.css';
import { openedFromSetPasswordLink, supabase } from '../supabase';
import * as api from '../lib/api';
import { AdminPanel } from '../components/AdminPanel';

/* Karlo Admin (admin.orionsoftsol.com): a separate site with its own sign-in, for managing clients.
   Only accounts listed as platform admins get past the sign-in; everyone else is turned away. */

const SITE = window.location.origin + import.meta.env.BASE_URL;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ka-page">
      <div className="ka-card">
        <div className="ka-brand">
          <span className="ka-logo">
            <ShieldCheck size={22} />
          </span>
          <div>
            <b>Karlo Admin</b>
            <small>Client management</small>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="ka-pass">
      <input type={show ? 'text' : 'password'} required placeholder={placeholder} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

type Mode = 'signin' | 'setup' | 'forgot' | 'newpass';

function SignIn({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setErr(null);
    setNote(null);
    if ((mode === 'setup' || mode === 'newpass') && password !== password2) return setErr('The two passwords don’t match.');
    if ((mode === 'setup' || mode === 'newpass') && password.length < 10) return setErr('Use at least 10 characters for the admin password.');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'setup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: SITE } });
        if (error) throw error;
        if (!data.session) setNote('Check your inbox and confirm the email, then sign in here.');
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: SITE });
        if (error) throw error;
        setNote('If that account exists, a link to set a new password is on its way.');
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        window.history.replaceState(null, '', import.meta.env.BASE_URL);
        window.location.reload();
      }
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };

  const title = { signin: 'Sign in', setup: 'Create the admin login', forgot: 'Reset password', newpass: 'Choose a new password' }[mode];
  return (
    <Shell>
      <form className="ka-form" onSubmit={submit}>
        <h1>{title}</h1>
        {mode === 'setup' && <p className="ka-muted">One-time setup. This login is separate from your normal Karlo account.</p>}
        {mode !== 'newpass' && (
          <input type="email" required placeholder="Admin email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
        {(mode === 'signin' || mode === 'setup' || mode === 'newpass') && (
          <PasswordInput value={password} onChange={setPassword} placeholder={mode === 'signin' ? 'Password' : 'New password (10+ characters)'} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
        )}
        {(mode === 'setup' || mode === 'newpass') && <PasswordInput value={password2} onChange={setPassword2} placeholder="Type it again" autoComplete="new-password" />}
        {err && <div className="ka-error">{err}</div>}
        {note && <div className="ka-note">{note}</div>}
        <button className="ka-btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : { signin: 'Sign in', setup: 'Create login', forgot: 'Send reset link', newpass: 'Save password' }[mode]}
        </button>
        {mode === 'signin' ? (
          <button type="button" className="ka-link" onClick={() => setMode('forgot')}>
            Forgot password?
          </button>
        ) : mode !== 'newpass' ? (
          <button type="button" className="ka-link" onClick={() => setMode('signin')}>
            Back to sign in
          </button>
        ) : null}
      </form>
    </Shell>
  );
}

function AdminApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [recovery] = useState(openedFromSetPasswordLink);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) return;
    let live = true;
    void api.isPlatformAdmin().then((yes) => live && setAllowed(yes));
    return () => {
      live = false;
    };
  }, [session]);

  const signOut = () => void supabase?.auth.signOut().then(() => setAllowed(null));

  if (!supabase) return <Shell>Not configured.</Shell>;
  if (session === undefined) return <div className="ka-page" />;
  if (session && recovery) return <SignIn initial="newpass" />;
  if (!session) return <SignIn initial={new URLSearchParams(window.location.search).has('setup') ? 'setup' : 'signin'} />;
  if (allowed === null) return <div className="ka-page" />;
  if (!allowed)
    return (
      <Shell>
        <div className="ka-form">
          <h1>No admin access</h1>
          <p className="ka-muted">{session.user.email} isn’t an admin account. Sign in with the admin login.</p>
          <button className="ka-btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </Shell>
    );
  return (
    <div className="app ka-app">
      <AdminPanel account={session.user.email ?? ''} onSignOut={signOut} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);

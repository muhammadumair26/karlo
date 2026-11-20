import { Fingerprint, KeyRound, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useBootDone } from '../lib/boot';
import { appLockAvailable, appLockOn, requestUnlock, setAppLock } from '../lib/appLock';
import {
  addPasskey,
  disableTotp,
  friendlyAuthError,
  listPasskeys,
  passkeysSupported,
  removePasskey,
  startTotp,
  totpFactors,
  verifyTotp,
  type PasskeyItem,
  type TotpFactor,
} from '../lib/security';
import { supabase } from '../supabase';
import { askConfirm, showAlert } from './dialog';
import { Modal } from './ui';

const when = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Security & sign-in: passkeys (Face ID / fingerprint) and two-step verification. */
export function SecurityModal({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<PasskeyItem[] | null>(null);
  const [factors, setFactors] = useState<TotpFactor[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [lockOn, setLockOn] = useState(() => appLockOn());
  const toggleLock = async () => {
    setErr(null);
    // Confirm with the phone's own fingerprint / screen lock before switching either way.
    const r = await requestUnlock(lockOn ? 'Turn off app lock' : 'Turn on app lock');
    if (!r.ok) {
      if (r.reason) setErr(r.reason);
      return;
    }
    setAppLock(!lockOn);
    setLockOn(!lockOn);
  };

  const load = useCallback(async () => {
    try {
      setKeys(await listPasskeys());
    } catch {
      setKeys([]);
    }
    try {
      setFactors(await totpFactors());
    } catch {
      setFactors([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const verified = (factors ?? []).filter((f) => f.status === 'verified');

  const doAdd = async () => {
    setBusy('add');
    setErr(null);
    try {
      await addPasskey();
      await load();
      void showAlert({ title: 'Passkey added', message: 'Next time, tap “Sign in with passkey” and use Face ID, your fingerprint or your device PIN.', tone: 'access' });
    } catch (e) {
      setErr(friendlyAuthError(e));
    }
    setBusy(null);
  };

  const doRemove = async (k: PasskeyItem) => {
    if (!(await askConfirm({ title: 'Remove this passkey?', message: `${k.friendly_name || 'This passkey'} won't be able to sign in to Karlo any more.`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await removePasskey(k.id);
      await load();
    } catch (e) {
      setErr(friendlyAuthError(e));
    }
  };

  const beginTotp = async () => {
    setBusy('totp');
    setErr(null);
    try {
      setSetup(await startTotp());
      setCode('');
    } catch (e) {
      setErr(friendlyAuthError(e));
    }
    setBusy(null);
  };

  const confirmTotp = async () => {
    if (!setup) return;
    setBusy('verify');
    setErr(null);
    try {
      await verifyTotp(setup.factorId, code);
      setSetup(null);
      await load();
      void showAlert({ title: 'Two-step sign-in is on', message: 'From now on Karlo asks for a 6-digit code from your authenticator app after your password.', tone: 'access' });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  };

  const turnOff = async () => {
    if (!(await askConfirm({ title: 'Turn off two-step sign-in?', message: 'Your account will only need your password (or a passkey) to sign in.', confirmLabel: 'Turn off', tone: 'danger' }))) return;
    setErr(null);
    try {
      for (const f of verified) await disableTotp(f.id);
      await supabase?.auth.refreshSession();
      await load();
    } catch (e) {
      setErr(friendlyAuthError(e));
    }
  };

  return (
    <Modal title="Security & sign-in" onClose={onClose}>
      <div className="ex-form sec">
        {err && <div className="auth-error">{err}</div>}

        {appLockAvailable() && (
          <section className="sec-block">
            <div className="sec-head">
              <Smartphone size={20} />
              <div>
                <strong>App lock</strong>
                <span className="muted">Stay signed in and open Karlo with your fingerprint, face or screen lock — no email or password.</span>
              </div>
            </div>
            <div className="sec-toggle-row">
              <span className="muted">{lockOn ? 'On — Karlo asks to unlock when you open it.' : 'Off'}</span>
              <button type="button" role="switch" aria-checked={lockOn} aria-label="App lock" className={`rs-toggle ${lockOn ? 'on' : ''}`} onClick={() => void toggleLock()}>
                <span />
              </button>
            </div>
          </section>
        )}
        <section className="sec-block">
          <div className="sec-head">
            <Fingerprint size={20} />
            <div>
              <strong>Passkeys</strong>
              <span className="muted">Sign in with Face ID, your fingerprint or your device PIN — no password to type.</span>
            </div>
          </div>
          {!passkeysSupported() ? (
            <p className="muted sec-note">This browser doesn't support passkeys. Try Chrome, Safari or Edge on an up-to-date device.</p>
          ) : (
            <>
              {keys === null ? (
                <p className="muted sec-note">Loading…</p>
              ) : keys.length === 0 ? (
                <p className="muted sec-note">No passkeys yet. Add one on each phone or computer you use.</p>
              ) : (
                <ul className="sec-list">
                  {keys.map((k) => (
                    <li key={k.id}>
                      <KeyRound size={16} />
                      <span className="sec-name">
                        {k.friendly_name || 'Passkey'}
                        <span className="muted">
                          Added {when(k.created_at)}
                          {k.last_used_at ? ` · last used ${when(k.last_used_at)}` : ''}
                        </span>
                      </span>
                      <button className="icon-btn" aria-label="Remove passkey" title="Remove" onClick={() => doRemove(k)}>
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button className="btn primary sec-btn" onClick={doAdd} disabled={busy === 'add'}>
                <Fingerprint size={15} /> {busy === 'add' ? 'Follow your device’s prompt…' : 'Add a passkey on this device'}
              </button>
            </>
          )}
        </section>

        <section className="sec-block">
          <div className="sec-head">
            <ShieldCheck size={20} />
            <div>
              <strong>Two-step sign-in</strong>
              <span className="muted">After your password, also enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</span>
            </div>
            {factors !== null && <span className={`sec-badge ${verified.length ? 'on' : ''}`}>{verified.length ? 'On' : 'Off'}</span>}
          </div>
          {setup ? (
            <div className="sec-setup">
              <ol>
                <li>Open your authenticator app and scan this code.</li>
                <li>Type the 6-digit code it shows.</li>
              </ol>
              <img className="sec-qr" src={setup.qr} alt="QR code for your authenticator app" />
              <p className="muted sec-note">
                Can't scan? Enter this key: <code className="sec-secret">{setup.secret}</code>
              </p>
              <div className="sec-code">
                <Smartphone size={16} />
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && confirmTotp()}
                  autoFocus
                />
                <button className="btn primary" disabled={code.length !== 6 || busy === 'verify'} onClick={confirmTotp}>
                  {busy === 'verify' ? 'Checking…' : 'Turn on'}
                </button>
              </div>
              <button className="btn ghost small" onClick={() => setSetup(null)}>
                Cancel
              </button>
            </div>
          ) : verified.length ? (
            <button className="btn ghost sec-btn danger-text" onClick={turnOff}>
              Turn off two-step sign-in
            </button>
          ) : (
            <button className="btn primary sec-btn" onClick={beginTotp} disabled={busy === 'totp' || factors === null}>
              <ShieldCheck size={15} /> Set up two-step sign-in
            </button>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** Shown after a password sign-in when two-step is on: asks for the 6-digit code. */
export function SecondStepScreen({ onDone }: { onDone: () => void }) {
  useBootDone();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const f = (await totpFactors()).find((x) => x.status === 'verified');
      if (!f) return onDone();
      await verifyTotp(f.id, code);
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <img className="auth-wordmark" src={`${import.meta.env.BASE_URL}karlo-wordmark.png`} alt="Karlo" />
        <h2>Two-step sign-in</h2>
        <p className="muted">Enter the 6-digit code from your authenticator app.</p>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          autoFocus
          className="sec-code-big"
        />
        {err && <div className="auth-error">{err}</div>}
        <button className="btn primary" disabled={code.length !== 6 || busy}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        <button type="button" className="auth-switch" onClick={() => supabase?.auth.signOut()}>
          Use a different account
        </button>
      </form>
    </div>
  );
}

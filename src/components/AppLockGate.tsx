import { App as CapApp } from '@capacitor/app';
import { Fingerprint, LogOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { appLockOn, requestUnlock, RELOCK_AFTER_MS } from '../lib/appLock';
import { isNativeApp } from '../lib/platform';
import { supabase } from '../supabase';

/** Covers Karlo with a lock screen until the phone's fingerprint / face / screen lock confirms it's you. */
export function AppLockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(() => appLockOn());
  const [msg, setMsg] = useState<string | null>(null);
  const asking = useRef(false);
  const hiddenAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    setMsg(null);
    const r = await requestUnlock();
    asking.current = false;
    if (r.ok) setLocked(false);
    else if (r.reason) setMsg(r.reason);
  }, []);

  // Ask straight away whenever the lock screen appears (after the opening animation has had a moment).
  useEffect(() => {
    if (!locked) return;
    const t = window.setTimeout(() => void unlock(), 700);
    return () => window.clearTimeout(t);
  }, [locked, unlock]);

  // Lock again after the app has been in the background for a while; follow the setting being switched.
  useEffect(() => {
    if (!isNativeApp) return;
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS && appLockOn()) setLocked(true);
    });
    const onSetting = () => !appLockOn() && setLocked(false);
    window.addEventListener('karlo:applock', onSetting);
    return () => {
      void sub.then((s) => s.remove());
      window.removeEventListener('karlo:applock', onSetting);
    };
  }, []);

  return (
    <>
      {children}
      {locked && (
        <div className="app-lock" role="dialog" aria-modal="true" aria-label="Karlo is locked">
          <div className="app-lock-box">
            <div className="app-lock-tile">
              <img src={`${import.meta.env.BASE_URL}karlo-icon.png`} alt="" />
            </div>
            <h2>Karlo is locked</h2>
            <p>Use your fingerprint, face or screen lock to open your boards.</p>
            <button className="auth-submit app-lock-btn" onClick={() => void unlock()}>
              <Fingerprint size={20} />
              <span>Unlock</span>
            </button>
            {msg && <p className="app-lock-msg">{msg}</p>}
          </div>
          <button className="app-lock-out" onClick={() => void supabase?.auth.signOut()}>
            <LogOut size={14} /> Sign out instead
          </button>
        </div>
      )}
    </>
  );
}

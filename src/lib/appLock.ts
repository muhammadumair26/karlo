import { isNativeApp } from './platform';

/**
 * App lock (phone app): stay signed in, and unlock Karlo with the phone's fingerprint, face or screen lock
 * instead of typing an email and password. The check itself is done by Android (BiometricPrompt).
 */
type Native = { canLock?: () => boolean; unlock?: (title: string) => void };
const native = () => (window as unknown as { KarloNative?: Native }).KarloNative;
const KEY = 'karlo-app-lock';
/** Lock again when the app comes back after being in the background this long. */
export const RELOCK_AFTER_MS = 30_000;

export function appLockAvailable(): boolean {
  if (!isNativeApp) return false;
  try {
    return native()?.canLock?.() === true;
  } catch {
    return false;
  }
}

export function appLockOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1' && appLockAvailable();
  } catch {
    return false;
  }
}

export function setAppLock(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('karlo:applock'));
}

/** Ask the phone to confirm it's you. Resolves true when unlocked. */
export function requestUnlock(title = 'Unlock Karlo'): Promise<{ ok: boolean; reason: string }> {
  return new Promise((resolve) => {
    const n = native();
    if (!n?.unlock) return resolve({ ok: false, reason: 'Not available on this device' });
    const done = (e: Event) => {
      window.removeEventListener('karlo:unlock', done);
      resolve((e as CustomEvent<{ ok: boolean; reason: string }>).detail);
    };
    window.addEventListener('karlo:unlock', done);
    n.unlock(title);
  });
}

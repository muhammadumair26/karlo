import { useEffect } from 'react';

/**
 * The opening animation lives in index.html (#boot) so it paints before any JavaScript loads and
 * continues the phone's own launch screen without a white flash. It fades away once the first real
 * screen (sign-in or your boards) is on screen, but never before its intro has played.
 */
const INTRO_MS = 1150;
let done = false;

export function hideBoot() {
  if (done) return;
  done = true;
  const el = document.getElementById('boot');
  if (!el) return;
  const wait = Math.max(0, INTRO_MS - performance.now());
  window.setTimeout(() => {
    el.classList.add('boot-out');
    window.setTimeout(() => el.remove(), 520);
  }, wait);
}

/** Hide the opening animation once `when` is true (the screen calling this is ready to be seen). */
export function useBootDone(when = true) {
  useEffect(() => {
    if (when) hideBoot();
  }, [when]);
}

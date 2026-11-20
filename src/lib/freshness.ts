declare const __BUILD_ID__: string;

/**
 * If a newer Karlo has been published than the page we're running, load it now. A changed address (?v=…)
 * skips the 10-minute copy that phones keep of the start page. Checked at start and whenever the app returns.
 */
export function keepFresh() {
  if (import.meta.env.DEV) return;
  const check = async () => {
    try {
      const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return;
      const { id } = (await r.json()) as { id?: string };
      if (!id || id === __BUILD_ID__) return;
      const url = new URL(location.href);
      if (url.searchParams.get('v') === id) return; // already tried this one
      url.searchParams.set('v', id);
      location.replace(url.toString());
    } catch {
      /* offline: keep what we have */
    }
  };
  void check();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void check());
}

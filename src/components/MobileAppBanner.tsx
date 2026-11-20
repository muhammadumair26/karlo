import { Share, X } from 'lucide-react';
import { useState } from 'react';
import { isNativeApp } from '../lib/platform';

const KEY = 'karlo-app-banner-dismissed';
const WEEK = 7 * 24 * 3600 * 1000;
const ANDROID_PACKAGE = 'com.orionsoftsol.karlo';

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isAndroid = /Android/i.test(ua);
const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

function dismissedRecently() {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < WEEK;
  } catch {
    return false;
  }
}

/**
 * On a phone's browser, offer the app: Android opens the installed app at the same page (or the download
 * page if it isn't installed); iPhone gets the "Add to Home Screen" tip. Hidden inside the apps.
 */
export function MobileAppBanner() {
  const [show, setShow] = useState(() => !isNativeApp && !standalone && (isAndroid || isIOS) && !dismissedRecently());
  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  const openApp = () => {
    const path = window.location.pathname + window.location.search;
    const fallback = encodeURIComponent(`${window.location.origin}/download/`);
    // Opens Karlo if it's installed, otherwise Android goes to the download page.
    window.location.href = `intent://${window.location.host}${path}#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
  };

  return (
    <div className="app-banner" role="region" aria-label="Get the Karlo app">
      <img src={`${import.meta.env.BASE_URL}karlo-icon.png`} alt="" className="app-banner-icon" />
      <div className="app-banner-text">
        <strong>Karlo works better in the app</strong>
        {isAndroid ? (
          <span>Faster, full screen, with voice and notifications.</span>
        ) : (
          <span>
            Tap <Share size={12} className="app-banner-share" /> Share, then <b>Add to Home Screen</b>.
          </span>
        )}
      </div>
      {isAndroid && (
        <button className="btn primary app-banner-open" onClick={openApp}>
          Open app
        </button>
      )}
      <button className="icon-btn app-banner-close" onClick={dismiss} aria-label="Not now" title="Not now">
        <X size={16} />
      </button>
    </div>
  );
}

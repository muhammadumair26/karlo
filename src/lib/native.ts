import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNativeApp } from './platform';

// A karlo.orionsoftsol.com link that opened the app before the boards were ready.
let pendingLink: { boardId: string; cardId: string | null } | null = null;
export const takePendingLink = () => {
  const l = pendingLink;
  pendingLink = null;
  return l;
};
export function openLink(url: string) {
  try {
    const u = new URL(url);
    const boardId = u.searchParams.get('board');
    if (!boardId) return;
    const target = { boardId, cardId: u.searchParams.get('card') };
    pendingLink = target; // picked up if the boards aren't loaded yet
    window.dispatchEvent(new CustomEvent('karlo:open', { detail: target }));
  } catch {
    /* not a Karlo link */
  }
}

/** Phone-app niceties: status bar colour, Android back button, splash screen. No-ops on the website. */
export function setupNative() {
  if (!isNativeApp) return;
  document.documentElement.classList.add('native-app');
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  void StatusBar.setBackgroundColor({ color: '#1d4ed8' }).catch(() => {});
  void SplashScreen.hide().catch(() => {});

  // karlo.orionsoftsol.com links open in the app (Android app links): go to that board / card.
  void App.addListener('appUrlOpen', ({ url }) => openLink(url));
  void App.getLaunchUrl()
    .then((r) => r?.url && openLink(r.url))
    .catch(() => {});

  // Android back: close the top-most pop-up/panel first, then go back, then leave the app.
  void App.addListener('backButton', ({ canGoBack }) => {
    const overlay = document.querySelector('.lightbox, .modal-backdrop, .notif-panel, .switch-panel, .search-results, .menu, .popover');
    if (overlay) {
      const scrim = document.querySelector<HTMLElement>('.notif-scrim, .switch-scrim');
      if (scrim) scrim.click();
      else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        (document.activeElement as HTMLElement | null)?.blur();
        document.body.click();
      }
    } else if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}

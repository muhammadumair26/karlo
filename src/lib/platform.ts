import { Capacitor } from '@capacitor/core';

/** True inside the iOS/Android app (Capacitor), false on the website. */
export const isNativeApp = Capacitor.isNativePlatform();

/** Public website address — used for links people open from email or share with others. */
export const WEB_URL = 'https://karlo.orionsoftsol.com';

/** Origin to put in shareable links / auth emails (the app's own origin is capacitor://localhost). */
export const publicOrigin = () => (isNativeApp ? WEB_URL : window.location.origin);

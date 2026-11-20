import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '../supabase';
import { openLink } from './native';
import { isNativeApp } from './platform';

/**
 * Phone notifications that arrive even when the Karlo app is closed (Android, through Firebase Cloud Messaging).
 * The phone's notification address ("token") is saved for the signed-in person; the `push` server function
 * sends to it whenever that person gets a Karlo notification.
 */

const firebaseReady = () => {
  try {
    return (window as unknown as { KarloNative?: { firebase?(): boolean } }).KarloNative?.firebase?.() === true;
  } catch {
    return false;
  }
};

let started = false;

export async function enableNativePush(): Promise<'on' | 'off' | 'denied' | 'unavailable'> {
  if (!isNativeApp || !firebaseReady() || !supabase) return 'unavailable';
  const sb = supabase;
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return 'denied';

  if (!started) {
    started = true;
    await PushNotifications.createChannel({ id: 'karlo', name: 'Karlo', description: 'Cards, mentions, reminders', importance: 5, visibility: 1, vibration: true }).catch(() => {});
    await PushNotifications.addListener('registration', ({ value }) => {
      void sb.rpc('register_push_token', { p_token: value, p_platform: 'android' }).then(({ error }) => error && console.warn('Karlo: could not save phone token', error.message));
    });
    await PushNotifications.addListener('registrationError', (e) => console.warn('Karlo: phone notifications unavailable', e.error));
    // Tapping a notification opens that board / card.
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const url = (notification.data as { url?: string } | undefined)?.url;
      if (url) openLink(url);
    });
  }
  await PushNotifications.register();
  return 'on';
}

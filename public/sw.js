/* Karlo service worker: shows push notifications and opens the right card when one is clicked. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Karlo', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Karlo';
  const body = [data.body, data.board].filter(Boolean).join('\n');
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/favicon-64.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = wins.find((w) => new URL(w.url).origin === url.origin);
      if (same) {
        // Reuse the open Karlo tab: ask it to open the card, then bring it forward.
        same.postMessage({ type: 'karlo:open-url', url: url.href });
        return same.focus();
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});

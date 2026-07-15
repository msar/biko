/* global self, clients */
// Imported by the Workbox-generated service worker for Web Push.
self.addEventListener('push', (event) => {
  let payload = { title: 'Biko', body: 'Tenés una notificación', data: { url: '/' } };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // keep defaults
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Biko', {
      body: payload.body || '',
      data: payload.data || { url: '/' },
      icon: '/pwa-192.png',
      badge: '/favicon.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    }),
  );
});

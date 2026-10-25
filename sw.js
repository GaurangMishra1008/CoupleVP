// Minimal service worker so the app can be installed (and appear in the Android share sheet).
// It doesn't cache anything: the app always loads fresh from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

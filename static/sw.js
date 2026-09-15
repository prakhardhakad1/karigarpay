/* Cache only the public application shell. Never cache payroll, photos or auth. */
const CACHE = 'karigarpay-shell-v1';
const PUBLIC = ['/', '/static/app.js', '/static/voice.js', '/static/styles.css', '/manifest.webmanifest', '/static/icons/icon-192.png', '/static/icons/icon-512.png', '/static/icons/maskable-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('karigarpay-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !PUBLIC.includes(url.pathname) || url.search) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(request);
    return cached || new Response('Offline. Reconnect to load KarigarPay.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }));
});

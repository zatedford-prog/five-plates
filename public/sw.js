// Keeps the app's files on the phone so it opens instantly, even with no signal.
// Files are served from the phone first, then quietly refreshed in the background.
// Bump VERSION when the list of files changes.
const VERSION = 'fp-9';
const SHELL = [
  '/', '/index.html', '/app.css', '/fonts/fonts.css',
  '/fonts/nunito-sans.woff2', '/fonts/bricolage-grotesque.woff2',
  '/js/app.js', '/js/logic.js', '/manifest.webmanifest',
  '/icons/apple-touch-icon.png', '/icons/icon-192.png', '/favicon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const key = req.mode === 'navigate' ? '/' : req;
  event.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(key);
    const fresh = fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    if (cached) { event.waitUntil(fresh); return cached; }
    return fresh;
  }));
});

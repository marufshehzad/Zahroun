/* =========================================================================
   Zahroun Service Worker — cache-first for local assets, network-first for HTML
   Scope: all pages at root (e.g. zahroun.com/*.html)
   ========================================================================= */

const CACHE = 'zahroun-v1-20260614d'; // H4-fix: increment this string on every deployment to bust stale JS cache

const PRECACHE = [
  'css/style.css?v=20260614d',
  'js/firebase-config.js',
  'js/store.js',
  'js/products.js',
  'js/cart.js',
  'js/ui.js',
  'js/auth.js',
  'js/promotions.js',
  'js/broadcast.js',
  'js/analytics.js',
  'js/orders.js',
  'js/coupon.js',
  'js/wishlist.js',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'product%20pictures/main%20logo%20white.webp',
];

self.addEventListener('install', e => {
  // cache:'no-cache' revalidates with the server — plain addAll() can be
  // answered by the browser HTTP cache, silently precaching stale files.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(PRECACHE.map(u =>
        fetch(u, { cache: 'no-cache' })
          .then(r => { if (r.ok) return c.put(u, r); })
          .catch(() => {})
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin requests — let Firebase/Cloudinary/CDN go to network
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML navigation (always get fresh pages).
  // cache:'no-cache' forces revalidation with the server — without it the
  // fetch can be answered by the HTTP cache (Firebase serves HTML with
  // max-age=3600), so users kept seeing day-old pages on first load.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for CSS, JS, images, fonts — these are versioned or rarely change
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        // no-cache: revalidate with the server so a stale browser HTTP
        // cache entry can't get permanently baked into the SW cache
        return fetch(request, { cache: 'no-cache' }).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
          }
          return res;
        });
      })
    );
  }
});

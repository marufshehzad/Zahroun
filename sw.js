/* =========================================================================
   Zahroun Service Worker — cache-first for local assets, network-first for HTML
   Scope: all pages at root (e.g. zahroun.com/*.html)
   ========================================================================= */

const CACHE = 'zahroun-v1';

const PRECACHE = [
  'css/style.css',
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
  'favicon.png',
  'product%20pictures/main%20logo%20white.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {})
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

  // Network-first for HTML navigation (always get fresh pages)
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
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
        return fetch(request).then(res => {
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

/* =========================================================================
   ZAHROUN — Product store (Firestore-backed, with instant offline fallback)
   =========================================================================
   Replaces the old hardcoded products.js include on every page.

   Strategy (important): the storefront must NEVER show an empty grid while
   waiting on the network. So we:
     1) publish the bundled products IMMEDIATELY (synchronous, instant render),
     2) then try Firestore in the background and, if it has products, upgrade
        and re-render with the live data.

   Exposes the global `window.products` (so existing page/cart code works
   unchanged) and fires a "products-ready" event that pages render on.
   Product IDs stay NUMERIC to match product.html (parseInt on the URL id).
   ========================================================================= */

import { db } from "./firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { seedProducts } from "./products.js";

const _PROD_KEY = 'zhr_products_v1';
const _PROD_TTL = 2 * 60 * 1000; // 2 minutes — balances nav speed vs. stock accuracy

function normalize(p) {
  let id = p.id;
  if (typeof id === "string" && id.trim() !== "" && !isNaN(Number(id))) {
    id = Number(id);
  }
  const seed = seedProducts.find(s => String(s.id) === String(id));
  const normalized = { ...p, id };
  if (seed) {
    if (normalized.image && !normalized.image.startsWith('http')) {
      normalized.image = seed.image;
    }
    if (normalized.sizeImages) {
      for (const size in normalized.sizeImages) {
        if (normalized.sizeImages[size] && !normalized.sizeImages[size].startsWith('http')) {
          normalized.sizeImages[size] = seed.sizeImages[size] || normalized.sizeImages[size];
        }
      }
    } else if (seed.sizeImages) {
      normalized.sizeImages = seed.sizeImages;
    }
  }
  return normalized;
}

function publish(list, source) {
  window.products = list;
  window.ZahrounStore = {
    ready: true,
    source,
    products: list,
    getById: (id) => {
      if (!id) return null;
      const targetStr = String(id).toLowerCase().trim();
      const numVal = parseInt(targetStr, 10);
      return list.find(p => 
        String(p.id).toLowerCase().trim() === targetStr ||
        (!isNaN(numVal) && Number(p.id) === numVal) ||
        (p.name && p.name.toLowerCase().trim() === targetStr) ||
        (p.name && p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === targetStr)
      ) || null;
    }
  };
  document.dispatchEvent(new Event("products-ready"));
  console.info(`[Zahroun Store] ${list.length} products ready (${source}).`);
}

// 1) Instant render with bundled data — never an empty storefront.
publish(seedProducts.map(normalize).sort((a, b) => (typeof a.id === 'number' && typeof b.id === 'number') ? a.id - b.id : 0), "bundled");

// 2) Upgrade to live data: sessionStorage cache → Firestore (stale-while-revalidate).
//    Cache renders instantly; a fresh fetch still runs in the background and
//    re-publishes live Firestore data so admin edits & new products appear immediately.
(async () => {
  let servedFromCache = false;
  let cachedJson = null;
  try {
    // Fast path: reuse products fetched earlier in this session (cross-page cache)
    try {
      const raw = sessionStorage.getItem(_PROD_KEY);
      if (raw) {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < _PROD_TTL && Array.isArray(data) && data.length) {
          publish(data.map(normalize).sort((a, b) => (typeof a.id === 'number' && typeof b.id === 'number') ? a.id - b.id : 0), "cache");
          servedFromCache = true;
          cachedJson = JSON.stringify(data);
        }
      }
    } catch {}

    const snap = await getDocs(collection(db, "products"));
    if (!snap.empty) {
      const list = snap.docs
        .map(d => normalize({ id: d.id, ...d.data() }))
        .filter(p => p.hidden !== true)
        .sort((a, b) => {
          const numA = Number(a.id), numB = Number(b.id);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return String(a.id).localeCompare(String(b.id));
        });
      try { sessionStorage.setItem(_PROD_KEY, JSON.stringify({ data: list, ts: Date.now() })); } catch {}
      // Always publish live Firestore data if it differs or if coming from bundled
      if (!servedFromCache || JSON.stringify(list) !== cachedJson || window.ZahrounStore?.source === 'bundled') {
        publish(list, "firestore");
      }
    }
  } catch (err) {
    if (!servedFromCache) console.warn("[Zahroun Store] Firestore unavailable; using bundled products.", err);
  }
})();


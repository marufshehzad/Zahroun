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
  const id = typeof p.id === "number" ? p.id : Number(p.id);
  return { ...p, id };
}

function publish(list, source) {
  window.products = list;
  window.ZahrounStore = {
    ready: true,
    source,
    products: list,
    getById: (id) => list.find(p => p.id === Number(id)) || null
  };
  document.dispatchEvent(new Event("products-ready"));
  console.info(`[Zahroun Store] ${list.length} products ready (${source}).`);
}

// 1) Instant render with bundled data — never an empty storefront.
publish(seedProducts.map(normalize).sort((a, b) => a.id - b.id), "bundled");

// 2) Upgrade to live data: sessionStorage cache → Firestore.
(async () => {
  try {
    // Fast path: reuse products fetched earlier in this session (cross-page cache)
    try {
      const raw = sessionStorage.getItem(_PROD_KEY);
      if (raw) {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < _PROD_TTL && Array.isArray(data) && data.length) {
          publish(data.map(normalize).sort((a, b) => a.id - b.id), "cache");
          return;
        }
      }
    } catch {}

    const snap = await getDocs(collection(db, "products"));
    if (!snap.empty) {
      const list = snap.docs
        .map(d => normalize({ id: d.id, ...d.data() }))
        .filter(p => p.hidden !== true)
        .sort((a, b) => a.id - b.id);
      try { sessionStorage.setItem(_PROD_KEY, JSON.stringify({ data: list, ts: Date.now() })); } catch {}
      publish(list, "firestore");
    }
  } catch (err) {
    console.warn("[Zahroun Store] Firestore unavailable; using bundled products.", err);
  }
})();

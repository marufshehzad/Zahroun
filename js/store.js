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

// 2) Upgrade to Firestore data when available.
(async () => {
  try {
    const snap = await getDocs(collection(db, "products"));
    if (!snap.empty) {
      const list = snap.docs
        .map(d => normalize({ id: d.id, ...d.data() }))
        .filter(p => p.hidden !== true)        // admins can hide products
        .sort((a, b) => a.id - b.id);
      publish(list, "firestore");
    }
  } catch (err) {
    console.warn("[Zahroun Store] Firestore unavailable; using bundled products.", err);
  }
})();

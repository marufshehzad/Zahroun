/* =========================================================================
   ZAHROUN — Product store (Firestore-backed, with offline fallback)
   =========================================================================
   Replaces the old hardcoded products.js include on every page.

   What it does:
   - Fetches the "products" collection from Firestore.
   - If Firestore has products, those become the source of truth.
   - If Firestore is empty / unreachable, it falls back to the bundled
     seedProducts so the storefront NEVER renders empty (offline-safe).
   - Exposes the result as the global `window.products` (so existing page
     and cart code keeps working unchanged) and fires a "products-ready"
     event that pages listen for before rendering.

   Product IDs stay NUMERIC to match the existing pages (product.html does
   parseInt on the URL id).
   ========================================================================= */

import { db } from "./firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { seedProducts } from "./products.js";

function normalize(p) {
  // Guarantee a numeric id (Firestore doc data stores id as a number).
  const id = typeof p.id === "number" ? p.id : Number(p.id);
  return { ...p, id };
}

async function loadProducts() {
  let list = seedProducts.map(normalize); // safe default

  try {
    const snap = await getDocs(collection(db, "products"));
    if (!snap.empty) {
      list = snap.docs
        .map(d => normalize({ id: d.id, ...d.data() }))
        .filter(p => p.hidden !== true)        // admins can hide products
        .sort((a, b) => a.id - b.id);
    }
  } catch (err) {
    console.warn("[Zahroun Store] Firestore unavailable, using bundled products.", err);
  }

  window.products = list;
  window.ZahrounStore = {
    ready: true,
    products: list,
    getById: (id) => list.find(p => p.id === Number(id)) || null
  };
  document.dispatchEvent(new Event("products-ready"));
}

loadProducts();

/* =========================================================================
   ZAHROUN — Wishlist module
   Stores wishlist in Firestore (users/{uid}.wishlist) for logged-in users,
   falls back to localStorage ("z_wishlist") for guests.
   Exposes window.Wishlist for non-module scripts (shop.html, index.html).
   ========================================================================= */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LS_KEY = "z_wishlist";

let wishlist = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]").map(Number));
let uid = null;
let synced = false;

onAuthStateChanged(auth, async user => {
  uid = user ? user.uid : null;
  if (uid) {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      const saved = ((snap.exists() && snap.data().wishlist) || []).map(Number);
      const local = JSON.parse(localStorage.getItem(LS_KEY) || "[]").map(Number);
      const merged = new Set([...saved, ...local]);
      wishlist = merged;
      if (local.length) {
        await setDoc(doc(db, "users", uid), { wishlist: [...merged] }, { merge: true });
        localStorage.removeItem(LS_KEY);
      }
    } catch (e) { console.warn("[Wishlist] sync:", e); }
  } else {
    wishlist = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]").map(Number));
  }
  synced = true;
  document.dispatchEvent(new CustomEvent("wishlist-ready"));
  _refreshAllHearts();
});

async function _persist() {
  if (uid) {
    try { await setDoc(doc(db, "users", uid), { wishlist: [...wishlist] }, { merge: true }); }
    catch (e) { console.warn("[Wishlist] persist:", e); }
  } else {
    localStorage.setItem(LS_KEY, JSON.stringify([...wishlist]));
  }
}

function _refreshAllHearts() {
  document.querySelectorAll(".wish-btn[data-pid]").forEach(btn => {
    const id = Number(btn.dataset.pid);
    const on = wishlist.has(id);
    btn.classList.toggle("active", on);
    const icon = btn.querySelector("ion-icon");
    if (icon) icon.setAttribute("name", on ? "heart" : "heart-outline");
  });
}

async function toggle(productId) {
  const id = Number(productId);
  const adding = !wishlist.has(id);
  if (adding) wishlist.add(id); else wishlist.delete(id);
  await _persist();
  _refreshAllHearts();
  document.dispatchEvent(new CustomEvent("wishlist-changed", { detail: { id, added: adding } }));
  return adding;
}

function isIn(productId) { return wishlist.has(Number(productId)); }
function get() { return [...wishlist]; }

/* Expose globally so non-module scripts can call Wishlist.toggle(id) */
window.Wishlist = { toggle, isIn, get };

export { toggle, isIn, get };

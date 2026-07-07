/* Coupon validation for checkout. Exposes window helpers so the non-module
   checkout script can call them. */

import { db } from "./firebase-config.js";
import { auth } from "./firebase-config.js";
import {
  doc, getDoc, updateDoc, increment, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


window.appliedCoupon = null;

window.validateAndApplyCoupon = async function (code, subtotal, cartItems) {
  if (!code) return { valid: false, msg: "Please enter a coupon code." };
  const snap = await getDoc(doc(db, "coupons", code.trim().toUpperCase()));
  if (!snap.exists()) return { valid: false, msg: "Coupon not found." };
  const c = snap.data();
  if (!c.active) return { valid: false, msg: "This coupon is not active." };
  if (c.expiresAt) {
    const exp = c.expiresAt.toDate ? c.expiresAt.toDate() : new Date(c.expiresAt);
    if (exp < new Date()) return { valid: false, msg: "This coupon has expired." };
  }
  if (c.minOrder && subtotal < c.minOrder) return { valid: false, msg: `Minimum order Tk ${c.minOrder} required for this coupon.` };
  if (c.maxUses && (c.usedCount || 0) >= c.maxUses) return { valid: false, msg: "This coupon's usage limit has been reached." };

  // Check if coupon is blocked on sale products
  if (c.allowOnSaleProducts === false && cartItems && cartItems.length) {
    const flashIds = new Set(((window.zahFlashSale && window.zahFlashSale.items) || []).map(it => it.productId));
    if (flashIds.size > 0 && cartItems.some(item => flashIds.has(item.id))) {
      return { valid: false, msg: "This coupon cannot be applied to sale products." };
    }
  }

  const freeDelivery = c.type === "freeship";
  const discount = freeDelivery
    ? 0
    : c.type === "percent"
      ? Math.round(subtotal * c.value / 100 * 100) / 100
      : Math.min(c.value, subtotal);

  window.appliedCoupon = { id: code.trim().toUpperCase(), ...c, discount, freeDelivery };
  const label = freeDelivery ? "Free delivery" : c.type === "percent" ? `${c.value}% off` : `Tk ${c.value} off`;
  if (window.zahrounGA) window.zahrounGA.trackCouponApply(code.trim().toUpperCase(), discount);
  return { valid: true, discount, msg: `Coupon applied: ${label}` };
};

window.clearAppliedCoupon = function () {
  window.appliedCoupon = null;
};

/* H3-fix: atomic transaction — check maxUses before incrementing.
   Returns true on success, false if limit already reached, throws on Firestore error. */
window.incrementCouponUsage = async function (code) {
  if (!code) return true;
  const ref = doc(db, "coupons", code);
  try {
    let limitReached = false;
    await runTransaction(db, async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists()) return; // coupon deleted — no-op
      const data = snap.data();
      const used = data.usedCount || 0;
      const max  = data.maxUses;           // undefined means unlimited
      if (max !== undefined && used >= max) {
        limitReached = true;
        return; // do not increment — abort is implicit (no writes)
      }
      const newCount = used + 1;
      const updates = { usedCount: increment(1) };
      if (max !== undefined && max > 0 && newCount >= max) updates.active = false;
      txn.update(ref, updates);
    });
    return !limitReached;
  } catch (e) {
    console.warn("Could not increment coupon usage:", e);
    throw e; // re-throw so the caller can surface the failure
  }
};

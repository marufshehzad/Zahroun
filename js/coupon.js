/* Coupon validation for checkout. Exposes window helpers so the non-module
   checkout script can call them. */

import { db } from "./firebase-config.js";
import { auth } from "./firebase-config.js";
import {
  doc, getDoc, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

window.appliedCoupon = null;

window.validateAndApplyCoupon = async function (code, subtotal) {
  if (!code) return { valid: false, msg: "Please enter a coupon code." };
  const snap = await getDoc(doc(db, "coupons", code.trim().toUpperCase()));
  if (!snap.exists()) return { valid: false, msg: "Coupon not found." };
  const c = snap.data();
  if (!c.active) return { valid: false, msg: "This coupon is not active." };
  if (c.expiresAt) {
    const exp = c.expiresAt.toDate ? c.expiresAt.toDate() : new Date(c.expiresAt);
    if (exp < new Date()) return { valid: false, msg: "This coupon has expired." };
  }
  if (c.minOrder && subtotal < c.minOrder) return { valid: false, msg: `Minimum order ৳${c.minOrder} required for this coupon.` };
  if (c.maxUses && (c.usedCount || 0) >= c.maxUses) return { valid: false, msg: "This coupon's usage limit has been reached." };

  const freeDelivery = c.type === "freeship";
  const discount = freeDelivery
    ? 0
    : c.type === "percent"
      ? Math.round(subtotal * c.value / 100 * 100) / 100
      : Math.min(c.value, subtotal);

  window.appliedCoupon = { id: code.trim().toUpperCase(), ...c, discount, freeDelivery };
  const label = freeDelivery ? "Free delivery" : c.type === "percent" ? `${c.value}% off` : `৳${c.value} off`;
  if (window.zahrounGA) window.zahrounGA.trackCouponApply(code.trim().toUpperCase(), discount);
  return { valid: true, discount, msg: `Coupon applied: ${label}` };
};

window.clearAppliedCoupon = function () {
  window.appliedCoupon = null;
};

window.incrementCouponUsage = async function (code) {
  if (!code || !auth.currentUser) return;
  try {
    await updateDoc(doc(db, "coupons", code), { usedCount: increment(1) });
  } catch (e) {
    console.warn("Could not increment coupon usage:", e);
  }
};

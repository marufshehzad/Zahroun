/* =========================================================================
   ZAHROUN — Order helper (used by checkout.html)
   =========================================================================
   Exposes window.saveOrder() so the (classic) checkout script can persist an
   order to Firestore. Orders require a logged-in user (Firestore rules tie
   the order's uid to the authenticated account), which also powers the
   customer's order history and the admin Orders dashboard.
   ========================================================================= */

import { db, auth } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, doc, getDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

window.getCurrentUser = () => auth.currentUser;

/* ── 6-digit sequential order number ──────────────────────────────────────
   Atomic, gap-tolerant counter stored at counters/orders.current.
   First order = 100001, then 100002, 100003 … Guaranteed unique + ordered.
   Firestore transactions serialize concurrent orders, so no collisions.
   (Requires the counters/{id} rule to be published — see firestore.rules.) */
async function getNextOrderNum() {
  const counterRef = doc(db, "counters", "orders");
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = (snap.exists() && typeof snap.data().current === "number")
      ? snap.data().current
      : 100000;                 // so the very first order becomes 100001
    const next = current + 1;
    if (snap.exists()) tx.update(counterRef, { current: next });
    else               tx.set(counterRef, { current: next });
    return next;
  });
}

window.saveOrder = async function (order) {
  const user = auth.currentUser;

  // Server-side stock validation — reads fresh Firestore values, not cache
  const stockErrors = [];
  await Promise.all((order.items || []).map(async item => {
    if (!item.id || !item.quantity) return;
    try {
      const snap = await getDoc(doc(db, "products", String(item.id)));
      if (snap.exists()) {
        const stock = snap.data().stock;
        if (typeof stock === "number" && stock < item.quantity) {
          stockErrors.push(
            stock === 0
              ? `"${item.name || item.id}" is out of stock.`
              : `"${item.name || item.id}": only ${stock} left (you ordered ${item.quantity}).`
          );
        }
      }
    } catch { /* read failure — allow order, admin corrects if needed */ }
  }));

  if (stockErrors.length > 0) {
    const err = new Error(stockErrors[0]);
    err.code = "out-of-stock";
    err.allErrors = stockErrors;
    throw err;
  }

  // ── C3-fix: server-side loyalty & referral discount verification ──────────
  // Clamp loyaltyDiscountAmount to what the user actually has in Firestore.
  // This prevents a client from inflating window._loyaltyDiscount on the front-end.
  let verifiedLoyaltyDiscount = 0;
  let verifiedLoyaltyPoints   = 0;
  if (user && order.loyaltyRedeemedPoints > 0 && order.loyaltyDiscountAmount > 0) {
    try {
      const lpSnap = await getDoc(doc(db, "loyaltyPoints", user.uid));
      const lpData = lpSnap.exists() ? lpSnap.data() : {};
      const actualBalance = lpData.points || 0;

      // Also fetch admin config for redeemValue cap
      const cfgSnap = await getDoc(doc(db, "settings", "promotions"));
      const lp = cfgSnap.exists() ? (cfgSnap.data()?.loyaltyPoints || {}) : {};
      const redeemValue  = lp.redeemValue  || 1;
      const maxRedeemPct = lp.maxRedeemPct || 0;
      const subtotal     = order.subtotal   || 0;

      // Cap to actual balance
      const clampedPts = Math.min(order.loyaltyRedeemedPoints, actualBalance);
      let maxAllowed = clampedPts * redeemValue;
      // Cap to maxRedeemPct of subtotal if set
      if (maxRedeemPct > 0 && subtotal > 0) {
        maxAllowed = Math.min(maxAllowed, (subtotal * maxRedeemPct) / 100);
      }
      verifiedLoyaltyDiscount = Math.min(order.loyaltyDiscountAmount, maxAllowed);
      verifiedLoyaltyPoints   = Math.floor(verifiedLoyaltyDiscount / redeemValue);

      if (verifiedLoyaltyDiscount !== order.loyaltyDiscountAmount) {
        console.warn(`[saveOrder] C3: loyalty discount clamped from ${order.loyaltyDiscountAmount} to ${verifiedLoyaltyDiscount}`);
      }
    } catch (e) {
      // Firestore read failed — discard loyalty discount entirely (safe default)
      console.warn('[saveOrder] C3: loyalty verification read failed, discarding:', e);
      verifiedLoyaltyDiscount = 0;
      verifiedLoyaltyPoints   = 0;
    }
  }

  // Referral discount: cap to the admin-configured refereeAmt (prevents client inflation)
  let verifiedReferralDiscount = 0;
  const clientReferralEntry = (order.promos || []).find(p => p.label === 'Referral Discount');
  if (clientReferralEntry && user) {
    try {
      const cfgSnap2 = await getDoc(doc(db, "settings", "promotions"));
      const rc = cfgSnap2.exists() ? (cfgSnap2.data()?.referral || {}) : {};
      if (rc.enabled) {
        const maxReferral = rc.refereeAmt || 0;
        verifiedReferralDiscount = Math.min(clientReferralEntry.discount || 0, maxReferral);
        if (verifiedReferralDiscount !== (clientReferralEntry.discount || 0)) {
          console.warn(`[saveOrder] C3: referral discount clamped from ${clientReferralEntry.discount} to ${verifiedReferralDiscount}`);
        }
        // Update promo entry with clamped value
        clientReferralEntry.discount = verifiedReferralDiscount;
      } else {
        // Referral not enabled server-side — strip it
        order.promos = (order.promos || []).filter(p => p.label !== 'Referral Discount');
        verifiedReferralDiscount = 0;
      }
    } catch (e) {
      console.warn('[saveOrder] C3: referral verification read failed, discarding:', e);
      order.promos = (order.promos || []).filter(p => p.label !== 'Referral Discount');
    }
  }

  // Rebuild the verified total (server-side recompute to match clamped discounts)
  const verifiedTotal = Math.max(0,
    (order.subtotal     || 0)
    - (order.discount   || 0)        // coupon (already re-validated at submit in H8-fix)
    - (order.promoDiscount || 0)     // promo engine discounts
    - verifiedLoyaltyDiscount
    - verifiedReferralDiscount
    + (order.delivery   || 0)
  );
  // ── end C3-fix ──

  // 6-digit sequential order number (100001, 100002, …)
  const orderNum = await getNextOrderNum();
  const ref = await addDoc(collection(db, "orders"), {
    ...order,
    // Overwrite with server-verified values
    loyaltyRedeemedPoints: verifiedLoyaltyPoints,
    loyaltyDiscountAmount: verifiedLoyaltyDiscount,
    total:                 verifiedTotal,
    orderNum,
    uid:       user ? user.uid : null,
    userEmail: user ? (user.email || order.guestEmail || null) : (order.guestEmail || null),
    isGuest:   !user,
    status:    "pending",
    createdAt: serverTimestamp()
  });

  // Atomically decrement stock with floor at 0 — prevents negative stock
  await Promise.all((order.items || []).map(async item => {
    if (!item.id || !item.quantity) return;
    try {
      const prodRef = doc(db, "products", String(item.id));
      await runTransaction(db, async tx => {
        const snap = await tx.get(prodRef);
        if (snap.exists() && typeof snap.data().stock === "number") {
          tx.update(prodRef, { stock: Math.max(0, snap.data().stock - item.quantity) });
        }
      });
    } catch { /* stock update failed silently — admin can correct manually */ }
  }));

  return { id: ref.id, orderNum };
};

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
  collection, addDoc, updateDoc, serverTimestamp, doc, getDoc, runTransaction
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

  // Referral discount: cap to the admin-configured refereeAmt (prevents client inflation).
  // The referral entry lives INSIDE order.promos (the promo engine folds opts.referralDiscount
  // into its own discounts[]/totalDiscount — see js/promotions.js evaluate()), so order.promoDiscount
  // already includes it. Clamp the entry in place and recompute promoDiscount from the corrected
  // promos array — do NOT also subtract verifiedReferralDiscount separately below, or the referral
  // amount gets discounted twice.
  const clientReferralEntry = (order.promos || []).find(p => p.label === 'Referral Discount');
  if (clientReferralEntry && user) {
    const referralBefore = Number(clientReferralEntry.discount) || 0;
    let referralAfter = referralBefore;
    try {
      const cfgSnap2 = await getDoc(doc(db, "settings", "promotions"));
      const rc = cfgSnap2.exists() ? (cfgSnap2.data()?.referral || {}) : {};
      if (rc.enabled) {
        const maxReferral = rc.refereeAmt || 0;
        referralAfter = Math.min(referralBefore, maxReferral);
        if (referralAfter !== referralBefore) {
          console.warn(`[saveOrder] C3: referral discount clamped from ${referralBefore} to ${referralAfter}`);
        }
        // Update promo entry with clamped value
        clientReferralEntry.discount = referralAfter;
      } else {
        // Referral not enabled server-side — strip it
        referralAfter = 0;
        order.promos = (order.promos || []).filter(p => p.label !== 'Referral Discount');
      }
    } catch (e) {
      console.warn('[saveOrder] C3: referral verification read failed, discarding:', e);
      referralAfter = 0;
      order.promos = (order.promos || []).filter(p => p.label !== 'Referral Discount');
    }
    // Apply the clamp as a DELTA against the aggregate, instead of re-summing
    // order.promos. Each promos[] entry is already rounded to whole taka by
    // checkout.html, whereas promoDiscount is the single rounding of the
    // engine's exact total — the figure js/pricing.js computed and the summary
    // showed. Re-summing the rounded parts can therefore land a taka away from
    // it, and that taka would be a stored total the customer never approved.
    // Subtracting only what the clamp actually removed keeps the clamp fully
    // effective while leaving an unclamped order byte-identical to its quote.
    if (referralAfter !== referralBefore) {
      order.promoDiscount = Math.max(0, (Number(order.promoDiscount) || 0) - (referralBefore - referralAfter));
    }
  }

  // Rebuild the verified total from the clamped values. This mirrors
  // js/pricing.js computeOrderSummary() exactly — same component order, same
  // whole-taka rounding, same floor at 0 — so the amount stored here is the
  // amount the checkout summary showed. It re-derives the total rather than
  // trusting order.total, which is what keeps a tampered total from landing.
  //
  // promoDiscount does NOT contain the loyalty amount: js/promotions.js keeps
  // loyalty out of its discounts[] on purpose, so subtracting both here counts
  // it exactly once. (Previously loyalty was inside promoDiscount as well and
  // this line removed it a second time.)
  const _bdt = (n) => { const v = Number(n); return Number.isFinite(v) ? Math.round(v) : 0; };
  const _subtotal = Math.max(0, _bdt(order.subtotal));
  let _coupon  = Math.max(0, _bdt(order.discount));
  let _promo   = Math.max(0, _bdt(order.promoDiscount));
  let _loyalty = Math.max(0, _bdt(verifiedLoyaltyDiscount));
  // Discounts can never exceed the goods value; trim loyalty, then promo, then coupon.
  let _over = (_coupon + _promo + _loyalty) - _subtotal;
  if (_over > 0) {
    const _trim = (v) => { const t = Math.min(v, _over); _over -= t; return v - t; };
    _loyalty = _trim(_loyalty);
    _promo   = _trim(_promo);
    _coupon  = _trim(_coupon);
  }
  const verifiedTotal = Math.max(0, _bdt(_subtotal - (_coupon + _promo + _loyalty) + _bdt(order.delivery)));
  // If the clamp trimmed the loyalty amount, scale the redeemed POINTS down to
  // match — otherwise the customer would be billed for points they did not
  // actually receive credit for.
  if (_loyalty < Math.max(0, _bdt(verifiedLoyaltyDiscount)) && verifiedLoyaltyDiscount > 0) {
    verifiedLoyaltyPoints = Math.floor(verifiedLoyaltyPoints * (_loyalty / verifiedLoyaltyDiscount));
  }
  verifiedLoyaltyDiscount = _loyalty;
  // ── end C3-fix ──

  // 6-digit sequential order number (100001, 100002, …)
  const orderNum = await getNextOrderNum();
  const ref = await addDoc(collection(db, "orders"), {
    ...order,
    // Overwrite with server-verified values. subtotal/discount/promoDiscount are
    // written back as the CLAMPED, whole-taka figures the total was actually
    // computed from — if a clamp trimmed one of them and the document still
    // carried the untrimmed number, the order would be internally inconsistent
    // and firestore.rules' total-identity check would reject the whole write.
    subtotal:              _subtotal,
    discount:              _coupon,
    promoDiscount:         _promo,
    loyaltyRedeemedPoints: verifiedLoyaltyPoints,
    loyaltyDiscountAmount: verifiedLoyaltyDiscount,
    delivery:              _bdt(order.delivery),
    total:                 verifiedTotal,
    orderNum,
    uid:       user ? user.uid : null,
    userEmail: user ? (user.email || order.guestEmail || null) : (order.guestEmail || null),
    isGuest:   !user,
    status:    "pending",
    // Stock is NOT touched at placement. Products are admin-write-only
    // (firestore.rules: match /products -> allow write: if isAdmin()), so the
    // client-side decrement that used to live here was rejected by the security
    // rules and swallowed by its own empty catch — while this flag still
    // claimed the stock HAD been taken. That combination meant admin.js's
    // deductOrderStock() skipped the real deduction on confirm, and
    // restoreOrderStock() handed back stock on every cancellation that had
    // never been removed, so inventory only ever drifted upward.
    //
    // The admin panel now owns stock movement end to end: it deducts when an
    // order reaches confirmed/shipped/delivered and restores when it returns to
    // pending/follow-up/cancelled/returned.
    //
    // NOTE: the ABSENCE of stockState marks a legacy order (placed before this
    // change) whose stockDeducted:true was a lie. admin.js reads a missing
    // stockState as 'none', so those orders will not restore phantom stock.
    stockState: "none",
    createdAt: serverTimestamp()
  });

  return { id: ref.id, orderNum };
};

// Persists the browser pixel eventId to the order document so admin can
// reference it when sending CAPI cancellation signals later.
window.updateOrderPixelEventId = async function (orderId, eventId) {
  if (!orderId || !eventId) return;
  try {
    await updateDoc(doc(db, "orders", orderId), { pixelEventId: eventId });
  } catch (e) { /* non-critical — silent */ }
};

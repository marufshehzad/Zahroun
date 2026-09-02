/* =========================================================================
   ZAHROUN — canonical order pricing
   =========================================================================
   THE single source of truth for money. Every surface that shows a total —
   the cart drawer, the cart page, the checkout summary, and the order document
   written to Firestore — calls computeOrderSummary() and renders what it
   returns. Nothing recomputes the arithmetic on its own.

   This exists because each surface used to do its own maths, and they drifted:
     * the cart page hard-coded Tk 70 delivery and a Tk 5,000 free-delivery
       threshold, so it quoted a different total from checkout;
     * the checkout summary left the loyalty discount inside promoDiscount while
       the order document subtracted it separately, so the stored total was
       lower than the total the customer approved;
     * the cart drawer labelled a bare subtotal as "Total".

   Loaded as a classic script (not a module) so the classic inline scripts in
   cart.html and checkout.html can call it directly, and so js/cart.js can use
   it without an import. Module code reaches it through window.ZahrounPricing.

   CURRENCY POLICY — Bangladeshi Taka has no circulating subunit and these are
   cash-on-delivery orders, so every money value this module returns is a whole
   number of taka (Math.round, half away from zero). Rounding happens once, on
   each component, before the total is assembled — never twice, and never only
   at display time. That is what keeps "what the page shows" and "what Firestore
   stores" byte-identical instead of differing by rounding dust.
   ========================================================================= */
(function () {
  'use strict';

  /* Round to whole taka. Non-finite input (NaN from a tampered cart, undefined
     from a missing field) collapses to 0 rather than poisoning the total. */
  function bdt(n) {
    const v = Number(n);
    return Number.isFinite(v) ? Math.round(v) : 0;
  }

  /* Store settings, from the freshest source available on this page.
     window.zahSettings is set by js/auth.js once settings/store loads; the
     sessionStorage copy covers callers that run before that (cart.html renders
     synchronously). Defaults match the admin panel's own defaults. */
  function getStoreSettings() {
    let s = window.zahSettings;
    if (!s) {
      try {
        const raw = sessionStorage.getItem('zhr_store_v1');
        if (raw) s = JSON.parse(raw).data;
      } catch { /* private mode / quota — fall through to defaults */ }
    }
    s = s || {};
    return {
      deliveryDhaka: Number(s.deliveryDhaka) > 0 ? Number(s.deliveryDhaka) : 60,
      deliveryOutside: Number(s.deliveryOutside) > 0 ? Number(s.deliveryOutside) : 120,
      freeDeliveryThreshold: Number(s.freeDeliveryThreshold) || 0
    };
  }

  function lineQty(item) {
    const q = parseInt(item && item.quantity, 10);
    return Number.isFinite(q) && q > 0 ? q : 1;
  }

  /* What the customer actually pays for this line, per unit. Flash-sale pricing
     is already baked into selectedPrice by js/cart.js reconcileCart(). */
  function lineUnitPrice(item) {
    const p = parseFloat(item && (item.selectedPrice != null ? item.selectedPrice : item.price));
    return Number.isFinite(p) && p > 0 ? p : 0;
  }

  /* Catalog (pre-flash-sale) unit price, for the "you saved" line. */
  function lineOriginalUnitPrice(item) {
    if (!item) return 0;
    const orig = parseFloat(item.originalPrice);
    if (Number.isFinite(orig) && orig > 0) return orig;
    const catalog = item.prices && item.size ? parseFloat(item.prices[item.size]) : NaN;
    if (Number.isFinite(catalog) && catalog > 0) return catalog;
    return lineUnitPrice(item);
  }

  function subtotalOf(cart) {
    return bdt((cart || []).reduce((s, i) => s + lineUnitPrice(i) * lineQty(i), 0));
  }

  function originalSubtotalOf(cart) {
    return bdt((cart || []).reduce((s, i) => s + lineOriginalUnitPrice(i) * lineQty(i), 0));
  }

  /* ---------------------------------------------------------------------
     computeOrderSummary(input) -> the canonical result every surface renders.

     input:
       cart          required — array of cart lines
       coupon        window.appliedCoupon, or null
       promoResult   window._promoResult from ZahrounPromos.evaluate(), or null.
                     Must NOT contain the loyalty discount (promotions.js keeps
                     loyalty out of its discounts[] on purpose).
       loyalty       { points, discount } or null
       deliveryFee   the chosen area's fee. Omit to use the Inside-Dhaka
                     default, which is what checkout's own area selector
                     defaults to — that is what keeps the cart page's estimate
                     equal to the first total checkout shows.
       settings      override for getStoreSettings(), for tests
     --------------------------------------------------------------------- */
  function computeOrderSummary(input) {
    const o = input || {};
    const cart = o.cart || [];
    const coupon = o.coupon || null;
    const promoResult = o.promoResult || null;
    const loyalty = o.loyalty || null;
    const settings = o.settings || getStoreSettings();

    const deliveryFee = bdt(o.deliveryFee != null ? o.deliveryFee : settings.deliveryDhaka);

    const subtotal = subtotalOf(cart);
    const originalSubtotal = originalSubtotalOf(cart);
    const flashSaleDiscount = Math.max(0, bdt(originalSubtotal - subtotal));

    let couponDiscount = Math.max(0, bdt(coupon ? coupon.discount : 0));
    let promoDiscount = Math.max(0, bdt(promoResult ? promoResult.totalDiscount : 0));
    let loyaltyDiscount = Math.max(0, bdt(loyalty ? loyalty.discount : 0));

    /* Discounts can never exceed the value of the goods. Trimmed in a fixed
       order — loyalty, then promotions, then coupon — so the same cart always
       produces the same breakdown no matter which surface asked. */
    let over = (couponDiscount + promoDiscount + loyaltyDiscount) - subtotal;
    if (over > 0) {
      const trim = (v) => { const t = Math.min(v, over); over -= t; return v - t; };
      loyaltyDiscount = trim(loyaltyDiscount);
      promoDiscount = trim(promoDiscount);
      couponDiscount = trim(couponDiscount);
    }
    const totalDiscount = couponDiscount + promoDiscount + loyaltyDiscount;

    const freeShipping =
      !!(coupon && coupon.freeDelivery) ||
      !!(promoResult && promoResult.freeShipping) ||
      (settings.freeDeliveryThreshold > 0 && subtotal >= settings.freeDeliveryThreshold);

    const freeShippingAdjustment = freeShipping ? -deliveryFee : 0;
    const effectiveDelivery = deliveryFee + freeShippingAdjustment;

    const total = Math.max(0, bdt(subtotal - totalDiscount + effectiveDelivery));

    return {
      originalSubtotal,        // catalog value of the goods
      subtotal,                // what the goods cost after flash sale
      flashSaleDiscount,       // informational: already inside subtotal
      couponDiscount,
      promoDiscount,           // every other promotion; excludes loyalty
      loyaltyDiscount,
      totalDiscount,
      deliveryFee,             // before free shipping
      freeShipping,
      freeShippingAdjustment,  // negative, or 0
      effectiveDelivery,       // what is actually charged for delivery
      total                    // final payable
    };
  }

  window.ZahrounPricing = {
    bdt,
    getStoreSettings,
    subtotalOf,
    originalSubtotalOf,
    computeOrderSummary
  };
})();

/* =========================================================================
   ZAHROUN — Google Analytics 4 (GA4)  |  Measurement ID: G-RQQ5NDW51V
   =========================================================================
   Loads gtag.js and exposes window.zahrounGA with typed tracking helpers.
   All helpers are safe to call before gtag is ready (they silently no-op).
   ========================================================================= */

const GA_ID = "G-RQQ5NDW51V";

(function () {
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", GA_ID, { send_page_view: true });
})();

function _gtag(...args) {
  if (typeof window.gtag === "function") window.gtag(...args);
}

window.zahrounGA = {

  trackProductView(p) {
    _gtag("event", "view_item", {
      currency: "BDT",
      value: p.price || 0,
      items: [{
        item_id: String(p.id),
        item_name: p.name,
        item_category: p.category || "",
        price: p.price || 0
      }]
    });
  },

  trackAddToCart(p, size, price) {
    _gtag("event", "add_to_cart", {
      currency: "BDT",
      value: Number(price) || 0,
      items: [{
        item_id: String(p.id),
        item_name: p.name,
        item_category: p.category || "",
        item_variant: size,
        price: Number(price) || 0,
        quantity: 1
      }]
    });
  },

  trackRemoveFromCart(p, size, price) {
    _gtag("event", "remove_from_cart", {
      currency: "BDT",
      value: Number(price) || 0,
      items: [{
        item_id: String(p.id),
        item_name: p.name,
        item_variant: size,
        price: Number(price) || 0
      }]
    });
  },

  trackBeginCheckout(cartItems, total) {
    _gtag("event", "begin_checkout", {
      currency: "BDT",
      value: Number(total) || 0,
      items: (cartItems || []).map(i => ({
        item_id: String(i.id),
        item_name: i.name,
        item_variant: i.size,
        price: Number(i.selectedPrice) || 0,
        quantity: i.quantity || 1
      }))
    });
  },

  trackPurchase(orderId, items, total, couponCode) {
    _gtag("event", "purchase", {
      transaction_id: orderId,
      currency: "BDT",
      value: Number(total) || 0,
      coupon: couponCode || undefined,
      items: (items || []).map(i => ({
        item_id: String(i.id),
        item_name: i.name,
        item_variant: i.size,
        price: Number(i.price) || 0,
        quantity: i.quantity || 1
      }))
    });
  },

  trackCouponApply(code, discount) {
    _gtag("event", "select_promotion", {
      promotion_id: code,
      promotion_name: code,
      creative_slot: "coupon",
      discount: Number(discount) || 0
    });
  },

  trackWishlistAdd(p) {
    _gtag("event", "add_to_wishlist", {
      currency: "BDT",
      value: p.price || 0,
      items: [{
        item_id: String(p.id),
        item_name: p.name,
        item_category: p.category || "",
        price: p.price || 0
      }]
    });
  },

  trackWishlistRemove(p) {
    _gtag("event", "remove_from_wishlist", {
      items: [{
        item_id: String(p.id),
        item_name: p.name
      }]
    });
  },

  trackNewsletterSubscribe(email) {
    _gtag("event", "newsletter_subscribe", {
      method: "footer_form",
      email_domain: (email || "").split("@")[1] || ""
    });
  },

  trackContactForm(subject) {
    _gtag("event", "contact_form_submit", {
      subject: subject || ""
    });
  }
};

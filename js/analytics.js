/* =========================================================================
   ZAHROUN — Google Analytics 4 (GA4)
   =========================================================================
   HOW TO ACTIVATE:
   1. Go to https://analytics.google.com  ->  Admin  ->  Create Property
   2. Add a "Web" data stream for your Netlify site URL.
   3. Copy the Measurement ID (looks like  G-XXXXXXXXXX ).
   4. Paste it below, replacing the placeholder.

   Until a real ID is added, this file does NOTHING — no network calls,
   no slowdown, no effect on the live site. Safe to deploy as-is.
   ========================================================================= */

const GA_MEASUREMENT_ID = "G-RQQ5NDW51V"; // <-- paste your GA4 ID here

(function loadGoogleAnalytics() {
  // Guard: stay completely inactive until a real ID is configured.
  if (!GA_MEASUREMENT_ID || GA_MEASUREMENT_ID === "G-XXXXXXXXXX") {
    console.info("[Zahroun Analytics] Not configured yet. Add your GA4 Measurement ID in js/analytics.js");
    return;
  }

  // Load the official gtag.js library.
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);
})();

/* -------------------------------------------------------------------------
   Helper: track custom events (product views, add-to-cart, purchases...).
   Safe to call anywhere — silently does nothing until GA4 is configured.
   Example:
     trackEvent("view_item", { item_name: "Sahraa Oudh", price: 2490 });
   ------------------------------------------------------------------------- */
function trackEvent(eventName, params = {}) {
  if (typeof window.gtag === "function") {
    window.gtag("event", eventName, params);
  }
}
window.trackEvent = trackEvent;

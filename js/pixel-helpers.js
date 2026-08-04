// Facebook Pixel Utility Functions — zahroun.com
// Include on EVERY page, BEFORE any pixel event code
(function () {
    function getCookie(name) {
        var m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return m ? decodeURIComponent(m[2]) : '';
    }
    function generateEventId(prefix) {
        return (prefix || 'EVT') + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9).toUpperCase();
    }
    function getFbp() { return getCookie('_fbp'); }
    function getFbc() {
        var fbc = getCookie('_fbc');
        if (!fbc) {
            try {
                var fbclid = new URLSearchParams(window.location.search).get('fbclid');
                if (fbclid) {
                    fbc = 'fb.1.' + Date.now() + '.' + fbclid;
                    document.cookie = '_fbc=' + fbc + '; path=/; max-age=7776000';
                }
            } catch (e) {}
        }
        return fbc;
    }
    function getSafeFbp() { return getFbp() || localStorage.getItem('zahr_fbp') || ''; }
    function getSafeFbc() { return getFbc() || localStorage.getItem('zahr_fbc') || ''; }
    function cacheFbIdentifiers() {
        var fbp = getFbp(), fbc = getFbc();
        if (fbp) try { localStorage.setItem('zahr_fbp', fbp); } catch (e) {}
        if (fbc) try { localStorage.setItem('zahr_fbc', fbc); } catch (e) {}
    }
    // Persistent per-browser ID for Advanced Matching's external_id — raised by
    // the team as a missing EMQ parameter (WhatsApp thread, Aug 2026). Generated
    // once and reused for every event so Meta can stitch a visitor's events
    // together even before they submit any contact info at checkout.
    function getExternalId() {
        try {
            var id = localStorage.getItem('zahr_ext_id');
            if (!id) {
                id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
                    : 'xid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 12);
                localStorage.setItem('zahr_ext_id', id);
            }
            return id;
        } catch (e) { return ''; }
    }
    window.getCookie = getCookie;
    window.generateEventId = generateEventId;
    window.getFbp = getFbp;
    window.getFbc = getFbc;
    window.getSafeFbp = getSafeFbp;
    window.getSafeFbc = getSafeFbc;
    window.getExternalId = getExternalId;
    cacheFbIdentifiers();
    // Re-init the pixel with external_id as an Advanced Matching parameter —
    // fbq('init') can be called more than once; later calls just merge in
    // extra matching data used by every event fired after this point.
    try { if (typeof fbq !== 'undefined') fbq('init', '1581299296765663', { external_id: getExternalId() }); } catch (e) {}

    // Generic CAPI sender — usable from any page.
    // userData is optional; when omitted only fbp/fbc are sent (pre-checkout pages).
    window.sendCAPI = function (eventName, eventId, customData, userData) {
        try {
            var ud = userData || {};
            fetch('/api/facebook-capi', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event_name: eventName,
                    event_id: eventId,
                    event_time: Math.floor(Date.now() / 1000),
                    user_data: {
                        em: ud.email || '',
                        ph: ud.phone || '',
                        fn: ud.first_name || '',
                        ln: ud.last_name || '',
                        ct: ud.city || '',
                        external_id: getExternalId(),
                        fbp: getSafeFbp(),
                        fbc: getSafeFbc()
                    },
                    custom_data: customData || {},
                    source_url: window.location.href
                })
            }).catch(function () {});
        } catch (e) {}
    };

    // Single dispatch point for every tracked action — modeled on the
    // pattern well-run trackers (e.g. GhorerBazar's TrackingManager) use:
    // one call fires BOTH the browser Pixel and the server CAPI event,
    // sharing one fresh event_id for Meta's deduplication. Pages should
    // call this instead of hand-rolling fbq()+sendCAPI() pairs — that
    // hand-rolling is what caused the product.html duplicate-ViewContent
    // and shop.html missing-CAPI bugs found earlier: every call site had
    // to remember the pattern correctly on its own, and one didn't.
    var EVENT_MAP = {
        view_item: 'ViewContent',
        add_to_cart: 'AddToCart',
        begin_checkout: 'InitiateCheckout',
        add_payment_info: 'AddPaymentInfo',
        purchase: 'Purchase'
    };
    window.TrackingManager = {
        // eventKey: an EVENT_MAP key (or any custom event name, passed through
        // unchanged via trackCustom) — customData: Meta custom_data fields
        // (content_ids, value, currency, ...) — userData: optional
        // {email, phone, first_name, last_name, city} for advanced matching —
        // idPrefix: optional short prefix for the generated event_id.
        // Returns the event_id used (callers that need to persist it, e.g.
        // Purchase's stored pixelEventId, use this), or false if it didn't fire.
        processTracking: function (eventKey, customData, userData, idPrefix) {
            try {
                if (typeof fbq === 'undefined') return false;
                var fbEventName = EVENT_MAP[eventKey] || eventKey;
                var isStandard = !!EVENT_MAP[eventKey];
                var eventId = typeof generateEventId === 'function'
                    ? generateEventId(idPrefix || eventKey.slice(0, 3).toUpperCase())
                    : eventKey + '_' + Date.now();
                fbq(isStandard ? 'track' : 'trackCustom', fbEventName, customData || {}, { eventID: eventId });
                if (typeof sendCAPI === 'function') sendCAPI(fbEventName, eventId, customData, userData);
                return eventId;
            } catch (e) {
                return false;
            }
        }
    };
})();

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
    window.getCookie = getCookie;
    window.generateEventId = generateEventId;
    window.getFbp = getFbp;
    window.getFbc = getFbc;
    window.getSafeFbp = getSafeFbp;
    window.getSafeFbc = getSafeFbc;
    cacheFbIdentifiers();
})();

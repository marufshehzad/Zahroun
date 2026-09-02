// Zahroun — Guest order tracking (Vercel serverless function)
//
// Why this exists: the Firestore rule for /orders used to be `allow read: if true`
// so track.html could look orders up from the browser — which exposed every
// order (names, phones, addresses, bKash/Nagad transaction IDs) to anyone with
// the public Firebase config. The rule is now owner/admin-only and guest
// tracking goes through this endpoint instead: it queries Firestore with a
// service account and returns ONLY non-sensitive fields (status, items,
// totals, delivery area, masked phone — never the full name, street address,
// email, or payment transaction ID, because 6-digit order numbers are
// guessable).
//
// SETUP (required before this endpoint works):
// 1. Firebase Console → Project settings (gear) → Service accounts
//    → "Generate new private key" → downloads a JSON file.
// 2. Vercel dashboard → Project Settings → Environment Variables →
//    add FIREBASE_SERVICE_ACCOUNT = the ENTIRE contents of that JSON file.
//    (Alternatively set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.)
// 3. Publish the updated firestore.rules in the Firebase console.
//
// No npm dependencies — signs the Google OAuth JWT with Node's crypto,
// same zero-dependency style as facebook-capi.js / product-feed.js.

const crypto = require('crypto');
const https = require('https');

const PROJECT_ID = 'zahroun';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ── tiny https helper ─────────────────────────────────────────────────────
function httpsRequest(url, { method = 'GET', headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method,
            headers: { ...headers },
        };
        if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', c => { raw += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: raw }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// ── Google OAuth via service-account JWT (cached across warm invocations) ─
let _tokenCache = { token: null, exp: 0 };

function loadServiceAccount() {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (json) {
        const sa = JSON.parse(json);
        return { email: sa.client_email, key: sa.private_key };
    }
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key = process.env.FIREBASE_PRIVATE_KEY;
    if (email && key) return { email, key: key.replace(/\\n/g, '\n') };
    return null;
}

function b64url(input) {
    return Buffer.from(input).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (_tokenCache.token && _tokenCache.exp - 60 > now) return _tokenCache.token;

    const sa = loadServiceAccount();
    if (!sa) throw Object.assign(new Error('FIREBASE_SERVICE_ACCOUNT not set'), { config: true });

    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({
        iss: sa.email,
        scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    }));
    const unsigned = `${header}.${claims}`;
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.key);
    const jwt = `${unsigned}.${b64url(signature)}`;

    const resp = await httpsRequest('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')
            + '&assertion=' + jwt,
    });
    const data = JSON.parse(resp.body);
    if (!data.access_token) throw new Error('OAuth token exchange failed: ' + resp.body.slice(0, 200));
    _tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
    return data.access_token;
}

// ── Firestore REST value unwrapping (typed wrappers → plain JS) ───────────
function fsValue(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue; // ISO 8601 string
    if ('mapValue' in v) return fsFields(v.mapValue.fields || {});
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsValue);
    if ('nullValue' in v) return null;
    return null;
}
function fsFields(fields) {
    const out = {};
    Object.keys(fields || {}).forEach(k => { out[k] = fsValue(fields[k]); });
    return out;
}

async function runQuery(structuredQuery) {
    const token = await getAccessToken();
    const resp = await httpsRequest(`${FIRESTORE_BASE}:runQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ structuredQuery }),
    });
    if (resp.status !== 200) throw new Error('Firestore query failed: ' + resp.body.slice(0, 200));
    const entries = JSON.parse(resp.body);
    return (Array.isArray(entries) ? entries : [])
        .filter(e => e.document)
        .map(e => ({
            id: e.document.name.split('/').pop(),
            ...fsFields(e.document.fields),
        }));
}

// ── Lookups ───────────────────────────────────────────────────────────────
const digitsOnly = s => String(s || '').replace(/\D/g, '');

async function lookupByOrderNum(num) {
    return runQuery({
        from: [{ collectionId: 'orders' }],
        where: {
            fieldFilter: {
                field: { fieldPath: 'orderNum' },
                op: 'EQUAL',
                value: { integerValue: String(num) },
            },
        },
        limit: 5,
    });
}

// BD numbers get stored in whatever format the customer typed at checkout, so
// try the common equivalent spellings exactly, then fall back to a bounded
// recent-orders scan with last-10-digit matching (the same fuzzy match
// track.html used to run in the browser — now safely server-side).
async function lookupByPhone(input) {
    const d = digitsOnly(input);
    if (d.length < 8 || d.length > 15) return [];

    const local = d.startsWith('880') ? d.slice(3) : (d.startsWith('0') ? d.slice(1) : d);
    const variants = [...new Set([
        input.trim(),
        d,
        local,
        '0' + local,
        '880' + local,
        '+880' + local,
    ])].filter(v => v).slice(0, 10);

    const exact = await runQuery({
        from: [{ collectionId: 'orders' }],
        where: {
            fieldFilter: {
                field: { fieldPath: 'customer.mobile' },
                op: 'IN',
                value: { arrayValue: { values: variants.map(v => ({ stringValue: v })) } },
            },
        },
        limit: 50,
    });
    if (exact.length) return sortByDate(exact).slice(0, 20);

    // Fuzzy fallback needs at least 10 digits so a short suffix can't trawl
    // other customers' orders.
    if (d.length < 10) return [];
    const last10 = d.slice(-10);
    const recent = await runQuery({
        from: [{ collectionId: 'orders' }],
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
        limit: 200,
    });
    return recent
        .filter(o => digitsOnly(o.customer && o.customer.mobile).slice(-10) === last10)
        .slice(0, 20);
}

function sortByDate(orders) {
    return orders.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

// ── Sanitization — the whole point of this endpoint ───────────────────────
// Never return: customer name, street address, email, payment transaction ID,
// uid, admin notes. Order numbers are sequential and guessable, so whatever
// leaves here must be safe to show to someone who only guessed a number.
function maskMobile(mobile) {
    const d = digitsOnly(mobile);
    if (d.length < 6) return null;
    return d.slice(0, 3) + '•'.repeat(d.length - 5) + d.slice(-2);
}

function sanitizeOrder(o) {
    const items = (Array.isArray(o.items) ? o.items : []).map(i => ({
        name: i.name || '',
        size: i.size || '',
        quantity: i.quantity || 1,
        price: i.price || 0,
        image: i.image || '',
        isFreeGift: !!i.isFreeGift,
        originalPrice: i.originalPrice || 0,
    }));
    const statusHistory = (Array.isArray(o.statusHistory) ? o.statusHistory : [])
        .filter(h => h && h.status)
        .map(h => ({ status: h.status, at: h.at || null }));
    return {
        orderNum: o.orderNum || null,
        displayId: o.orderNum ? null : String(o.id || '').slice(0, 8).toUpperCase(),
        status: o.status || 'pending',
        createdAt: o.createdAt || null,
        statusHistory,
        items,
        discount: o.discount || 0,
        delivery: o.delivery || 0,
        total: o.total || 0,
        payment: { method: (o.payment && o.payment.method) || null },
        customer: {
            area: (o.customer && o.customer.area) || null,
            mobileMasked: maskMobile(o.customer && o.customer.mobile),
        },
    };
}

// ── Rate limiting (best-effort, per warm instance) ────────────────────────
const RATE_LIMIT = 20;                 // requests
const RATE_WINDOW = 5 * 60 * 1000;     // per 5 minutes per IP
const _hits = new Map();

function rateLimited(ip) {
    const now = Date.now();
    if (_hits.size > 5000) _hits.clear(); // memory guard
    const arr = (_hits.get(ip) || []).filter(t => now - t < RATE_WINDOW);
    arr.push(now);
    _hits.set(ip, arr);
    return arr.length > RATE_LIMIT;
}

// ── Handler ───────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://zahroun.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (rateLimited(ip)) {
        return res.status(429).json({ error: 'Too many requests — please wait a minute and try again.' });
    }

    const query = String((req.body && req.body.query) || '').trim().slice(0, 40);
    const digits = digitsOnly(query);
    if (digits.length < 4) {
        return res.status(400).json({ error: 'Enter a 6-digit order ID or a phone number.' });
    }

    try {
        let orders = [];
        const looksLikeOrderId = /^\d{6}$/.test(digits) && /^\d+$/.test(query);
        const looksLikePhone = digits.length >= 8 && digits.length <= 15;

        if (looksLikeOrderId) {
            orders = await lookupByOrderNum(parseInt(digits, 10));
            if (!orders.length && looksLikePhone) orders = await lookupByPhone(query);
        } else if (looksLikePhone) {
            orders = await lookupByPhone(query);
            if (!orders.length && /^\d{4,8}$/.test(digits)) {
                orders = await lookupByOrderNum(parseInt(digits, 10));
            }
        } else if (/^\d{4,8}$/.test(digits)) {
            orders = await lookupByOrderNum(parseInt(digits, 10));
        }

        return res.status(200).json({ orders: orders.map(sanitizeOrder) });
    } catch (err) {
        if (err.config) return res.status(503).json({ error: 'Order tracking is not configured yet.' });
        console.error('[track-order]', err.message);
        return res.status(502).json({ error: 'Order lookup failed — please try again.' });
    }
};

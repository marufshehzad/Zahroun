// Zahroun — ImageKit upload authentication (Vercel serverless function)
// Set IMAGEKIT_PRIVATE_KEY in Vercel dashboard → Project Settings → Environment Variables
// Never expose the private key to the browser — this endpoint signs on the server
// and hands the client only a short-lived token/signature pair.
//
// SEC-9 ------------------------------------------------------------------
// This endpoint used to answer a bare, unauthenticated GET with a valid
// 40-minute ImageKit upload credential. The CORS header restrains browsers
// only, so anyone could `curl` it in a loop and upload arbitrary files to the
// account: exhausting the free-tier quota (at which point every product image
// on the storefront stops loading) and hosting abusive content under
// ik.imagekit.io/zahroun. ImageKit's signature is HMAC-SHA1(token + expire),
// which binds nothing about folder, filename or MIME type, so the credential
// cannot be scoped after the fact — it has to be withheld from non-admins.
//
// Credentials are now issued ONLY to a verified Firebase admin. The caller must
// send `Authorization: Bearer <Firebase ID token>`.
//
// There is no root package.json in this repo, so Vercel functions get no npm
// dependencies and firebase-admin is unavailable. The RS256 token signature is
// therefore verified against Google's published public certificates using
// Node's built-in crypto, following Firebase's documented "verify with a
// third-party JWT library" procedure.

const crypto = require('crypto');
const https = require('https');

const PROJECT_ID     = 'zahroun';                     // js/firebase-config.js
const ISSUER         = `https://securetoken.google.com/${PROJECT_ID}`;
const CERTS_URL      = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_TTL_SEC  = 300;    // was 2400 (40 min); the client uses it immediately
const RATE_MAX       = 20;
const RATE_WINDOW_MS = 60000;

function httpsGet(url, headers) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.get(
            { hostname: u.hostname, path: u.pathname + u.search, headers: headers || {} },
            res => {
                let raw = '';
                res.on('data', c => { raw += c; });
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
            }
        );
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('upstream timeout')));
    });
}

/* ---- Google signing certs, cached across warm invocations ---------------- */
let _certs = null;
let _certsExpiresAt = 0;

async function getCerts() {
    if (_certs && Date.now() < _certsExpiresAt) return _certs;
    const r = await httpsGet(CERTS_URL);
    if (r.status !== 200) throw new Error('cert fetch failed');
    const certs = JSON.parse(r.body);
    const m = /max-age=(\d+)/.exec(r.headers['cache-control'] || '');
    _certs = certs;
    _certsExpiresAt = Date.now() + (m ? parseInt(m[1], 10) : 3600) * 1000;
    return _certs;
}

function b64uToBuf(s) {
    return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function verifyIdToken(jwt) {
    const parts = String(jwt).split('.');
    if (parts.length !== 3) throw new Error('malformed');
    const [h64, p64, s64] = parts;

    let header, payload;
    try {
        header  = JSON.parse(b64uToBuf(h64).toString('utf8'));
        payload = JSON.parse(b64uToBuf(p64).toString('utf8'));
    } catch { throw new Error('malformed'); }

    if (header.alg !== 'RS256') throw new Error('bad alg');
    if (!header.kid) throw new Error('no kid');

    const certs = await getCerts();
    const pem = certs[header.kid];
    if (!pem) throw new Error('unknown kid');

    const publicKey = new crypto.X509Certificate(pem).publicKey;
    const ok = crypto.createVerify('RSA-SHA256')
        .update(`${h64}.${p64}`)
        .verify(publicKey, b64uToBuf(s64));
    if (!ok) throw new Error('bad signature');

    const now  = Math.floor(Date.now() / 1000);
    const skew = 60;
    if (payload.aud !== PROJECT_ID) throw new Error('bad aud');
    if (payload.iss !== ISSUER)     throw new Error('bad iss');
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new Error('bad sub');
    if (!(payload.exp > now - skew))  throw new Error('expired');
    if (!(payload.iat <= now + skew)) throw new Error('bad iat');

    return payload;
}

/* Read users/{uid}.role with the CALLER's own token, so the existing Firestore
   rules apply (users: `allow read: if isOwner(uid) || isAdmin()`). A customer
   can read their own profile but cannot change `role` — the users create and
   update rules both pin it — so this cannot be forged. */
async function hasAdminRole(uid, idToken) {
    try {
        const r = await httpsGet(
            `${FIRESTORE_BASE}/users/${encodeURIComponent(uid)}`,
            { Authorization: `Bearer ${idToken}` }
        );
        if (r.status !== 200) return false;
        const doc = JSON.parse(r.body);
        return !!(doc && doc.fields && doc.fields.role && doc.fields.role.stringValue === 'admin');
    } catch { return false; }
}

/* ---- Best-effort throttle ------------------------------------------------
   Vercel functions are STATELESS: this Map lives in one warm instance only. It
   blunts a naive flood that lands on a warm instance but does NOT stop a
   distributed attacker or one that keeps hitting cold starts. The auth gate
   above is the actual control; this only bounds CPU spent verifying JWTs.
   Real cross-instance limiting needs Vercel Firewall rules or a datastore,
   neither of which is available on this project. */
const _hits = new Map();
function rateLimited(key) {
    const now = Date.now();
    if (_hits.size > 5000) _hits.clear();
    const rec = _hits.get(key);
    if (!rec || now - rec.start > RATE_WINDOW_MS) {
        _hits.set(key, { start: now, n: 1 });
        return false;
    }
    rec.n++;
    return rec.n > RATE_MAX;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://zahroun.com');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (rateLimited('ip:' + ip)) {
        return res.status(429).json({ error: 'Too many requests' });
    }

    const authHeader = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!m) return res.status(401).json({ error: 'Sign in as an admin to upload images.' });

    let claims;
    try {
        claims = await verifyIdToken(m[1].trim());
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    }

    if (rateLimited('uid:' + claims.sub)) {
        return res.status(429).json({ error: 'Too many requests' });
    }

    // Admin proof, cheapest first:
    //   1. ADMIN_UIDS env allow-list — no extra network call, and independent of
    //      Firestore, so it still holds if the rules are ever misconfigured.
    //   2. An `admin` custom claim, if one is ever set on the account.
    //   3. users/{uid}.role read over the Firestore REST API.
    const allowList = (process.env.ADMIN_UIDS || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    let isAdmin = allowList.includes(claims.sub) || claims.admin === true;
    if (!isAdmin) isAdmin = await hasAdminRole(claims.sub, m[1].trim());
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) return res.status(500).json({ error: 'IMAGEKIT_PRIVATE_KEY not set' });

    const token = crypto.randomUUID();
    const expire = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;

    const signature = crypto
        .createHmac('sha1', privateKey)
        .update(token + expire)
        .digest('hex');

    res.status(200).json({ token, expire, signature });
};

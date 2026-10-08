// Zahroun — shared admin-auth verification for Vercel functions.
//
// Extracted from api/imagekit-auth.js (the original ImageKit upload signer,
// now removed since uploads go to Cloudflare R2 instead — see js/images.js).
// Same zero-dependency approach as the rest of this project's backend: the
// Firebase ID token's RS256 signature is verified against Google's published
// certificates using Node's built-in crypto, following Firebase's documented
// "verify with a third-party JWT library" procedure by hand, because this
// repo has no firebase-admin available server-side.
//
// Used by api/upload-image.js and api/delete-image.js — both need the exact
// same "is this caller a verified admin" check, so it lives in one place
// instead of being copy-pasted (a security check is the last place you want
// two copies to drift apart).

const crypto = require('crypto');
const https = require('https');

const PROJECT_ID = 'zahroun';
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const RATE_MAX = 20;
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
    header = JSON.parse(b64uToBuf(h64).toString('utf8'));
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

  const now = Math.floor(Date.now() / 1000);
  const skew = 60;
  if (payload.aud !== PROJECT_ID) throw new Error('bad aud');
  if (payload.iss !== ISSUER) throw new Error('bad iss');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new Error('bad sub');
  if (!(payload.exp > now - skew)) throw new Error('expired');
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
   above is the actual control; this only bounds CPU spent verifying JWTs. */
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

/* Verifies the caller is a signed-in Firebase admin.
   Returns { ok: true, uid } or { ok: false, status, error }. */
async function requireAdmin(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited('ip:' + ip)) {
    return { ok: false, status: 429, error: 'Too many requests' };
  }

  const authHeader = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) return { ok: false, status: 401, error: 'Sign in as an admin.' };

  let claims;
  try {
    claims = await verifyIdToken(m[1].trim());
  } catch {
    return { ok: false, status: 401, error: 'Invalid or expired session. Please sign in again.' };
  }

  if (rateLimited('uid:' + claims.sub)) {
    return { ok: false, status: 429, error: 'Too many requests' };
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
  if (!isAdmin) return { ok: false, status: 403, error: 'Admin access required.' };

  return { ok: true, uid: claims.sub };
}

/* Shared CORS headers for the admin-only upload/delete endpoints. */
function setAdminCors(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', 'https://zahroun.com');
  res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

module.exports = { requireAdmin, setAdminCors };

// Zahroun — issues a short-lived presigned R2 PUT URL for an authenticated
// admin. Replaces api/imagekit-auth.js (removed): same shape (sign in as
// admin, get back a short-lived upload credential), but for Cloudflare R2
// instead of ImageKit.
//
// The file itself never passes through this function — the browser PUTs it
// straight to R2 with the URL this returns (see js/images.js). That avoids
// any multipart-form parsing and Vercel's ~4.5MB serverless body limit.
//
// GET /api/upload-image?contentType=image/webp
// -> { uploadUrl, url }  (url is this project's own /api/img?key=... address)

const crypto = require('crypto');
const { requireAdmin, setAdminCors } = require('../lib/admin-auth');
const { presignUpload } = require('../lib/r2');

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

module.exports = async (req, res) => {
  setAdminCors(res, ['GET', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const contentType = String((req.query && req.query.contentType) || '').toLowerCase();
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) return res.status(400).json({ error: 'Unsupported image type.' });

  const key = `zahroun/${crypto.randomUUID()}.${ext}`;
  try {
    const uploadUrl = await presignUpload(key, contentType);
    res.status(200).json({ uploadUrl, url: `/api/img?key=${encodeURIComponent(key)}` });
  } catch (err) {
    console.error('[upload-image] presign failed:', err instanceof Error ? err.message : err);
    res.status(502).json({ error: 'Could not prepare upload — please try again.' });
  }
};

// Zahroun — on-demand image resize proxy for R2-stored images.
//
// Every image reference in the storefront points here (`/api/img?key=...`)
// instead of a raw bucket URL. The bucket is never public; this is the only
// thing that ever reads from it, using the same R2 credentials as the
// upload/delete routes (read-only here). Playing the role ik.imagekit.io's
// `tr:w-...,h-...` params used to, and what Ibroon gets for free from
// Next.js's own `/_next/image` endpoint for its R2 images.
//
// GET /api/img?key=zahroun/<uuid>.webp&w=400&h=540

const sharp = require('sharp');
const { getR2Object } = require('../lib/r2');

const MIN_DIM = 16;
const MAX_DIM = 2000; // matches the crop modal's own output cap (js/admin.js)
const STEP = 8; // rounds requested sizes into shared cache buckets

function clampRound(n) {
  const v = Math.min(MAX_DIM, Math.max(MIN_DIM, Math.round(Number(n) || 0)));
  return Math.round(v / STEP) * STEP;
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const key = typeof req.query.key === 'string' ? req.query.key : '';
  if (!key || key.length > 300 || key.includes('..')) {
    return res.status(400).json({ error: 'Invalid key' });
  }

  let body;
  try {
    const obj = await getR2Object(key);
    body = await streamToBuffer(obj.Body);
  } catch (err) {
    return res.status(404).json({ error: 'Not found' });
  }

  const w = req.query.w ? clampRound(req.query.w) : null;
  const h = req.query.h ? clampRound(req.query.h) : null;

  try {
    let pipeline = sharp(body).rotate(); // applies EXIF orientation, then drops it
    if (w || h) {
      pipeline = pipeline.resize({
        width: w || undefined,
        height: h || undefined,
        fit: h ? 'cover' : 'inside',
        withoutEnlargement: true,
      });
    }
    const out = await pipeline.webp({ quality: 82 }).toBuffer();
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(out);
  } catch (err) {
    console.error('[img] resize failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Image processing failed' });
  }
};

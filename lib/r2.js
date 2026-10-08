// Zahroun — Cloudflare R2 (S3-compatible object storage) for product/content
// images. Replaces ImageKit (js/imagekit.js, removed) — see js/images.js for
// why: ImageKit's free tier hit the same storage/bandwidth wall Cloudinary
// did before it, which took every product photo offline at once when
// crossed. R2 has no such hard cutoff.
//
// The bucket is NOT public — every read goes through api/img.js, which holds
// the same credentials as the upload/delete routes below and fetches objects
// directly over the S3 API. That keeps the setup to one Cloudflare API token
// (no separate "enable public access" step) and gives every image a single,
// cacheable serving path that can resize on demand.
//
// Credentials come from an R2 API token created in the Cloudflare dashboard
// (Object Read & Write, scoped to this one bucket):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let _client = null;

function client() {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

function bucket() {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error('R2 is not configured — set R2_BUCKET.');
  return b;
}

/** A short-lived URL the browser can PUT the file bytes to directly. */
async function presignUpload(key, contentType) {
  const cmd = new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType });
  return getSignedUrl(client(), cmd, { expiresIn: 300 }); // 5 minutes
}

/** Fetches an object. `.Body` is a Node Readable stream, `.ContentType` the stored MIME type. */
async function getR2Object(key) {
  return client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
}

/** Deletes the object at `key`. Not-found is treated as success (already gone). */
async function deleteFromR2(key) {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/**
 * Extracts the R2 object key from one of this project's own `/api/img?key=`
 * URLs. Returns null for any URL that isn't ours (old ImageKit/Cloudinary
 * URLs still sitting in Firestore from before this migration, most obviously).
 */
function keyFromUrl(url) {
  try {
    const u = new URL(url, 'https://zahroun.com');
    if (u.pathname !== '/api/img') return null;
    return u.searchParams.get('key');
  } catch {
    return null;
  }
}

module.exports = { presignUpload, getR2Object, deleteFromR2, keyFromUrl };

// Zahroun — POST /api/delete-image  Body: { url: string }
// Deletes an admin-uploaded image from R2 given one of this project's own
// /api/img?key=... URLs. A URL that isn't ours (an ImageKit/Cloudinary URL
// left over from before this migration) is a no-op — there's nothing here
// to delete, and the admin UI should still clear the field either way.

const { requireAdmin, setAdminCors } = require('../lib/admin-auth');
const { deleteFromR2, keyFromUrl } = require('../lib/r2');

module.exports = async (req, res) => {
  setAdminCors(res, ['POST', 'OPTIONS']);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return res.status(400).json({ error: 'A valid url is required' });

  const key = keyFromUrl(url);
  if (!key) return res.status(200).json({ ok: true, result: 'not ours' });

  try {
    await deleteFromR2(key);
    res.status(200).json({ ok: true, result: 'deleted' });
  } catch (err) {
    console.error('[delete-image] R2 delete failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Delete failed' });
  }
};

/* =========================================================================
   ZAHROUN — Cloudflare R2 image upload + URL-transform helper
   =========================================================================
   Replaces js/imagekit.js (ImageKit's free tier hit the same wall
   Cloudinary did before it — a hard storage/bandwidth cap that takes every
   product photo offline at once when crossed). R2's free tier (10 GB
   storage, no egress fees) has no such cutoff; usage past it is billed per
   GB instead of the account being switched off.

   Upload: the browser asks /api/upload-image for a short-lived presigned R2
   PUT URL (admin-gated — same "sign in as admin, get a short-lived upload
   credential" shape the old ImageKit auth flow used), then PUTs the file
   bytes straight to R2. The file never passes through our own server, so
   there's no multipart parsing to write and no risk of hitting Vercel's
   ~4.5MB serverless body limit.

   Serve: every new upload's URL is this project's own `/api/img?key=...`
   proxy, which fetches the object from R2 (the bucket itself is never
   public) and resizes it on demand with sharp, long-cached at Vercel's
   edge — the same job ik.imagekit.io's `tr:` params used to do.

   Old ik.imagekit.io / Cloudinary URLs still sitting in Firestore from
   before this migration keep rendering unchanged via the pass-through
   branches in optimizedUrl() below — nothing breaks until each is
   individually re-uploaded through the new flow.
   ========================================================================= */

import { auth } from "./firebase-config.js";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — same cap the ImageKit flow had

async function authHeader({ forceRefresh = false } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in as an admin to upload images.");
  const idToken = await user.getIdToken(forceRefresh);
  return { Authorization: `Bearer ${idToken}` };
}

/* SEC-9-style retry: a cached ID token can be stale (expired, or minted
   before the account was promoted to admin), so a 401/403 is retried once
   with a force-refreshed token before giving up. */
async function fetchJson(url, options, retryOn401 = true) {
  const res = await fetch(url, options);
  if ((res.status === 401 || res.status === 403) && retryOn401) {
    const headers = { ...options.headers, ...(await authHeader({ forceRefresh: true })) };
    return fetchJson(url, { ...options, headers }, false);
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error((json && json.error) || "Request failed.");
  return json;
}

/* Upload a single image File/Blob. Returns { url }.
   Optional onProgress(percent) callback for progress bars. */
export async function uploadImage(file, { onProgress } = {}) {
  if (!file) throw new Error("No file selected.");
  const type = file.type || "image/jpeg";
  if (!type.startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > MAX_BYTES) throw new Error("Image must be under 10MB.");

  const headers = await authHeader();
  const { uploadUrl, url } = await fetchJson(
    `/api/upload-image?contentType=${encodeURIComponent(type)}`,
    { headers },
  );

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", type);
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("Upload failed."));
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload.")));
    xhr.send(file);
  });

  return { url };
}

/* Upload several images in sequence. Returns array of { url }. */
export async function uploadImages(fileList, { onEach } = {}) {
  const files = Array.from(fileList || []);
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const r = await uploadImage(files[i], {
      onProgress: (p) => { if (onEach) onEach(i, p); }
    });
    out.push(r);
  }
  return out;
}

/* Deletes an admin-uploaded image from R2 by its /api/img?key=... url.
   Silently no-ops on any error, and on any URL that isn't ours (a leftover
   ImageKit/Cloudinary url) — the UI should still clear the field regardless
   of whether there was anything here to delete. */
export async function deleteImage(url) {
  if (!url) return;
  try {
    const headers = { "Content-Type": "application/json", ...(await authHeader()) };
    await fetchJson("/api/delete-image", { method: "POST", headers, body: JSON.stringify({ url }) });
  } catch {
    // Non-fatal — UI should still remove the image even if the delete fails.
  }
}

/* True for one of our own resize-proxy URLs. */
export function isR2Url(url) {
  return typeof url === "string" && url.startsWith("/api/img?");
}

/* Rewrites one of our own /api/img URLs to request a specific size.
   No-op (passthrough) for any other URL. */
export function r2Url(url, width, height) {
  if (!isR2Url(url)) return url;
  const u = new URL(url, "https://zahroun.com");
  if (width) u.searchParams.set("w", String(Math.round(width)));
  if (height) u.searchParams.set("h", String(Math.round(height)));
  return u.pathname + u.search;
}

const IK_BASE = "https://ik.imagekit.io/zahroun/";

/* Drop-in for the old ik.imagekit.io / Cloudinary optimizedUrl(url, width)
   — width-only, aspect-preserving resize. Kept so any old stored URL (not
   yet re-uploaded through the R2 flow) keeps rendering correctly. */
export function optimizedUrl(url, width = 600) {
  if (!url) return url;
  if (isR2Url(url)) return r2Url(url, width);
  if (url.startsWith(IK_BASE)) return url.replace(IK_BASE, `${IK_BASE}tr:w-${width},f-auto/`);
  if (!url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/w_${width},f_auto,q_auto/`);
}

/* =========================================================================
   ZAHROUN — ImageKit image upload + URL-transform helper
   =========================================================================
   Replaces js/cloudinary.js (Cloudinary's free-tier credit pool ran out).
   ImageKit's free tier gives 20GB storage + 20GB bandwidth/month as
   dedicated buckets, not a shared "credit" pool.

   Uploads go through a small serverless signer (api/imagekit-auth.js) so
   the ImageKit Private Key never reaches the browser — only a short-lived
   token/signature pair does.
   ========================================================================= */

import { auth } from "./firebase-config.js";

const IK_URL_ENDPOINT = "https://ik.imagekit.io/zahroun";
const IK_PUBLIC_KEY = "public_3Pd1lxXtRc2yHWaaICeO9+RC4sI=";
const IK_AUTH_ENDPOINT = "/api/imagekit-auth";
const IK_UPLOAD_ENDPOINT = "https://upload.imagekit.io/api/v1/files/upload";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/* SEC-9: the signer now requires a verified Firebase admin, so the caller's ID
   token must be attached. A cached token can be stale (expired, or minted
   before the account was promoted to admin), so a 401/403 is retried once with
   a force-refreshed token before giving up. */
async function getAuthParams({ forceRefresh = false } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in as an admin to upload images.");

  const idToken = await user.getIdToken(forceRefresh);
  const res = await fetch(IK_AUTH_ENDPOINT, {
    headers: { Authorization: `Bearer ${idToken}` }
  });

  if ((res.status === 401 || res.status === 403) && !forceRefresh) {
    return getAuthParams({ forceRefresh: true });
  }
  if (!res.ok) {
    let msg = "Could not authenticate upload.";
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json(); // { token, expire, signature }
}

/* Upload a single image File. Returns { url, publicId }.
   Optional onProgress(percent) callback for progress bars. */
export async function uploadImage(file, { onProgress } = {}) {
  if (!file) throw new Error("No file selected.");
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > MAX_BYTES) throw new Error("Image must be under 10MB.");

  const { token, expire, signature } = await getAuthParams();

  const form = new FormData();
  form.append("file", file);
  form.append("fileName", file.name || `upload-${Date.now()}`);
  form.append("publicKey", IK_PUBLIC_KEY);
  form.append("signature", signature);
  form.append("token", token);
  form.append("expire", expire);
  form.append("useUniqueFileName", "true");
  form.append("folder", "/zahroun");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", IK_UPLOAD_ENDPOINT);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === "function") {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ url: res.url, publicId: res.fileId });
        } else {
          reject(new Error(res.message || "Upload failed."));
        }
      } catch {
        reject(new Error("Upload failed (bad response)."));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(form);
  });
}

/* Upload several images in sequence. Returns array of { url, publicId }. */
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

/* Insert an ImageKit "tr:" transformation segment into a delivery URL, e.g.
   ikTransform(url, "w-400,h-540,fo-auto,f-auto"). No-op for URLs that
   aren't from our ImageKit endpoint (legacy Cloudinary URLs on old
   products pass through untouched and still render, just unresized). */
export function ikTransform(url, tr) {
  if (!url || !url.startsWith(IK_URL_ENDPOINT + "/")) return url || "";
  return url.replace(IK_URL_ENDPOINT + "/", `${IK_URL_ENDPOINT}/tr:${tr}/`);
}

/* Drop-in for the old Cloudinary optimizedUrl(url, width) — width-only,
   aspect-preserving resize. Use for fast-loading thumbnails. */
export function optimizedUrl(url, width = 600) {
  return ikTransform(url, `w-${width},f-auto`);
}

/* =========================================================================
   ZAHROUN — Cloudinary image upload helper
   =========================================================================
   WHY: Firebase Storage now requires the paid Blaze plan. Cloudinary's
   free tier (25 GB storage + 25 GB bandwidth/month) lets us upload images
   straight from the browser — no server, perfect for a Netlify static site.

   ONE-TIME SETUP (free):
   1. Create an account at https://cloudinary.com  (sign up free)
   2. On the Dashboard, copy your "Cloud name".
   3. Go to Settings (gear icon) -> Upload -> "Upload presets"
        -> click "Add upload preset"
        -> set "Signing Mode" = Unsigned
        -> (optional) Folder = zahroun
        -> Save, then copy the preset NAME.
   4. Paste both values below.

   NOTE: Unsigned uploads are fine here because the admin panel is behind
   login. Later, for stricter security, this can move to a signed upload
   via a Netlify Function.
   ========================================================================= */

const CLOUDINARY_CLOUD_NAME = "dj3nmxfj0";       // Zahroun Cloudinary cloud name
const CLOUDINARY_UPLOAD_PRESET = "zahroun_upload"; // unsigned upload preset

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/* Upload a single image File. Returns { url, publicId }.
   Optional onProgress(percent) callback for progress bars. */
export async function uploadImage(file, { onProgress } = {}) {
  if (!file) throw new Error("No file selected.");
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > MAX_BYTES) throw new Error("Image must be under 10MB.");
  if (CLOUDINARY_CLOUD_NAME === "YOUR_CLOUD_NAME") {
    throw new Error("Cloudinary not configured. Add your cloud name + preset in js/cloudinary.js");
  }

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === "function") {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ url: res.secure_url, publicId: res.public_id });
        } else {
          reject(new Error((res.error && res.error.message) || "Upload failed."));
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

/* Return a CDN-optimized, resized version of a Cloudinary URL
   (auto format + auto quality + width). Use for fast-loading thumbnails. */
export function optimizedUrl(secureUrl, width = 600) {
  if (!secureUrl || !secureUrl.includes("/upload/")) return secureUrl;
  return secureUrl.replace("/upload/", `/upload/f_auto,q_auto,w_${width}/`);
}

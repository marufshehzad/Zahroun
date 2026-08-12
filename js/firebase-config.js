/* =========================================================================
   ZAHROUN — Firebase configuration & initialization
   =========================================================================
   HOW TO ACTIVATE:
   1. Go to https://console.firebase.google.com  ->  Add project (name: "zahroun")
   2. Inside the project: click the Web icon  </>  to "Add app".
   3. Register the app (nickname: "Zahroun Web"). Firebase shows a
      `firebaseConfig` object — copy its values into the object below.
   4. In the left menu, enable these products (free Spark plan):
        - Build > Authentication  (Email/Password + Google sign-in)
        - Build > Firestore Database  (Start in *production* mode)
   NOTE: Firebase Storage now requires the paid Blaze plan, so image
   uploads use ImageKit's free tier instead (see js/imagekit.js).

   NOTE: These config values are NOT secrets. They are public client
   identifiers and are safe to commit. Real security comes from the
   Firestore/Storage Security Rules (added in a later phase).

   This uses the modular Firebase SDK (v10) loaded from the official CDN,
   so no build step / npm install is required for the static site.
   ========================================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA8D5-muT5d_kFekNU1lSSYtgZGJI5_OZA",
  authDomain: "zahroun.firebaseapp.com",
  projectId: "zahroun",
  storageBucket: "zahroun.firebasestorage.app",
  messagingSenderId: "923370845185",
  appId: "1:923370845185:web:6fd1c3f3c1e235b255bc00"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// Persist login across sessions (prevents repeated login on return visits)
setPersistence(auth, browserLocalPersistence).catch(() => {});

// IndexedDB offline cache for fast loads — but IndexedDB/BroadcastChannel
// are often locked down inside in-app browsers (Facebook/Instagram ad
// clicks open the site in one of these). There, initializeFirestore()
// throws synchronously, which — since every page imports `db` from here —
// took down the whole site with a blank stuck-loading screen. Fall back to
// Firestore's default in-memory cache so the site still loads there; it
// just loses cross-reload offline persistence, which bundled/session
// fallbacks elsewhere already cover.
let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  console.warn("[Zahroun] Persistent Firestore cache unavailable (likely a restrictive in-app browser); using in-memory cache instead.", e);
  _db = getFirestore(app);
}
export const db = _db;

export default app;
/* Image uploads use ImageKit (js/imagekit.js), not Firebase Storage. */

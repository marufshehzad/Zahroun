/* =========================================================================
   ZAHROUN — Authentication module (Firebase Auth + Firestore user profiles)
   =========================================================================
   Self-contained drop-in component. Loaded once per page as a module:
       <script type="module" src="js/auth.js"></script>

   It does everything related to auth:
     - injects a luxury-themed login / signup modal (matches site theme)
     - adds an account button into the existing .nav-icons (no HTML edits)
     - email/password signup + login, Google sign-in, logout, password reset
     - persistent sessions (stay logged in across visits)
     - creates a Firestore users/{uid} profile with a role ("customer"/"admin")
     - exposes window.zahrounAuth for other modules (cart, admin route guard)

   No existing UI/theme/layout is changed — everything is injected on top.
   ========================================================================= */

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* Keep users signed in across page loads / visits. */
setPersistence(auth, browserLocalPersistence).catch(() => {});

/* In-memory cache of the current user's Firestore profile (incl. role). */
let currentProfile = null;

/* ---------------------------------------------------------------------------
   Toast notifications (shared, theme-coloured). Reused across the site.
   showToast("message", "success" | "error")
   --------------------------------------------------------------------------- */
function showToast(message, type = "success") {
  let toast = document.getElementById("zahroun-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "zahroun-toast";
    document.body.appendChild(toast);
  }
  const ok = type !== "error";
  toast.style.cssText = `
    position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%);
    background: ${ok ? "var(--primary-color, #163E34)" : "#9b2226"};
    color: #fff; padding: 0.85rem 2rem; border-radius: 50px;
    font-family: var(--font-sans, sans-serif); font-size: 0.95rem;
    z-index: 100000; box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    opacity: 0; transition: opacity .3s ease; pointer-events: none;
    max-width: 90vw; text-align: center;`;
  toast.textContent = (ok ? "✓ " : "⚠ ") + message;
  requestAnimationFrame(() => { toast.style.opacity = "1"; });
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = "0"; }, 3000);
}
window.showToast = showToast;

/* Convert Firebase errors into friendly messages (and log the raw error). */
function friendlyError(err) {
  const code = (err && err.code) || "";
  console.error("[Zahroun Auth] error:", code || err, err); // open F12 Console to see this
  const map = {
    "auth/email-already-in-use": "This email is already registered. Try logging in.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password. Try again.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
    "auth/popup-blocked": "Popup blocked — allow popups, then try again.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/operation-not-allowed": "This sign-in method is NOT enabled in Firebase Console.",
    "auth/unauthorized-domain": "This domain isn't authorized in Firebase Auth settings.",
    "permission-denied": "Database blocked the write — publish your Firestore rules.",
    "unavailable": "Firestore unavailable — make sure the database is created."
  };
  return map[code] || `Error: ${code || "unknown"} — please try again.`;
}

/* ---------------------------------------------------------------------------
   Modal markup + scoped styles (uses the site's CSS variables -> on-theme).
   --------------------------------------------------------------------------- */
function injectStyles() {
  if (document.getElementById("za-styles")) return;
  const style = document.createElement("style");
  style.id = "za-styles";
  style.textContent = `
    #zahroun-auth-modal{position:fixed;inset:0;z-index:99999;display:none;
      align-items:center;justify-content:center;background:rgba(15,46,39,.45);
      backdrop-filter:blur(4px);padding:1rem;}
    #zahroun-auth-modal.open{display:flex;animation:zaFade .25s ease;}
    @keyframes zaFade{from{opacity:0}to{opacity:1}}
    .za-card{background:var(--surface-color,#fff);width:100%;max-width:420px;
      border-radius:14px;padding:2.25rem;box-shadow:0 20px 60px rgba(0,0,0,.25);
      position:relative;animation:zaUp .3s cubic-bezier(.25,.8,.25,1);
      max-height:92vh;overflow-y:auto;}
    @keyframes zaUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    .za-close{position:absolute;top:1rem;right:1rem;background:none;border:none;
      font-size:1.6rem;cursor:pointer;color:var(--text-muted,#666);line-height:1;}
    .za-title{font-family:var(--font-serif,serif);color:var(--primary-color,#163E34);
      font-size:1.7rem;text-align:center;margin-bottom:.25rem;}
    .za-sub{text-align:center;color:var(--text-muted,#666);font-size:.9rem;margin-bottom:1.5rem;}
    .za-tabs{display:flex;border-bottom:1px solid var(--border-color,#DCD8CF);margin-bottom:1.5rem;}
    .za-tab{flex:1;padding:.75rem;background:none;border:none;cursor:pointer;
      font-family:var(--font-sans,sans-serif);font-size:.95rem;color:var(--text-muted,#666);
      border-bottom:2px solid transparent;transition:all .3s;}
    .za-tab.active{color:var(--primary-color,#163E34);border-bottom-color:var(--primary-color,#163E34);font-weight:600;}
    .za-field{margin-bottom:1rem;}
    .za-field label{display:block;font-size:.82rem;color:var(--text-muted,#666);margin-bottom:.35rem;letter-spacing:.3px;}
    .za-field input{width:100%;padding:.8rem 1rem;border:1px solid var(--border-color,#DCD8CF);
      border-radius:8px;font-family:var(--font-sans,sans-serif);font-size:.95rem;
      background:var(--bg-color,#F5F3EF);transition:border-color .3s;}
    .za-field input:focus{outline:none;border-color:var(--primary-color,#163E34);background:#fff;}
    .za-btn{width:100%;padding:.85rem;background:var(--primary-color,#163E34);color:#fff;border:none;
      border-radius:8px;font-family:var(--font-sans,sans-serif);font-size:.98rem;font-weight:500;
      letter-spacing:.5px;cursor:pointer;transition:background .3s;margin-top:.25rem;}
    .za-btn:hover{background:var(--primary-hover,#0F2E27);}
    .za-btn:disabled{opacity:.6;cursor:not-allowed;}
    .za-google{display:flex;align-items:center;justify-content:center;gap:.6rem;width:100%;
      padding:.8rem;background:#fff;color:var(--text-main,#1A1A1A);border:1px solid var(--border-color,#DCD8CF);
      border-radius:8px;font-family:var(--font-sans,sans-serif);font-size:.95rem;cursor:pointer;transition:all .3s;}
    .za-google:hover{background:var(--bg-color,#F5F3EF);}
    .za-google svg{width:18px;height:18px;}
    .za-divider{display:flex;align-items:center;gap:1rem;margin:1.25rem 0;color:var(--text-muted,#999);font-size:.8rem;}
    .za-divider::before,.za-divider::after{content:"";flex:1;height:1px;background:var(--border-color,#DCD8CF);}
    .za-link{background:none;border:none;color:var(--primary-color,#163E34);cursor:pointer;
      font-size:.85rem;text-decoration:underline;font-family:var(--font-sans,sans-serif);padding:0;}
    .za-foot{text-align:center;margin-top:1rem;font-size:.85rem;color:var(--text-muted,#666);}
    /* Account button + dropdown in navbar */
    .za-account-wrap{position:relative;display:inline-block;}
    .za-menu{position:absolute;right:0;top:calc(100% + 10px);background:#fff;border:1px solid var(--border-color,#DCD8CF);
      border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.12);min-width:200px;padding:.5rem;display:none;z-index:9000;}
    .za-menu.open{display:block;animation:zaFade .2s ease;}
    .za-menu .za-user{padding:.6rem .75rem;border-bottom:1px solid var(--border-color,#DCD8CF);margin-bottom:.4rem;}
    .za-menu .za-user strong{display:block;font-size:.9rem;color:var(--text-main,#1A1A1A);}
    .za-menu .za-user span{font-size:.75rem;color:var(--text-muted,#666);}
    .za-menu a,.za-menu button{display:flex;align-items:center;gap:.6rem;width:100%;text-align:left;
      padding:.6rem .75rem;background:none;border:none;border-radius:6px;cursor:pointer;
      font-family:var(--font-sans,sans-serif);font-size:.9rem;color:var(--text-main,#1A1A1A);}
    .za-menu a:hover,.za-menu button:hover{background:var(--bg-color,#F5F3EF);}
  `;
  document.head.appendChild(style);
}

function injectModal() {
  injectStyles();
  if (document.getElementById("zahroun-auth-modal")) return;

  const googleSvg = `<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

  const modal = document.createElement("div");
  modal.id = "zahroun-auth-modal";
  modal.innerHTML = `
    <div class="za-card" role="dialog" aria-modal="true">
      <button class="za-close" aria-label="Close" data-za-close>&times;</button>

      <!-- LOGIN + SIGNUP -->
      <div data-za-view="auth">
        <h2 class="za-title">Zahroun</h2>
        <p class="za-sub">Welcome to luxury fragrance</p>
        <div class="za-tabs">
          <button class="za-tab active" data-za-tab="login">Login</button>
          <button class="za-tab" data-za-tab="signup">Sign Up</button>
        </div>

        <form data-za-form="login">
          <div class="za-field"><label>Email</label><input type="email" name="email" required autocomplete="email"></div>
          <div class="za-field"><label>Password</label><input type="password" name="password" required autocomplete="current-password"></div>
          <div style="text-align:right;margin-bottom:1rem;"><button type="button" class="za-link" data-za-forgot>Forgot password?</button></div>
          <button type="submit" class="za-btn">Login</button>
        </form>

        <form data-za-form="signup" style="display:none;">
          <div class="za-field"><label>Full Name</label><input type="text" name="name" required autocomplete="name"></div>
          <div class="za-field"><label>Email</label><input type="email" name="email" required autocomplete="email"></div>
          <div class="za-field"><label>Password</label><input type="password" name="password" required minlength="6" autocomplete="new-password"></div>
          <button type="submit" class="za-btn">Create Account</button>
        </form>

        <div class="za-divider">or</div>
        <button class="za-google" data-za-google>${googleSvg} Continue with Google</button>
      </div>

      <!-- FORGOT PASSWORD -->
      <div data-za-view="forgot" style="display:none;">
        <h2 class="za-title">Reset Password</h2>
        <p class="za-sub">We'll email you a reset link</p>
        <form data-za-form="forgot">
          <div class="za-field"><label>Email</label><input type="email" name="email" required autocomplete="email"></div>
          <button type="submit" class="za-btn">Send Reset Link</button>
        </form>
        <p class="za-foot"><button class="za-link" data-za-back>&larr; Back to login</button></p>
      </div>
    </div>`;
  document.body.appendChild(modal);
  wireModal(modal);
}

/* ---------------------------------------------------------------------------
   Modal open/close + view switching + form handlers.
   --------------------------------------------------------------------------- */
function wireModal(modal) {
  const show = (sel, on) => { const el = modal.querySelector(sel); if (el) el.style.display = on ? "" : "none"; };
  const setView = (v) => {
    show('[data-za-view="auth"]', v === "auth");
    show('[data-za-view="forgot"]', v === "forgot");
  };
  const setTab = (t) => {
    modal.querySelectorAll(".za-tab").forEach(b => b.classList.toggle("active", b.dataset.zaTab === t));
    show('[data-za-form="login"]', t === "login");
    show('[data-za-form="signup"]', t === "signup");
  };

  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.hasAttribute("data-za-close")) closeAuthModal();
    if (e.target.dataset.zaTab) setTab(e.target.dataset.zaTab);
    if (e.target.hasAttribute("data-za-forgot")) setView("forgot");
    if (e.target.hasAttribute("data-za-back")) setView("auth");
    if (e.target.closest("[data-za-google]")) handleGoogle();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAuthModal(); });

  modal.querySelector('[data-za-form="login"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Logging in...";
    const f = new FormData(e.target);
    try {
      await signInWithEmailAndPassword(auth, f.get("email").trim(), f.get("password"));
      showToast("Welcome back!"); closeAuthModal();
    } catch (err) { showToast(friendlyError(err), "error"); }
    finally { btn.disabled = false; btn.textContent = "Login"; }
  });

  modal.querySelector('[data-za-form="signup"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Creating...";
    const f = new FormData(e.target);
    try {
      const cred = await createUserWithEmailAndPassword(auth, f.get("email").trim(), f.get("password"));
      await updateProfile(cred.user, { displayName: f.get("name").trim() });
      await createUserProfile(cred.user, f.get("name").trim());
      showToast("Account created. Welcome to Zahroun!"); closeAuthModal();
    } catch (err) { showToast(friendlyError(err), "error"); }
    finally { btn.disabled = false; btn.textContent = "Create Account"; }
  });

  modal.querySelector('[data-za-form="forgot"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Sending...";
    const f = new FormData(e.target);
    try {
      await sendPasswordResetEmail(auth, f.get("email").trim());
      showToast("Reset link sent. Check your email.");
      setView("auth");
    } catch (err) { showToast(friendlyError(err), "error"); }
    finally { btn.disabled = false; btn.textContent = "Send Reset Link"; }
  });
}

function openAuthModal() {
  injectModal();
  document.getElementById("zahroun-auth-modal").classList.add("open");
}
function closeAuthModal() {
  const m = document.getElementById("zahroun-auth-modal");
  if (m) m.classList.remove("open");
}

async function handleGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(auth, provider);
    await createUserProfile(cred.user, cred.user.displayName || "");
    showToast("Signed in with Google!"); closeAuthModal();
  } catch (err) { showToast(friendlyError(err), "error"); }
}

/* ---------------------------------------------------------------------------
   Firestore user profile. Creates users/{uid} on first sign-up/sign-in.
   Default role = "customer". Promote to "admin" manually in the console.
   --------------------------------------------------------------------------- */
async function createUserProfile(user, name) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      name: name || user.displayName || "",
      email: user.email || "",
      role: "customer",
      blocked: false,
      createdAt: serverTimestamp()
    });
  }
}

async function loadProfile(user) {
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      currentProfile = snap.data();
    } else {
      // Self-heal: create a profile if it's missing (e.g. account was made
      // before the Firestore rules allowed the write).
      await createUserProfile(user, user.displayName || "");
      const again = await getDoc(ref);
      currentProfile = again.exists() ? again.data() : null;
    }
  } catch { currentProfile = null; }
  return currentProfile;
}

/* ---------------------------------------------------------------------------
   Navbar account button + dropdown. Injected into existing .nav-icons.
   --------------------------------------------------------------------------- */
function renderAccount(user) {
  const navIcons = document.querySelector(".nav-icons");
  if (!navIcons) return;
  let wrap = document.getElementById("za-account");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "za-account";
    wrap.className = "za-account-wrap";
    const cartBtn = navIcons.querySelector("#cart-icon");
    navIcons.insertBefore(wrap, cartBtn || navIcons.firstChild);
  }

  if (!user) {
    wrap.innerHTML = `<button aria-label="Account" data-za-open><ion-icon name="person-outline"></ion-icon></button>`;
    wrap.querySelector("[data-za-open]").onclick = openAuthModal;
    return;
  }

  const name = user.displayName || (currentProfile && currentProfile.name) || "Account";
  const isAdmin = currentProfile && currentProfile.role === "admin";
  wrap.innerHTML = `
    <button aria-label="Account" data-za-toggle><ion-icon name="person-circle-outline"></ion-icon></button>
    <div class="za-menu">
      <div class="za-user"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(user.email || "")}</span></div>
      <a href="account.html"><ion-icon name="bag-handle-outline"></ion-icon> My Orders</a>
      <a href="wishlist.html"><ion-icon name="heart-outline"></ion-icon> Wishlist</a>
      ${isAdmin ? `<a href="admin/index.html"><ion-icon name="speedometer-outline"></ion-icon> Admin Panel</a>` : ``}
      <button data-za-logout><ion-icon name="log-out-outline"></ion-icon> Logout</button>
    </div>`;
  const menu = wrap.querySelector(".za-menu");
  wrap.querySelector("[data-za-toggle]").onclick = (e) => { e.stopPropagation(); menu.classList.toggle("open"); };
  wrap.querySelector("[data-za-logout]").onclick = async () => {
    await signOut(auth); showToast("Logged out."); menu.classList.remove("open");
  };
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) menu.classList.remove("open"); });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------------------------------------------------------------------
   Auth state -> update navbar, cache profile, run admin route guard.
   --------------------------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (user) { await loadProfile(user); } else { currentProfile = null; }
  renderAccount(user);
  runAdminGuard(user);
  document.dispatchEvent(new CustomEvent("zahroun-auth-changed", { detail: { user, profile: currentProfile } }));
});

/* Admin route protection: any page that sets <body data-require-admin>
   will redirect non-admins away. Used by the admin panel pages. */
function runAdminGuard(user) {
  if (!document.body.hasAttribute("data-require-admin")) return;
  if (!user) { window.location.href = "../index.html"; return; }
  // profile may still be loading; re-check shortly
  setTimeout(() => {
    if (!currentProfile || currentProfile.role !== "admin") {
      showToast("Admin access only", "error");
      window.location.href = "../index.html";
    }
  }, 400);
}

/* ---------------------------------------------------------------------------
   Public API for other modules (cart, wishlist, admin guard).
   --------------------------------------------------------------------------- */
window.zahrounAuth = {
  openModal: openAuthModal,
  closeModal: closeAuthModal,
  logout: () => signOut(auth),
  getUser: () => auth.currentUser,
  getProfile: () => currentProfile,
  isAdmin: () => !!(currentProfile && currentProfile.role === "admin"),
  requireLogin: () => { if (!auth.currentUser) { openAuthModal(); return false; } return true; }
};

/* Boot: inject styles + account button immediately (logged-out state),
   onAuthStateChanged will refresh it once Firebase resolves. */
injectStyles();
renderAccount(null);

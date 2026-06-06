/* =========================================================================
   ZAHROUN — Admin dashboard logic
   ========================================================================= */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc, addDoc,
  serverTimestamp, Timestamp, query, limit, onSnapshot, where, orderBy, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { uploadImage, optimizedUrl } from "./cloudinary.js";

const $ = (sel) => document.querySelector(sel);
const gate = $("#admin-gate");

/* ---- EmailJS (order confirmation mail) ---------------------------------- */
const EMAILJS_PUBLIC_KEY  = "wUGMJ65uoDE5-C0AF";
const EMAILJS_SERVICE_ID  = "service_y827jxy";
const EMAILJS_TEMPLATE_ID = "template_7r5991b";

(function initEmailJS() {
  if (typeof emailjs !== "undefined") emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
})();

async function sendConfirmationEmail(order) {
  if (typeof emailjs === "undefined") return;
  if (!order.userEmail) return;
  try {
    const items      = order.items || [];
    const name       = order.customer?.name || "";
    const ordShort   = order.orderNum ? String(order.orderNum) : order.id.slice(0, 8).toUpperCase();
    const subtotal   = +(order.subtotal || 0);
    const delivery   = +(order.delivery || 0);
    const discount   = +(order.discount || 0);
    const total      = +(order.total || 0);
    const loyaltyPts = +(order.loyaltyRedeemedPoints || 0);
    const loyaltyAmt = +(order.loyaltyDiscountAmount || 0);
    const orderDate  = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
      + ", " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    const fmtNum = v => (+v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    /* ── Items HTML — all items in one card table ──────────────────── */
    const itemRows = items.map((item, idx) => {
      const rawImg = item.image || item.imageUrl || item.img || item.images?.[0] || "";
      const imgUrl = (rawImg && typeof rawImg === "string" && rawImg.startsWith("https://")) ? rawImg : "";
      if (rawImg && !imgUrl) console.warn("[Email] Skipping non-HTTPS image for:", item.name, "|", String(rawImg).slice(0, 120));
      const imgContent = imgUrl
        ? `<img src="${imgUrl}" alt="${item.name}" width="80" height="80" style="width:80px;height:80px;object-fit:cover;display:block;">`
        : `<div style="width:80px;height:80px;background:rgba(10,58,49,0.55);border:1px solid rgba(212,166,74,0.18);"></div>`;
      const imgCell = `<div style="width:80px;height:80px;border-radius:10px;overflow:hidden;">${imgContent}</div>`;
      const size    = item.size || item.selectedSize || "";
      const isLast  = idx === items.length - 1;
      const sep     = isLast ? "" : `<tr><td colspan="3" style="padding:0 20px;"><div style="height:1px;background:rgba(212,166,74,0.10);"></div></td></tr>`;

      if (item.isFreeGift) {
        const origPrice = parseFloat(item.originalPrice) || 0;
        return `<tr style="background:rgba(10,58,49,0.22);">
  <td width="100" valign="middle" style="padding:20px 0 20px 20px;">${imgCell}</td>
  <td valign="middle" style="padding:20px 14px;">
    <div style="font-family:'Inter',Arial,sans-serif;font-size:14px;font-weight:600;color:#FFFFFF;line-height:1.4;margin-bottom:5px;">${item.name}</div>
    ${size ? `<div style="font-family:'Inter',Arial,sans-serif;font-size:10px;font-weight:600;color:#9E9E9E;letter-spacing:2px;text-transform:uppercase;margin-bottom:7px;">${size}</div>` : ""}
    <div style="display:inline-block;padding:3px 9px;background:#D4A64A;color:#041A16;font-family:'Inter',Arial,sans-serif;font-size:9px;font-weight:800;letter-spacing:3px;text-transform:uppercase;border-radius:3px;">Complimentary Gift</div>
  </td>
  <td align="right" valign="middle" style="padding:20px 20px 20px 0;white-space:nowrap;">
    ${origPrice > 0 ? `<div style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#9E9E9E;text-decoration:line-through;margin-bottom:4px;">BDT&nbsp;${fmtNum(origPrice)}</div>` : ""}
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;font-weight:700;color:#D4A64A;letter-spacing:1px;">FREE</div>
  </td>
</tr>${sep}`;
      }

      const unitPrice = parseFloat(item.selectedPrice || item.price) || 0;
      const rowTotal  = fmtNum(unitPrice * item.quantity);
      return `<tr>
  <td width="100" valign="middle" style="padding:20px 0 20px 20px;">${imgCell}</td>
  <td valign="middle" style="padding:20px 14px;">
    <div style="font-family:'Inter',Arial,sans-serif;font-size:14px;font-weight:600;color:#FFFFFF;line-height:1.4;margin-bottom:5px;">${item.name}</div>
    ${size ? `<div style="font-family:'Inter',Arial,sans-serif;font-size:10px;font-weight:600;color:#9E9E9E;letter-spacing:2px;text-transform:uppercase;margin-bottom:5px;">${size}</div>` : ""}
    <div style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#8A8A8A;">Qty&nbsp;&times;&nbsp;${item.quantity}</div>
  </td>
  <td align="right" valign="middle" style="padding:20px 20px 20px 0;white-space:nowrap;">
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:16px;font-weight:600;color:#D4A64A;letter-spacing:0.5px;">BDT&nbsp;${rowTotal}</div>
    ${item.quantity > 1 ? `<div style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#8A8A8A;margin-top:4px;">${fmtNum(unitPrice)}&nbsp;each</div>` : ""}
  </td>
</tr>${sep}`;
    }).join("");
    const itemsHtml = `<table width="100%" cellpadding="0" cellspacing="0" border="0"
        style="border:1px solid rgba(212,166,74,0.14);border-radius:14px;overflow:hidden;background:rgba(4,16,12,0.2);">${itemRows}</table>`;

    /* ── Discount HTML — standalone block above summary card ───────── */
    let discountHtml = "";
    const hasDiscount  = discount > 0;
    const hasLoyalty   = loyaltyPts > 0 && loyaltyAmt > 0;
    if (hasDiscount || hasLoyalty) {
      let rows = "";
      if (hasDiscount) {
        rows += `<tr>
  <td style="padding:13px 22px;border-bottom:1px solid rgba(255,255,255,0.05);">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#CFCFCF;">Coupon Discount${order.couponCode ? " (" + order.couponCode + ")" : ""}</td>
      <td align="right" style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#EDEDED;font-weight:500;">-BDT ${fmtNum(discount)}</td>
    </tr></table>
  </td>
</tr>`;
      }
      if (hasLoyalty) {
        rows += `<tr>
  <td style="padding:13px 22px;border-bottom:1px solid rgba(255,255,255,0.05);">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#49C16D;">Loyalty Points (${loyaltyPts} pts redeemed)</td>
      <td align="right" style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#49C16D;font-weight:500;">-BDT ${fmtNum(loyaltyAmt)}</td>
    </tr></table>
  </td>
</tr>`;
      }
      discountHtml = `<table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:rgba(4,16,12,0.55);border:1px solid rgba(212,166,74,0.15);border-radius:12px;overflow:hidden;">
    <tr><td style="padding:10px 22px 4px;">
      <span style="font-family:'Inter',Arial,sans-serif;font-size:9px;font-weight:700;color:#9E9E9E;letter-spacing:2px;text-transform:uppercase;">DISCOUNTS APPLIED</span>
    </td></tr>
    ${rows}
  </table>`;
    }

    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email:       order.userEmail,
      to_name:        name,
      order_id:       ordShort,
      order_date:     orderDate,
      items_html:     itemsHtml,
      subtotal:       fmtNum(subtotal),
      delivery:       fmtNum(delivery),
      discount_html:  discountHtml,
      total:          fmtNum(total),
      payment_method: order.payment?.method || "",
      address:        order.customer?.address || "",
      mobile:         order.customer?.mobile || "",
    });
  } catch (err) {
    console.warn("Confirmation email failed:", err);
  }
}
const gateMsg = $("#gate-msg");
const app = $("#admin-app");

let products = [], orders = [], customers = [], categories = [], coupons = [], reviews = [], messages = [], newsletter = [];
let settings = {};
let editing = null, editingCat = null, editingCoupon = null;
const SIZE_KEYS = ["6ML", "15ML", "30ML", "50ML"];
let sizeImagesMap = { "6ML": "", "15ML": "", "30ML": "", "50ML": "" };
let revenueChart = null, statusChart = null, anRevChart = null, anStatusChart = null;
let anDays = 30;
let anCustomFrom = null;
let anCustomTo = null;
let pfSearch = "", pfCategory = "", pfSort = "default";
const pfFlags = new Set();
const sectionLoaded = new Set();
const acknowledgedOrderIds = new Set(JSON.parse(localStorage.getItem("ackOrderIds") || "[]"));
let _reviewListenerUnsub = null;
let _knownReviewIds = null;
let _newPendingReviews = 0;
let galleryImages = [];
let galleryDragSrc = null;
let ofSearch = "";
let ofStatusFilter = "all";
let currentDetailOrder = null;
let _cropResolve = null;
let _cropReject = null;
let _cropPanX = 0, _cropPanY = 0, _cropScale = 1;
let _cropNatW = 0, _cropNatH = 0, _cropFrameW = 0, _cropFrameH = 0;
let _cropDragging = false, _cropSX = 0, _cropSY = 0, _cropSPX = 0, _cropSPY = 0;
let _cropMM = null, _cropMU = null, _cropTM = null, _cropTU = null;

function _cropApply() {
  const img = document.getElementById("crop-img");
  if (!img) return;
  img.style.width  = (_cropNatW * _cropScale) + "px";
  img.style.height = (_cropNatH * _cropScale) + "px";
  img.style.transform = `translate(${_cropPanX}px,${_cropPanY}px)`;
}

function _cropClamp(x, y) {
  const maxX = 0, minX = _cropFrameW - _cropNatW * _cropScale;
  const maxY = 0, minY = _cropFrameH - _cropNatH * _cropScale;
  return [Math.min(maxX, Math.max(minX, x)), Math.min(maxY, Math.max(minY, y))];
}

function openCropModal(file, { aspectRatio = NaN } = {}) {
  return new Promise((resolve, reject) => {
    _cropResolve = resolve;
    _cropReject = reject;
    const modal = document.getElementById("crop-modal");
    const frame = document.getElementById("crop-wrap");
    const img   = document.getElementById("crop-img");

    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      _cropNatW = img.naturalWidth;
      _cropNatH = img.naturalHeight;
      _cropFrameW = frame.offsetWidth;
      _cropFrameH = frame.offsetHeight;
      _cropScale = Math.max(_cropFrameW / _cropNatW, _cropFrameH / _cropNatH);
      _cropPanX = (_cropFrameW - _cropNatW * _cropScale) / 2;
      _cropPanY = (_cropFrameH - _cropNatH * _cropScale) / 2;
      _cropApply();
    };
    img.src = objUrl;

    if (_cropMM) { document.removeEventListener("mousemove", _cropMM); document.removeEventListener("mouseup", _cropMU); }
    if (_cropTM) { document.removeEventListener("touchmove", _cropTM); document.removeEventListener("touchend", _cropTU); }

    frame.onmousedown = e => {
      _cropDragging = true; _cropSX = e.clientX; _cropSY = e.clientY;
      _cropSPX = _cropPanX; _cropSPY = _cropPanY; e.preventDefault();
    };
    frame.ontouchstart = e => {
      _cropDragging = true; _cropSX = e.touches[0].clientX; _cropSY = e.touches[0].clientY;
      _cropSPX = _cropPanX; _cropSPY = _cropPanY; e.preventDefault();
    };

    _cropMM = e => {
      if (!_cropDragging) return;
      [_cropPanX, _cropPanY] = _cropClamp(_cropSPX + e.clientX - _cropSX, _cropSPY + e.clientY - _cropSY);
      _cropApply();
    };
    _cropMU = () => { _cropDragging = false; };
    _cropTM = e => {
      if (!_cropDragging) return;
      [_cropPanX, _cropPanY] = _cropClamp(_cropSPX + e.touches[0].clientX - _cropSX, _cropSPY + e.touches[0].clientY - _cropSY);
      _cropApply(); e.preventDefault();
    };
    _cropTU = () => { _cropDragging = false; };

    document.addEventListener("mousemove", _cropMM);
    document.addEventListener("mouseup",   _cropMU);
    document.addEventListener("touchmove", _cropTM, { passive: false });
    document.addEventListener("touchend",  _cropTU);

    modal.classList.add("open");
  });
}

function closeCropModal() {
  document.getElementById("crop-modal").classList.remove("open");
  if (_cropMM) { document.removeEventListener("mousemove", _cropMM); document.removeEventListener("mouseup", _cropMU); _cropMM = _cropMU = null; }
  if (_cropTM) { document.removeEventListener("touchmove", _cropTM); document.removeEventListener("touchend", _cropTU); _cropTM = _cropTU = null; }
  const frame = document.getElementById("crop-wrap");
  if (frame) { frame.onmousedown = null; frame.ontouchstart = null; }
  _cropResolve = null; _cropReject = null;
}

const SUBTITLES = {
  dashboard: "Overview of your store performance",
  products: "Manage your fragrance catalogue",
  orders: "Track and update customer orders",
  customers: "Your registered customers",
  categories: "Organise your collections",
  coupons: "Discount codes & promotions",
  promotions: "Manage all promotional features — Buy X Get Y, Spin to Win, Seasonal & more",
  loyalty: "Configure the points program and manage member enrollments",
  "flash-sale": "Limited-time offers with countdown timer",
  "broadcast": "Site-wide announcement banner for all visitors",
  "faq-manager": "Add, edit, and delete FAQ items shown on the FAQ page",
  reviews: "Moderate customer reviews",
  messages: "Contact form submissions",
  analytics: "Traffic & sales insights",
  pages: "Manage hero banners, category cards & gallery images",
  settings: "Store configuration",
  admins: "Manage who has admin access to this panel"
};
const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
const STATUS_COLORS = { pending: "#f0b429", confirmed: "#1a56b8", shipped: "#7c3aed", delivered: "#1e7e34", cancelled: "#9b2226" };

/* ---- Admin gate -------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    gateMsg.innerHTML = 'Please <a href="index.html" style="color:var(--primary-color);">log in</a> first, then open the Admin Panel from the account menu.';
    return;
  }
  // Retry up to 3 times — handles stale/expired auth tokens and race conditions
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) await new Promise(r => setTimeout(r, attempt * 600));
      await user.getIdToken(attempt > 1); // force-refresh token on retry
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) {
        gateMsg.innerHTML = 'Access denied — profile not found.<br><a href="index.html" style="color:var(--primary-color);">Back to site</a>';
        return;
      }
      const data = snap.data();
      if (data.role !== "admin") {
        gateMsg.innerHTML = 'Access denied — role: <strong>' + (data.role || "none") + '</strong>.<br><a href="index.html" style="color:var(--primary-color);">Back to site</a>';
        return;
      }
      gate.style.display = "none";
      app.style.display = "block";
      initAdmin(user, data);
      return;
    } catch (e) {
      if (e.code === "permission-denied" && attempt < 3) {
        gateMsg.textContent = "Verifying access… (" + (attempt + 1) + "/3)";
        continue;
      }
      console.warn("Admin verification failed (attempt " + attempt + "):", e.code || e.message);
      gateMsg.innerHTML = "Could not verify access: " + (e.code || e.message) +
        '<br><button onclick="location.reload()" style="margin-top:.75rem;background:var(--primary-color);color:#fff;border:none;border-radius:8px;padding:.45rem 1.1rem;cursor:pointer;font-size:.9rem;">Retry</button>';
    }
  }
});

/* ---- Init -------------------------------------------------------------- */
async function initAdmin(user, profile) {
  const name = profile.name || user.email;
  $("#admin-who").textContent = name + " · admin";
  $("#side-av").textContent = (name[0] || "A").toUpperCase();
  $("#side-nm").innerHTML = `${escapeHtml(name)}<small>Admin</small>`;

  $("#admin-logout").addEventListener("click", async () => { await signOut(auth); window.location.href = "index.html"; });
  document.querySelectorAll("#admin-nav button").forEach(btn => btn.addEventListener("click", () => switchSection(btn.dataset.section)));
  document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => switchSection(b.dataset.goto)));
  document.querySelectorAll("[data-qa]").forEach(b => b.addEventListener("click", () => {
    const qa = b.dataset.qa;
    if (qa === "add-product") { switchSection("products"); openForm(null); }
    else switchSection(qa);
  }));

  $("#add-product-btn").addEventListener("click", () => openForm(null));
  $("#cancel-product").addEventListener("click", closeForm);
  $("#product-modal").addEventListener("click", (e) => { if (e.target.id === "product-modal") closeForm(); });
  document.getElementById("img-file-multi").addEventListener("change", handleMultiImageUpload);
  document.getElementById("si-sync-btn")?.addEventListener("click", () => {
    const mainImg = galleryImages[0] || "";
    if (!mainImg) { if (window.showToast) window.showToast("Add a main image first.", "error"); return; }
    SIZE_KEYS.forEach(k => { sizeImagesMap[k] = mainImg; });
    renderSizeImageGrid();
  });

  // Size on/off toggles
  SIZE_KEYS.forEach(sz => {
    const cb  = document.getElementById(`sizeOn-${sz}`);
    const num = sz.replace("ML","");
    const inp = document.querySelector(`#product-form input[name="price${num}"]`);
    if (cb && inp) cb.addEventListener("change", () => {
      inp.disabled = !cb.checked;
      inp.closest(".fg").style.opacity = cb.checked ? "1" : "0.42";
    });
  });

  // Product type → show/hide combo fields
  document.getElementById("product-type-sel")?.addEventListener("change", () => {
    const isCombo = document.getElementById("product-type-sel").value === "combo";
    document.getElementById("combo-items-row").style.display = isCombo ? "" : "none";
    document.getElementById("base-price-row").style.display  = isCombo ? "" : "none";
  });

  $("#product-form").addEventListener("submit", saveProduct);

  // Notification bell
  const notifBtn = document.getElementById("notif-btn");
  const notifDrop = document.getElementById("notif-dropdown");
  function positionNotifDrop() {
    const r = notifBtn.getBoundingClientRect();
    const dropW = 320;
    const margin = 10;
    const vw = window.innerWidth;
    // Prefer aligning right edge to button right; clamp so it doesn't go off left edge
    let left = r.right - dropW;
    if (left < margin) left = margin;
    if (left + dropW > vw - margin) left = vw - dropW - margin;
    notifDrop.style.position = "fixed";
    notifDrop.style.top = (r.bottom + 6) + "px";
    notifDrop.style.left = left + "px";
    notifDrop.style.right = "auto";
    notifDrop.style.width = dropW + "px";
  }
  if (notifBtn) {
    notifBtn.addEventListener("click", e => {
      e.stopPropagation();
      const open = notifDrop.style.display !== "none";
      if (open) {
        notifDrop.style.display = "none";
      } else {
        notifDrop.style.display = "";
        positionNotifDrop();
        orders.filter(o => isNewOrder(o)).forEach(o => acknowledgedOrderIds.add(o.id));
        localStorage.setItem("ackOrderIds", JSON.stringify([...acknowledgedOrderIds]));
        updateNotifications();
      }
    });
    window.addEventListener("resize", () => { if (notifDrop.style.display !== "none") positionNotifDrop(); });
    document.addEventListener("click", e => {
      if (!document.getElementById("notif-wrap")?.contains(e.target)) notifDrop.style.display = "none";
    });
  }
  document.getElementById("notif-mark-all")?.addEventListener("click", e => {
    e.stopPropagation();
    orders.forEach(o => acknowledgedOrderIds.add(o.id));
    localStorage.setItem("ackOrderIds", JSON.stringify([...acknowledgedOrderIds]));
    updateNotifications();
  });

  // Order detail modal close
  document.getElementById("od-close")?.addEventListener("click", () => document.getElementById("order-detail-modal")?.classList.remove("open"));
  document.getElementById("order-detail-modal")?.addEventListener("click", e => { if (e.target.id === "order-detail-modal") e.target.classList.remove("open"); });
  document.getElementById("od-print")?.addEventListener("click", () => { if (currentDetailOrder) printOrderInvoice(currentDetailOrder); });

  // Crop modal buttons
  document.getElementById("crop-cancel")?.addEventListener("click", () => {
    closeCropModal();
    if (_cropReject) _cropReject(new Error("cancelled"));
  });
  document.getElementById("crop-ok")?.addEventListener("click", () => {
    const img = document.getElementById("crop-img");
    if (!img || !_cropNatW) return;
    const cropX = -_cropPanX / _cropScale;
    const cropY = -_cropPanY / _cropScale;
    const cropW = _cropFrameW / _cropScale;
    const cropH = _cropFrameH / _cropScale;
    const outW = Math.min(Math.round(cropW * 2), 1800);
    const outH = Math.min(Math.round(cropH * 2), 1800);
    const canvas = document.createElement("canvas");
    canvas.width = outW; canvas.height = outH;
    canvas.getContext("2d").drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
    canvas.toBlob(blob => { const res = _cropResolve; closeCropModal(); if (res) res(blob); }, "image/jpeg", 0.88);
  });

  // Fetch all data once at startup (needed for dashboard stats)
  await Promise.all([fetchProducts(), fetchOrders(), fetchCustomers()]);
  fetchFlashSale().then(updateFlashNavBadge).catch(() => {});
  fetchBroadcast().then(updateBroadcastBadge).catch(() => {});
  renderDashboard();
  updateNotifications();
  // Show unread messages badge without blocking
  fetchMessages().catch(() => {});
  // Real-time new-order notifications
  startOrderListener();
  startReviewListener();
}

/* ---- Real-time order listener + browser notifications ------------------ */
let _orderListenerUnsub = null;
let _knownOrderIds = null;

async function requestNotifPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") await Notification.requestPermission();
}

function playOrderSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch (_) {}
}

function showOrderNotification(order) {
  playOrderSound();
  const title = "New Order — Zahroun";
  const body = `${order.customer?.name || "Customer"} · ৳${order.total}`;
  if (Notification.permission === "granted") {
    try { new Notification(title, { body, icon: "product pictures/main logo.png" }); } catch (_) {}
  }
  adminToast(`🛒 New order from ${order.customer?.name || "a customer"} — ৳${order.total}`);
  const btn = document.getElementById("notif-btn");
  if (btn) { btn.classList.add("ringing"); btn.addEventListener("animationend", () => btn.classList.remove("ringing"), { once: true }); }
  const dropdownOpen = document.getElementById("notif-dropdown")?.style.display !== "none";
  if (dropdownOpen) { acknowledgedOrderIds.add(order.id); localStorage.setItem("ackOrderIds", JSON.stringify([...acknowledgedOrderIds])); }
  updateNotifications();
}

function startOrderListener() {
  requestNotifPermission();
  if (_orderListenerUnsub) _orderListenerUnsub();

  // Snapshot to track which order IDs already exist at startup
  _knownOrderIds = new Set(orders.map(o => o.id));

  const q = query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(50));
  _orderListenerUnsub = onSnapshot(q, snap => {
    if (_knownOrderIds === null) return;
    snap.docChanges().forEach(change => {
      if (change.type === "added" && !_knownOrderIds.has(change.doc.id)) {
        const order = { id: change.doc.id, ...change.doc.data() };
        orders.unshift(order);
        _knownOrderIds.add(change.doc.id);
        showOrderNotification(order);
        if (typeof renderOrderTable === "function") renderOrderTable();
        renderDashboard();
      }
    });
  }, err => console.warn("Order listener:", err));
}

/* ---- Real-time review listener ----------------------------------------- */
function startReviewListener() {
  if (_reviewListenerUnsub) _reviewListenerUnsub();
  // No orderBy — avoids requiring a composite Firestore index (failed-precondition fix).
  const q = query(collection(db, "reviews"), where("status", "==", "pending"), limit(50));
  getDocs(q).then(s => {
    _knownReviewIds = new Set(s.docs.map(d => d.id));
  }).catch(() => { _knownReviewIds = new Set(); });

  _reviewListenerUnsub = onSnapshot(q, snap => {
    if (_knownReviewIds === null) return;
    snap.docChanges().forEach(change => {
      if (change.type === "added" && !_knownReviewIds.has(change.doc.id)) {
        _knownReviewIds.add(change.doc.id);
        const rv = change.doc.data();
        _newPendingReviews++;
        updateReviewBadge();
        adminToast(`⭐ New review from ${rv.reviewerName || "a customer"} on "${rv.productName || "a product"}"`);
      }
    });
  }, err => console.warn("Review listener:", err));
}

function updateReviewBadge() {
  const badge = document.getElementById("nav-reviews-badge");
  if (!badge) return;
  if (_newPendingReviews > 0) { badge.textContent = _newPendingReviews; badge.style.display = ""; }
  else { badge.style.display = "none"; }
}

/* ---- Section switcher — lazy render ------------------------------------ */
function switchSection(name) {
  document.querySelectorAll("#admin-nav button").forEach(b => b.classList.toggle("active", b.dataset.section === name));
  document.querySelectorAll("[data-panel]").forEach(p => p.style.display = p.dataset.panel === name ? "" : "none");
  const titleMap = { "flash-sale": "Flash Sale", "broadcast": "Broadcast", "faq-manager": "FAQ Manager" };
  $("#section-title").textContent = titleMap[name] || (name.charAt(0).toUpperCase() + name.slice(1));
  $("#section-subtitle").textContent = SUBTITLES[name] || "";

  if (name === "dashboard") {
    renderDashboard();
  } else if (name === "loyalty") {
    initLoyaltyMembersSection();
  } else if (name === "admins") {
    loadAdminsSection();
  } else if (name === "analytics") {
    if (!sectionLoaded.has("analytics")) {
      sectionLoaded.add("analytics");
      setupAnalyticsControls();
    }
    renderAnalytics();
  } else if (!sectionLoaded.has(name)) {
    sectionLoaded.add(name);
    setupSection(name);
    if (name === "products") renderProductTable();
    else if (name === "orders") renderOrderTable();
    else if (name === "customers") renderCustomerTable();
    else if (name === "categories") fetchCategories().then(renderCategoryTable);
    else if (name === "coupons") fetchCoupons().then(renderCouponTable);
    else if (name === "promotions") initPromotionsPanel();
    else if (name === "flash-sale") fetchFlashSale().then(renderFlashSaleForm);
    else if (name === "broadcast") fetchBroadcast().then(renderBroadcastForm);
    else if (name === "faq-manager") initFaqManager();
    else if (name === "reviews") { _newPendingReviews = 0; updateReviewBadge(); fetchReviews().then(renderReviewTable); }
    else if (name === "messages") fetchMessages().then(renderMessagesTable);
    else if (name === "settings") fetchSettings().then(renderSettingsForm);
    else if (name === "pages") fetchPageSettings().then(renderPagesSection);
  }
}

// One-time event listener setup per section (called on first visit)
function setupSection(name) {
  if (name === "categories") {
    $("#add-cat-btn").addEventListener("click", () => openCatForm(null));
    $("#cancel-cat").addEventListener("click", closeCatForm);
    $("#cat-modal").addEventListener("click", e => { if (e.target.id === "cat-modal") closeCatForm(); });
    $("#cat-form").addEventListener("submit", saveCat);
    $("#cat-form [name=name]").addEventListener("input", function () {
      if (!editingCat) $("#cat-form [name=slug]").value = this.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    });
  } else if (name === "coupons") {
    $("#add-coupon-btn").addEventListener("click", () => openCouponForm(null));
    $("#cancel-coupon").addEventListener("click", closeCouponForm);
    $("#coupon-modal").addEventListener("click", e => { if (e.target.id === "coupon-modal") closeCouponForm(); });
    $("#coupon-form").addEventListener("submit", saveCoupon);
    $("#coupon-form [name=code]").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase(); });
  } else if (name === "products") {
    document.getElementById("pf-search").addEventListener("input", e => { pfSearch = e.target.value; renderProductTable(); });
    document.getElementById("pf-category").addEventListener("change", e => { pfCategory = e.target.value; renderProductTable(); });
    document.getElementById("pf-sort").addEventListener("change", e => { pfSort = e.target.value; renderProductTable(); });
    document.querySelectorAll(".pf-flag-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const flag = btn.dataset.flag;
        if (pfFlags.has(flag)) { pfFlags.delete(flag); btn.classList.remove("active"); }
        else { pfFlags.add(flag); btn.classList.add("active"); }
        renderProductTable();
      });
    });
  } else if (name === "orders") {
    const ofInput = document.getElementById("of-search");
    if (ofInput) ofInput.addEventListener("input", e => { ofSearch = e.target.value; renderOrderTable(); });
    document.querySelectorAll("#ord-tabs .ord-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        ofStatusFilter = btn.dataset.filter;
        document.querySelectorAll("#ord-tabs .ord-pill").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderOrderTable();
      });
    });
    const expBtn = document.getElementById("export-orders-btn");
    if (expBtn && !expBtn._wired) { expBtn._wired = true; expBtn.addEventListener("click", exportOrdersCSV); }
  } else if (name === "settings") {
    $("#settings-form").addEventListener("submit", saveSettings);
  } else if (name === "pages") {
    setupPagesSection();
  }
}

/* ---- Core data fetchers (Firestore reads, called sparingly) ------------ */
async function fetchProducts() {
  try {
    const snap = await getDocs(collection(db, "products"));
    products = snap.docs.map(d => ({ id: Number(d.id), ...d.data() })).sort((a, b) => a.id - b.id);
    $("#stat-products").textContent = products.length;
  } catch (e) { console.error("fetchProducts:", e); }
}

async function fetchOrders() {
  try {
    const q = query(collection(db, "orders"), limit(200));
    const snap = await getDocs(q);
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    updateOrdersBadge();
  } catch (e) { console.error("fetchOrders:", e); }
}

async function fetchCustomers() {
  try {
    const snap = await getDocs(collection(db, "users"));
    customers = snap.docs.map(d => d.data());
    $("#stat-customers").textContent = customers.length;
  } catch (e) { console.error("fetchCustomers:", e); }
}

async function fetchCategories() {
  try {
    const snap = await getDocs(collection(db, "categories"));
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (e) { console.error("fetchCategories:", e); }
}

async function fetchCoupons() {
  try {
    const snap = await getDocs(collection(db, "coupons"));
    coupons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.error("fetchCoupons:", e); }
}

async function fetchReviews() {
  try {
    const snap = await getDocs(collection(db, "reviews"));
    reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const pending = reviews.filter(r => r.status === "pending").length;
    const msg = $("#pending-review-msg");
    if (msg) msg.textContent = pending ? `${pending} pending approval` : `${reviews.length} total`;
  } catch (e) { console.error("fetchReviews:", e); }
}

async function fetchSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "store"));
    settings = snap.exists() ? snap.data() : {};
  } catch (e) { console.error("fetchSettings:", e); }
}

function updateOrdersBadge() {
  const newCount = orders.filter(o => isNewOrder(o)).length;
  const pending = orders.filter(o => o.status === "pending").length;
  const count = newCount || pending;
  const badge = $("#nav-orders-badge");
  if (count) { badge.textContent = count; badge.style.display = ""; } else { badge.style.display = "none"; }
}

/* ---- Dashboard --------------------------------------------------------- */
function renderDashboard() {
  const now = Date.now();
  const weekAgo = now / 1000 - 7 * 86400;
  const inWeek = (ts) => ts && ts.seconds >= weekAgo;
  const active = orders.filter(o => o.status !== "cancelled");
  const totalRevenue = active.reduce((s, o) => s + (o.total || 0), 0);

  // Basic stats
  $("#stat-orders").textContent = orders.length;
  $("#stat-revenue").textContent = "৳" + totalRevenue.toLocaleString();

  const ordersWk = orders.filter(o => inWeek(o.createdAt)).length;
  const revenueWk = active.filter(o => inWeek(o.createdAt)).reduce((s, o) => s + (o.total || 0), 0);
  const custWk = customers.filter(u => inWeek(u.createdAt)).length;
  const prodWk = products.filter(p => inWeek(p.createdAt)).length;
  setDelta("#delta-products", prodWk, "new this week", `${products.length} in catalogue`);
  setDelta("#delta-orders", ordersWk, "this week", "No new orders");
  $("#delta-revenue").textContent = totalRevenue ? `↑ ${Math.round(revenueWk / totalRevenue * 100)}% this week` : "—";
  $("#delta-revenue").className = "delta" + (totalRevenue ? "" : " flat");
  setDelta("#delta-customers", custWk, "this week", "—");

  // Avg Order Value
  const avgOrder = orders.length ? Math.round(totalRevenue / orders.length) : 0;
  const el_avg = $("#stat-avg-order");
  if (el_avg) el_avg.textContent = "৳" + avgOrder.toLocaleString();
  const el_avgD = $("#delta-avg-order");
  if (el_avgD) { el_avgD.textContent = orders.length ? `from ${orders.length} orders` : "—"; el_avgD.className = "delta flat"; }

  // Pending Payments (bKash/Nagad not yet verified)
  const pendingPay = orders.filter(o => o.paymentStatus === "pending" && o.payment?.method !== "COD");
  const el_pp = $("#stat-pending-pay");
  if (el_pp) el_pp.textContent = pendingPay.length;
  const el_ppD = $("#delta-pending-pay");
  if (el_ppD) {
    el_ppD.textContent = pendingPay.length ? "Needs verification" : "All verified ✓";
    el_ppD.className = "delta" + (pendingPay.length ? "" : " flat");
  }

  // This Month revenue
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const monthSec = monthStart.getTime() / 1000;
  const lastMonthStart = new Date(monthStart); lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
  const lastMonthSec = lastMonthStart.getTime() / 1000;
  const monthRev = active.filter(o => o.createdAt && o.createdAt.seconds >= monthSec).reduce((s, o) => s + (o.total || 0), 0);
  const lastMonthRev = active.filter(o => o.createdAt && o.createdAt.seconds >= lastMonthSec && o.createdAt.seconds < monthSec).reduce((s, o) => s + (o.total || 0), 0);
  const el_mr = $("#stat-month-revenue");
  if (el_mr) el_mr.textContent = "৳" + monthRev.toLocaleString();
  const el_mrD = $("#delta-month-revenue");
  if (el_mrD) {
    if (lastMonthRev > 0) {
      const pct = Math.round((monthRev - lastMonthRev) / lastMonthRev * 100);
      el_mrD.textContent = (pct >= 0 ? "↑ " : "↓ ") + Math.abs(pct) + "% vs last month";
      el_mrD.className = "delta" + (pct >= 0 ? "" : " flat");
    } else {
      el_mrD.textContent = monthRev ? "First month data" : "No orders yet";
      el_mrD.className = "delta flat";
    }
  }

  updateOrdersBadge();
  renderRevenueChart();
  renderStatusChart();
  renderRecentOrders();
  renderTopSelling();
  setDateRange();
  renderStockAlerts();
  checkDailyStockAlert();
}

function setDelta(sel, n, unit, flatText) {
  const el = $(sel);
  if (n > 0) { el.textContent = `↑ ${n} ${unit}`; el.className = "delta"; }
  else { el.textContent = flatText; el.className = "delta flat"; }
}

function setDateRange() {
  const end = new Date(), start = new Date(Date.now() - 6 * 86400000);
  const f = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  $("#date-range").textContent = `${f(start)} - ${f(end)}, ${end.getFullYear()}`;
}

function renderRevenueChart() {
  if (!window.Chart) return;
  const labels = [], data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    const dayStart = new Date(d).setHours(0, 0, 0, 0) / 1000;
    const dayEnd = dayStart + 86400;
    data.push(orders.filter(o => o.status !== "cancelled" && o.createdAt && o.createdAt.seconds >= dayStart && o.createdAt.seconds < dayEnd).reduce((s, o) => s + (o.total || 0), 0));
  }
  const canvas = $("#revenue-chart");
  if (revenueChart) { revenueChart.destroy(); revenueChart = null; }
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, "rgba(22,62,52,.25)"); grad.addColorStop(1, "rgba(22,62,52,0)");
  revenueChart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ data, borderColor: "#163E34", backgroundColor: grad, fill: true, tension: .4, pointBackgroundColor: "#163E34", pointRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => "৳" + v } }, x: { grid: { display: false } } } }
  });
}

function renderStatusChart() {
  if (!window.Chart) return;
  const counts = ORDER_STATUSES.map(s => orders.filter(o => (o.status || "pending") === s).length);
  const canvas = $("#status-chart");
  if (statusChart) { statusChart.destroy(); statusChart = null; }
  statusChart = new Chart(canvas, {
    type: "doughnut",
    data: { labels: ORDER_STATUSES, datasets: [{ data: counts, backgroundColor: ORDER_STATUSES.map(s => STATUS_COLORS[s]), borderWidth: 0 }] },
    options: { cutout: "65%", responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false } } }
  });
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  $("#status-legend").innerHTML = ORDER_STATUSES.map((s, i) => `
    <div><span class="dot" style="background:${STATUS_COLORS[s]}"></span> <span style="text-transform:capitalize;">${s}</span>
    <span class="ct">${counts[i]} (${Math.round(counts[i] / total * 100)}%)</span></div>`).join("");
}

function renderRecentOrders() {
  const el = $("#recent-orders");
  if (!orders.length) { el.innerHTML = `<p class="muted-note">No orders yet.</p>`; return; }
  el.innerHTML = `<div class="ro-row ro-head"><span>Order</span><span>Customer</span><span>Amount</span><span>Status</span></div>` +
    orders.slice(0, 5).map(o => `<div class="ro-row">
      <span><strong>${o.orderNum ? "#" + o.orderNum : "#" + o.id.slice(0,6).toUpperCase()}</strong></span>
      <span>${escapeHtml(o.customer?.name || "—")}</span>
      <span>৳${o.total || 0}</span>
      <span><span class="o-status ${escapeHtml(o.status || "pending")}">${escapeHtml(o.status || "pending")}</span></span>
    </div>`).join("");
}

function renderTopSelling() {
  const el = $("#top-selling");
  const map = {};
  orders.filter(o => o.status !== "cancelled").forEach(o => (o.items || []).forEach(i => {
    const k = i.id ?? i.name;
    if (!map[k]) map[k] = { name: i.name, image: i.image, qty: 0, rev: 0 };
    map[k].qty += i.quantity || 0; map[k].rev += (i.price || 0) * (i.quantity || 0);
  }));
  const top = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5);
  if (!top.length) { el.innerHTML = `<p class="muted-note">No sales yet.</p>`; return; }
  el.innerHTML = top.map(t => `<div class="ts-row">
    <img src="${optimizedUrl(t.image, 80)}" alt="">
    <div class="nm">${escapeHtml(t.name)}<small>${t.qty} sold</small></div>
    <div class="val"><strong>৳${t.rev.toLocaleString()}</strong></div>
  </div>`).join("");
}

/* ---- Section table renderers (memory only, no Firestore) -------------- */
function getFilteredProducts() {
  let result = [...products];
  const q = pfSearch.trim().toLowerCase();
  if (q) result = result.filter(p => (p.name || "").toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q));
  if (pfCategory) result = result.filter(p => p.category === pfCategory);
  if (pfFlags.has("featured")) result = result.filter(p => p.featured);
  if (pfFlags.has("bestseller")) result = result.filter(p => p.bestseller);
  if (pfFlags.has("lowstock")) result = result.filter(p => p.stock !== undefined && p.stock !== null && p.stock < 10);
  if (pfFlags.has("hidden")) result = result.filter(p => p.hidden);
  if (pfFlags.has("new-arrival")) result = result.filter(p => p.newArrival);
  if (pfFlags.has("gift-sets")) result = result.filter(p => p.productType === "combo");
  if (pfSort === "name") result.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  else if (pfSort === "price-asc") result.sort((a, b) => (a.price || 0) - (b.price || 0));
  else if (pfSort === "price-desc") result.sort((a, b) => (b.price || 0) - (a.price || 0));
  else if (pfSort === "stock-asc") result.sort((a, b) => (a.stock ?? 999) - (b.stock ?? 999));
  else result.sort((a, b) => a.id - b.id);
  return result;
}

function renderProductTable() {
  const tbody = $("#product-rows");
  const filtered = getFilteredProducts();
  const countEl = document.getElementById("pf-count");
  if (countEl) countEl.textContent = filtered.length !== products.length ? `${filtered.length} of ${products.length} products` : `${products.length} product${products.length !== 1 ? "s" : ""}`;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted-note" style="padding:2rem;text-align:center;">${products.length ? "No products match your filters." : "No products yet."}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((p, i) => {
    const price = (p.prices && p.prices["50ML"]) ? p.prices["50ML"] : (p.price || 0);
    const flags = [p.featured ? `<span class="badge green">Featured</span>` : "", p.bestseller ? `<span class="badge">Bestseller</span>` : "", p.newArrival ? `<span class="badge" style="background:#1a1a1a;color:#D4AF37;">New</span>` : "", p.productType === "combo" ? `<span class="badge" style="background:#E07B2E;color:#fff;">Gift Set</span>` : "", p.hidden ? `<span class="badge">Hidden</span>` : ""].join(" ");
    return `<tr data-pid="${p.id}">
      <td style="padding-left:.75rem;"><input type="checkbox" class="bulk-chk" data-pid="${p.id}"></td>
      <td style="color:var(--text-muted);font-size:.8rem;text-align:center;width:2.5rem;">${i + 1}</td>
      <td><img src="${optimizedUrl(p.image, 80)}" alt=""></td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.category || "")}</td>
      <td>৳${price}</td>
      <td>${p.stock === 0 ? '<span style="color:#9b2226;font-weight:600;font-size:.8rem;">Out of Stock</span>' : (p.stock !== undefined && p.stock !== null && p.stock < 10) ? `<span style="color:#b8860b;font-weight:600;">⚠ ${p.stock}</span>` : (p.stock ?? "—")}</td>
      <td>${flags}</td>
      <td style="white-space:nowrap;">
        <button class="icon-btn" data-edit="${p.id}" title="Edit"><ion-icon name="create-outline"></ion-icon></button>
        <button class="icon-btn danger" data-del="${p.id}" title="Delete"><ion-icon name="trash-outline"></ion-icon></button>
      </td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openForm(products.find(p => p.id === Number(b.dataset.edit)))));
  tbody.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => deleteProduct(Number(b.dataset.del))));

  // Bulk selection logic
  const bulkBar = document.getElementById("bulk-bar");
  const bulkCount = document.getElementById("bulk-count");
  const selectAll = document.getElementById("bulk-select-all");
  const updateBulkBar = () => {
    const checked = tbody.querySelectorAll(".bulk-chk:checked");
    if (bulkBar) bulkBar.style.display = checked.length ? "flex" : "none";
    if (bulkCount) bulkCount.textContent = `${checked.length} selected`;
    if (selectAll) selectAll.indeterminate = checked.length > 0 && checked.length < tbody.querySelectorAll(".bulk-chk").length;
    if (selectAll) selectAll.checked = checked.length > 0 && checked.length === tbody.querySelectorAll(".bulk-chk").length;
  };
  tbody.querySelectorAll(".bulk-chk").forEach(chk => chk.addEventListener("change", updateBulkBar));
  if (selectAll && !selectAll._bulkWired) {
    selectAll._bulkWired = true;
    selectAll.addEventListener("change", () => {
      tbody.querySelectorAll(".bulk-chk").forEach(chk => chk.checked = selectAll.checked);
      updateBulkBar();
    });
  }
  const cancelBtn = document.getElementById("bulk-cancel");
  if (cancelBtn && !cancelBtn._bulkWired) {
    cancelBtn._bulkWired = true;
    cancelBtn.addEventListener("click", () => {
      tbody.querySelectorAll(".bulk-chk").forEach(c => c.checked = false);
      if (selectAll) { selectAll.checked = false; selectAll.indeterminate = false; }
      if (bulkBar) bulkBar.style.display = "none";
    });
  }
  const applyBtn = document.getElementById("bulk-apply");
  if (applyBtn && !applyBtn._bulkWired) {
    applyBtn._bulkWired = true;
    applyBtn.addEventListener("click", async () => {
      const action = document.getElementById("bulk-action").value;
      if (!action) { adminToast("Choose an action first."); return; }
      const ids = [...tbody.querySelectorAll(".bulk-chk:checked")].map(c => Number(c.dataset.pid));
      if (!ids.length) return;
      if (action === "delete" && !await zahrounConfirm(`Delete ${ids.length} product(s)? This cannot be undone.`, { title: "Delete Products", ok: "Delete", danger: true })) return;
      applyBtn.disabled = true; applyBtn.textContent = "Working…";
      try {
        for (const id of ids) {
          const ref = doc(db, "products", String(id));
          if (action === "featured-on")  await updateDoc(ref, { featured: true });
          else if (action === "featured-off") await updateDoc(ref, { featured: false });
          else if (action === "hide")    await updateDoc(ref, { hidden: true });
          else if (action === "show")    await updateDoc(ref, { hidden: false });
          else if (action === "delete")  await deleteDoc(ref);
        }
        if (action === "delete") products = products.filter(p => !ids.includes(p.id));
        else ids.forEach(id => {
          const p = products.find(x => x.id === id);
          if (p) {
            if (action === "featured-on")  p.featured = true;
            if (action === "featured-off") p.featured = false;
            if (action === "hide")   p.hidden = true;
            if (action === "show")   p.hidden = false;
          }
        });
        adminToast(`${ids.length} product(s) updated.`);
        renderProductTable();
        renderStockAlerts();
      } catch (e) { adminToast("Bulk action failed: " + (e.code || e.message), "error"); }
      finally { applyBtn.disabled = false; applyBtn.textContent = "Apply"; }
    });
  }
}

function isNewOrder(o) {
  try {
    const ms = o.createdAt?.toMillis ? o.createdAt.toMillis() : o.createdAt?.seconds ? o.createdAt.seconds * 1000 : null;
    return ms && (Date.now() - ms) < 86400000;
  } catch { return false; }
}

async function awardLoyaltyPointsForOrder(order) {
  try {
    const settingsSnap = await getDoc(doc(db, "settings", "promotions"));
    const cfg = settingsSnap.exists() ? settingsSnap.data() : {};
    const lp = cfg.loyaltyPoints || {};
    if (!lp.enabled || !order.uid || !order.total) return;

    if (lp.enrollMode === "approve") {
      const lpSnap = await getDoc(doc(db, "loyaltyPoints", order.uid));
      if (!lpSnap.exists() || lpSnap.data().status !== "approved") return;
    }

    const deliveredOrders = orders.filter(o => o.uid === order.uid && o.status === "delivered");
    const userTotalSpend = deliveredOrders.reduce((s, o) => s + (o.total || 0), 0);

    let mult = 1;
    if (lp.tiers?.enabled) {
      const t = lp.tiers;
      if (userTotalSpend >= (t.platinum?.minSpend || 15000)) mult = t.platinum?.mult || 3;
      else if (userTotalSpend >= (t.gold?.minSpend || 8000)) mult = t.gold?.mult || 2;
      else mult = t.silver?.mult || 1;
    }

    const basePoints = Math.floor(order.total / (lp.earnPer || 100));
    const points = Math.floor(basePoints * mult);
    if (points <= 0) return;

    const tier = lp.tiers?.enabled ? (
      userTotalSpend >= (lp.tiers.platinum?.minSpend || 15000) ? "platinum" :
      userTotalSpend >= (lp.tiers.gold?.minSpend || 8000) ? "gold" : "silver"
    ) : null;

    const ref = doc(db, "loyaltyPoints", order.uid);
    const snap = await getDoc(ref);
    const now = new Date().toISOString();
    if (snap.exists()) {
      const prev = snap.data();
      const update = {
        points: (prev.points || 0) + points,
        lifetimeEarned: (prev.lifetimeEarned || 0) + points,
        lastEarnedDate: now,
        lastUpdated: now
      };
      if (tier) update.tier = tier;
      await updateDoc(ref, update);
    } else {
      const newDoc = {
        uid: order.uid, points, lifetimeEarned: points,
        lastEarnedDate: now, lastUpdated: now,
        status: lp.enrollMode === "approve" ? "pending" : "approved"
      };
      if (tier) newDoc.tier = tier;
      await setDoc(ref, newDoc);
    }
    await updateDoc(doc(db, "orders", order.id), { loyaltyPointsAwarded: true, loyaltyPointsEarned: points });
    if (order) { order.loyaltyPointsAwarded = true; order.loyaltyPointsEarned = points; }
    adminToast(`✓ ${points} loyalty point${points !== 1 ? "s" : ""} awarded to customer`);
  } catch (e) { console.warn("Loyalty award failed:", e); }
}

async function reverseLoyaltyPointsForOrder(order) {
  if (!order?.uid) return;
  try {
    const settingsSnap = await getDoc(doc(db, "settings", "promotions"));
    const cfg = settingsSnap.exists() ? settingsSnap.data() : {};
    const lp = cfg.loyaltyPoints || {};
    if (!lp.enabled) return;

    const ref = doc(db, "loyaltyPoints", order.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const prev = snap.data();
    const now = new Date().toISOString();
    const updates = { lastUpdated: now };

    // Reverse earned points if any were awarded
    if (order.loyaltyPointsAwarded && order.loyaltyPointsEarned > 0) {
      updates.points = Math.max(0, (prev.points || 0) - order.loyaltyPointsEarned);
      updates.lifetimeEarned = Math.max(0, (prev.lifetimeEarned || 0) - order.loyaltyPointsEarned);
    }

    // Restore redeemed points if customer used them on this order
    if (order.loyaltyRedeemedPoints > 0) {
      updates.points = (updates.points ?? (prev.points || 0)) + order.loyaltyRedeemedPoints;
    }

    if (Object.keys(updates).length > 1) await updateDoc(ref, updates);
    await updateDoc(doc(db, "orders", order.id), { loyaltyPointsAwarded: false });
    if (order) order.loyaltyPointsAwarded = false;
  } catch (e) { console.warn("Loyalty reversal failed:", e); }
}

async function changeOrderStatus(orderId, newStatus) {
  const order = orders.find(o => o.id === orderId);
  const prevStatus = order?.status || "pending";
  try {
    if (newStatus === "confirmed" && prevStatus !== "confirmed") await deductOrderStock(order);
    if (newStatus === "cancelled" && prevStatus !== "cancelled") await restoreOrderStock(order);
    const histEntry = { status: newStatus, at: new Date().toISOString() };
    await updateDoc(doc(db, "orders", orderId), { status: newStatus, statusHistory: arrayUnion(histEntry) });
    if (order) { order.status = newStatus; order.statusHistory = [...(order.statusHistory || []), histEntry]; }
    if (newStatus === "confirmed" && prevStatus !== "confirmed") sendConfirmationEmail(order);

    // Loyalty: award on delivery, reverse on cancellation
    if (newStatus === "delivered" && prevStatus !== "delivered" && order?.uid && !order?.loyaltyPointsAwarded) {
      awardLoyaltyPointsForOrder(order).catch(e => console.warn("LP award:", e));
    } else if (newStatus === "cancelled" && prevStatus !== "cancelled" && (order?.loyaltyPointsAwarded || order?.loyaltyRedeemedPoints > 0)) {
      reverseLoyaltyPointsForOrder(order).catch(e => console.warn("LP reverse:", e));
    }

    updateOrdersBadge(); renderOrderTable(); renderDashboard(); updateNotifications();
    const _c = order?.customer || {};
    if (_c.mobile && newStatus !== "pending") showWaNotifyToast(order, newStatus);
  } catch (e) { alert("Update failed: " + (e.code || e.message)); }
}

function renderOrderTable() {
  const tbody = $("#order-rows");
  const cardsWrap = document.getElementById("ord-cards");
  const q = ofSearch.trim().toLowerCase();

  // Update pill counts
  const newCount = orders.filter(isNewOrder).length;
  const statusKeys = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
  const tcAll = document.getElementById("ord-tc-all"); if (tcAll) tcAll.textContent = orders.length;
  const tcNew = document.getElementById("ord-tc-new"); if (tcNew) tcNew.textContent = newCount;
  statusKeys.forEach(s => {
    const el = document.getElementById("ord-tc-" + s);
    if (el) el.textContent = orders.filter(o => (o.status || "pending") === s).length;
  });

  // Update header subtitle
  const sub = document.getElementById("orders-subtitle");
  const pCount = orders.filter(o => (o.status || "pending") === "pending").length;
  if (sub) sub.textContent = `${orders.length} total · ${pCount} pending`;
  const countEl = document.getElementById("orders-count");
  if (countEl) countEl.textContent = `${orders.length} order(s)`;

  // Filter
  let visible = orders;
  if (ofStatusFilter === "new") visible = orders.filter(isNewOrder);
  else if (ofStatusFilter !== "all") visible = orders.filter(o => (o.status || "pending") === ofStatusFilter);
  if (q) visible = visible.filter(o =>
    String(o.orderNum || "").includes(q) ||
    o.id.toLowerCase().startsWith(q) ||
    (o.customer?.name || "").toLowerCase().includes(q) ||
    (o.customer?.mobile || "").includes(q)
  );

  const empty = (msg) => {
    tbody.innerHTML = `<tr><td colspan="7" class="muted-note" style="padding:2rem;text-align:center;">${msg}</td></tr>`;
    if (cardsWrap) cardsWrap.innerHTML = `<p class="muted-note" style="text-align:center;padding:2rem 0;">${msg}</p>`;
  };
  if (!orders.length) { empty("No orders yet."); return; }
  if (!visible.length) { empty("No orders match."); return; }

  // Desktop table
  const opts = (st) => ORDER_STATUSES.map(s => `<option value="${s}" ${st === s ? "selected" : ""}>${s}</option>`).join("");
  tbody.innerHTML = visible.map(o => {
    const c = o.customer || {};
    const st = o.status || "pending";
    const isNew = isNewOrder(o) && st === "pending";
    const items = (o.items || []).map(i => `${escapeHtml(i.name)} (${i.size}) ×${i.quantity}`).join("<br>");
    return `<tr data-oid="${o.id}" ${isNew ? 'class="new-order-row"' : ''} style="cursor:pointer;">
      <td><strong>${o.orderNum ? "#" + o.orderNum : "#" + o.id.slice(0,6).toUpperCase()}</strong>${isNew ? '<span class="new-order-badge">New</span>' : ''}</td>
      <td>${escapeHtml(c.name || "")}<br><span class="muted-note">${escapeHtml(c.mobile || "")}</span></td>
      <td style="font-size:.82rem;">${items}</td>
      <td>৳${o.total || 0}</td>
      <td>${escapeHtml(o.payment?.method || "")}
        ${o.payment?.senderMobile ? `<br><span class="muted-note">${escapeHtml(o.payment.senderMobile)}</span>` : ""}
        ${o.payment?.txnId ? `<br><span class="muted-note">${escapeHtml(o.payment.txnId)}</span>` : ""}
        ${(o.payment?.method === 'bKash' || o.payment?.method === 'Nagad') ? (o.paymentStatus === "verified"
          ? `<br><span style="color:#1e7e34;font-size:.74rem;font-weight:600;">✓ Verified</span><br><button onclick="window._unverifyPayment('${o.id}')" style="margin-top:.2rem;background:none;color:#9b2226;border:1px solid #d9a5a5;border-radius:4px;padding:.15rem .5rem;font-size:.7rem;cursor:pointer;">Undo</button>`
          : `<br><button onclick="window._verifyPayment('${o.id}')" style="margin-top:.3rem;background:#e65100;color:#fff;border:none;border-radius:5px;padding:.3rem .8rem;font-size:.75rem;font-weight:600;cursor:pointer;">Verify Payment</button>`) : ""}
      </td>
      <td>${(()=>{const nm={pending:{s:'confirmed',l:'Confirm',bg:'#163E34'},confirmed:{s:'shipped',l:'Ship',bg:'#1a56b8'},shipped:{s:'delivered',l:'Delivered',bg:'#1e7e34'}};const nx=nm[st];return `<select data-order="${o.id}" style="padding:.35rem;border-radius:6px;border:1px solid var(--border-color);width:100%;">${opts(st)}</select>${nx?`<button class="tbl-quickact" data-oid="${o.id}" data-next="${nx.s}" style="display:block;margin-top:.3rem;width:100%;background:${nx.bg};color:#fff;border:none;border-radius:5px;padding:.28rem .5rem;font-size:.75rem;font-weight:600;cursor:pointer;font-family:var(--font-sans);">${nx.l}</button>`:''}`})()}</td>
      <td class="muted-note">${fmtDate(o.createdAt)}</td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("select[data-order]").forEach(sel => {
    sel.addEventListener("change", async () => {
      const prev = sel.dataset.prev || sel.querySelector("option[selected]")?.value || sel.defaultValue;
      if (!await zahrounConfirm(`Change order status to "${sel.value}"?`, { title: "Update Order Status", ok: "Yes, Update", danger: false })) { sel.value = prev; return; }
      sel.dataset.prev = sel.value;
      sel.disabled = true; await changeOrderStatus(sel.dataset.order, sel.value);
    });
    sel.dataset.prev = sel.value;
  });
  tbody.querySelectorAll(".tbl-quickact").forEach(btn => {
    btn.addEventListener("click", async () => {
      const nextSt = btn.dataset.next;
      const labels = { confirmed: "Confirm", shipped: "Ship", delivered: "Mark as Delivered" };
      if (!await zahrounConfirm(`Mark this order as "${nextSt}"?`, { title: labels[nextSt] || "Update Status", ok: labels[nextSt] || "Confirm", danger: false })) return;
      btn.disabled = true;
      await changeOrderStatus(btn.dataset.oid, nextSt);
    });
  });
  tbody.querySelectorAll("tr[data-oid]").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest("select") || e.target.closest("button")) return;
      const order = orders.find(o => o.id === row.dataset.oid);
      if (order) openOrderDetail(order);
    });
  });

  // Mobile cards
  if (!cardsWrap) return;
  cardsWrap.innerHTML = visible.map(o => {
    const c = o.customer || {};
    const st = o.status || "pending";
    const isNewCard = isNewOrder(o) && st === "pending";
    const ordId = o.orderNum ? "#" + String(o.orderNum).padStart(6,"0") : "#" + o.id.slice(0,6).toUpperCase();
    const initial = (c.name || "?")[0].toUpperCase();
    const d = fmtDate(o.createdAt);
    const itemsHtml = (o.items || []).map(i =>
      `<div class="orc-item"><span>${escapeHtml(i.name)} <span class="orc-size">(${i.size})</span></span><span class="orc-qty">×${i.quantity}</span></div>`
    ).join("");
    return `<div class="orc" data-oid="${o.id}" ${isNewCard ? 'style="border-left:3px solid #e63946;"' : ''}>
      <div class="orc-head">
        <div>
          <div class="orc-ordnum">${ordId}${isNewCard ? '<span class="new-order-badge" style="font-size:.58rem;padding:.14rem .45rem;">New</span>' : ''}</div>
          <div class="orc-date-pay">${d} · ${escapeHtml(o.payment?.method || "")}</div>
        </div>
        <span class="orc-badge st-${st}">${st}</span>
      </div>
      ${(o.payment?.method === 'bKash' || o.payment?.method === 'Nagad') ? `
      <div class="orc-pay-strip ${o.paymentStatus === 'verified' ? 'orc-pay-verified' : 'orc-pay-pending'}">
        <div class="pay-info">
          ${o.payment?.senderMobile ? `<strong>${escapeHtml(o.payment.senderMobile)}</strong>` : ''}
          ${o.payment?.txnId ? `<br>TxnID: ${escapeHtml(o.payment.txnId)}` : ''}
        </div>
        ${o.paymentStatus === 'verified'
          ? `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:.25rem;"><span class="orc-verified-tag">✓ Verified</span><button class="orc-unverify-btn" data-unverify="${o.id}">Undo</button></div>`
          : `<button class="orc-verify-btn" data-verify="${o.id}">Verify Payment</button>`}
      </div>` : ''}
      <div class="orc-customer">
        <div class="orc-av">${initial}</div>
        <div class="orc-cinfo">
          <div class="orc-name">${escapeHtml(c.name || "—")}</div>
          <div class="orc-phone">${escapeHtml(c.mobile || "")}</div>
          <div class="orc-addr">${escapeHtml(c.address || "")}</div>
        </div>
        <div class="orc-amount">৳${(o.total || 0).toLocaleString()}</div>
      </div>
      <div class="orc-items-block">${itemsHtml}</div>
      ${(()=>{ const nm={pending:{s:'confirmed',l:'Confirm',ic:'checkmark-circle-outline',bg:'#163E34'},confirmed:{s:'shipped',l:'Ship',ic:'car-outline',bg:'#1a56b8'},shipped:{s:'delivered',l:'Delivered',ic:'bag-check-outline',bg:'#1e7e34'}};const nx=nm[st];return nx?`<div style="padding:.4rem .85rem .1rem;"><button class="orc-quickact" data-oid="${o.id}" data-next="${nx.s}" style="width:100%;background:${nx.bg};color:#fff;border:none;border-radius:8px;padding:.5rem;font-size:.84rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.4rem;font-family:var(--font-sans);"><ion-icon name="${nx.ic}" style="font-size:1rem;"></ion-icon>${nx.l}</button></div>`:'';})()}
      <div class="orc-actions">
        <button class="orc-act-btn" data-view="${o.id}"><ion-icon name="eye-outline"></ion-icon> View</button>
        <button class="orc-act-btn" data-call="${escapeHtml(c.mobile || "")}"><ion-icon name="call-outline"></ion-icon> Call</button>
        <div class="orc-act-btn orc-status-cell">
          <ion-icon name="swap-vertical-outline"></ion-icon> Status
          <select class="orc-status-sel" data-order="${o.id}">${opts(st)}</select>
        </div>
      </div>
    </div>`;
  }).join("");

  cardsWrap.querySelectorAll("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      const order = orders.find(o => o.id === btn.dataset.view);
      if (order) openOrderDetail(order);
    });
  });
  cardsWrap.querySelectorAll("[data-call]").forEach(btn => {
    btn.addEventListener("click", () => { if (btn.dataset.call) window.open("tel:" + btn.dataset.call); });
  });
  cardsWrap.querySelectorAll("[data-verify]").forEach(btn => {
    btn.addEventListener("click", () => showVerifyConfirm(btn.dataset.verify));
  });
  cardsWrap.querySelectorAll("[data-unverify]").forEach(btn => {
    btn.addEventListener("click", () => unverifyPayment(btn.dataset.unverify));
  });
  cardsWrap.querySelectorAll(".orc-status-sel").forEach(sel => {
    sel.addEventListener("change", async () => {
      const prev = sel.dataset.prev || sel.value;
      if (!await zahrounConfirm(`Change order status to "${sel.value}"?`, { title: "Update Order Status", ok: "Yes, Update", danger: false })) { sel.value = prev; return; }
      sel.dataset.prev = sel.value;
      sel.disabled = true; await changeOrderStatus(sel.dataset.order, sel.value);
    });
    sel.dataset.prev = sel.value;
  });
  cardsWrap.querySelectorAll(".orc-quickact").forEach(btn => {
    btn.addEventListener("click", async () => {
      const nextSt = btn.dataset.next;
      const labels = { confirmed: "Confirm", shipped: "Ship", delivered: "Mark as Delivered" };
      if (!await zahrounConfirm(`Mark this order as "${nextSt}"?`, { title: labels[nextSt] || "Update Status", ok: labels[nextSt] || "Confirm", danger: false })) return;
      btn.disabled = true;
      await changeOrderStatus(btn.dataset.oid, nextSt);
    });
  });
}

async function verifyPayment(orderId) {
  try {
    const order = orders.find(o => o.id === orderId);
    const wasConfirmed = order?.status === "confirmed";
    await updateDoc(doc(db, "orders", orderId), { paymentStatus: "verified", status: "confirmed" });
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) { orders[idx].paymentStatus = "verified"; orders[idx].status = "confirmed"; }
    if (!wasConfirmed && order) sendConfirmationEmail(order);
    renderOrderTable();
    if (currentDetailOrder?.id === orderId) {
      currentDetailOrder.paymentStatus = "verified";
      currentDetailOrder.status = "confirmed";
      openOrderDetail(currentDetailOrder);
    }
  } catch (e) { alert("Verify failed: " + (e.code || e.message)); }
}
let _pendingVerifyOrderId = null;

function showVerifyConfirm(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  _pendingVerifyOrderId = orderId;
  const details = document.getElementById("vcp-details");
  if (details) {
    details.innerHTML = `
      <div><span style="color:var(--text-muted);">Method</span> &nbsp;·&nbsp; <strong>${escapeHtml(order.payment?.method || "")}</strong></div>
      <div><span style="color:var(--text-muted);">Paid from</span> &nbsp;·&nbsp; <strong>${escapeHtml(order.payment?.senderMobile || "—")}</strong></div>
      <div><span style="color:var(--text-muted);">Transaction ID</span> &nbsp;·&nbsp; <strong style="font-family:monospace;letter-spacing:.03em;">${escapeHtml(order.payment?.txnId || "—")}</strong></div>
      <div><span style="color:var(--text-muted);">Amount</span> &nbsp;·&nbsp; <strong>৳${(order.total || 0).toLocaleString()}</strong></div>`;
  }
  const c1 = document.getElementById("vcp-check1");
  const c2 = document.getElementById("vcp-check2");
  const btn = document.getElementById("vcp-confirm-btn");
  if (c1) c1.checked = false;
  if (c2) c2.checked = false;
  if (btn) { btn.style.opacity = ".45"; btn.style.pointerEvents = "none"; }
  const toggle = () => {
    const ok = c1?.checked && c2?.checked;
    if (btn) { btn.style.opacity = ok ? "1" : ".45"; btn.style.pointerEvents = ok ? "" : "none"; }
  };
  if (c1) { c1.onchange = toggle; }
  if (c2) { c2.onchange = toggle; }
  document.getElementById("verify-confirm-modal").style.display = "flex";
}
window._verifyPayment = showVerifyConfirm;

window._confirmVerify = async function() {
  document.getElementById("verify-confirm-modal").style.display = "none";
  if (_pendingVerifyOrderId) { await verifyPayment(_pendingVerifyOrderId); _pendingVerifyOrderId = null; }
};

async function unverifyPayment(orderId) {
  if (!await zahrounConfirm("Undo payment verification? Order will return to pending.", { title: "Undo Verification", ok: "Undo", danger: true })) return;
  try {
    await updateDoc(doc(db, "orders", orderId), { paymentStatus: "pending", status: "pending" });
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) { orders[idx].paymentStatus = "pending"; orders[idx].status = "pending"; }
    renderOrderTable();
    if (currentDetailOrder?.id === orderId) {
      currentDetailOrder.paymentStatus = "pending";
      currentDetailOrder.status = "pending";
      openOrderDetail(currentDetailOrder);
    }
  } catch (e) { alert("Failed: " + (e.code || e.message)); }
}
window._unverifyPayment = unverifyPayment;

function renderCustomerTable() {
  const tbody = $("#customer-rows");

  // Registered users
  const regRows = customers.map(u => {
    const spent = orders
      .filter(o => o.status !== "cancelled" && (o.uid === u.uid || (u.email && o.userEmail === u.email)))
      .reduce((s, o) => s + (o.total || 0), 0);
    const orderCount = orders.filter(o => o.uid === u.uid || (u.email && o.userEmail === u.email)).length;
    return { name: u.name || "—", email: u.email || "—", role: u.role || "customer", joined: fmtDate(u.createdAt), spent, orderCount, isGuest: false };
  });

  // Guest customers — group by mobile (always present) falling back to email
  const guestMap = {};
  const regUids = new Set(customers.map(u => u.uid).filter(Boolean));
  const regEmails = new Set(customers.map(u => u.email).filter(Boolean));
  orders.forEach(o => {
    // Include orders with no registered-user match (isGuest true, or no uid and email not registered)
    const isUnmatched = o.isGuest || (!o.uid && !(o.userEmail && regEmails.has(o.userEmail)));
    if (!isUnmatched) return;
    const mobile = o.customer?.mobile || "";
    const email  = o.userEmail || o.guestEmail || "—";
    const key    = mobile || email;
    if (!guestMap[key]) guestMap[key] = { name: o.customer?.name || "Guest", email, mobile, spent: 0, orderCount: 0, joined: fmtDate(o.createdAt) };
    if (o.status !== "cancelled") guestMap[key].spent += (o.total || 0);
    guestMap[key].orderCount++;
  });
  const guestRows = Object.values(guestMap).map(g => ({ ...g, role: "guest", isGuest: true }));

  const allRows = [...regRows, ...guestRows];
  $("#customers-count").textContent = `${allRows.length} customer(s)`;
  if (!allRows.length) { tbody.innerHTML = `<tr><td colspan="5" class="muted-note" style="padding:2rem;text-align:center;">No users.</td></tr>`; return; }

  tbody.innerHTML = allRows.map(u => `<tr>
    <td>${escapeHtml(u.name)}</td>
    <td>${u.isGuest
      ? `${u.mobile ? `<span style="font-weight:500;">${escapeHtml(u.mobile)}</span>` : ""}${u.email !== "—" ? `<br><span class="muted-note" style="font-size:.78rem;">${escapeHtml(u.email)}</span>` : ""}`
      : escapeHtml(u.email)}</td>
    <td><span class="badge" style="${u.isGuest ? "background:#f0f0f0;color:#555;" : u.role==="admin" ? "background:#163E34;color:#fff;" : ""}">${escapeHtml(u.role)}</span></td>
    <td class="muted-note">${u.joined}</td>
    <td><strong style="color:var(--primary-color);">৳${u.spent.toLocaleString()}</strong>${u.orderCount ? `<br><span class="muted-note" style="font-size:.75rem;">${u.orderCount} order${u.orderCount > 1 ? "s" : ""}</span>` : ""}</td>
  </tr>`).join("");

  const expBtn = document.getElementById("export-customers-btn");
  if (expBtn && !expBtn._wired) { expBtn._wired = true; expBtn.addEventListener("click", exportCustomersCSV); }

  const searchInput = document.getElementById("customer-search");
  if (searchInput && !searchInput._wired) {
    searchInput._wired = true;
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      tbody.querySelectorAll("tr").forEach(tr => {
        tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });
  }
}

/* ---- Categories -------------------------------------------------------- */
function renderCategoryTable() {
  const tbody = $("#cat-rows");
  if (!categories.length) { tbody.innerHTML = `<tr><td colspan="5" class="muted-note" style="padding:2rem;text-align:center;">No categories yet.</td></tr>`; return; }
  tbody.innerHTML = categories.map(c => {
    const count = products.filter(p => (p.category || "").toLowerCase() === c.name.toLowerCase()).length;
    return `<tr>
      <td><strong>${escapeHtml(c.name)}</strong></td>
      <td><code style="font-size:.82rem;">${escapeHtml(c.id)}</code></td>
      <td>${c.order || 0}</td>
      <td>${count}</td>
      <td style="white-space:nowrap;">
        <button class="icon-btn" data-cat-edit="${escapeHtml(c.id)}" title="Edit"><ion-icon name="create-outline"></ion-icon></button>
        <button class="icon-btn danger" data-cat-del="${escapeHtml(c.id)}" title="Delete"><ion-icon name="trash-outline"></ion-icon></button>
      </td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("[data-cat-edit]").forEach(b => b.addEventListener("click", () => openCatForm(categories.find(c => c.id === b.dataset.catEdit))));
  tbody.querySelectorAll("[data-cat-del]").forEach(b => b.addEventListener("click", () => deleteCat(b.dataset.catDel)));
}

function openCatForm(cat) {
  editingCat = cat || null;
  const f = $("#cat-form");
  f.reset();
  $("#cat-form-title").textContent = cat ? "Edit Category" : "Add Category";
  const slugInput = f.querySelector("[name=slug]");
  if (cat) {
    f.querySelector("[name=name]").value = cat.name || "";
    slugInput.value = cat.id;
    slugInput.readOnly = true;
    f.querySelector("[name=order]").value = cat.order || 0;
  } else {
    slugInput.readOnly = false;
  }
  $("#cat-modal").classList.add("open");
}
function closeCatForm() { $("#cat-modal").classList.remove("open"); }

async function saveCat(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Saving…";
  const slug = f.querySelector("[name=slug]").value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!slug) { alert("Slug is required"); btn.disabled = false; btn.textContent = "Save Category"; return; }
  try {
    const data = { name: f.querySelector("[name=name]").value.trim(), order: parseInt(f.querySelector("[name=order]").value) || 0, updatedAt: serverTimestamp() };
    if (!editingCat) data.createdAt = serverTimestamp();
    await setDoc(doc(db, "categories", slug), data, { merge: true });
    closeCatForm();
    await fetchCategories();
    renderCategoryTable();
    adminToast("Category saved.");
  } catch (err) { alert("Save failed: " + (err.code || err.message)); }
  finally { btn.disabled = false; btn.textContent = "Save Category"; }
}

async function deleteCat(id) {
  if (!await zahrounConfirm("Delete this category? This action cannot be undone.", { title: "Delete Category", ok: "Delete", danger: true })) return;
  try { await deleteDoc(doc(db, "categories", id)); await fetchCategories(); renderCategoryTable(); }
  catch (err) { alert("Delete failed: " + (err.code || err.message)); }
}

/* ---- Coupons ----------------------------------------------------------- */
function renderCouponTable() {
  const tbody = $("#coupon-rows");
  if (!coupons.length) { tbody.innerHTML = `<tr><td colspan="8" class="muted-note" style="padding:2rem;text-align:center;">No coupons yet.</td></tr>`; return; }
  tbody.innerHTML = coupons.map(c => {
    const discountText = c.type === "freeship" ? "Free delivery" : c.type === "percent" ? `${c.value}% off` : `৳${c.value} off`;
    const isExpired = c.expiresAt && c.expiresAt.toDate && c.expiresAt.toDate() < new Date();
    const expiryText = c.expiresAt ? (c.expiresAt.toDate ? c.expiresAt.toDate().toLocaleDateString("en-GB") : c.expiresAt) : "No expiry";
    const maxText = c.maxUses ? `${c.usedCount || 0}/${c.maxUses}` : `${c.usedCount || 0}/∞`;
    const statusLabel = isExpired ? "expired" : (c.active ? "active" : "inactive");
    const saleAllowed = c.allowOnSaleProducts !== false;
    return `<tr>
      <td><code style="font-size:.9rem;font-weight:700;letter-spacing:1px;">${escapeHtml(c.id)}</code></td>
      <td>${discountText}</td>
      <td>${c.minOrder ? `৳${c.minOrder}` : "—"}</td>
      <td>${maxText}</td>
      <td class="${isExpired ? "muted-note" : ""}">${expiryText}</td>
      <td><span class="badge ${c.active && !isExpired ? "green" : ""}">${statusLabel}</span></td>
      <td><span class="badge ${saleAllowed ? "green" : ""}" title="${saleAllowed ? "Works on sale products" : "Blocked on sale products"}">${saleAllowed ? "Yes" : "No"}</span></td>
      <td style="white-space:nowrap;">
        <button class="icon-btn" data-toggle-coupon="${escapeHtml(c.id)}" title="${c.active ? "Deactivate" : "Activate"}"><ion-icon name="${c.active ? "pause-outline" : "play-outline"}"></ion-icon></button>
        <button class="icon-btn" data-coupon-edit="${escapeHtml(c.id)}" title="Edit"><ion-icon name="create-outline"></ion-icon></button>
        <button class="icon-btn danger" data-coupon-del="${escapeHtml(c.id)}" title="Delete"><ion-icon name="trash-outline"></ion-icon></button>
      </td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("[data-toggle-coupon]").forEach(b => b.addEventListener("click", () => toggleCoupon(b.dataset.toggleCoupon)));
  tbody.querySelectorAll("[data-coupon-edit]").forEach(b => b.addEventListener("click", () => openCouponForm(coupons.find(c => c.id === b.dataset.couponEdit))));
  tbody.querySelectorAll("[data-coupon-del]").forEach(b => b.addEventListener("click", () => deleteCoupon(b.dataset.couponDel)));
}

async function toggleCoupon(id) {
  const coupon = coupons.find(c => c.id === id);
  if (!coupon) return;
  try { await updateDoc(doc(db, "coupons", id), { active: !coupon.active }); coupon.active = !coupon.active; renderCouponTable(); }
  catch (err) { alert("Failed: " + (err.code || err.message)); }
}

function genCouponCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const suffix = Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return "ZAH-" + suffix;
}

function openCouponForm(coupon) {
  editingCoupon = coupon || null;
  const f = $("#coupon-form");
  f.reset();
  $("#coupon-form-title").textContent = coupon ? "Edit Coupon" : "Add Coupon";
  const codeInput = f.querySelector("[name=code]");
  if (coupon) {
    codeInput.value = coupon.id; codeInput.readOnly = true;
    f.querySelector("[name=type]").value = coupon.type || "percent";
    f.querySelector("[name=value]").value = coupon.value || "";
    f.querySelector("[name=minOrder]").value = coupon.minOrder || 0;
    f.querySelector("[name=maxUses]").value = coupon.maxUses || 0;
    f.querySelector("[name=active]").checked = !!coupon.active;
    f.querySelector("[name=allowOnSaleProducts]").checked = coupon.allowOnSaleProducts !== false;
    if (coupon.expiresAt && coupon.expiresAt.toDate) f.querySelector("[name=expiresAt]").value = coupon.expiresAt.toDate().toISOString().split("T")[0];
  } else {
    codeInput.readOnly = false;
    f.querySelector("[name=active]").checked = true;
    f.querySelector("[name=allowOnSaleProducts]").checked = true;
  }
  const genBtn = document.getElementById("gen-coupon-btn");
  if (genBtn && !genBtn._wired) {
    genBtn._wired = true;
    genBtn.addEventListener("click", () => {
      const inp = f.querySelector("[name=code]");
      if (!inp.readOnly) inp.value = genCouponCode();
    });
  }
  $("#coupon-modal").classList.add("open");
}
function closeCouponForm() {
  $("#coupon-modal").classList.remove("open");
  const genBtn = document.getElementById("gen-coupon-btn");
  if (genBtn) genBtn._wired = false;
}

async function saveCoupon(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Saving…";
  const code = f.querySelector("[name=code]").value.trim().toUpperCase();
  if (!code) { alert("Code is required"); btn.disabled = false; btn.textContent = "Save Coupon"; return; }
  const couponType = f.querySelector("[name=type]").value;
  const couponValue = parseFloat(f.querySelector("[name=value]").value) || 0;
  if (couponType !== "freeship" && couponValue <= 0) {
    alert("Discount value is required for this coupon type.");
    btn.disabled = false; btn.textContent = "Save Coupon"; return;
  }
  const expiresVal = f.querySelector("[name=expiresAt]").value;
  try {
    await setDoc(doc(db, "coupons", code), {
      type: couponType,
      value: couponValue,
      minOrder: parseFloat(f.querySelector("[name=minOrder]").value) || 0,
      maxUses: parseInt(f.querySelector("[name=maxUses]").value) || 0,
      active: f.querySelector("[name=active]").checked,
      allowOnSaleProducts: f.querySelector("[name=allowOnSaleProducts]").checked,
      expiresAt: expiresVal ? Timestamp.fromDate(new Date(expiresVal)) : null,
      usedCount: editingCoupon ? (editingCoupon.usedCount || 0) : 0,
      updatedAt: serverTimestamp(),
      ...(!editingCoupon ? { createdAt: serverTimestamp() } : {})
    });
    closeCouponForm();
    await fetchCoupons();
    renderCouponTable();
    adminToast("Coupon saved.");
  } catch (err) {
    const msg = err.code === "permission-denied"
      ? "Permission denied. Make sure your Firestore Security Rules are published in Firebase Console."
      : (err.code || err.message);
    alert("Save failed: " + msg);
    console.error("saveCoupon error:", err);
  }
  finally { btn.disabled = false; btn.textContent = "Save Coupon"; }
}

async function deleteCoupon(id) {
  if (!await zahrounConfirm(`Delete coupon "${id}"? This action cannot be undone.`, { title: "Delete Coupon", ok: "Delete", danger: true })) return;
  try { await deleteDoc(doc(db, "coupons", id)); await fetchCoupons(); renderCouponTable(); }
  catch (err) { alert("Delete failed: " + (err.code || err.message)); }
}

/* ---- Reviews ----------------------------------------------------------- */
function renderReviewTable() {
  const tbody = $("#review-rows");
  if (!reviews.length) { tbody.innerHTML = `<tr><td colspan="8" class="muted-note" style="padding:2rem;text-align:center;">No reviews yet.</td></tr>`; return; }
  tbody.innerHTML = reviews.map(r => {
    const stars = "★".repeat(r.rating || 0) + "☆".repeat(5 - (r.rating || 0));
    const isPending = !r.status || r.status === "pending";
    const isApproved = r.status === "approved";
    const hasReply = !!r.adminReply;
    return `<tr>
      <td style="font-size:.85rem;">${escapeHtml(r.productName || "—")}</td>
      <td style="font-size:.85rem;">${escapeHtml(r.reviewerName || "—")}<br><span class="muted-note">${escapeHtml(r.reviewerEmail || "")}</span></td>
      <td style="color:#f0b429;letter-spacing:1px;font-size:.9rem;">${stars}</td>
      <td style="font-size:.82rem;max-width:180px;word-break:break-word;">${escapeHtml(r.text || "")}</td>
      <td><span class="badge ${isApproved ? "green" : r.status === "rejected" ? "" : ""}" style="${r.status === "rejected" ? "background:#fdecea;color:#9b2226;" : ""}">${r.status || "pending"}</span></td>
      <td class="muted-note">${fmtDate(r.createdAt)}</td>
      <td style="min-width:160px;">
        ${hasReply
          ? `<span style="font-size:.78rem;color:#1e7e34;font-style:italic;">"${escapeHtml(r.adminReply.slice(0,60))}${r.adminReply.length > 60 ? "…" : ""}"</span>
             <button class="link-btn" style="font-size:.73rem;margin-top:.2rem;display:block;" data-rv-edit-reply="${r.id}">Edit</button>`
          : `<textarea data-rv-reply="${r.id}" placeholder="Reply to review…" rows="2" style="width:100%;font-size:.78rem;padding:.3rem .5rem;border:1px solid var(--border-color);border-radius:6px;font-family:var(--font-sans);resize:vertical;box-sizing:border-box;"></textarea>
             <button class="icon-btn" data-rv-save-reply="${r.id}" style="margin-top:.2rem;font-size:.75rem;padding:.25rem .6rem;" title="Save reply"><ion-icon name="checkmark-outline"></ion-icon> Reply</button>`
        }
      </td>
      <td style="white-space:nowrap;">
        ${!isApproved ? `<button class="icon-btn" data-rv-approve="${r.id}" title="Approve"><ion-icon name="checkmark-outline"></ion-icon></button>` : ""}
        ${r.status !== "rejected" ? `<button class="icon-btn" data-rv-reject="${r.id}" title="Reject"><ion-icon name="close-outline"></ion-icon></button>` : ""}
        <button class="icon-btn danger" data-rv-del="${r.id}" title="Delete"><ion-icon name="trash-outline"></ion-icon></button>
      </td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("[data-rv-approve]").forEach(b => b.addEventListener("click", () => updateReviewStatus(b.dataset.rvApprove, "approved")));
  tbody.querySelectorAll("[data-rv-reject]").forEach(b => b.addEventListener("click", () => updateReviewStatus(b.dataset.rvReject, "rejected")));
  tbody.querySelectorAll("[data-rv-del]").forEach(b => b.addEventListener("click", () => deleteReview(b.dataset.rvDel)));

  // Mobile: tap row → bottom sheet with full review
  tbody.querySelectorAll("[data-rv-save-reply]").forEach(b => b.addEventListener("click", async () => {
    const id = b.dataset.rvSaveReply;
    const ta = tbody.querySelector(`textarea[data-rv-reply="${id}"]`);
    const reply = ta ? ta.value.trim() : "";
    if (!reply) return;
    b.disabled = true;
    try {
      await updateDoc(doc(db, "reviews", id), { adminReply: reply });
      const r = reviews.find(x => x.id === id);
      if (r) r.adminReply = reply;
      renderReviewTable();
      adminToast("Reply saved.");
    } catch (e) { adminToast("Failed to save reply.", "error"); b.disabled = false; }
  }));
  tbody.querySelectorAll("[data-rv-edit-reply]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.rvEditReply;
    const r = reviews.find(x => x.id === id);
    if (!r) return;
    const td = b.closest("td");
    td.innerHTML = `<textarea data-rv-reply="${id}" rows="2" style="width:100%;font-size:.78rem;padding:.3rem .5rem;border:1px solid var(--border-color);border-radius:6px;font-family:var(--font-sans);resize:vertical;box-sizing:border-box;">${escapeHtml(r.adminReply || "")}</textarea>
      <button data-rv-save-reply="${id}" style="margin-top:.2rem;font-size:.75rem;padding:.25rem .6rem;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;"><ion-icon name="checkmark-outline"></ion-icon> Update</button>`;
    td.querySelector(`[data-rv-save-reply="${id}"]`).addEventListener("click", async (ev) => {
      const reply = td.querySelector("textarea").value.trim();
      ev.target.disabled = true;
      try {
        await updateDoc(doc(db, "reviews", id), { adminReply: reply });
        const rx = reviews.find(x => x.id === id);
        if (rx) rx.adminReply = reply;
        renderReviewTable(); adminToast("Reply updated.");
      } catch { adminToast("Failed.", "error"); ev.target.disabled = false; }
    });
  }));

  // Mobile: tap row → bottom sheet with full review
  if (window.innerWidth <= 620) {
    tbody.querySelectorAll("tr").forEach(tr => {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", e => {
        if (e.target.closest("button, textarea, select, a")) return;
        const approveBtn = tr.querySelector("[data-rv-approve]");
        const delBtn = tr.querySelector("[data-rv-del]");
        const id = approveBtn?.dataset?.rvApprove || delBtn?.dataset?.rvDel;
        const r = id ? reviews.find(x => x.id === id) : null;
        if (!r) return;
        showReviewSheet(r);
      });
    });
  }
}

function showReviewSheet(r) {
  document.getElementById("rv-sheet")?.remove();
  const stars = "★".repeat(r.rating || 0) + "☆".repeat(5 - (r.rating || 0));
  const sheet = document.createElement("div");
  sheet.id = "rv-sheet";
  sheet.style.cssText = "position:fixed;inset:0;z-index:200000;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,.45);";
  sheet.innerHTML = `
    <div style="background:#fff;border-radius:18px 18px 0 0;padding:1.5rem 1.25rem 2rem;max-height:80vh;overflow-y:auto;">
      <div style="width:36px;height:4px;background:#ddd;border-radius:4px;margin:0 auto 1.25rem;"></div>
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.3rem;">${escapeHtml(r.productName || "")}</div>
      <div style="font-size:.82rem;font-weight:600;margin-bottom:.3rem;">${escapeHtml(r.reviewerName || "Anonymous")}</div>
      <div style="color:#f0b429;letter-spacing:1px;font-size:1rem;margin-bottom:.75rem;">${stars}</div>
      <p style="font-size:.9rem;line-height:1.65;color:var(--text-main);margin-bottom:1rem;">${escapeHtml(r.text || "")}</p>
      ${r.adminReply ? `<div style="background:#f5f3ef;border-left:3px solid var(--primary-color);padding:.6rem .9rem;border-radius:0 8px 8px 0;font-size:.82rem;font-style:italic;color:var(--primary-color);margin-bottom:1rem;">Reply: ${escapeHtml(r.adminReply)}</div>` : ""}
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;">
        ${r.status !== "approved" ? `<button class="btn" style="flex:1;padding:.55rem;" data-sheet-approve="${r.id}">Approve</button>` : ""}
        ${r.status !== "rejected" ? `<button class="btn btn-outline" style="flex:1;padding:.55rem;" data-sheet-reject="${r.id}">Reject</button>` : ""}
        <button class="btn" style="background:#9b2226;border-color:#9b2226;flex:1;padding:.55rem;" data-sheet-del="${r.id}">Delete</button>
      </div>
      <button style="margin-top:.75rem;width:100%;padding:.5rem;background:none;border:1px solid var(--border-color);border-radius:8px;font-size:.88rem;cursor:pointer;" id="rv-sheet-close">Close</button>
    </div>`;
  document.body.appendChild(sheet);
  sheet.querySelector("#rv-sheet-close").addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", e => { if (e.target === sheet) sheet.remove(); });
  sheet.querySelector("[data-sheet-approve]")?.addEventListener("click", async () => {
    await updateReviewStatus(r.id, "approved"); sheet.remove();
  });
  sheet.querySelector("[data-sheet-reject]")?.addEventListener("click", async () => {
    await updateReviewStatus(r.id, "rejected"); sheet.remove();
  });
  sheet.querySelector("[data-sheet-del]")?.addEventListener("click", async () => {
    await deleteReview(r.id); sheet.remove();
  });
}

async function updateReviewStatus(id, status) {
  try {
    await updateDoc(doc(db, "reviews", id), { status });
    const r = reviews.find(x => x.id === id);
    if (r) r.status = status;
    renderReviewTable();
    adminToast(`Review ${status}.`);
  } catch (err) { alert("Failed: " + (err.code || err.message)); }
}

async function deleteReview(id) {
  if (!await zahrounConfirm("Delete this review permanently? This action cannot be undone.", { title: "Delete Review", ok: "Delete", danger: true })) return;
  try {
    await deleteDoc(doc(db, "reviews", id));
    reviews = reviews.filter(r => r.id !== id);
    renderReviewTable();
  } catch (err) { alert("Failed: " + (err.code || err.message)); }
}

/* ---- FAQ --------------------------------------------------------------- */
let faqs = [];
let editingFaq = null;

async function fetchFaqs() {
  try {
    const snap = await getDocs(collection(db, "faqs"));
    faqs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (e) { console.error("fetchFaqs:", e); }
}

function renderFaqTable() {
  const tbody = $("#faq-rows");
  if (!tbody) return;
  if (!faqs.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted-note" style="padding:2rem;text-align:center;">No FAQs yet. Click "Add Question" to get started.</td></tr>`;
    return;
  }
  tbody.innerHTML = faqs.map(f => `<tr>
    <td style="font-size:.85rem;max-width:220px;word-break:break-word;">${escapeHtml(f.question || "")}</td>
    <td style="font-size:.82rem;color:var(--text-muted);max-width:260px;">${escapeHtml((f.answer || "").slice(0, 90))}${(f.answer || "").length > 90 ? "…" : ""}</td>
    <td><span class="badge ${f.active !== false ? "green" : ""}">${f.active !== false ? "Active" : "Hidden"}</span></td>
    <td style="font-size:.85rem;">${f.order || 0}</td>
    <td style="white-space:nowrap;">
      <button class="icon-btn" data-faq-edit="${f.id}" title="Edit"><ion-icon name="create-outline"></ion-icon></button>
      <button class="icon-btn danger" data-faq-del="${f.id}" title="Delete"><ion-icon name="trash-outline"></ion-icon></button>
    </td>
  </tr>`).join("");
  tbody.querySelectorAll("[data-faq-edit]").forEach(b => b.addEventListener("click", () => openFaqModal(faqs.find(f => f.id === b.dataset.faqEdit))));
  tbody.querySelectorAll("[data-faq-del]").forEach(b => b.addEventListener("click", () => deleteFaqModal(b.dataset.faqDel)));
}

function openFaqModal(faq) {
  editingFaq = faq || null;
  const f = $("#faq-form");
  f.reset();
  $("#faq-form-title").textContent = faq ? "Edit FAQ" : "Add FAQ";
  if (faq) {
    f.querySelector("[name=question]").value = faq.question || "";
    f.querySelector("[name=answer]").value = faq.answer || "";
    f.querySelector("[name=order]").value = faq.order ?? 0;
    f.querySelector("[name=active]").checked = faq.active !== false;
  } else {
    f.querySelector("[name=order]").value = faqs.length;
    f.querySelector("[name=active]").checked = true;
  }
  $("#faq-modal").classList.add("open");
}

function closeFaqModal() { $("#faq-modal").classList.remove("open"); }

async function saveFaqModal(e) {
  e.preventDefault();
  const f = e.target;
  const data = {
    question: f.querySelector("[name=question]").value.trim(),
    answer: f.querySelector("[name=answer]").value.trim(),
    order: parseInt(f.querySelector("[name=order]").value) || 0,
    active: f.querySelector("[name=active]").checked,
    updatedAt: serverTimestamp()
  };
  if (!data.question || !data.answer) { adminToast("Question and answer are required."); return; }
  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    if (editingFaq) {
      await updateDoc(doc(db, "faqs", editingFaq.id), data);
      const idx = faqs.findIndex(x => x.id === editingFaq.id);
      if (idx !== -1) Object.assign(faqs[idx], data);
    } else {
      const ref = await addDoc(collection(db, "faqs"), { ...data, createdAt: serverTimestamp() });
      faqs.push({ id: ref.id, ...data });
    }
    faqs.sort((a, b) => (a.order || 0) - (b.order || 0));
    renderFaqTable();
    closeFaqModal();
    adminToast(editingFaq ? "FAQ updated." : "FAQ added.");
  } catch (err) { alert("Failed: " + (err.code || err.message)); }
  finally { btn.disabled = false; btn.textContent = "Save FAQ"; }
}

async function deleteFaqModal(id) {
  if (!await zahrounConfirm("Delete this FAQ permanently? This action cannot be undone.", { title: "Delete FAQ", ok: "Delete", danger: true })) return;
  try {
    await deleteDoc(doc(db, "faqs", id));
    faqs = faqs.filter(f => f.id !== id);
    renderFaqTable();
    adminToast("FAQ deleted.");
  } catch (err) { alert("Delete failed: " + (err.code || err.message)); }
}

/* ---- Policies ---------------------------------------------------------- */
function renderPoliciesForm() {
  const ret = document.getElementById("policy-return");
  const prv = document.getElementById("policy-privacy");
  const trm = document.getElementById("policy-terms");
  if (ret) ret.value = settings.policyReturn || "";
  if (prv) prv.value = settings.policyPrivacy || "";
  if (trm) trm.value = settings.policyTerms || "";
}

async function savePolicies() {
  const btn = document.getElementById("save-policies");
  const status = document.getElementById("status-policies");
  const data = {
    policyReturn: document.getElementById("policy-return").value.trim(),
    policyPrivacy: document.getElementById("policy-privacy").value.trim(),
    policyTerms: document.getElementById("policy-terms").value.trim(),
    updatedAt: serverTimestamp()
  };
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  if (status) status.textContent = "";
  try {
    await setDoc(doc(db, "settings", "store"), data, { merge: true });
    Object.assign(settings, data);
    if (status) status.textContent = "✓ Saved";
    adminToast("Policies saved.");
    setTimeout(() => { if (status) status.textContent = ""; }, 3000);
  } catch (err) { alert("Failed: " + (err.code || err.message)); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Save Policies"; } }
}

/* ---- Flash Sale --------------------------------------------------------- */
let flashSaleData = { enabled: false, items: [] };

async function fetchFlashSale() {
  try {
    const snap = await getDoc(doc(db, "settings", "flashSale"));
    flashSaleData = snap.exists() ? snap.data() : { enabled: false, items: [] };
    flashSaleData.items = flashSaleData.items || [];
  } catch (e) { console.error("fetchFlashSale:", e); }
}

function updateFlashNavBadge() {
  const badge = document.getElementById("nav-flash-badge");
  const liveBadge = document.getElementById("flash-live-badge");
  const on = !!flashSaleData.enabled;
  if (badge) badge.style.display = on ? "" : "none";
  if (liveBadge) liveBadge.style.display = on ? "" : "none";
}

function renderFlashSaleForm() {
  document.getElementById("flash-enabled").checked = !!flashSaleData.enabled;
  document.getElementById("flash-title").value = flashSaleData.title || "";
  document.getElementById("flash-badge").value = flashSaleData.badgeText || "";
  document.getElementById("flash-subtitle").value = flashSaleData.subtitle || "";

  if (flashSaleData.endDate) {
    try {
      const d = flashSaleData.endDate.toDate ? flashSaleData.endDate.toDate() : new Date(flashSaleData.endDate);
      const pad = n => String(n).padStart(2, "0");
      document.getElementById("flash-end-date").value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      document.getElementById("flash-end-time").value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { /* invalid date */ }
  }

  updateFlashNavBadge();
  buildFlashProductRows();

  document.getElementById("flash-enabled").onchange = updateFlashNavBadge;
  document.getElementById("save-flash-sale").onclick = saveFlashSale;
  fetchSaleAnalytics();
}

function buildFlashProductRows() {
  const tbody = document.getElementById("flash-product-rows");
  if (!tbody) return;
  const items = flashSaleData.items || [];
  let selectedCount = 0;

  tbody.innerHTML = products.filter(p => !p.hidden).map(p => {
    const item = items.find(i => i.productId === p.id);
    const checked = !!item;
    if (checked) selectedCount++;
    const regularPrice = (p.prices && p.prices["50ML"]) ? p.prices["50ML"] : (p.price || 0);
    const salePrice = item?.salePrice || "";
    const saving = (item && item.salePrice && regularPrice > item.salePrice)
      ? `<span style="color:#1e7e34;font-weight:600;">৳${(regularPrice - item.salePrice).toLocaleString()} off</span>`
      : `<span style="color:var(--text-muted);">—</span>`;

    return `<tr id="frow-${p.id}">
      <td><input type="checkbox" class="fchk" data-pid="${p.id}" ${checked ? "checked" : ""} style="width:15px;height:15px;cursor:pointer;accent-color:var(--primary-color);"></td>
      <td>
        <div style="display:flex;align-items:center;gap:.6rem;">
          ${p.image ? `<img src="${optimizedUrl(p.image, 36)}" style="width:36px;height:36px;object-fit:contain;background:var(--bg-color);border-radius:5px;flex-shrink:0;">` : ""}
          <span style="font-size:.85rem;font-weight:500;">${escapeHtml(p.name)}</span>
        </div>
      </td>
      <td style="font-size:.85rem;">৳${regularPrice.toLocaleString()}</td>
      <td><input type="number" class="flash-prod-inp fprice" data-pid="${p.id}" data-reg="${regularPrice}" value="${salePrice}" min="1" max="${regularPrice}" placeholder="Sale price" ${!checked ? "disabled" : ""}></td>
      <td id="fsaving-${p.id}">${saving}</td>
    </tr>`;
  }).join("");

  // Update count
  const countEl = document.getElementById("flash-selected-count");
  if (countEl) countEl.textContent = `${selectedCount} product${selectedCount !== 1 ? "s" : ""} selected`;

  // Wire checkboxes
  tbody.querySelectorAll(".fchk").forEach(chk => {
    chk.addEventListener("change", () => {
      const inp = tbody.querySelector(`.fprice[data-pid="${chk.dataset.pid}"]`);
      if (inp) inp.disabled = !chk.checked;
      // Update count
      const total = tbody.querySelectorAll(".fchk:checked").length;
      const cEl = document.getElementById("flash-selected-count");
      if (cEl) cEl.textContent = `${total} product${total !== 1 ? "s" : ""} selected`;
    });
  });

  // Wire price inputs → live savings
  tbody.querySelectorAll(".fprice").forEach(inp => {
    inp.addEventListener("input", () => {
      const reg = parseInt(inp.dataset.reg) || 0;
      const sale = parseInt(inp.value) || 0;
      const savEl = document.getElementById(`fsaving-${inp.dataset.pid}`);
      if (savEl) {
        savEl.innerHTML = sale > 0 && sale < reg
          ? `<span style="color:#1e7e34;font-weight:600;">৳${(reg - sale).toLocaleString()} off</span>`
          : `<span style="color:var(--text-muted);">—</span>`;
      }
    });
  });
}

async function saveFlashSale() {
  const tbody = document.getElementById("flash-product-rows");
  const items = [];
  tbody.querySelectorAll(".fchk:checked").forEach(chk => {
    const pid = parseInt(chk.dataset.pid);
    const inp = tbody.querySelector(`.fprice[data-pid="${pid}"]`);
    const salePrice = parseInt(inp?.value) || 0;
    if (pid && salePrice > 0) items.push({ productId: pid, salePrice });
  });

  const dateVal = document.getElementById("flash-end-date").value;
  const timeVal = document.getElementById("flash-end-time").value || "23:59";
  const endDate = dateVal ? Timestamp.fromDate(new Date(`${dateVal}T${timeVal}:00`)) : null;

  const enabled = document.getElementById("flash-enabled").checked;
  const data = {
    enabled,
    title: document.getElementById("flash-title").value.trim() || "Flash Sale",
    subtitle: document.getElementById("flash-subtitle").value.trim(),
    badgeText: (document.getElementById("flash-badge").value.trim() || "SALE").toUpperCase(),
    endDate,
    items,
    updatedAt: serverTimestamp()
  };

  const btn = document.getElementById("save-flash-sale");
  const status = document.getElementById("flash-save-status");
  btn.disabled = true; btn.innerHTML = `<ion-icon name="hourglass-outline"></ion-icon> Saving…`;

  try {
    await setDoc(doc(db, "settings", "flashSale"), data);
    flashSaleData = { ...data };
    updateFlashNavBadge();
    if (status) { status.textContent = "✓ Saved"; setTimeout(() => { status.textContent = ""; }, 3000); }
    adminToast(`Flash Sale ${enabled ? "is now LIVE 🔥" : "turned off."}`);
  } catch (err) { alert("Failed: " + (err.code || err.message)); }
  finally { btn.disabled = false; btn.innerHTML = `<ion-icon name="save-outline"></ion-icon> Save Flash Sale`; }
}

async function fetchSaleAnalytics() {
  const card = document.getElementById("sale-analytics-card");
  if (!card) return;
  const saleItems = flashSaleData.items || [];
  if (!saleItems.length) {
    card.innerHTML = `<p class="muted-note" style="text-align:center;padding:1.5rem;">No sale products configured. Add products above and save first.</p>`;
    return;
  }
  card.innerHTML = `<p class="muted-note" style="text-align:center;padding:1.5rem;"><ion-icon name="hourglass-outline" style="vertical-align:middle;"></ion-icon> Loading…</p>`;
  try {
    const saleIds = new Set(saleItems.map(i => i.productId));
    const salePriceMap = {};
    saleItems.forEach(i => { salePriceMap[i.productId] = i.salePrice; });
    const regularPriceMap = {};
    products.forEach(p => { regularPriceMap[p.id] = (p.prices && p.prices["50ML"]) ? p.prices["50ML"] : (p.price || 0); });

    const snap = await getDocs(collection(db, "orders"));
    let totalOrders = 0, totalRevenue = 0, totalDiscount = 0, totalUnitsSold = 0;
    const productSales = {};

    snap.docs.forEach(d => {
      const order = d.data();
      const items = order.items || [];
      const saleOrderItems = items.filter(it => saleIds.has(it.id));
      if (!saleOrderItems.length) return;
      totalOrders++;
      saleOrderItems.forEach(it => {
        const qty = it.quantity || 1;
        const salePrice = salePriceMap[it.id] || it.selectedPrice || 0;
        const regPrice = regularPriceMap[it.id] || salePrice;
        totalRevenue += salePrice * qty;
        totalDiscount += Math.max(0, (regPrice - salePrice)) * qty;
        totalUnitsSold += qty;
        productSales[it.id] = (productSales[it.id] || 0) + qty;
      });
    });

    let topProductId = null, topQty = 0;
    Object.entries(productSales).forEach(([id, qty]) => { if (qty > topQty) { topProductId = Number(id); topQty = qty; } });
    const topProduct = topProductId ? products.find(p => p.id === topProductId) : null;

    const statBox = (value, label, color) =>
      `<div style="background:var(--bg-color);border-radius:10px;padding:1rem 1.25rem;border:1px solid var(--border-color);text-align:center;">
         <div style="font-size:1.6rem;font-weight:700;color:${color};">${value}</div>
         <div style="font-size:.75rem;color:var(--text-muted);margin-top:.3rem;line-height:1.4;">${label}</div>
       </div>`;

    card.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:1rem;padding:.25rem 0 1rem;">
        ${statBox(totalOrders, "Orders with<br>Sale Items", "var(--primary-color)")}
        ${statBox("৳" + totalRevenue.toLocaleString(), "Revenue from<br>Sale Products", "var(--primary-color)")}
        ${statBox(totalUnitsSold, "Total Units<br>Sold on Sale", "var(--primary-color)")}
        ${statBox("৳" + Math.round(totalDiscount).toLocaleString(), "Total Discount<br>Given", "#e63946")}
        ${topProduct ? statBox(escapeHtml(topProduct.name) + `<div style="font-size:.7rem;font-weight:400;color:var(--text-muted);">${topQty} unit${topQty !== 1 ? "s" : ""} sold</div>`, "Top Sale<br>Product", "var(--primary-color)") : ""}
      </div>
      <p class="muted-note" style="font-size:.75rem;text-align:right;">Based on all-time orders containing current sale products.</p>`;
  } catch(e) {
    card.innerHTML = `<p class="muted-note" style="text-align:center;padding:1.5rem;">Could not load analytics.</p>`;
    console.error("fetchSaleAnalytics:", e);
  }
}
window.fetchSaleAnalytics = fetchSaleAnalytics;

/* ---- Loyalty Section (Settings + Members) -------------------------------- */
let _lmTab = 'all';
let _lpSettingsWired = false;

window.lmShowTab = function(tab) {
  _lmTab = tab;
  ['all','pending','approved','rejected'].forEach(t => {
    const btn = document.getElementById('lm-tab-' + t);
    if (!btn) return;
    const active = t === tab;
    btn.style.background = active ? '#163E34' : '#fff';
    btn.style.color      = active ? '#fff'    : 'var(--text-main)';
    btn.style.fontWeight = active ? '600'     : '400';
    btn.style.border     = active ? '1px solid #163E34' : '1px solid var(--border-color)';
  });
  renderLoyaltyMembersTable();
};

window.lmRefresh = function() { renderLoyaltyMembersTable(); };

async function renderLoyaltyMembersTable() {
  const listEl = document.getElementById('lm-members-list'); if (!listEl) return;
  listEl.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem;">Loading…</div>';
  try {
    const statusColors = { pending:'#e67e22', approved:'#27ae60', rejected:'#c0392b' };
    const statusLabels = { pending:'Pending', approved:'Approved', rejected:'Rejected' };
    const tierInfo = { silver:{ icon:'🥈', label:'Silver' }, gold:{ icon:'🥇', label:'Gold' }, platinum:{ icon:'💎', label:'Platinum' } };
    let q;
    if (_lmTab === 'all') q = query(collection(db,'loyaltyPoints'));
    else                   q = query(collection(db,'loyaltyPoints'), where('status','==',_lmTab));
    const snap = await getDocs(q);

    // Update stat cards (only when viewing "all" — gives accurate global totals)
    if (_lmTab === 'all') {
      let pending = 0, approved = 0, totalPts = 0;
      snap.forEach(d => {
        const s = d.data().status || 'pending';
        if (s === 'pending')  pending++;
        if (s === 'approved') approved++;
        totalPts += (d.data().points || 0);
      });
      const el = id => document.getElementById(id);
      if (el('lm-stat-total'))    el('lm-stat-total').textContent    = snap.size;
      if (el('lm-stat-pending'))  el('lm-stat-pending').textContent  = pending;
      if (el('lm-stat-approved')) el('lm-stat-approved').textContent = approved;
      if (el('lm-stat-points'))   el('lm-stat-points').textContent   = totalPts.toLocaleString();
      const badge = document.getElementById('nav-loyalty-badge');
      if (badge) { badge.textContent = pending || ''; badge.style.display = pending ? '' : 'none'; }
    }

    if (snap.empty) {
      listEl.innerHTML = `<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:.88rem;">
        <ion-icon name="people-outline" style="font-size:2rem;display:block;margin:0 auto .5rem;opacity:.35;"></ion-icon>
        No ${_lmTab === 'all' ? '' : _lmTab + ' '}members found.
      </div>`;
      return;
    }

    let html = `<table style="width:100%;border-collapse:collapse;font-size:.84rem;">
      <thead><tr style="background:#f7f7f5;border-bottom:2px solid var(--border-color);">
        <th style="padding:.7rem 1rem;text-align:left;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;">Name</th>
        <th style="padding:.7rem 1rem;text-align:left;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;">Email</th>
        <th style="padding:.7rem .85rem;text-align:center;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;">Points</th>
        <th style="padding:.7rem .85rem;text-align:center;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;">Tier</th>
        <th style="padding:.7rem .85rem;text-align:center;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;">Status</th>
        <th style="padding:.7rem .85rem;text-align:center;font-weight:600;color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;">Actions</th>
      </tr></thead><tbody>`;

    snap.forEach(d => {
      const data   = d.data();
      const status = data.status || 'pending';
      const tier   = data.tier   || 'silver';
      const pts    = data.points || 0;
      const ti     = tierInfo[tier] || tierInfo.silver;
      const sc     = statusColors[status] || '#888';
      html += `<tr style="border-bottom:1px solid #f0ede8;transition:background .12s;" onmouseover="this.style.background='#fafaf8'" onmouseout="this.style.background=''">
        <td data-label="Name" style="padding:.7rem 1rem;font-weight:500;color:var(--text-main);">${escapeHtml(data.name || '—')}</td>
        <td data-label="Email" style="padding:.7rem 1rem;color:var(--text-muted);font-size:.8rem;">${escapeHtml(data.email || d.id || '—')}</td>
        <td data-label="Points" style="padding:.7rem .85rem;text-align:center;font-family:'Inter',sans-serif;font-weight:700;font-size:.95rem;color:#163E34;">${pts.toLocaleString()}</td>
        <td data-label="Tier" style="padding:.7rem .85rem;text-align:center;font-size:.9rem;" title="${ti.label}">${ti.icon} <span style="font-size:.75rem;color:var(--text-muted);margin-left:.15rem;">${ti.label}</span></td>
        <td data-label="Status" style="padding:.7rem .85rem;text-align:center;">
          <span style="display:inline-block;padding:.22rem .65rem;border-radius:20px;font-size:.73rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:${sc}18;color:${sc};border:1px solid ${sc}40;">
            ${statusLabels[status] || status}
          </span>
        </td>
        <td data-label="Actions" style="padding:.7rem .85rem;text-align:center;">
          <div style="display:flex;gap:.35rem;justify-content:center;flex-wrap:wrap;">
            ${status !== 'approved' ? `<button onclick="window.lmAction('${d.id}','approved')" title="Approve this member" style="background:#163E34;color:#fff;border:none;border-radius:6px;padding:.35rem .8rem;font-size:.79rem;cursor:pointer;display:inline-flex;align-items:center;gap:.3rem;font-weight:600;letter-spacing:.02em;"><span>✓</span> Approve</button>` : ''}
            ${status !== 'rejected' ? `<button onclick="window.lmAction('${d.id}','rejected')" title="Reject this member" style="background:#c0392b;color:#fff;border:none;border-radius:6px;padding:.35rem .8rem;font-size:.79rem;cursor:pointer;display:inline-flex;align-items:center;gap:.3rem;font-weight:600;"><span>✗</span> Reject</button>` : ''}
            ${status === 'approved' ? `<button onclick="window.lmAction('${d.id}','pending')" title="Revoke approval — set back to pending" style="background:#6c757d;color:#fff;border:none;border-radius:6px;padding:.35rem .8rem;font-size:.79rem;cursor:pointer;font-weight:600;">↩ Revoke</button>` : ''}
          </div>
        </td>
      </tr>`;
    });
    html += '</tbody></table>';
    listEl.innerHTML = html;
  } catch(e) {
    listEl.innerHTML = '<div style="padding:2rem;text-align:center;color:#c0392b;font-size:.85rem;">Could not load members. Check your Firestore rules.</div>';
    console.warn('LP members:', e);
  }
}

window.lmAction = async function(uid, newStatus) {
  try {
    await updateDoc(doc(db,'loyaltyPoints',uid), { status: newStatus });
    renderLoyaltyMembersTable();
    const msgs = { approved: 'Member approved — they can now earn & redeem points.', rejected: 'Member rejected.', pending: 'Status revoked — member is now pending again.' };
    adminToast(msgs[newStatus] || 'Status updated.');
  } catch(e) { adminToast('Error: ' + e.message, false); }
};

async function saveLoyaltySettings() {
  const btn = document.getElementById('lp-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<ion-icon name="hourglass-outline"></ion-icon> Saving…'; }
  const getNum = id => parseFloat(document.getElementById(id)?.value) || 0;
  const getChk = id => !!(document.getElementById(id)?.checked);
  const enrollMode = document.querySelector('input[name="lp-enroll"]:checked')?.value || 'auto';
  const tiersOn = getChk('p-lp-tiers-on');
  const loyaltyPoints = {
    enabled: getChk('p-lp-on'),
    earnPer: getNum('p-lp-earn'),
    redeemValue: getNum('p-lp-val'),
    minRedeem: getNum('p-lp-min'),
    minOrderAmount: getNum('p-lp-min-order'),
    maxRedeemPct: getNum('p-lp-max-pct'),
    allowDuringPromos: getChk('p-lp-allow-promo'),
    allowWithCoupon: getChk('p-lp-allow-coupon'),
    allowWithFreeGift: getChk('p-lp-allow-gift'),
    enrollMode,
    enrollConditions: {
      minPurchase: getNum('p-lp-cond-min'),
      text: (document.getElementById('p-lp-cond-text')?.value || '').trim()
    },
    tiers: tiersOn ? {
      enabled: true,
      silver:   { minSpend: getNum('p-lp-silver-min'), mult: parseFloat(document.getElementById('p-lp-silver-mult')?.value) || 1 },
      gold:     { minSpend: getNum('p-lp-gold-min'),   mult: parseFloat(document.getElementById('p-lp-gold-mult')?.value)   || 2 },
      platinum: { minSpend: getNum('p-lp-plat-min'),   mult: parseFloat(document.getElementById('p-lp-plat-mult')?.value)   || 3 }
    } : { enabled: false }
  };
  try {
    await setDoc(doc(db,'settings','promotions'), { loyaltyPoints }, { merge: true });
    const msg = document.getElementById('lp-save-msg');
    if (msg) { msg.textContent = '✓ Settings saved successfully'; msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 3000); }
    adminToast('Loyalty settings saved!');
  } catch(e) {
    adminToast('Save failed: ' + (e.message || e), false);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<ion-icon name="save-outline"></ion-icon> Save Settings'; }
  }
}

async function initLoyaltyMembersSection() {
  // Load and populate settings on every visit (fresh data from Firestore)
  try {
    const snap = await getDoc(doc(db,'settings','promotions'));
    const cfg  = snap.exists() ? snap.data() : {};
    const lp   = cfg.loyaltyPoints || {};
    const chk  = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    const num  = (id, val) => { const el = document.getElementById(id); if (el) el.value = (val ?? ''); };

    chk('p-lp-on', lp.enabled);
    num('p-lp-earn',      lp.earnPer      ?? 100);
    num('p-lp-val',       lp.redeemValue  ?? 1);
    num('p-lp-min',       lp.minRedeem    ?? 50);
    num('p-lp-min-order', lp.minOrderAmount ?? 500);
    num('p-lp-max-pct',   lp.maxRedeemPct ?? 20);
    chk('p-lp-allow-promo',  lp.allowDuringPromos !== false);
    chk('p-lp-allow-coupon', lp.allowWithCoupon   !== false);
    chk('p-lp-allow-gift',   lp.allowWithFreeGift !== false);

    const enrollMode = lp.enrollMode || 'auto';
    const enrollEl = document.getElementById(enrollMode === 'approve' ? 'p-lp-approve' : 'p-lp-auto');
    if (enrollEl) enrollEl.checked = true;
    const condWrap = document.getElementById('lp-conditions-wrap');
    if (condWrap) condWrap.style.display = enrollMode === 'approve' ? '' : 'none';

    const cond = lp.enrollConditions || {};
    num('p-lp-cond-min', cond.minPurchase ?? 0);
    const condText = document.getElementById('p-lp-cond-text');
    if (condText) condText.value = cond.text || '';

    const tiersOn = !!(lp.tiers?.enabled);
    chk('p-lp-tiers-on', tiersOn);
    const tiersWrap = document.getElementById('lp-tiers-wrap');
    if (tiersWrap) tiersWrap.style.display = tiersOn ? '' : 'none';
    const lt = lp.tiers || {};
    num('p-lp-silver-min',  lt.silver?.minSpend   ?? 0);
    num('p-lp-silver-mult', lt.silver?.mult        ?? 1);
    num('p-lp-gold-min',    lt.gold?.minSpend      ?? 8000);
    num('p-lp-gold-mult',   lt.gold?.mult          ?? 2);
    num('p-lp-plat-min',    lt.platinum?.minSpend  ?? 15000);
    num('p-lp-plat-mult',   lt.platinum?.mult      ?? 3);
  } catch(e) {
    console.warn('Could not load loyalty settings:', e);
  }

  // Wire event listeners only once
  if (!_lpSettingsWired) {
    _lpSettingsWired = true;
    document.querySelectorAll('input[name="lp-enroll"]').forEach(r => r.addEventListener('change', () => {
      const isApprove = document.querySelector('input[name="lp-enroll"]:checked')?.value === 'approve';
      const condWrap = document.getElementById('lp-conditions-wrap');
      if (condWrap) condWrap.style.display = isApprove ? '' : 'none';
    }));
    document.getElementById('p-lp-tiers-on')?.addEventListener('change', e => {
      const wrap = document.getElementById('lp-tiers-wrap');
      if (wrap) wrap.style.display = e.target.checked ? '' : 'none';
    });
    document.getElementById('lp-save-btn')?.addEventListener('click', saveLoyaltySettings);
  }

  // Show members (always refresh on section visit)
  _lmTab = 'all';
  window.lmShowTab('all');
}

/* ---- FAQ Manager -------------------------------------------------------- */
let faqItems = [];
let editingFaqId = null;

async function initFaqManager() {
  await loadFaqs();
  const addBtn = document.getElementById("faq-add-btn");
  const cancelBtn = document.getElementById("faq-cancel-btn");
  const saveBtn = document.getElementById("faq-save-btn");
  if (addBtn) addBtn.onclick = () => openFaqForm(null);
  if (cancelBtn) cancelBtn.onclick = closeFaqForm;
  if (saveBtn) saveBtn.onclick = saveFaqItem;
}

async function loadFaqs() {
  const listEl = document.getElementById("faq-list-admin");
  if (!listEl) return;
  try {
    const snap = await getDocs(collection(db, "faqs"));
    faqItems = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    renderFaqListAdmin();
  } catch (e) {
    listEl.innerHTML = `<p style="color:#9b2226;text-align:center;">Failed to load FAQs.</p>`;
  }
}

function renderFaqListAdmin() {
  const listEl = document.getElementById("faq-list-admin");
  if (!listEl) return;
  if (!faqItems.length) {
    listEl.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:2rem;">No FAQs yet. Click "Add New FAQ" to create the first one.</p>`;
    return;
  }
  listEl.innerHTML = faqItems.map((f, i) => `
    <div style="border:1px solid var(--border-color);border-radius:8px;padding:1rem 1.1rem;margin-bottom:.75rem;background:var(--surface-color);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.75rem;">
        <div style="flex:1;">
          <div style="font-weight:600;font-size:.9rem;color:var(--text-main);margin-bottom:.3rem;">${escapeHtml(f.question)}</div>
          <div style="font-size:.82rem;color:var(--text-muted);white-space:pre-line;line-height:1.6;">${escapeHtml((f.answer || "").slice(0, 120))}${(f.answer || "").length > 120 ? "…" : ""}</div>
        </div>
        <div style="display:flex;gap:.5rem;flex-shrink:0;">
          <button onclick="openFaqForm('${escapeHtml(f._id)}')" style="background:none;border:1px solid var(--border-color);border-radius:6px;padding:.3rem .6rem;cursor:pointer;font-size:.8rem;color:var(--primary-color);display:flex;align-items:center;gap:.3rem;"><ion-icon name="create-outline" style="font-size:.9rem;"></ion-icon>Edit</button>
          <button onclick="deleteFaq('${escapeHtml(f._id)}')" style="background:none;border:1px solid #fdecea;border-radius:6px;padding:.3rem .6rem;cursor:pointer;font-size:.8rem;color:#9b2226;display:flex;align-items:center;gap:.3rem;"><ion-icon name="trash-outline" style="font-size:.9rem;"></ion-icon>Delete</button>
        </div>
      </div>
    </div>`).join("");
}

function openFaqForm(id) {
  editingFaqId = id;
  const wrap = document.getElementById("faq-form-wrap");
  const titleEl = document.getElementById("faq-form-title");
  const qInput = document.getElementById("faq-q-input");
  const aInput = document.getElementById("faq-a-input");
  if (!wrap) return;
  if (id) {
    const faq = faqItems.find(f => f._id === id);
    if (faq) { qInput.value = faq.question || ""; aInput.value = faq.answer || ""; }
    titleEl.textContent = "Edit FAQ";
  } else {
    qInput.value = ""; aInput.value = "";
    titleEl.textContent = "Add New FAQ";
  }
  wrap.style.display = "";
  qInput.focus();
}

function closeFaqForm() {
  const wrap = document.getElementById("faq-form-wrap");
  if (wrap) wrap.style.display = "none";
  editingFaqId = null;
}

async function saveFaqItem() {
  const q = document.getElementById("faq-q-input").value.trim();
  const a = document.getElementById("faq-a-input").value.trim();
  const status = document.getElementById("faq-save-status");
  const btn = document.getElementById("faq-save-btn");
  if (!q || !a) { if (status) { status.textContent = "⚠ Question and answer are required."; } return; }
  btn.disabled = true; btn.innerHTML = `<ion-icon name="hourglass-outline"></ion-icon> Saving…`;
  try {
    const data = { question: q, answer: a, active: true, order: faqItems.length, updatedAt: serverTimestamp() };
    if (editingFaqId) {
      await setDoc(doc(db, "faqs", editingFaqId), data);
    } else {
      await addDoc(collection(db, "faqs"), data);
    }
    if (status) { status.textContent = "✓ Saved"; setTimeout(() => { status.textContent = ""; }, 2500); }
    closeFaqForm();
    await loadFaqs();
    adminToast(editingFaqId ? "FAQ updated." : "FAQ added.");
  } catch (err) {
    alert("Failed: " + (err.code || err.message));
  } finally {
    btn.disabled = false; btn.innerHTML = `<ion-icon name="save-outline"></ion-icon> Save FAQ`;
  }
}

window.openFaqForm = openFaqForm;
window.saveFaqItem = saveFaqItem;
window.deleteFaq = async function(id) {
  if (!await zahrounConfirm("Delete this FAQ? This action cannot be undone.", { title: "Delete FAQ", ok: "Delete", danger: true })) return;
  try {
    await deleteDoc(doc(db, "faqs", id));
    faqItems = faqItems.filter(f => f._id !== id);
    renderFaqListAdmin();
    adminToast("FAQ deleted.");
  } catch (e) { alert("Failed to delete: " + e.message); }
};

/* ---- Broadcast ---------------------------------------------------------- */
let broadcastData = { enabled: false };

const BC_PRESETS = {
  promo:   { bg: "#111111", fg: "#D4AF37" },
  info:    { bg: "#1a3c5e", fg: "#ffffff" },
  emerald: { bg: "#1ADFE2", fg: "#111111" },
  warning: { bg: "#6b1a2a", fg: "#ffffff" },
  carousel:{ bg: "#111111", fg: "#ffffff"  }
};

const BC_SPEEDS      = { slow: 2.2, normal: 1.0, fast: 0.48, vfast: 0.25 };
const BC_BG_DUR      = { shimmer: 2.6, "shimmer-fast": 0.75, "golden-glow": 1.9, glass: 4.0, neon: 1.8 };
const BC_TEXT_DUR    = {
  ticker: 13, "ticker-r": 13,
  "slide-left": 4.5, "slide-right": 4.5, "slide-top": 4.5, "slide-bottom": 4.5,
  fade: 4.5, bounce: 4.5, flip: 4.5, blink: 1.0
};
const BC_INTENSITIES = { low: 0.10, normal: 0.25, high: 0.42, max: 0.65 };

function bcHexToRgba(hex, alpha) {
  if (!hex || hex.length < 7) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function bcSetColors(bg, fg) {
  const bgEl = document.getElementById("bc-bg-color");
  const fgEl = document.getElementById("bc-fg-color");
  if (bgEl) { bgEl.value = bg; document.getElementById("bc-bg-hex").value = bg; }
  if (fgEl) { fgEl.value = fg; document.getElementById("bc-fg-hex").value = fg; }
}

function bcPreviewUpdate() {
  const preview  = document.getElementById("bc-preview");
  const pvText   = document.getElementById("bc-preview-text");
  if (!preview || !pvText) return;

  const bg     = document.getElementById("bc-bg-color")?.value  || "#111111";
  const fg     = document.getElementById("bc-fg-color")?.value  || "#ffffff";
  const bcType = document.getElementById("bc-type")?.value || "promo";

  const bgAnim    = document.getElementById("bc-animation")?.value    || "none";
  const bgSpeed   = document.getElementById("bc-bg-speed")?.value     || "normal";
  const textAnim  = document.getElementById("bc-text-anim")?.value    || "none";
  const textSpeed = document.getElementById("bc-text-speed")?.value   || "normal";
  const effectColor = document.getElementById("bc-effect-color")?.value || "#ffffff";
  const intensity   = parseInt(document.getElementById("bc-effect-intensity")?.value || "25") / 100;
  const effectArea  = document.getElementById("bc-effect-area")?.value  || "inside";

  const showBeam  = effectArea === "inside"  || effectArea === "both";
  const showOuter = effectArea === "outside" || effectArea === "both" || effectArea === "edge-rim" || effectArea === "ambient" || effectArea === "bottom-line";

  const eHigh = bcHexToRgba(effectColor, intensity);
  const eLow  = bcHexToRgba(effectColor, intensity * 0.4);
  const eGlow = bcHexToRgba(effectColor, intensity * 1.9);

  // Use overflow:visible when outer glow needed so box-shadow is not clipped
  preview.style.cssText = [
    "border-radius:8px;height:52px",
    "display:flex;align-items:center;justify-content:center",
    "font-size:.87rem;font-family:var(--font-sans)",
    `overflow:${showOuter ? "visible" : "hidden"};position:relative;padding:0 2.5rem`,
    `background:${bg};color:${fg}`
  ].join(";");
  preview.querySelectorAll(".bc-prev-beam").forEach(e => e.remove());
  document.getElementById("bc-preview-css")?.remove();

  // ── Carousel vs normal content ────────────────────────────────────────────
  const isCarousel = bcType === "carousel";
  if (isCarousel) {
    const rawMsgs = (document.getElementById("bc-carousel-msgs")?.value || "").split("\n").map(s => s.trim()).filter(Boolean);
    const msgs = rawMsgs.length ? rawMsgs : ["Your carousel message here…"];
    let idx = parseInt(preview.dataset.carouselIdx || "0");
    if (idx >= msgs.length) idx = 0;
    preview.dataset.carouselIdx = idx;

    pvText.style.cssText = "position:relative;z-index:1;white-space:nowrap;text-align:center;";
    pvText.style.animation = "";
    pvText.textContent = msgs[idx].length > 80 ? msgs[idx].slice(0,80)+"…" : msgs[idx];

    preview.querySelectorAll(".bc-pv-arrow").forEach(e => e.remove());
    const arrowStyle = `position:absolute;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1rem;font-weight:700;color:${fg};opacity:.7;padding:.2rem .5rem;z-index:3;`;
    const prevBtn = document.createElement("button");
    prevBtn.className = "bc-pv-arrow"; prevBtn.style.cssText = arrowStyle + "left:.5rem;";
    prevBtn.textContent = "‹";
    prevBtn.onclick = () => { preview.dataset.carouselIdx = ((idx - 1 + msgs.length) % msgs.length); bcPreviewUpdate(); };
    const nextBtn = document.createElement("button");
    nextBtn.className = "bc-pv-arrow"; nextBtn.style.cssText = arrowStyle + "right:.5rem;";
    nextBtn.textContent = "›";
    nextBtn.onclick = () => { preview.dataset.carouselIdx = ((idx + 1) % msgs.length); bcPreviewUpdate(); };
    preview.appendChild(prevBtn);
    preview.appendChild(nextBtn);
    // No dot indicators
  } else {
    const msg = document.getElementById("bc-message")?.value.trim() || "Your message will appear here";
    preview.querySelectorAll(".bc-pv-arrow").forEach(e => e.remove());
    pvText.style.cssText = "position:relative;z-index:1;white-space:nowrap;";
    pvText.style.animation = "";
    pvText.textContent = msg.length > 80 ? msg.slice(0, 80) + "…" : msg;
  }

  // ── Animation durations ───────────────────────────────────────────────────
  const bgMult  = BC_SPEEDS[bgSpeed]   || 1;
  const txtMult = BC_SPEEDS[textSpeed] || 1;
  const bgDur   = ((BC_BG_DUR[bgAnim]    || 2)   * bgMult).toFixed(2);
  const txtDur  = ((BC_TEXT_DUR[textAnim]|| 4.5) * txtMult).toFixed(2);

  // ── CSS keyframes ─────────────────────────────────────────────────────────
  const css = `
    @keyframes bcpv-shimmer  { from{transform:translateX(-120%)} to{transform:translateX(300%)} }
    @keyframes bcpv-glass    { from{transform:translateX(-120%) skewX(-12deg)} to{transform:translateX(300%) skewX(-12deg)} }
    @keyframes bcpv-gglow    {
      0%,100%{box-shadow:0 2px 10px 2px rgba(212,175,55,.45),0 -2px 10px 2px rgba(212,175,55,.45),2px 0 10px 2px rgba(212,175,55,.45),-2px 0 10px 2px rgba(212,175,55,.45),inset 0 0 10px rgba(212,175,55,.12)}
      50%{box-shadow:0 3px 26px 8px rgba(212,175,55,.9),0 -3px 26px 8px rgba(212,175,55,.9),3px 0 26px 8px rgba(212,175,55,.9),-3px 0 26px 8px rgba(212,175,55,.9),inset 0 0 26px rgba(212,175,55,.3)}
    }
    @keyframes bcpv-neon     { 0%,100%{filter:brightness(1) saturate(1);opacity:1} 50%{filter:brightness(1.45) saturate(1.4);opacity:.88} }
    @keyframes bcpv-ticker   { from{left:101%} to{left:-101%} }
    @keyframes bcpv-tickerr  { from{left:-101%} to{left:101%} }
    @keyframes bcpv-slidel   { 0%,8%{transform:translateX(-120%);opacity:0} 18%,78%{transform:translateX(0);opacity:1} 90%,100%{transform:translateX(120%);opacity:0} }
    @keyframes bcpv-slider   { 0%,8%{transform:translateX(120%);opacity:0}  18%,78%{transform:translateX(0);opacity:1} 90%,100%{transform:translateX(-120%);opacity:0} }
    @keyframes bcpv-slidet   { 0%,8%{transform:translateY(-180%);opacity:0} 18%,78%{transform:translateY(0);opacity:1} 90%,100%{transform:translateY(180%);opacity:0} }
    @keyframes bcpv-slideb   { 0%,8%{transform:translateY(180%);opacity:0}  18%,78%{transform:translateY(0);opacity:1} 90%,100%{transform:translateY(-180%);opacity:0} }
    @keyframes bcpv-fade     { 0%,8%{opacity:0} 18%,78%{opacity:1} 90%,100%{opacity:0} }
    @keyframes bcpv-bounce   { 0%,8%{transform:translateY(-200%) scale(.5);opacity:0} 20%{transform:translateY(12%) scale(1.08)} 28%,78%{transform:translateY(0) scale(1);opacity:1} 90%,100%{transform:scale(.4);opacity:0} }
    @keyframes bcpv-flip     { 0%,8%{transform:rotateX(-90deg);opacity:0} 20%,78%{transform:rotateX(0);opacity:1} 90%,100%{transform:rotateX(90deg);opacity:0} }
    @keyframes bcpv-blink    { 0%,49%{opacity:1} 50%,99%{opacity:0} }
  `;
  const styleEl = document.createElement("style");
  styleEl.id = "bc-preview-css";
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Background animation — applies to carousel AND normal ─────────────────
  const addBeam = (beamCss) => {
    const beam = document.createElement("span");
    beam.className = "bc-prev-beam";
    if (showOuter) {
      // Wrap in overflow:hidden container so beam stays within bounds
      // while outer box-shadow can show freely
      const wrap = document.createElement("div");
      wrap.className = "bc-prev-beam";
      wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;border-radius:inherit;";
      beam.style.cssText = beamCss;
      wrap.appendChild(beam);
      preview.appendChild(wrap);
    } else {
      beam.style.cssText = beamCss + "z-index:2;";
      preview.appendChild(beam);
    }
  };

  if (bgAnim === "shimmer" || bgAnim === "shimmer-fast") {
    if (showBeam) addBeam(`position:absolute;top:0;width:42%;height:100%;pointer-events:none;background:linear-gradient(90deg,transparent,${eHigh},transparent);animation:bcpv-shimmer ${bgDur}s ease-in-out infinite;`);
    if (showOuter) preview.style.boxShadow = `0 0 22px 7px ${eGlow}`;
  } else if (bgAnim === "glass") {
    if (showBeam) addBeam(`position:absolute;top:0;width:42%;height:100%;pointer-events:none;background:linear-gradient(105deg,transparent 35%,${eHigh} 48%,${eLow} 55%,transparent 68%);transform:skewX(-10deg);animation:bcpv-glass ${bgDur}s ease-in-out infinite 1s;`);
    if (showOuter) preview.style.boxShadow = `0 0 22px 7px ${eGlow}`;
  } else if (bgAnim === "golden-glow") {
    const gc  = bcHexToRgba(effectColor, intensity * 0.85);
    const gc2 = bcHexToRgba(effectColor, intensity * 0.35);
    const css2 = `@keyframes bcpv-gglow2{0%,100%{box-shadow:0 2px 12px 3px ${gc2},0 -2px 12px 3px ${gc2},2px 0 12px 3px ${gc2},-2px 0 12px 3px ${gc2},inset 0 0 12px ${eLow}}50%{box-shadow:0 4px 30px 10px ${gc},0 -4px 30px 10px ${gc},4px 0 30px 10px ${gc},-4px 0 30px 10px ${gc},inset 0 0 30px ${eHigh}}}`;
    document.getElementById("bc-preview-css").textContent += css2;
    preview.style.animation = `bcpv-gglow2 ${bgDur}s ease-in-out infinite`;
    if (!showOuter) preview.style.clipPath = "inset(0)";
  } else if (bgAnim === "neon") {
    preview.style.animation = `bcpv-neon ${bgDur}s ease-in-out infinite`;
    if (showOuter) preview.style.boxShadow = `0 0 26px 8px ${eGlow}`;
  }

  // ── Premium effect area styles ────────────────────────────────────────────
  if (effectArea === "edge-rim") {
    const css3 = `@keyframes bcpv-rim{0%,100%{box-shadow:0 0 0 1.5px ${eHigh},inset 0 0 0 1.5px ${eLow},0 0 10px 3px ${eGlow}}50%{box-shadow:0 0 0 2px ${eGlow},inset 0 0 0 1.5px ${eHigh},0 0 20px 8px ${eGlow}}}`;
    document.getElementById("bc-preview-css").textContent += css3;
    const prev = preview.style.animation;
    preview.style.animation = prev ? `${prev},bcpv-rim ${bgDur}s ease-in-out infinite` : `bcpv-rim ${bgDur}s ease-in-out infinite`;
  } else if (effectArea === "bottom-line") {
    const css3 = `@keyframes bcpv-bline{0%,100%{opacity:.5;left:20%;right:20%}50%{opacity:1;left:4%;right:4%}}`;
    document.getElementById("bc-preview-css").textContent += css3;
    const line = document.createElement("div");
    line.className = "bc-prev-beam";
    line.style.cssText = `position:absolute;bottom:0;left:4%;right:4%;height:2px;border-radius:99px;background:${eHigh};box-shadow:0 0 8px 3px ${eGlow},0 0 14px 5px ${bcHexToRgba(effectColor,intensity*0.45)};pointer-events:none;z-index:4;animation:bcpv-bline ${bgDur}s ease-in-out infinite;`;
    preview.appendChild(line);
  } else if (effectArea === "ambient") {
    const a1 = bcHexToRgba(effectColor, Math.min(intensity * 1.4, 0.92));
    const a2 = bcHexToRgba(effectColor, intensity * 0.6);
    const a3 = bcHexToRgba(effectColor, intensity * 0.22);
    const css3 = `@keyframes bcpv-ambient{0%,100%{box-shadow:0 0 16px 5px ${a2},0 0 34px 12px ${a3},inset 0 0 16px ${bcHexToRgba(effectColor,intensity*0.1)}}50%{box-shadow:0 0 28px 10px ${a1},0 0 52px 20px ${a2},inset 0 0 28px ${bcHexToRgba(effectColor,intensity*0.2)}}}`;
    document.getElementById("bc-preview-css").textContent += css3;
    const prev = preview.style.animation;
    preview.style.animation = prev ? `${prev},bcpv-ambient ${bgDur}s ease-in-out infinite` : `bcpv-ambient ${bgDur}s ease-in-out infinite`;
  }

  // ── Text animation — carousel has its own fade, skip ─────────────────────
  if (!isCarousel) {
    const TANIM_MAP = {
      "slide-left": "bcpv-slidel", "slide-right": "bcpv-slider",
      "slide-top":  "bcpv-slidet", "slide-bottom": "bcpv-slideb",
      fade: "bcpv-fade", bounce: "bcpv-bounce", flip: "bcpv-flip", blink: "bcpv-blink"
    };
    if (textAnim === "ticker" || textAnim === "ticker-r") {
      pvText.style.cssText = "position:absolute;white-space:nowrap;z-index:1;";
      pvText.style.animation = `${textAnim === "ticker" ? "bcpv-ticker" : "bcpv-tickerr"} ${txtDur}s linear infinite`;
    } else if (TANIM_MAP[textAnim]) {
      pvText.style.cssText = "position:relative;z-index:1;white-space:nowrap;";
      pvText.style.animation = `${TANIM_MAP[textAnim]} ${txtDur}s ease-in-out infinite`;
    }
  }
}

async function fetchBroadcast() {
  try {
    const snap = await getDoc(doc(db, "settings", "broadcast"));
    broadcastData = snap.exists() ? snap.data() : { enabled: false };
  } catch (e) { console.error("fetchBroadcast:", e); }
}

function updateBroadcastBadge() {
  const badge = document.getElementById("nav-broadcast-badge");
  const liveBadge = document.getElementById("broadcast-live-badge");
  const on = !!broadcastData.enabled;
  if (badge) badge.style.display = on ? "" : "none";
  if (liveBadge) liveBadge.style.display = on ? "" : "none";
}

function bcToggleCarouselRow() {
  const isCarousel = document.getElementById("bc-type").value === "carousel";
  document.getElementById("bc-message-row").style.display  = isCarousel ? "none" : "";
  document.getElementById("bc-carousel-row").style.display = isCarousel ? "" : "none";
}

function renderBroadcastForm() {
  document.getElementById("bc-enabled").checked        = !!broadcastData.enabled;
  document.getElementById("bc-message").value           = broadcastData.message       || "";
  document.getElementById("bc-type").value              = broadcastData.type          || "promo";
  document.getElementById("bc-animation").value         = broadcastData.animation     || "none";
  document.getElementById("bc-bg-speed").value          = broadcastData.bgSpeed       || "normal";
  document.getElementById("bc-text-anim").value         = broadcastData.textAnim      || "none";
  document.getElementById("bc-text-speed").value        = broadcastData.textSpeed     || "normal";
  // Intensity: support legacy string ("normal","high"…) and new number (1-100)
  const _legacyIntMap = { low: 10, normal: 25, high: 42, max: 65 };
  const _rawInt = broadcastData.effectIntensity;
  const _intNum = typeof _rawInt === "number" ? _rawInt : (_legacyIntMap[_rawInt] || 25);
  document.getElementById("bc-effect-intensity").value     = String(_intNum);
  document.getElementById("bc-effect-intensity-num").value = String(_intNum);
  document.getElementById("bc-effect-area").value          = broadcastData.effectArea    || "inside";
  document.getElementById("bc-dismissible").value          = broadcastData.dismissible === false ? "0" : "1";
  document.getElementById("bc-link").value              = broadcastData.link          || "";
  document.getElementById("bc-link-text").value         = broadcastData.linkText      || "";
  // Carousel messages + interval
  const carouselMsgs = Array.isArray(broadcastData.carouselMessages) ? broadcastData.carouselMessages : [];
  document.getElementById("bc-carousel-msgs").value = carouselMsgs.join("\n");
  document.getElementById("bc-carousel-interval").value = String(broadcastData.carouselInterval ?? 4);
  bcToggleCarouselRow();
  // Effect color
  const efCol = broadcastData.effectColor || "#ffffff";
  document.getElementById("bc-effect-color").value = efCol;
  document.getElementById("bc-effect-hex").value   = efCol;

  const preset = BC_PRESETS[broadcastData.type] || BC_PRESETS.promo;
  bcSetColors(broadcastData.bgColor || preset.bg, broadcastData.fgColor || preset.fg);
  bcPreviewUpdate();

  updateBroadcastBadge();
  document.getElementById("bc-enabled").onchange   = updateBroadcastBadge;
  document.getElementById("save-broadcast").onclick = saveBroadcast;

  // Any change → refresh preview
  ["bc-message","bc-animation","bc-bg-speed","bc-text-anim","bc-text-speed","bc-effect-area"].forEach(id => {
    document.getElementById(id).oninput  = bcPreviewUpdate;
    document.getElementById(id).onchange = bcPreviewUpdate;
  });
  document.getElementById("bc-carousel-msgs").oninput = bcPreviewUpdate;

  // Intensity range ↔ number sync
  const _iRange = document.getElementById("bc-effect-intensity");
  const _iNum   = document.getElementById("bc-effect-intensity-num");
  _iRange.oninput = () => { _iNum.value = _iRange.value; bcPreviewUpdate(); };
  _iNum.oninput   = () => {
    const v = Math.max(1, Math.min(100, parseInt(_iNum.value) || 25));
    _iNum.value = String(v); _iRange.value = String(v); bcPreviewUpdate();
  };

  const efColorEl = document.getElementById("bc-effect-color");
  const efHexEl   = document.getElementById("bc-effect-hex");
  efColorEl.oninput = () => { efHexEl.value = efColorEl.value; bcPreviewUpdate(); };
  efHexEl.oninput   = () => { if (/^#[0-9A-Fa-f]{6}$/.test(efHexEl.value)) { efColorEl.value = efHexEl.value; bcPreviewUpdate(); } };

  // Preset style → auto-fill colors + toggle carousel row
  document.getElementById("bc-type").onchange = () => {
    const t = document.getElementById("bc-type").value;
    if (t !== "custom") { const p = BC_PRESETS[t] || BC_PRESETS.promo; bcSetColors(p.bg, p.fg); }
    bcToggleCarouselRow();
    bcPreviewUpdate();
  };

  const bgColor = document.getElementById("bc-bg-color");
  const fgColor = document.getElementById("bc-fg-color");
  const bgHex   = document.getElementById("bc-bg-hex");
  const fgHex   = document.getElementById("bc-fg-hex");

  bgColor.oninput = () => { bgHex.value = bgColor.value; document.getElementById("bc-type").value = "custom"; bcPreviewUpdate(); };
  fgColor.oninput = () => { fgHex.value = fgColor.value; bcPreviewUpdate(); };
  bgHex.oninput   = () => { if (/^#[0-9A-Fa-f]{6}$/.test(bgHex.value)) { bgColor.value = bgHex.value; bcPreviewUpdate(); } };
  fgHex.oninput   = () => { if (/^#[0-9A-Fa-f]{6}$/.test(fgHex.value)) { fgColor.value = fgHex.value; bcPreviewUpdate(); } };
}

async function saveBroadcast() {
  const btn = document.getElementById("save-broadcast");
  const status = document.getElementById("bc-save-status");
  const bcType = document.getElementById("bc-type").value;
  const carouselMessages = bcType === "carousel"
    ? document.getElementById("bc-carousel-msgs").value.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 10)
    : [];
  const data = {
    enabled:   document.getElementById("bc-enabled").checked,
    message:   document.getElementById("bc-message").value.trim(),
    type:      bcType,
    carouselMessages,
    animation:       document.getElementById("bc-animation").value,
    bgSpeed:         document.getElementById("bc-bg-speed").value,
    textAnim:        document.getElementById("bc-text-anim").value,
    textSpeed:       document.getElementById("bc-text-speed").value,
    effectColor:     document.getElementById("bc-effect-color").value,
    effectIntensity: parseInt(document.getElementById("bc-effect-intensity").value) || 25,
    effectArea:      document.getElementById("bc-effect-area").value,
    dismissible:     document.getElementById("bc-dismissible").value !== "0",
    carouselInterval: parseInt(document.getElementById("bc-carousel-interval").value) || 4,
    bgColor:         document.getElementById("bc-bg-color").value,
    fgColor:         document.getElementById("bc-fg-color").value,
    link:      document.getElementById("bc-link").value.trim(),
    linkText:  document.getElementById("bc-link-text").value.trim(),
    updatedAt: serverTimestamp()
  };
  btn.disabled = true; btn.innerHTML = `<ion-icon name="hourglass-outline"></ion-icon> Saving…`;
  try {
    await setDoc(doc(db, "settings", "broadcast"), data);
    broadcastData = { ...data };
    updateBroadcastBadge();
    if (status) { status.textContent = "✓ Saved"; setTimeout(() => { status.textContent = ""; }, 3000); }
    adminToast(`Broadcast ${data.enabled ? "is now LIVE 📢" : "turned off."}`);
  } catch (err) { alert("Failed: " + (err.code || err.message)); }
  finally { btn.disabled = false; btn.innerHTML = `<ion-icon name="save-outline"></ion-icon> Save Broadcast`; }
}

/* ---- Messages ---------------------------------------------------------- */
async function fetchMessages() {
  try {
    const snap = await getDocs(query(collection(db, "messages"), limit(200)));
    messages = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.sentAt?.seconds || 0) - (a.sentAt?.seconds || 0));
    const unread = messages.filter(m => !m.read).length;
    const badge = $("#nav-messages-badge");
    if (badge) { badge.textContent = unread; badge.style.display = unread ? "" : "none"; }
    const label = $("#messages-count-label");
    if (label) label.textContent = `${messages.length} message${messages.length !== 1 ? "s" : ""}${unread ? ` · ${unread} unread` : ""}`;
    updateNotifications();
  } catch (e) { console.error("fetchMessages:", e); }
}

function renderMessagesTable() {
  const tbody = $("#message-rows");
  if (!tbody) return;
  if (!messages.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted-note" style="padding:2rem;text-align:center;">No messages yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = messages.map(m => {
    const date = m.sentAt?.toDate ? (() => { const d = m.sentAt.toDate(); return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }); })() : "";
    const rowStyle = m.read ? "" : "background:var(--accent-color);font-weight:500;";
    return `<tr style="${rowStyle}">
      <td>${escapeHtml(m.name || "")}</td>
      <td><a href="mailto:${escapeHtml(m.email || "")}" style="color:var(--primary-color);">${escapeHtml(m.email || "")}</a></td>
      <td>${escapeHtml(m.subject || "")}</td>
      <td style="max-width:260px;white-space:normal;font-size:.85rem;">${escapeHtml(m.message || "")}</td>
      <td style="white-space:nowrap;">${date}</td>
      <td>${m.read ? `<span style="color:var(--text-muted);font-size:.8rem;">Read</span>` : `<span style="color:#1a56b8;font-size:.8rem;">New</span>`}</td>
      <td style="white-space:nowrap;">
        ${!m.read ? `<button class="qa-btn" data-msg-read="${m.id}" title="Mark as read"><ion-icon name="checkmark-outline"></ion-icon></button>` : ""}
        <button class="qa-btn" style="color:#9b2226;" data-msg-del="${m.id}" title="Delete"><ion-icon name="trash-outline"></ion-icon></button>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-msg-read]").forEach(b => b.addEventListener("click", async () => {
    const id = b.dataset.msgRead;
    await updateDoc(doc(db, "messages", id), { read: true });
    const msg = messages.find(m => m.id === id);
    if (msg) msg.read = true;
    renderMessagesTable();
    fetchMessages(); // refresh badge/count
  }));
  tbody.querySelectorAll("[data-msg-del]").forEach(b => b.addEventListener("click", async () => {
    if (!await zahrounConfirm("Delete this message? This action cannot be undone.", { title: "Delete Message", ok: "Delete", danger: true })) return;
    await deleteDoc(doc(db, "messages", b.dataset.msgDel));
    messages = messages.filter(m => m.id !== b.dataset.msgDel);
    renderMessagesTable();
    fetchMessages();
  }));
}

/* ---- Settings ---------------------------------------------------------- */
/* ---- Admins --------------------------------------------------------------- */
async function loadAdminsSection() {
  const listEl = document.getElementById("admins-list");
  if (!listEl) return;
  listEl.innerHTML = `<p class="muted-note">Loading…</p>`;
  try {
    const snap = await getDocs(query(collection(db, "users"), where("role", "==", "admin")));
    const admins = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
    if (!admins.length) {
      listEl.innerHTML = `<p class="muted-note">No admin users found.</p>`;
      return;
    }
    listEl.innerHTML = `<table class="data-table" style="width:100%;">
      <thead><tr><th>Name</th><th>Email</th><th>Joined</th><th></th></tr></thead>
      <tbody>${admins.map(a => `<tr>
        <td>${escapeHtml(a.name || "—")}</td>
        <td>${escapeHtml(a.email || "—")}</td>
        <td class="muted-note">${fmtDate(a.createdAt)}</td>
        <td><button class="btn-outline" style="font-size:.78rem;padding:.25rem .6rem;color:#e63946;border-color:#e63946;" onclick="window._revokeAdmin('${escapeHtml(a.docId)}','${escapeHtml(a.email||'')}')">Revoke</button></td>
      </tr>`).join("")}</tbody>
    </table>`;
  } catch (e) {
    listEl.innerHTML = `<p class="muted-note" style="color:#e63946;">Error loading admins.</p>`;
  }
}

window._revokeAdmin = async function(uid, email) {
  if (!await zahrounConfirm(`Remove admin access from ${email}? They will no longer be able to access the admin panel.`, { title: "Revoke Admin Access", ok: "Revoke", danger: true })) return;
  try {
    await updateDoc(doc(db, "users", uid), { role: "customer" });
    adminToast("Admin access removed.");
    loadAdminsSection();
  } catch (e) { adminToast("Failed: " + (e.code || e.message), false); }
};

window._grantAdmin = async function() {
  const emailInput = document.getElementById("admin-grant-email");
  const msgEl = document.getElementById("admin-grant-msg");
  const email = (emailInput.value || "").trim();
  if (!email) { msgEl.textContent = "Please enter an email."; msgEl.style.color = "#e63946"; return; }
  msgEl.textContent = "Searching…"; msgEl.style.color = "var(--text-muted)";
  try {
    const snap = await getDocs(query(collection(db, "users"), where("email", "==", email)));
    if (snap.empty) { msgEl.textContent = "No account found with this email."; msgEl.style.color = "#e63946"; return; }
    const userDoc = snap.docs[0];
    if (userDoc.data().role === "admin") { msgEl.textContent = "This user is already an admin."; msgEl.style.color = "var(--text-muted)"; return; }
    await updateDoc(doc(db, "users", userDoc.id), { role: "admin" });
    msgEl.textContent = `Admin access granted to ${email}.`;
    msgEl.style.color = "#1e7e34";
    emailInput.value = "";
    loadAdminsSection();
  } catch (e) { msgEl.textContent = "Error: " + (e.code || e.message); msgEl.style.color = "#e63946"; }
};

function renderSettingsForm() {
  const f = $("#settings-form");
  if (!f) return;
  f.querySelector("[name=whatsapp]").value = settings.whatsapp || "";
  f.querySelector("[name=contactEmail]").value = settings.contactEmail || "";
  f.querySelector("[name=announcement]").value = settings.announcement || "";
  f.querySelector("[name=announcementActive]").checked = !!settings.announcementActive;
  f.querySelector("[name=heroTitle]").value = settings.heroTitle || "";
  f.querySelector("[name=heroSubtitle]").value = settings.heroSubtitle || "";
  f.querySelector("[name=deliveryDhaka]").value = settings.deliveryDhaka ?? 60;
  f.querySelector("[name=deliveryOutside]").value = settings.deliveryOutside ?? 120;
  f.querySelector("[name=freeDeliveryThreshold]").value = settings.freeDeliveryThreshold ?? 0;
  f.querySelector("[name=reviewsEnabled]").checked = settings.reviewsEnabled !== false;
}

async function saveSettings(e) {
  e.preventDefault();
  const f = e.target;
  const btn = $("#settings-save");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const data = {
      whatsapp: f.querySelector("[name=whatsapp]").value.trim(),
      contactEmail: f.querySelector("[name=contactEmail]").value.trim(),
      announcement: f.querySelector("[name=announcement]").value.trim(),
      announcementActive: f.querySelector("[name=announcementActive]").checked,
      heroTitle: f.querySelector("[name=heroTitle]").value.trim(),
      heroSubtitle: f.querySelector("[name=heroSubtitle]").value.trim(),
      deliveryDhaka: parseInt(f.querySelector("[name=deliveryDhaka]").value) || 60,
      deliveryOutside: parseInt(f.querySelector("[name=deliveryOutside]").value) || 120,
      freeDeliveryThreshold: parseInt(f.querySelector("[name=freeDeliveryThreshold]").value) || 0,
      reviewsEnabled: f.querySelector("[name=reviewsEnabled]").checked,
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, "settings", "store"), data, { merge: true });
    Object.assign(settings, data);
    adminToast("Settings saved.");
  } catch (err) { alert("Failed: " + (err.code || err.message)); }
  finally { btn.disabled = false; btn.textContent = "Save Settings"; }
}

/* ---- Products: form ---------------------------------------------------- */
function openForm(product) {
  editing = product || null;
  const f = $("#product-form");
  f.reset();
  $("#product-form-title").textContent = product ? "Edit Product" : "Add Product";
  galleryImages = product?.images ? [...product.images] : (product?.image ? [product.image] : []);
  f.image.value = galleryImages[0] || "";
  sizeImagesMap = product?.sizeImages ? { ...product.sizeImages } : { "6ML": "", "15ML": "", "30ML": "", "50ML": "" };
  renderGalleryThumbs();
  renderSizeImageGrid();
  document.getElementById("img-status").textContent = "";
  if (product) {
    f.id.value = product.id;
    f.name.value = product.name || "";
    f.category.value = product.category || "Men";
    f.description.value = product.description || "";
    f.ingredients.value = product.ingredients || "";
    const pr = product.prices || {};
    f.price6.value = pr["6ML"] || ""; f.price15.value = pr["15ML"] || ""; f.price30.value = pr["30ML"] || ""; f.price50.value = pr["50ML"] || product.price || "";
    f.stock.value = product.stock ?? 100;
    f.concentration.value = product.tags?.concentration || "";
    f.gender.value = product.tags?.gender || "";
    f.type.value = product.tags?.type || "";
    f.fragrance_notes.value = (product.fragrance_notes || []).join(", ");
    f.seasons.value = (product.seasons || []).join(", ");
    f.occasions.value = (product.occasions || []).join(", ");
    f.featured.checked = !!product.featured;
    f.bestseller.checked = !!product.bestseller;
    f.newArrival.checked = !!product.newArrival;
    f.hidden.checked = !!product.hidden;
    // Active sizes
    const activeSzs = product.activeSizes ?? SIZE_KEYS;
    SIZE_KEYS.forEach(sz => {
      const cb = document.getElementById(`sizeOn-${sz}`);
      const num = sz.replace("ML","");
      const inp = document.querySelector(`#product-form input[name="price${num}"]`);
      if (cb) cb.checked = activeSzs.includes(sz);
      if (inp) { inp.disabled = !activeSzs.includes(sz); inp.closest(".fg").style.opacity = activeSzs.includes(sz) ? "1" : "0.42"; }
    });
    // Product type & combo
    const pType = product.productType || "regular";
    document.getElementById("product-type-sel").value = pType;
    const isCombo = pType === "combo";
    document.getElementById("combo-items-row").style.display = isCombo ? "" : "none";
    document.getElementById("base-price-row").style.display  = isCombo ? "" : "none";
    document.querySelector('#product-form [name="comboItems"]').value = (product.comboItems || []).join("\n");
    document.querySelector('#product-form [name="basePrice"]').value  = product.basePrice || "";
  } else {
    f.id.value = "";
    // Reset size toggles to all active
    SIZE_KEYS.forEach(sz => {
      const cb = document.getElementById(`sizeOn-${sz}`);
      const num = sz.replace("ML","");
      const inp = document.querySelector(`#product-form input[name="price${num}"]`);
      if (cb) cb.checked = true;
      if (inp) { inp.disabled = false; inp.closest(".fg").style.opacity = "1"; }
    });
    document.getElementById("product-type-sel").value = "regular";
    document.getElementById("combo-items-row").style.display = "none";
    document.getElementById("base-price-row").style.display  = "none";
    document.querySelector('#product-form [name="comboItems"]').value = "";
    document.querySelector('#product-form [name="basePrice"]').value  = "";
  }
  $("#product-modal").classList.add("open");
}

function closeForm() { galleryImages = []; $("#product-modal").classList.remove("open"); }

async function handleMultiImageUpload(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const statusEl = document.getElementById("img-status");
  let uploaded = 0;
  for (const file of files) {
    let blob;
    try {
      blob = await openCropModal(file, { aspectRatio: 3 / 4 });
    } catch { e.target.value = ""; continue; }
    statusEl.textContent = `Uploading…`;
    try {
      const { url } = await uploadImage(blob, { onProgress: p => { statusEl.textContent = `Uploading ${p}%…`; } });
      galleryImages.unshift(url);
      uploaded++;
      renderGalleryThumbs();
    } catch (err) { statusEl.textContent = "⚠ " + err.message; break; }
  }
  document.getElementById("product-form").image.value = galleryImages[0] || "";
  if (uploaded > 0) statusEl.textContent = `✓ ${uploaded} image${uploaded > 1 ? "s" : ""} added.`;
  e.target.value = "";
}

function renderGalleryThumbs() {
  const el = document.getElementById("gallery-thumbs");
  if (!el) return;
  if (!galleryImages.length) {
    el.innerHTML = `<span class="muted-note" style="font-size:.78rem;line-height:2.5rem;">No images yet.</span>`;
    return;
  }
  el.innerHTML = galleryImages.map((url, i) => `
    <div class="gallery-thumb${i === 0 ? " is-main" : ""}" draggable="true" data-gi="${i}">
      <img src="${optimizedUrl(url, 120)}" alt="">
      <button type="button" class="th-del" data-gi="${i}" title="Remove">&times;</button>
    </div>`).join("");
  el.querySelectorAll(".th-del").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      galleryImages.splice(Number(btn.dataset.gi), 1);
      document.getElementById("product-form").image.value = galleryImages[0] || "";
      renderGalleryThumbs();
    });
  });
  el.querySelectorAll(".gallery-thumb").forEach(th => {
    th.addEventListener("dragstart", () => { galleryDragSrc = Number(th.dataset.gi); });
    th.addEventListener("dragover", e => { e.preventDefault(); th.style.outline = "2px solid var(--primary-color)"; });
    th.addEventListener("dragleave", () => { th.style.outline = ""; });
    th.addEventListener("drop", e => {
      e.preventDefault(); th.style.outline = "";
      const src = galleryDragSrc, dest = Number(th.dataset.gi);
      if (src === null || src === dest) return;
      const moved = galleryImages.splice(src, 1)[0];
      galleryImages.splice(dest, 0, moved);
      document.getElementById("product-form").image.value = galleryImages[0] || "";
      renderGalleryThumbs();
    });
    th.addEventListener("dragend", () => { el.querySelectorAll(".gallery-thumb").forEach(t => t.style.outline = ""); });
  });
}

function renderSizeImageGrid() {
  const grid = document.getElementById("size-img-grid");
  if (!grid) return;
  grid.innerHTML = SIZE_KEYS.map(size => {
    const url = sizeImagesMap[size] || "";
    const thumb = url
      ? `<img src="${optimizedUrl(url, 120)}" style="width:100%;height:100%;object-fit:contain;">`
      : `<ion-icon name="image-outline" style="font-size:1.6rem;color:#bbb;"></ion-icon>`;
    const clearBtn = url
      ? `<button type="button" class="si-clear" data-size="${size}" style="font-size:.7rem;color:#9b2226;background:none;border:none;cursor:pointer;margin-top:.2rem;">✕ Remove</button>`
      : "";
    return `
      <div style="text-align:center;">
        <div style="font-size:.78rem;font-weight:600;margin-bottom:.35rem;color:var(--text-main);">${size}</div>
        <div style="width:100%;aspect-ratio:3/4;border:1px solid var(--border-color);border-radius:6px;overflow:hidden;background:var(--surface-color);display:flex;align-items:center;justify-content:center;margin-bottom:.35rem;">
          ${thumb}
        </div>
        <label class="btn btn-outline" style="font-size:.72rem;padding:.3rem .55rem;cursor:pointer;display:inline-block;" for="si-file-${size}">Upload</label>
        <input type="file" id="si-file-${size}" accept="image/*" data-size="${size}" style="display:none;" class="si-file-input">
        ${clearBtn}
      </div>`;
  }).join("");
  grid.querySelectorAll(".si-file-input").forEach(input => {
    input.addEventListener("change", handleSizeImageUpload);
  });
  grid.querySelectorAll(".si-clear").forEach(btn => {
    btn.addEventListener("click", () => {
      sizeImagesMap[btn.dataset.size] = "";
      renderSizeImageGrid();
    });
  });
}

async function handleSizeImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const size = e.target.dataset.size;
  let blob;
  try { blob = await openCropModal(file); } catch { e.target.value = ""; return; }
  const statusEl = document.getElementById("img-status");
  statusEl.textContent = `Uploading ${size}…`;
  try {
    const { url } = await uploadImage(blob, { onProgress: p => { statusEl.textContent = `Uploading ${size} ${p}%…`; } });
    sizeImagesMap[size] = url;
    renderSizeImageGrid();
    statusEl.textContent = `✓ ${size} image updated.`;
  } catch (err) { statusEl.textContent = "⚠ " + err.message; }
  e.target.value = "";
}

function csv(v) { return v.split(",").map(s => s.trim()).filter(Boolean); }
function numOrNull(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }

async function saveProduct(e) {
  e.preventDefault();
  const f = e.target;
  const saveBtn = $("#save-product");
  saveBtn.disabled = true; saveBtn.textContent = "Saving…";
  let id = numOrNull(f.id.value);
  const isNew = id === null;
  if (isNew) id = (products.reduce((m, p) => Math.max(m, p.id), 0) || 0) + 1;
  const price50 = numOrNull(f.price50.value) || 0;
  const prices = {};
  [["6ML", f.price6.value], ["15ML", f.price15.value], ["30ML", f.price30.value], ["50ML", f.price50.value]]
    .forEach(([k, v]) => { const n = numOrNull(v); if (n !== null) prices[k] = n; });
  const image = galleryImages[0] || "";
  const images = [...galleryImages];
  const sizeImages = {};
  SIZE_KEYS.forEach(k => { sizeImages[k] = sizeImagesMap[k] || image; });
  const data = {
    id, name: f.name.value.trim(), category: f.category.value, price: price50, prices, image, images, sizeImages: sizeImages || {},
    description: f.description.value.trim(), ingredients: f.ingredients.value.trim(),
    tags: { gender: f.gender.value.trim(), type: f.type.value.trim(), concentration: f.concentration.value.trim() },
    fragrance_notes: csv(f.fragrance_notes.value), seasons: csv(f.seasons.value), occasions: csv(f.occasions.value),
    stock: numOrNull(f.stock.value) ?? 0,
    featured: f.featured.checked, bestseller: f.bestseller.checked, newArrival: f.newArrival.checked, hidden: f.hidden.checked,
    activeSizes: SIZE_KEYS.filter(sz => { const cb = document.getElementById(`sizeOn-${sz}`); return !cb || cb.checked; }),
    productType: document.getElementById("product-type-sel")?.value || "regular",
    comboItems: (document.querySelector('#product-form [name="comboItems"]')?.value || "").split("\n").map(s => s.trim()).filter(Boolean),
    basePrice: numOrNull(document.querySelector('#product-form [name="basePrice"]')?.value) || 0,
    updatedAt: serverTimestamp()
  };
  if (isNew) data.createdAt = serverTimestamp();
  try {
    await setDoc(doc(db, "products", String(id)), data, { merge: true });
    closeForm();
    await fetchProducts();
    renderProductTable();
    renderDashboard();
    updateNotifications();
  } catch (err) { alert("Save failed: " + (err.code || err.message)); }
  finally { saveBtn.disabled = false; saveBtn.textContent = "Save Product"; }
}

async function deleteProduct(id) {
  const p = products.find(x => x.id === id);
  if (!await zahrounConfirm(`Delete "${p ? p.name : id}"? This cannot be undone.`, { title: "Delete Product", ok: "Delete", danger: true })) return;
  try { await deleteDoc(doc(db, "products", String(id))); await fetchProducts(); renderProductTable(); renderDashboard(); updateNotifications(); }
  catch (err) { alert("Delete failed: " + (err.code || err.message)); }
}

/* ---- Inventory management --------------------------------------------- */
async function deductOrderStock(order) {
  if (!order || order.stockDeducted) return;
  const changes = [];
  for (const item of (order.items || [])) {
    const product = products.find(p => String(p.id) === String(item.id));
    if (product && product.stock !== undefined && product.stock !== null) {
      const before = product.stock;
      const after = Math.max(0, before - (item.quantity || 1));
      changes.push({ product, item, before, after });
    }
  }
  if (!changes.length) return;
  await Promise.all(changes.map(c => updateDoc(doc(db, "products", String(c.product.id)), { stock: c.after })));
  changes.forEach(c => { c.product.stock = c.after; });
  await updateDoc(doc(db, "orders", order.id), { stockDeducted: true });
  order.stockDeducted = true;
  logStockHistory(changes, order.id, "deduct").catch(() => {});
  renderProductTable();
  updateNotifications();
  adminToast("Stock updated — order confirmed.");
}

async function restoreOrderStock(order) {
  if (!order || !order.stockDeducted) return;
  const changes = [];
  for (const item of (order.items || [])) {
    const product = products.find(p => String(p.id) === String(item.id));
    if (product && product.stock !== undefined && product.stock !== null) {
      const before = product.stock;
      const after = before + (item.quantity || 1);
      changes.push({ product, item, before, after });
    }
  }
  if (!changes.length) return;
  await Promise.all(changes.map(c => updateDoc(doc(db, "products", String(c.product.id)), { stock: c.after })));
  changes.forEach(c => { c.product.stock = c.after; });
  await updateDoc(doc(db, "orders", order.id), { stockDeducted: false });
  order.stockDeducted = false;
  logStockHistory(changes, order.id, "restore").catch(() => {});
  renderProductTable();
  updateNotifications();
  adminToast("Stock restored — order cancelled.");
}

async function logStockHistory(changes, orderId, type) {
  try {
    await Promise.all(changes.map(c => addDoc(collection(db, "stockHistory"), {
      productId: String(c.product.id),
      productName: c.product.name || "",
      type,
      qty: c.item.quantity || 1,
      stockBefore: c.before,
      stockAfter: c.after,
      orderId,
      timestamp: serverTimestamp()
    })));
  } catch (e) { console.warn("stockHistory:", e); }
}

function renderStockAlerts() {
  const el = document.getElementById("stock-alerts");
  if (!el) return;
  const outOfStock = products.filter(p => p.stock !== undefined && p.stock !== null && p.stock === 0);
  const lowStock = products.filter(p => p.stock !== undefined && p.stock !== null && p.stock > 0 && p.stock < 10);
  // Update Products nav badge
  const stockBadge = document.getElementById("nav-stock-badge");
  if (stockBadge) {
    const total = outOfStock.length + lowStock.length;
    stockBadge.textContent = total || "";
    stockBadge.style.display = total ? "" : "none";
  }
  if (!outOfStock.length && !lowStock.length) { el.innerHTML = ""; return; }
  const parts = [];
  if (outOfStock.length) parts.push(`<strong>${outOfStock.length} out of stock</strong>: ${outOfStock.slice(0, 3).map(p => escapeHtml(p.name)).join(", ")}${outOfStock.length > 3 ? "…" : ""}`);
  if (lowStock.length) parts.push(`<strong>${lowStock.length} low stock</strong>: ${lowStock.slice(0, 3).map(p => `${escapeHtml(p.name)} (${p.stock})`).join(", ")}${lowStock.length > 3 ? "…" : ""}`);
  el.innerHTML = `<div style="background:#fef3cd;border:1px solid #ffc107;border-radius:10px;padding:.85rem 1.1rem;display:flex;align-items:center;gap:.75rem;font-size:.85rem;color:#856404;">
    <ion-icon name="warning-outline" style="font-size:1.4rem;flex-shrink:0;color:#b8860b;"></ion-icon>
    <div style="flex:1;">${parts.join(" &nbsp;·&nbsp; ")}</div>
    <button id="stock-alert-goto" class="link-btn" style="white-space:nowrap;flex-shrink:0;">View Products →</button>
  </div>`;
  document.getElementById("stock-alert-goto")?.addEventListener("click", () => {
    switchSection("products");
    setTimeout(() => {
      const lowBtn = document.querySelector(".pf-flag-btn[data-flag='lowstock']");
      if (lowBtn && !lowBtn.classList.contains("active")) lowBtn.click();
    }, 100);
  });
}

function checkDailyStockAlert() {
  const today = new Date().toDateString();
  if (localStorage.getItem("zStockAlertDay") === today) return;
  const outOfStock = products.filter(p => p.stock !== undefined && p.stock !== null && p.stock === 0);
  const lowStock   = products.filter(p => p.stock !== undefined && p.stock !== null && p.stock > 0 && p.stock < 10);
  if (!outOfStock.length && !lowStock.length) return;
  localStorage.setItem("zStockAlertDay", today);
  const parts = [];
  if (outOfStock.length) parts.push(`${outOfStock.length} out of stock`);
  if (lowStock.length) parts.push(`${lowStock.length} low stock`);
  let t = document.getElementById("daily-stock-toast");
  if (t) t.remove();
  t = document.createElement("div");
  t.id = "daily-stock-toast";
  t.style.cssText = "position:fixed;top:1.25rem;right:1.25rem;background:#fff;border:1.5px solid #ffc107;border-radius:14px;padding:1rem 1.25rem;box-shadow:0 6px 28px rgba(0,0,0,.14);font-family:var(--font-sans);font-size:.85rem;z-index:200000;max-width:320px;animation:cfmPop .3s ease both;";
  t.innerHTML = `<div style="display:flex;align-items:flex-start;gap:.7rem;"><ion-icon name="warning-outline" style="font-size:1.4rem;color:#b8860b;flex-shrink:0;margin-top:.05rem;"></ion-icon><div><p style="font-weight:700;color:#856404;margin-bottom:.2rem;">Stock Alert</p><p style="color:#374151;margin-bottom:.75rem;line-height:1.45;">${parts.join(" &amp; ")} — review before orders come in.</p><div style="display:flex;gap:.5rem;"><button id="dsa-goto" style="background:#163E34;color:#fff;border:none;border-radius:7px;padding:.35rem .85rem;font-size:.8rem;font-weight:600;cursor:pointer;font-family:var(--font-sans);">View Products</button><button onclick="this.closest('#daily-stock-toast').remove()" style="background:none;border:1px solid #e5e5e5;border-radius:7px;padding:.35rem .75rem;font-size:.8rem;cursor:pointer;font-family:var(--font-sans);">Dismiss</button></div></div></div>`;
  document.body.appendChild(t);
  t.querySelector("#dsa-goto")?.addEventListener("click", () => { t.remove(); switchSection("products"); setTimeout(() => { const lb = document.querySelector(".pf-flag-btn[data-flag='lowstock']"); if (lb && !lb.classList.contains("active")) lb.click(); }, 100); });
  setTimeout(() => { if (t.parentNode) { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 300); } }, 12000);
}

/* ---- Analytics --------------------------------------------------------- */
async function fetchNewsletter() {
  if (newsletter.length) return;
  try {
    const snap = await getDocs(collection(db, "newsletter"));
    newsletter = snap.docs.map(d => d.data());
  } catch (e) { console.warn("fetchNewsletter:", e); }
}

function setupAnalyticsControls() {
  document.querySelectorAll(".an-period").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".an-period").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      anDays = parseInt(btn.dataset.days);
      if (isNaN(anDays)) anDays = 0;
      const customRange = document.getElementById("an-custom-range");
      if (customRange) customRange.style.display = anDays === -1 ? "flex" : "none";
      if (anDays !== -1) renderAnalytics();
    });
  });
  document.getElementById("an-custom-apply")?.addEventListener("click", () => {
    const from = document.getElementById("an-date-from")?.value;
    const to = document.getElementById("an-date-to")?.value;
    if (!from || !to) return;
    anCustomFrom = new Date(from).getTime() / 1000;
    anCustomTo = new Date(to).getTime() / 1000 + 86399;
    renderAnalytics();
  });
}

function anFilterOrders(days) {
  if (days === -1 && anCustomFrom && anCustomTo)
    return orders.filter(o => o.createdAt && o.createdAt.seconds >= anCustomFrom && o.createdAt.seconds <= anCustomTo);
  if (!days) return orders;
  const cutoff = Date.now() / 1000 - days * 86400;
  return orders.filter(o => o.createdAt && o.createdAt.seconds >= cutoff);
}

function anFilterCustomers(days) {
  if (days === -1 && anCustomFrom && anCustomTo)
    return customers.filter(u => u.createdAt && u.createdAt.seconds >= anCustomFrom && u.createdAt.seconds <= anCustomTo);
  if (!days) return customers;
  const cutoff = Date.now() / 1000 - days * 86400;
  return customers.filter(u => u.createdAt && u.createdAt.seconds >= cutoff);
}

async function renderAnalytics() {
  await fetchNewsletter();
  const filtered = anFilterOrders(anDays);
  const active = filtered.filter(o => o.status !== "cancelled");
  const revenue = active.reduce((s, o) => s + (o.total || 0), 0);
  const avgVal = active.length ? Math.round(revenue / active.length) : 0;
  const newCusts = anFilterCustomers(anDays).length;

  $("#an-revenue").textContent = "৳" + revenue.toLocaleString();
  $("#an-orders").textContent = filtered.length;
  $("#an-avg-val").textContent = avgVal ? `Avg ৳${avgVal.toLocaleString()} / order` : "—";
  const convRate = customers.length ? ((active.length / customers.length) * 100).toFixed(1) : 0;
  $("#an-order-conv").textContent = `${convRate}% conversion`;
  $("#an-customers").textContent = newCusts;
  $("#an-newsletter").textContent = newsletter.length;

  const labelMap = { 7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days", 0: "All time", "-1": "Custom range" };
  const labelEl = $("#an-chart-label");
  if (labelEl) labelEl.textContent = labelMap[String(anDays)] || "";

  renderAnRevenueChart(active);
  renderAnStatusChart(filtered);
  renderAnTopProducts(active);
  renderAnFunnel(filtered, active, newCusts);
}

function renderAnRevenueChart(active) {
  if (!window.Chart) return;
  const canvas = $("#an-revenue-chart");
  if (anRevChart) { anRevChart.destroy(); anRevChart = null; }

  const days = anDays || 90;
  let labels = [], data = [];

  if (days <= 30) {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
      const s = new Date(d).setHours(0, 0, 0, 0) / 1000;
      data.push(active.filter(o => o.createdAt && o.createdAt.seconds >= s && o.createdAt.seconds < s + 86400).reduce((t, o) => t + (o.total || 0), 0));
    }
  } else {
    const weeks = Math.min(Math.ceil(days / 7), 13);
    for (let i = weeks - 1; i >= 0; i--) {
      const end = Date.now() / 1000 - i * 7 * 86400;
      const start = end - 7 * 86400;
      const d = new Date(end * 1000);
      labels.push("Wk " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
      data.push(active.filter(o => o.createdAt && o.createdAt.seconds >= start && o.createdAt.seconds < end).reduce((t, o) => t + (o.total || 0), 0));
    }
  }

  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, "rgba(22,62,52,.3)"); grad.addColorStop(1, "rgba(22,62,52,0)");
  anRevChart = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: "rgba(22,62,52,.75)", borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => "৳" + v } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } } }
  });
}

function renderAnStatusChart(filtered) {
  if (!window.Chart) return;
  const canvas = $("#an-status-chart");
  if (anStatusChart) { anStatusChart.destroy(); anStatusChart = null; }
  const counts = ORDER_STATUSES.map(s => filtered.filter(o => (o.status || "pending") === s).length);
  anStatusChart = new Chart(canvas, {
    type: "doughnut",
    data: { labels: ORDER_STATUSES, datasets: [{ data: counts, backgroundColor: ORDER_STATUSES.map(s => STATUS_COLORS[s]), borderWidth: 0 }] },
    options: { cutout: "65%", responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, plugins: { legend: { display: false } } }
  });
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  $("#an-status-legend").innerHTML = ORDER_STATUSES.map((s, i) => `
    <div><span class="dot" style="background:${STATUS_COLORS[s]}"></span>
    <span style="text-transform:capitalize;">${s}</span>
    <span class="ct">${counts[i]} (${Math.round(counts[i] / total * 100)}%)</span></div>`).join("");
}

function renderAnTopProducts(active) {
  const el = $("#an-top-products");
  const map = {};
  active.forEach(o => (o.items || []).forEach(i => {
    const k = i.id ?? i.name;
    if (!map[k]) map[k] = { name: i.name, qty: 0, rev: 0 };
    map[k].qty += i.quantity || 0;
    map[k].rev += (i.price || 0) * (i.quantity || 0);
  }));
  const top = Object.values(map).sort((a, b) => b.rev - a.rev).slice(0, 5);
  const maxRev = top[0]?.rev || 1;
  if (!top.length) { el.innerHTML = `<p class="muted-note">No sales data yet.</p>`; return; }
  el.innerHTML = top.map(t => `
    <div class="ts-row" style="flex-direction:column;align-items:flex-start;gap:.3rem;">
      <div style="display:flex;justify-content:space-between;width:100%;font-size:.88rem;">
        <span>${escapeHtml(t.name)}</span>
        <strong style="color:var(--primary-color);">৳${t.rev.toLocaleString()}</strong>
      </div>
      <div style="display:flex;align-items:center;gap:.5rem;width:100%;">
        <div style="flex:1;height:6px;background:#f0eee8;border-radius:3px;">
          <div style="width:${Math.round(t.rev / maxRev * 100)}%;height:100%;background:var(--primary-color);border-radius:3px;"></div>
        </div>
        <span style="font-size:.75rem;color:var(--text-muted);">${t.qty} sold</span>
      </div>
    </div>`).join("");
}

function renderAnFunnel(filtered, active, newCusts) {
  const el = $("#an-funnel");
  const steps = [
    { label: "New Customers", val: newCusts || 0 },
    { label: "Orders Placed", val: filtered.length },
    { label: "Confirmed/Shipped", val: filtered.filter(o => ["confirmed", "shipped", "delivered"].includes(o.status)).length },
    { label: "Delivered", val: filtered.filter(o => o.status === "delivered").length }
  ];
  const max = Math.max(...steps.map(s => s.val), 1);
  el.innerHTML = steps.map(s => `
    <div class="an-funnel-row">
      <div style="flex:1;">
        <div style="font-size:.82rem;margin-bottom:.3rem;">${s.label}</div>
        <div style="display:flex;align-items:center;gap:.5rem;">
          <div style="flex:1;height:8px;background:#f0eee8;border-radius:4px;">
            <div class="an-funnel-bar" style="width:${max ? Math.round(s.val / max * 100) : 0}%;"></div>
          </div>
        </div>
      </div>
      <strong style="font-size:.95rem;min-width:2rem;text-align:right;">${s.val}</strong>
    </div>`).join("");
}

/* ---- Order detail modal ----------------------------------------------- */
function openOrderDetail(order) {
  currentDetailOrder = order;
  const c = order.customer || {};
  const items = order.items || [];
  const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
  const couponCode = typeof order.coupon === "string" ? order.coupon : (order.coupon?.id || order.coupon?.code || "");
  const discount = order.couponDiscount || (typeof order.coupon === "object" ? order.coupon?.discount : 0) || 0;
  const orderNumDisplay = order.orderNum ? `#${order.orderNum}` : `#${order.id.slice(0, 8).toUpperCase()}`;

  document.getElementById("od-order-id").textContent = `Order ${orderNumDisplay}`;
  document.getElementById("od-content").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem;">
      <div>
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:.5rem;">Customer</div>
        <div style="font-size:.9rem;line-height:1.8;">
          <strong>${escapeHtml(c.name || "—")}</strong><br>
          ${c.email ? `<a href="mailto:${escapeHtml(c.email)}" style="color:var(--primary-color);">${escapeHtml(c.email)}</a><br>` : ""}
          ${c.mobile ? `<span>${escapeHtml(c.mobile)}</span><br>` : ""}
          ${c.address ? `<span style="color:var(--text-muted);font-size:.85rem;">${escapeHtml(c.address)}</span>` : ""}
        </div>
      </div>
      <div>
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:.5rem;">Payment</div>
        <div style="font-size:.9rem;line-height:1.8;">
          <strong>${escapeHtml(order.payment?.method || "—")}</strong>
          ${(order.payment?.method === 'bKash' || order.payment?.method === 'Nagad')
            ? (order.paymentStatus === "verified"
              ? `<span style="display:inline-block;margin-left:.5rem;background:#e6f4ea;color:#1e7e34;font-size:.72rem;font-weight:700;padding:.1rem .5rem;border-radius:4px;vertical-align:middle;">✓ VERIFIED</span> <button onclick="window._unverifyPayment('${order.id}')" style="background:none;color:#9b2226;border:1px solid #d9a5a5;border-radius:4px;padding:.1rem .45rem;font-size:.72rem;cursor:pointer;font-family:var(--font-sans);">Undo</button>`
              : `<span style="display:inline-block;margin-left:.5rem;background:#fdecea;color:#9b2226;font-size:.72rem;font-weight:600;padding:.1rem .5rem;border-radius:4px;vertical-align:middle;">⏳ UNVERIFIED</span>`)
            : ""}<br>
          ${order.payment?.senderMobile ? `Paid from: <strong>${escapeHtml(order.payment.senderMobile)}</strong><br>` : ""}
          ${order.payment?.txnId ? `TxnID: <code style="font-size:.82rem;background:var(--bg-color);padding:.1rem .3rem;border-radius:4px;">${escapeHtml(order.payment.txnId)}</code><br>` : ""}
          ${(order.payment?.method === 'bKash' || order.payment?.method === 'Nagad') && order.paymentStatus !== "verified"
            ? `<button onclick="window._verifyPayment('${order.id}')" style="margin-top:.4rem;background:#1e7e34;color:#fff;border:none;border-radius:6px;padding:.4rem 1rem;font-size:.82rem;cursor:pointer;font-family:var(--font-sans);">✓ Mark as Verified</button><br>`
            : ""}
          ${couponCode ? `Coupon: <code style="font-size:.82rem;background:#e6f4ea;color:#1e7e34;padding:.1rem .4rem;border-radius:4px;font-weight:600;">${escapeHtml(couponCode)}</code>` : `<span style="color:var(--text-muted);font-size:.85rem;">No coupon</span>`}
        </div>
      </div>
    </div>

    <div style="margin-bottom:1.25rem;">
      <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:.75rem;">Items</div>
      ${items.map(i => i.isFreeGift ? `
        <div style="display:flex;align-items:center;gap:.75rem;background:#f4f9f6;border-radius:8px;border:1px solid #c3dfd2;padding:.65rem .75rem;margin-bottom:.35rem;">
          ${i.image ? `<img src="${optimizedUrl(i.image, 50)}" alt="" style="width:44px;height:44px;object-fit:contain;background:#fff;border-radius:6px;flex-shrink:0;border:1px solid #c3dfd2;">` : ""}
          <div style="flex:1;font-size:.88rem;">
            <div style="font-weight:600;margin-bottom:.2rem;">${escapeHtml(i.name || "")}</div>
            <div style="color:var(--text-muted);font-size:.8rem;">Size: ${escapeHtml(i.size || "—")}</div>
            <div style="color:var(--text-muted);font-size:.8rem;">Quantity: 1</div>
            <span style="display:inline-block;margin-top:.3rem;font-size:.65rem;font-weight:800;background:#0b231a;color:#c9a84c;border-radius:3px;padding:.15rem .5rem;letter-spacing:.12em;text-transform:uppercase;">Free Gift</span>
          </div>
          <div style="text-align:right;font-size:.88rem;">
            ${i.originalPrice > 0 ? `<div style="color:var(--text-muted);text-decoration:line-through;font-size:.8rem;">৳${Number(i.originalPrice).toLocaleString()}</div>` : ""}
            <div style="font-weight:700;color:#163E34;">FREE</div>
          </div>
        </div>` : `
        <div style="display:flex;align-items:center;gap:.75rem;padding:.6rem 0;border-bottom:1px solid #f0eee8;">
          ${i.image ? `<img src="${optimizedUrl(i.image, 50)}" alt="" style="width:44px;height:44px;object-fit:contain;background:var(--bg-color);border-radius:6px;flex-shrink:0;">` : ""}
          <div style="flex:1;font-size:.88rem;">
            <div style="font-weight:500;margin-bottom:.2rem;">${escapeHtml(i.name || "")}</div>
            <div style="color:var(--text-muted);font-size:.8rem;">Size: ${escapeHtml(i.size || "—")}</div>
            <div style="color:var(--text-muted);font-size:.8rem;">Quantity: ${i.quantity || 1}</div>
          </div>
          <div style="text-align:right;font-size:.88rem;">৳${((i.price || 0) * (i.quantity || 1)).toLocaleString()}</div>
        </div>`).join("")}
    </div>

    ${order.giftMessage ? `
    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:.9rem 1.1rem;margin-bottom:1.25rem;display:flex;gap:.75rem;align-items:flex-start;">
      <ion-icon name="gift-outline" style="font-size:1.3rem;color:#b8860b;flex-shrink:0;margin-top:.1rem;"></ion-icon>
      <div>
        <div style="font-size:.7rem;text-transform:uppercase;color:#b8860b;letter-spacing:.05em;font-weight:700;margin-bottom:.25rem;">Gift Message</div>
        <div style="font-size:.88rem;color:#1c1c1c;line-height:1.6;font-style:italic;">"${escapeHtml(order.giftMessage)}"</div>
      </div>
    </div>` : ""}

    <div style="background:var(--bg-color);border-radius:8px;padding:1rem;margin-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.4rem;"><span style="color:var(--text-muted);">Subtotal</span><span>৳${subtotal.toLocaleString()}</span></div>
      ${discount ? `<div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.4rem;color:#1e7e34;"><span>Discount (${escapeHtml(couponCode)})</span><span>−৳${Number(discount).toLocaleString()}</span></div>` : ""}
      ${order.deliveryCharge ? `<div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.4rem;"><span style="color:var(--text-muted);">Delivery</span><span>৳${Number(order.deliveryCharge).toLocaleString()}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:1rem;border-top:1px solid var(--border-color);padding-top:.65rem;margin-top:.5rem;">
        <span>Total</span><span style="color:var(--primary-color);">৳${(order.total || 0).toLocaleString()}</span>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
      <div>
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:.3rem;">Status</div>
        <span class="o-status ${escapeHtml(order.status || "pending")}">${escapeHtml(order.status || "pending")}</span>
      </div>
      <div style="text-align:right;">
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:.3rem;">Ordered</div>
        <div style="font-size:.85rem;">${fmtDate(order.createdAt)}</div>
      </div>
    </div>

    <div style="border-top:1px solid var(--border-color);padding-top:1rem;">
      <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:.5rem;">Staff Notes</div>
      <textarea id="order-notes-ta" placeholder="Internal note for staff… (not visible to customer)" style="width:100%;box-sizing:border-box;border:1px solid var(--border-color);border-radius:8px;padding:.6rem .75rem;font-family:var(--font-sans,sans-serif);font-size:.85rem;resize:vertical;min-height:72px;background:var(--bg-color,#faf7f0);color:var(--text-main);">${escapeHtml(order.adminNotes || "")}</textarea>
      <button id="order-notes-save" style="margin-top:.5rem;padding:.4rem 1.1rem;background:var(--primary-color,#163E34);color:#fff;border:none;border-radius:7px;font-size:.82rem;cursor:pointer;font-family:var(--font-sans);">Save Note</button>
    </div>`;
  document.getElementById("order-detail-modal").classList.add("open");
  document.getElementById("order-notes-save").addEventListener("click", async () => {
    const notes = document.getElementById("order-notes-ta").value.trim();
    const btn = document.getElementById("order-notes-save");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await updateDoc(doc(db, "orders", order.id), { adminNotes: notes });
      const o = orders.find(x => x.id === order.id);
      if (o) o.adminNotes = notes;
      adminToast("Note saved.");
    } catch (e) { adminToast("Save failed.", "error"); }
    btn.disabled = false; btn.textContent = "Save Note";
  });
}

/* ---- Order invoice print ---------------------------------------------- */
function printOrderInvoice(order) {
  const c = order.customer || {};
  const items = order.items || [];
  const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
  const discount = order.couponDiscount || (typeof order.coupon === "object" ? order.coupon?.discount : 0) || 0;
  const couponCode = typeof order.coupon === "string" ? order.coupon : (order.coupon?.id || order.coupon?.code || "");
  const dateStr = fmtDate(order.createdAt);
  const orderNumDisplay = order.orderNum ? `#${order.orderNum}` : `#${order.id.slice(0, 8).toUpperCase()}`;
  const logoUrl = window.location.origin + "/product%20pictures/main%20logo.png";
  const statusColor = STATUS_COLORS[order.status || "pending"] || "#888";

  const itemRows = items.map((item, idx) => `<tr>
    <td>${idx + 1}</td>
    <td>${escapeHtml(item.name || "")}</td>
    <td>${escapeHtml(item.size || "")}</td>
    <td style="text-align:center;">${item.quantity || 1}</td>
    <td style="text-align:right;">৳${(item.price || 0).toLocaleString()}</td>
    <td style="text-align:right;">৳${((item.price || 0) * (item.quantity || 1)).toLocaleString()}</td>
  </tr>`).join("");

  const discountRow = discount ? `<tr class="tot"><td colspan="5" style="text-align:right;color:#1e7e34;">Discount (${escapeHtml(couponCode)})</td><td style="text-align:right;color:#1e7e34;">−৳${Number(discount).toLocaleString()}</td></tr>` : "";
  const deliveryRow = order.deliveryCharge ? `<tr class="tot"><td colspan="5" style="text-align:right;color:#555;">Delivery</td><td style="text-align:right;">৳${Number(order.deliveryCharge).toLocaleString()}</td></tr>` : "";

  const win = window.open("", "_blank", "width=720,height=960,scrollbars=yes");
  win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Invoice ${orderNumDisplay} | Zahroun</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Inter',sans-serif;color:#1c1c1c;background:#fff;padding:2.5cm 2.2cm;font-size:.82rem;font-weight:400;line-height:1.6;}
  /* Header */
  .hdr{text-align:center;padding-bottom:1.4rem;margin-bottom:1.8rem;position:relative;}
  .hdr::after{content:'';display:block;margin:1.2rem auto 0;width:60px;height:1.5px;background:#163E34;}
  .logo-img{height:180px;max-width:340px;object-fit:contain;display:block;margin:0 auto;}
  .inv-tag{font-family:'Inter',sans-serif;font-size:.68rem;letter-spacing:3px;color:#b0a090;margin-top:.2rem;text-transform:uppercase;font-weight:400;}
  /* Order meta */
  .inv-meta{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.8rem;padding-bottom:1.2rem;border-bottom:1px solid #e8e4dc;}
  .inv-num{font-family:'Inter',sans-serif;font-size:1.5rem;font-weight:700;color:#163E34;letter-spacing:4px;line-height:1.1;}
  .inv-num-lbl{font-size:.58rem;letter-spacing:4px;text-transform:uppercase;color:#aaa;margin-bottom:.3rem;font-weight:500;}
  .status-badge{display:inline-block;background:${statusColor};color:#fff;padding:.2rem .65rem;border-radius:3px;font-size:.62rem;font-weight:600;letter-spacing:.06em;margin-top:.5rem;text-transform:uppercase;}
  /* Grid */
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-bottom:1.8rem;}
  .lbl{font-size:.58rem;text-transform:uppercase;letter-spacing:.12em;color:#aaa;margin-bottom:.4rem;font-weight:600;}
  .val{font-size:.82rem;line-height:1.9;color:#2a2a2a;}
  .val strong{font-weight:600;color:#1c1c1c;}
  /* Table */
  table{width:100%;border-collapse:collapse;margin-bottom:1.5rem;}
  thead th{background:#163E34;color:#fff;padding:.5rem .7rem;font-size:.62rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;}
  tbody td{padding:.5rem .7rem;border-bottom:1px solid #f0ece4;font-size:.82rem;color:#2a2a2a;vertical-align:middle;}
  tbody tr:last-child td{border-bottom:none;}
  .tot td{border:none;padding:.22rem .7rem;font-size:.8rem;color:#666;}
  .tot td:last-child{color:#2a2a2a;}
  .tot-sep td{border-top:1px solid #e8e4dc;padding-top:.6rem;}
  .grand td{padding:.55rem .7rem;font-weight:600;font-size:.9rem;color:#1c1c1c;border-top:1.5px solid #163E34;}
  .grand td:last-child{color:#163E34;font-size:1rem;}
  /* Footer */
  .footer{text-align:center;font-size:.68rem;color:#bbb;border-top:1px solid #f0ece4;padding-top:1rem;margin-top:1.8rem;line-height:2;letter-spacing:.02em;}
  .footer strong{color:#999;font-weight:500;}
  .print-btn{text-align:center;margin-top:1.8rem;}
  .print-btn button{background:#163E34;color:#fff;border:none;padding:.6rem 2rem;border-radius:4px;cursor:pointer;font-size:.8rem;font-family:'Inter',sans-serif;letter-spacing:.04em;font-weight:500;}
  .print-btn button:hover{background:#0f2820;}
  @media print{.print-btn{display:none;}body{padding:1.5cm;}}
</style></head><body>
<div class="hdr">
  <img src="${logoUrl}" class="logo-img" alt="Zahroun">
  <div class="inv-tag">Tax Invoice &nbsp;·&nbsp; Order Confirmation</div>
</div>

<div class="inv-meta">
  <div>
    <div class="inv-num-lbl">Order Number</div>
    <div class="inv-num">${orderNumDisplay}</div>
    <div><span class="status-badge">${(order.status || "pending").toUpperCase()}</span></div>
  </div>
  <div style="text-align:right;">
    <div class="lbl">Date Issued</div>
    <div class="val">${dateStr}</div>
  </div>
</div>

<div class="grid2">
  <div>
    <div class="lbl">Bill To</div>
    <div class="val">
      <strong>${escapeHtml(c.name || "—")}</strong><br>
      ${c.email ? escapeHtml(c.email) + "<br>" : ""}
      ${c.mobile ? escapeHtml(c.mobile) + "<br>" : ""}
      ${c.address ? `<span style="color:#777;">${escapeHtml(c.address)}</span>` : ""}
    </div>
  </div>
  <div>
    <div class="lbl">Payment Details</div>
    <div class="val">
      <strong>${escapeHtml(order.payment?.method || "—")}</strong><br>
      ${order.payment?.senderMobile ? "Paid from: " + escapeHtml(order.payment.senderMobile) + "<br>" : ""}
      ${order.payment?.txnId ? "Txn ID: " + escapeHtml(order.payment.txnId) + "<br>" : ""}
      ${couponCode ? 'Coupon: <strong style="color:#163E34;">' + escapeHtml(couponCode) + "</strong>" : ""}
    </div>
  </div>
</div>

<table>
  <thead><tr><th style="width:2rem;">#</th><th>Product</th><th>Size</th><th style="text-align:center;width:3rem;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Amount</th></tr></thead>
  <tbody>${itemRows}</tbody>
  <tfoot>
    <tr class="tot"><td colspan="5" style="text-align:right;">Subtotal</td><td style="text-align:right;">৳${subtotal.toLocaleString()}</td></tr>
    ${discountRow}${deliveryRow}
    <tr class="tot tot-sep"><td colspan="6"></td></tr>
    <tr class="grand"><td colspan="5" style="text-align:right;">Total Payable</td><td style="text-align:right;">৳${(order.total || 0).toLocaleString()}</td></tr>
  </tfoot>
</table>

<div class="footer">
  <strong>Zahroun</strong> &nbsp;·&nbsp; Dhanmondi, Dhaka, Bangladesh, 1205<br>
  WhatsApp: +880 1886-936581 &nbsp;·&nbsp; zahroun.com<br>
  Thank you for your order — we hope you love your fragrance.
</div>
<div class="print-btn"><button onclick="window.print()">Print / Save as PDF</button></div>
</body></html>`);
  win.document.close();
}

/* ---- Notification system ---------------------------------------------- */
function timeAgo(ms) {
  const d = Date.now() - ms;
  if (d < 60000) return "just now";
  if (d < 3600000) return Math.floor(d / 60000) + "m ago";
  if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
  return Math.floor(d / 86400000) + "d ago";
}

function updateNotifications() {
  const newOrds = orders.filter(o => isNewOrder(o));
  const unreadMsgs = messages.filter(m => !m.read).length;
  const lowStock = products.filter(p => p.stock !== undefined && p.stock !== null && p.stock < 10).length;
  const unackNew = newOrds.filter(o => !acknowledgedOrderIds.has(o.id)).length;
  const badgeTotal = unackNew + unreadMsgs + lowStock;

  const badge = document.getElementById("notif-badge");
  if (badge) { badge.textContent = badgeTotal; badge.style.display = badgeTotal ? "" : "none"; }

  const total = newOrds.length + unreadMsgs + lowStock;

  const list = document.getElementById("notif-list");
  if (!list) return;

  if (!total) {
    list.innerHTML = `<div style="padding:1.6rem 1rem;text-align:center;color:var(--text-muted);font-size:.85rem;"><ion-icon name="checkmark-circle-outline" style="font-size:2rem;display:block;margin:0 auto .4rem;color:#1e7e34;"></ion-icon>All caught up!</div>`;
    return;
  }

  let html = "";

  if (newOrds.length) {
    html += `<div style="padding:.55rem 1rem .3rem;font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--primary-color);background:#f9f7f4;">New Orders</div>`;
    html += newOrds.slice(0, 8).map(o => {
      const c = o.customer || {};
      const num = o.orderNum || o.id.slice(0, 8).toUpperCase();
      const ms = o.createdAt?.toMillis ? o.createdAt.toMillis() : (o.createdAt?.seconds || 0) * 1000;
      const isNew = !acknowledgedOrderIds.has(o.id);
      return `<div class="notif-item" data-goto="orders" style="display:flex;align-items:center;gap:.75rem;padding:.7rem 1rem;border-bottom:1px solid #f4f2ee;cursor:pointer;background:${isNew ? '#fffcf5' : '#fff'};transition:background .15s;">
        <div style="width:34px;height:34px;border-radius:9px;background:${isNew ? '#fef3d8' : '#f2f0ec'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <ion-icon name="cart-outline" style="font-size:1.05rem;color:${isNew ? '#b8860b' : 'var(--primary-color)'};"></ion-icon>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:.82rem;font-weight:600;display:flex;align-items:center;gap:.4rem;">#${escapeHtml(String(num))}${isNew ? '<span class="notif-new-pill">NEW</span>' : ''}</div>
          <div style="font-size:.74rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:.1rem;">${escapeHtml(c.name || "Customer")} · ৳${(o.total || 0).toLocaleString()}</div>
        </div>
        <span style="font-size:.68rem;color:var(--text-muted);white-space:nowrap;flex-shrink:0;">${timeAgo(ms)}</span>
      </div>`;
    }).join("");
  }

  const summaryItems = [];
  if (unreadMsgs) summaryItems.push({ icon: "mail-outline", text: `${unreadMsgs} unread message${unreadMsgs > 1 ? "s" : ""}`, go: "messages", color: "#1a56b8" });
  if (lowStock) summaryItems.push({ icon: "warning-outline", text: `${lowStock} product${lowStock > 1 ? "s" : ""} low in stock (<10)`, go: "products", color: "#9b2226" });
  html += summaryItems.map(item => `
    <div class="notif-item" data-goto="${item.go}" style="display:flex;align-items:center;gap:.75rem;padding:.7rem 1rem;border-bottom:1px solid #f4f2ee;cursor:pointer;background:#fff;">
      <div style="width:34px;height:34px;border-radius:9px;background:#f2f0ec;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <ion-icon name="${item.icon}" style="font-size:1.05rem;color:${item.color};"></ion-icon>
      </div>
      <span style="font-size:.82rem;flex:1;">${item.text}</span>
      <ion-icon name="chevron-forward-outline" style="color:var(--text-muted);font-size:.85rem;flex-shrink:0;"></ion-icon>
    </div>`).join("");

  list.innerHTML = html;
  list.querySelectorAll(".notif-item").forEach(el => {
    el.addEventListener("click", () => {
      document.getElementById("notif-dropdown").style.display = "none";
      switchSection(el.dataset.goto);
    });
  });
}

/* ---- CSV Export -------------------------------------------------------- */
function downloadCSV(filename, headers, rows) {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportOrdersCSV() {
  const headers = ["Order ID", "Customer", "Mobile", "Address", "Items", "Total", "Payment Method", "TxnID", "Coupon", "Status", "Date"];
  const rows = orders.map(o => {
    const c = o.customer || {};
    const itemStr = (o.items || []).map(i => `${i.name} ${i.size} x${i.quantity}`).join(" | ");
    const coupon = typeof o.coupon === "string" ? o.coupon : (o.coupon?.id || o.coupon?.code || "");
    return [o.id, c.name || "", c.mobile || "", c.address || "", itemStr, o.total || 0, o.payment?.method || "", o.payment?.txnId || "", coupon, o.status || "pending", fmtDate(o.createdAt)];
  });
  downloadCSV("zahroun_orders.csv", headers, rows);
  adminToast(`Exported ${orders.length} orders.`);
}

function exportCustomersCSV() {
  const headers = ["Name", "Email", "Role", "Joined"];
  const rows = customers.map(u => [u.name || "", u.email || "", u.role || "customer", fmtDate(u.createdAt)]);
  downloadCSV("zahroun_customers.csv", headers, rows);
  adminToast(`Exported ${customers.length} customers.`);
}

/* =========================================================================
   PAGES SECTION — dynamic image management
   ========================================================================= */

let pageSettings = { homepage: {}, about: {}, contact: {} };
let galleryPageImages = [];
let galleryPageDragSrc = null;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

async function fetchPageSettings() {
  try {
    const [hSnap, aSnap, cSnap] = await Promise.all([
      getDoc(doc(db, "settings", "homepage")),
      getDoc(doc(db, "settings", "about")),
      getDoc(doc(db, "settings", "contact"))
    ]);
    pageSettings.homepage = hSnap.exists() ? hSnap.data() : {};
    pageSettings.about = aSnap.exists() ? aSnap.data() : {};
    pageSettings.contact = cSnap.exists() ? cSnap.data() : {};
  } catch (e) { console.error("fetchPageSettings:", e); }
}

function setupPagesSection() {
  document.querySelectorAll(".pages-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pages-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".pages-sub").forEach(s => s.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector(`.pages-sub[data-sub="${btn.dataset.tab}"]`)?.classList.add("active");
    });
  });

  bindPageUpload("file-hero-desktop",   "prev-hero-desktop",   "status-hero-desktop",   "del-hero-desktop",   { aspectRatio: 16/9 });
  bindPageUpload("file-hero-mobile",    "prev-hero-mobile",    "status-hero-mobile",    "del-hero-mobile",    { aspectRatio: 9/16 });
  bindPageUpload("file-cat-forher",     "prev-cat-forher",     "status-cat-forher",     "del-cat-forher",     { aspectRatio: 1 });
  bindPageUpload("file-cat-unisex",     "prev-cat-unisex",     "status-cat-unisex",     "del-cat-unisex",     { aspectRatio: 1 });
  bindPageUpload("file-cat-forhim",     "prev-cat-forhim",     "status-cat-forhim",     "del-cat-forhim",     { aspectRatio: 1 });
  bindPageUpload("file-why-0",          "prev-why-0",          "status-why-0",          "del-why-0",          { aspectRatio: 1 });
  bindPageUpload("file-why-1",          "prev-why-1",          "status-why-1",          "del-why-1",          { aspectRatio: 1 });
  bindPageUpload("file-why-2",          "prev-why-2",          "status-why-2",          "del-why-2",          { aspectRatio: 1 });
  bindPageUpload("file-about-hero",     "prev-about-hero",     "status-about-hero",     "del-about-hero",     { aspectRatio: 16/9 });
  bindPageUpload("file-about-mission",  "prev-about-mission",  "status-about-mission",  "del-about-mission");
  bindPageUpload("file-contact-hero",   "prev-contact-hero",   "status-contact-hero",   "del-contact-hero",   { aspectRatio: 16/9 });
  bindPageUpload("file-contact-map",    "prev-contact-map",    "status-contact-map",    "del-contact-map");

  document.getElementById("file-gallery-multi").addEventListener("change", handleGalleryPageUpload);

  const opacityInput = document.getElementById("about-hero-opacity");
  const opacityVal = document.getElementById("about-hero-opacity-val");
  if (opacityInput) {
    opacityInput.addEventListener("input", () => {
      opacityVal.textContent = parseFloat(opacityInput.value).toFixed(2);
    });
  }

  document.querySelectorAll(".map-toggle button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".map-toggle button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.mapmode;
      document.getElementById("map-sub-iframe").style.display = mode === "iframe" ? "" : "none";
      document.getElementById("map-sub-image").style.display = mode === "image" ? "" : "none";
    });
  });

  document.getElementById("save-pages-homepage").addEventListener("click", savePagesHomepage);
  document.getElementById("save-pages-about").addEventListener("click", savePagesAbout);
  document.getElementById("save-pages-contact").addEventListener("click", savePagesContact);

  // FAQ
  document.getElementById("add-faq-btn").addEventListener("click", () => openFaqModal(null));
  document.getElementById("cancel-faq").addEventListener("click", closeFaqModal);
  document.getElementById("faq-modal").addEventListener("click", e => { if (e.target.id === "faq-modal") closeFaqModal(); });
  document.getElementById("faq-form").addEventListener("submit", saveFaqModal);
  fetchFaqs().then(renderFaqTable);

  // Policies
  renderPoliciesForm();
  document.getElementById("save-policies").addEventListener("click", savePolicies);
}

function bindPageUpload(fileId, previewId, statusId, delId, { aspectRatio = NaN } = {}) {
  const fileInput = document.getElementById(fileId);
  const preview = document.getElementById(previewId);
  const statusEl = document.getElementById(statusId);
  const delBtn = document.getElementById(delId);
  if (!fileInput) return;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      statusEl.textContent = "File exceeds 3MB limit.";
      statusEl.style.color = "#9b2226";
      fileInput.value = "";
      return;
    }
    let blob;
    try { blob = await openCropModal(file, { aspectRatio }); }
    catch { fileInput.value = ""; return; }
    statusEl.style.color = "";
    statusEl.textContent = "Uploading…";
    try {
      const { url } = await uploadImage(blob, { onProgress: p => { statusEl.textContent = `Uploading ${p}%…`; } });
      preview.src = optimizedUrl(url, 600);
      preview.classList.add("has-img");
      if (delBtn) delBtn.style.display = "";
      statusEl.textContent = "Uploaded.";
      fileInput._uploadedUrl = url;
      fileInput._deleted = false;
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.style.color = "#9b2226";
    }
    fileInput.value = "";
  });

  if (delBtn) {
    delBtn.addEventListener("click", () => {
      preview.src = "";
      preview.classList.remove("has-img");
      delBtn.style.display = "none";
      fileInput._uploadedUrl = null;
      fileInput._deleted = true;
      statusEl.textContent = "";
    });
  }
}

function setPagePreview(previewId, delId, url) {
  if (!url) return;
  const el = document.getElementById(previewId);
  const del = document.getElementById(delId);
  if (el) { el.src = optimizedUrl(url, 800); el.classList.add("has-img"); }
  if (del) del.style.display = "";
  const fileInput = document.getElementById(previewId.replace("prev-", "file-"));
  if (fileInput) fileInput._uploadedUrl = url;
}

function getPageUrl(previewId) {
  const fileInput = document.getElementById(previewId.replace("prev-", "file-"));
  return fileInput?._uploadedUrl || null;
}

function resolvePageField(previewId, existingValue) {
  const fileInput = document.getElementById(previewId.replace("prev-", "file-"));
  if (fileInput?._deleted) return null;
  return fileInput?._uploadedUrl || existingValue || null;
}

async function handleGalleryPageUpload(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const statusEl = document.getElementById("status-gallery-multi");
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      statusEl.textContent = `"${file.name}" exceeds 3MB limit. Skipped.`;
      statusEl.style.color = "#9b2226";
      continue;
    }
    let blob;
    try { blob = await openCropModal(file, { aspectRatio: 1 }); }
    catch { continue; }
    statusEl.style.color = "";
    statusEl.textContent = "Uploading…";
    try {
      const { url } = await uploadImage(blob, { onProgress: p => { statusEl.textContent = `Uploading ${p}%…`; } });
      galleryPageImages.push(url);
      renderGalleryPageThumbs();
      statusEl.textContent = `${galleryPageImages.length} image${galleryPageImages.length > 1 ? "s" : ""} in gallery.`;
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.style.color = "#9b2226";
    }
  }
  e.target.value = "";
}

function renderGalleryPageThumbs() {
  const el = document.getElementById("gallery-page-thumbs");
  if (!el) return;
  if (!galleryPageImages.length) {
    el.innerHTML = `<span class="muted-note" style="font-size:.78rem;line-height:2.5rem;">No gallery images yet.</span>`;
    return;
  }
  el.innerHTML = galleryPageImages.map((url, i) => `
    <div class="gallery-page-thumb" draggable="true" data-gpi="${i}" style="width:80px;">
      <img src="${optimizedUrl(url, 160)}" alt="">
      <button type="button" class="th-del" data-gpi="${i}" title="Remove">&times;</button>
    </div>`).join("");
  el.querySelectorAll(".th-del").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      galleryPageImages.splice(Number(btn.dataset.gpi), 1);
      renderGalleryPageThumbs();
    });
  });
  el.querySelectorAll(".gallery-page-thumb").forEach(th => {
    th.addEventListener("dragstart", () => { galleryPageDragSrc = Number(th.dataset.gpi); });
    th.addEventListener("dragover", e => { e.preventDefault(); th.classList.add("drag-over"); });
    th.addEventListener("dragleave", () => { th.classList.remove("drag-over"); });
    th.addEventListener("drop", e => {
      e.preventDefault(); th.classList.remove("drag-over");
      const src = galleryPageDragSrc, dest = Number(th.dataset.gpi);
      if (src === null || src === dest) return;
      const moved = galleryPageImages.splice(src, 1)[0];
      galleryPageImages.splice(dest, 0, moved);
      renderGalleryPageThumbs();
    });
    th.addEventListener("dragend", () => { el.querySelectorAll(".gallery-page-thumb").forEach(t => t.classList.remove("drag-over")); });
  });
}

function renderPagesSection() {
  const hp = pageSettings.homepage;
  const ab = pageSettings.about;
  const ct = pageSettings.contact;

  setPagePreview("prev-hero-desktop", "del-hero-desktop", hp.heroDesktop);
  setPagePreview("prev-hero-mobile", "del-hero-mobile", hp.heroMobile);
  setPagePreview("prev-cat-forher", "del-cat-forher", hp.catImages?.forHer);
  setPagePreview("prev-cat-unisex", "del-cat-unisex", hp.catImages?.unisex);
  setPagePreview("prev-cat-forhim", "del-cat-forhim", hp.catImages?.forHim);
  const why = hp.whyChoose || [];
  [0, 1, 2].forEach(i => setPagePreview(`prev-why-${i}`, `del-why-${i}`, why[i]?.icon));

  galleryPageImages = hp.gallery ? [...hp.gallery] : [];
  renderGalleryPageThumbs();

  setPagePreview("prev-about-hero", "del-about-hero", ab.heroImage);
  const opacityInput = document.getElementById("about-hero-opacity");
  const opacityVal = document.getElementById("about-hero-opacity-val");
  if (opacityInput) {
    const val = ab.heroOpacity !== undefined ? ab.heroOpacity : 0.5;
    opacityInput.value = val;
    if (opacityVal) opacityVal.textContent = parseFloat(val).toFixed(2);
  }
  setPagePreview("prev-about-mission", "del-about-mission", ab.missionImage);

  setPagePreview("prev-contact-hero", "del-contact-hero", ct.heroImage);
  if (ct.mapEmbed) {
    const mapInput = document.getElementById("contact-map-embed");
    if (mapInput) mapInput.value = ct.mapEmbed;
    document.getElementById("map-mode-iframe")?.classList.add("active");
    document.getElementById("map-mode-image")?.classList.remove("active");
    document.getElementById("map-sub-iframe").style.display = "";
    document.getElementById("map-sub-image").style.display = "none";
  } else if (ct.mapImage) {
    setPagePreview("prev-contact-map", "del-contact-map", ct.mapImage);
    document.getElementById("map-mode-iframe")?.classList.remove("active");
    document.getElementById("map-mode-image")?.classList.add("active");
    document.getElementById("map-sub-iframe").style.display = "none";
    document.getElementById("map-sub-image").style.display = "";
  }
}

async function savePagesHomepage() {
  const btn = document.getElementById("save-pages-homepage");
  const statusEl = document.getElementById("status-pages-homepage");
  btn.disabled = true; btn.textContent = "Saving…";
  statusEl.textContent = "";
  try {
    const hp = pageSettings.homepage;
    const heroDesktop = resolvePageField("prev-hero-desktop", hp.heroDesktop);
    const heroMobile = resolvePageField("prev-hero-mobile", hp.heroMobile);
    const catForHer = resolvePageField("prev-cat-forher", hp.catImages?.forHer);
    const catUnisex = resolvePageField("prev-cat-unisex", hp.catImages?.unisex);
    const catForHim = resolvePageField("prev-cat-forhim", hp.catImages?.forHim);
    const prevWhy = hp.whyChoose || [];
    const whyChoose = [0, 1, 2].map(i => ({
      icon: resolvePageField(`prev-why-${i}`, prevWhy[i]?.icon)
    }));
    const data = {
      heroDesktop,
      heroMobile,
      catImages: { forHer: catForHer, unisex: catUnisex, forHim: catForHim },
      whyChoose,
      gallery: galleryPageImages,
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, "settings", "homepage"), data, { merge: true });
    pageSettings.homepage = { ...hp, ...data };
    statusEl.textContent = "Saved.";
    adminToast("Homepage images saved.");
  } catch (err) {
    statusEl.textContent = "Failed: " + (err.code || err.message);
    statusEl.style.color = "#9b2226";
  }
  btn.disabled = false; btn.textContent = "Save Homepage Images";
}

async function savePagesAbout() {
  const btn = document.getElementById("save-pages-about");
  const statusEl = document.getElementById("status-pages-about");
  btn.disabled = true; btn.textContent = "Saving…";
  statusEl.textContent = "";
  try {
    const ab = pageSettings.about;
    const heroImage = resolvePageField("prev-about-hero", ab.heroImage);
    const heroOpacity = parseFloat(document.getElementById("about-hero-opacity")?.value) || 0.5;
    const missionImage = resolvePageField("prev-about-mission", ab.missionImage);
    const data = { heroImage, heroOpacity, missionImage, updatedAt: serverTimestamp() };
    await setDoc(doc(db, "settings", "about"), data, { merge: true });
    pageSettings.about = { ...ab, ...data };
    statusEl.textContent = "Saved.";
    adminToast("About page images saved.");
  } catch (err) {
    statusEl.textContent = "Failed: " + (err.code || err.message);
    statusEl.style.color = "#9b2226";
  }
  btn.disabled = false; btn.textContent = "Save About Images";
}

async function savePagesContact() {
  const btn = document.getElementById("save-pages-contact");
  const statusEl = document.getElementById("status-pages-contact");
  btn.disabled = true; btn.textContent = "Saving…";
  statusEl.textContent = "";
  try {
    const ct = pageSettings.contact;
    const heroImage = resolvePageField("prev-contact-hero", ct.heroImage);
    const activeMode = document.querySelector(".map-toggle button.active")?.dataset.mapmode || "iframe";
    let mapEmbed = null, mapImage = null;
    if (activeMode === "iframe") {
      mapEmbed = document.getElementById("contact-map-embed")?.value.trim() || null;
    } else {
      mapImage = resolvePageField("prev-contact-map", ct.mapImage);
    }
    const data = { heroImage, mapEmbed, mapImage, updatedAt: serverTimestamp() };
    await setDoc(doc(db, "settings", "contact"), data, { merge: true });
    pageSettings.contact = { ...ct, ...data };
    statusEl.textContent = "Saved.";
    adminToast("Contact page images saved.");
  } catch (err) {
    statusEl.textContent = "Failed: " + (err.code || err.message);
    statusEl.style.color = "#9b2226";
  }
  btn.disabled = false; btn.textContent = "Save Contact Images";
}

/* ---- Helpers ----------------------------------------------------------- */
function fmtDate(ts) {
  try {
    if (!ts || !ts.toDate) return "—";
    const d = ts.toDate();
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
      ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch { return "—"; }
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function zahrounConfirm(msg, opts = {}) {
  return new Promise(resolve => {
    const title   = opts.title  || "Are you sure?";
    const okText  = opts.ok     || "Confirm";
    const danger  = opts.danger !== false;
    const icon    = danger
      ? `<ion-icon name="trash-outline"      style="color:#9b2226;font-size:1.45rem;"></ion-icon>`
      : `<ion-icon name="swap-horizontal-outline" style="color:#163E34;font-size:1.45rem;"></ion-icon>`;

    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.46);z-index:300000;display:flex;align-items:center;justify-content:center;padding:1.5rem;backdrop-filter:blur(3px);";
    ov.innerHTML = `
      <div style="background:#fff;border-radius:18px;padding:2rem 1.75rem;max-width:360px;width:100%;box-shadow:0 28px 70px rgba(0,0,0,.22);animation:cfmPop .22s cubic-bezier(.34,1.56,.64,1) both;font-family:var(--font-sans);">
        <div style="width:48px;height:48px;border-radius:50%;background:${danger ? '#fff2f2' : '#f0f7f4'};display:flex;align-items:center;justify-content:center;margin-bottom:1.1rem;">${icon}</div>
        <p style="font-size:1rem;font-weight:700;color:#1a1a1a;margin-bottom:.4rem;">${title}</p>
        <p style="font-size:.88rem;color:#6b7280;margin-bottom:1.6rem;line-height:1.55;">${msg}</p>
        <div style="display:flex;gap:.65rem;justify-content:flex-end;">
          <button id="cfm-no"  style="padding:.55rem 1.2rem;border:1px solid #e5e5e5;background:#fff;border-radius:8px;font-size:.88rem;cursor:pointer;color:#374151;font-family:var(--font-sans);font-weight:500;">Cancel</button>
          <button id="cfm-yes" style="padding:.55rem 1.2rem;background:${danger ? '#9b2226' : '#163E34'};color:#fff;border:none;border-radius:8px;font-size:.88rem;cursor:pointer;font-weight:600;font-family:var(--font-sans);">${okText}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    setTimeout(() => ov.querySelector("#cfm-yes").focus(), 50);
    const close = r => { ov.remove(); resolve(r); };
    ov.querySelector("#cfm-yes").addEventListener("click", () => close(true));
    ov.querySelector("#cfm-no").addEventListener("click",  () => close(false));
    ov.addEventListener("click", e => { if (e.target === ov) close(false); });
    const onKey = e => { if (e.key === "Escape") { close(false); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
  });
}

function showWaNotifyToast(order, status) {
  const c = order?.customer || {};
  const num = order?.orderNum || (order?.id || "").slice(0, 6).toUpperCase();
  const statusMsgs = {
    confirmed: `✅ আপনার Order #${num} confirmed হয়েছে। আমরা আপনার পণ্য প্রস্তুত করছি।`,
    shipped:   `🚚 আপনার Order #${num} shipped হয়েছে! শীঘ্রই পৌঁছাবে।`,
    delivered: `🎉 আপনার Order #${num} delivered হয়েছে। ধন্যবাদ Zahroun বেছে নেওয়ার জন্য!`,
    cancelled: `❌ আপনার Order #${num} cancelled হয়েছে।`
  };
  const msg = statusMsgs[status] || `📦 আপনার Order #${num} এর status "${status}" হয়েছে।`;
  const waPhone = (c.mobile || "").replace(/[^0-9]/g, "").replace(/^0/, "880");
  if (!waPhone) return;
  const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg + "\n\n— Zahroun Perfumes")}`;
  let t = document.getElementById("wa-notify-toast");
  if (t) t.remove();
  t = document.createElement("div");
  t.id = "wa-notify-toast";
  t.style.cssText = "position:fixed;bottom:4.5rem;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:.7rem 1rem;box-shadow:0 4px 20px rgba(0,0,0,.14);font-family:var(--font-sans);font-size:.84rem;z-index:100001;display:flex;align-items:center;gap:.7rem;white-space:nowrap;max-width:calc(100vw - 2rem);opacity:0;transition:opacity .25s;";
  t.innerHTML = `<span style="color:#374151;">Status updated</span><a href="${waUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:.35rem;background:#25D366;color:#fff;border-radius:6px;padding:.3rem .75rem;font-size:.8rem;font-weight:600;text-decoration:none;flex-shrink:0;"><ion-icon name="logo-whatsapp" style="font-size:1rem;"></ion-icon>Notify on WhatsApp</a><button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:1rem;padding:0;line-height:1;flex-shrink:0;">×</button>`;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "1"; }, 10);
  t._t = setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 8000);
}

function adminToast(msg, ok = true) {
  let t = document.getElementById("a-toast");
  if (!t) { t = document.createElement("div"); t.id = "a-toast"; document.body.appendChild(t); }
  Object.assign(t.style, { position: "fixed", bottom: "2rem", left: "50%", transform: "translateX(-50%)", background: ok ? "#163E34" : "#9b2226", color: "#fff", padding: ".75rem 2rem", borderRadius: "50px", fontFamily: "var(--font-sans)", fontSize: ".9rem", zIndex: "100000", opacity: "1", transition: "opacity .3s", maxWidth: "90vw", textAlign: "center", pointerEvents: "none" });
  t.textContent = (ok ? "✓ " : "⚠ ") + msg;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.opacity = "0"; }, 3200);
}

/* ========================================================================
   PROMOTIONS PANEL
   ======================================================================== */

async function initPromotionsPanel() {
  const P = window.ZahrounPromos;
  if (!P) { console.warn("ZahrounPromos not loaded"); return; }
  const cfg = await P.load(true);

  const $   = id => document.getElementById(id);
  const chk = (id, val) => { const el=$(id); if(el) el.checked=!!val; };
  const num = (id, val) => { const el=$(id); if(el) el.value=val??''; };
  const str = (id, val) => { const el=$(id); if(el) el.value=val??''; };
  const getNum = id => parseFloat($(id)?.value)||0;
  const getStr = id => $(id)?.value?.trim()||'';
  const getChk = id => !!($(id)?.checked);

  // Buy X Get Y
  const bxgy = cfg.buyXGetY||{};
  chk('p-bxgy-on', bxgy.enabled);
  const r1=bxgy.rules?.[0]||{buy:2,getFree:1}, r2=bxgy.rules?.[1]||{buy:3,getFree:1};
  num('p-bxgy-buy1',r1.buy); num('p-bxgy-free1',r1.getFree);
  num('p-bxgy-buy2',r2.buy); num('p-bxgy-free2',r2.getFree);
  // Free item scope
  const bxgyScope = bxgy.freeItemScope || 'any';
  const bxgyScopeEl = $(bxgyScope === 'select' ? 'p-bxgy-select' : 'p-bxgy-any');
  if (bxgyScopeEl) bxgyScopeEl.checked = true;
  // Support new freeProductSizes format (product+size) and legacy freeProductIds
  const savedFreeSizes = new Set();
  (bxgy.freeProductSizes || []).forEach(fs => savedFreeSizes.add(`${fs.productId}_${fs.size}`));
  if (savedFreeSizes.size === 0 && bxgy.freeProductIds?.length) {
    bxgy.freeProductIds.forEach(id => savedFreeSizes.add(`${id}_50ML`));
  }
  if ($('bxgy-products-wrap')) $('bxgy-products-wrap').style.display = bxgyScope === 'select' ? '' : 'none';
  document.querySelectorAll('input[name="bxgy-scope"]').forEach(r => r.addEventListener('change', e => {
    if ($('bxgy-products-wrap')) $('bxgy-products-wrap').style.display = e.target.value === 'select' ? '' : 'none';
    if (e.target.value === 'select' && !_bxgyAllProducts) loadBxgyProducts('');
  }));
  // Load products for free item selection — size-aware checkboxes
  const _BXGY_SIZES = ['6ML', '15ML', '30ML', '50ML'];
  let _bxgyAllProducts = null;
  async function loadBxgyProducts(filterText) {
    const list = $('bxgy-prod-list'); if (!list) return;
    list.innerHTML = '<span style="color:var(--text-muted);font-size:.8rem">Loading...</span>';
    try {
      if (!_bxgyAllProducts) {
        const snap = await getDocs(collection(db, 'products'));
        _bxgyAllProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      const ft = (filterText||'').toLowerCase();
      const filtered = ft ? _bxgyAllProducts.filter(p => (p.name||'').toLowerCase().includes(ft)) : _bxgyAllProducts;
      if (!filtered.length) { list.innerHTML = '<span style="color:var(--text-muted);font-size:.8rem">No products found.</span>'; return; }
      list.innerHTML = filtered.map(p => {
        const sizePrices = p.prices || {};
        const availSizes = _BXGY_SIZES.filter(s => sizePrices[s]);
        if (!availSizes.length) {
          // Fallback for products without granular pricing
          const key = `${p.id}_50ML`;
          const chk = savedFreeSizes.has(key) ? 'checked' : '';
          return `<label style="display:flex;align-items:center;gap:.5rem;padding:.28rem .4rem;border-radius:5px;cursor:pointer;">
            <input type="checkbox" class="bxgy-prod-chk" value="${key}" ${chk}>
            <span style="flex:1;">${p.name||p.id}</span>
            ${p.price?`<span style="color:var(--text-muted);font-size:.78rem;">৳${p.price}</span>`:''}
          </label>`;
        }
        return `<div style="margin-bottom:.45rem;padding:.45rem .55rem;border-radius:7px;background:#fafafa;border:1px solid #eee;">
          <div style="font-size:.82rem;font-weight:600;color:#1a1a1a;margin-bottom:.3rem;">${p.name||p.id}</div>
          <div style="display:flex;flex-wrap:wrap;gap:.3rem;">
            ${availSizes.map(s => {
              const key = `${p.id}_${s}`;
              const isChk = savedFreeSizes.has(key);
              return `<label style="display:inline-flex;align-items:center;gap:.22rem;font-size:.76rem;padding:.18rem .45rem;border-radius:20px;border:1.5px solid ${isChk?'#163E34':'#ddd'};background:${isChk?'#e8f5e9':'#fff'};cursor:pointer;">
                <input type="checkbox" class="bxgy-prod-chk" value="${key}" ${isChk?'checked':''}>${s}<span style="color:var(--text-muted);font-size:.7rem;margin-left:.12rem;">৳${sizePrices[s]}</span>
              </label>`;
            }).join('')}
          </div>
        </div>`;
      }).join('');
    } catch(e) { list.innerHTML = `<span style="color:#c0392b;font-size:.8rem">Error: ${e.message||'Could not load'}</span>`; }
  }
  $('bxgy-prod-search')?.addEventListener('input', e => loadBxgyProducts(e.target.value));
  if (bxgyScope === 'select') loadBxgyProducts('');

  // BOGO
  const bogo=cfg.bogo||{};
  chk('p-bogo-on',bogo.enabled); num('p-bogo-pct',bogo.discountPct??100);

  // Tiered Discount
  const td=cfg.tieredDiscount||{};
  chk('p-tier-on',td.enabled);
  renderTierRows(td.tiers||[{min:1000,pct:5},{min:2000,pct:10},{min:3000,pct:15}]);

  // Free Gift
  const fg=cfg.freeGift||{};
  chk('p-fgift-on',fg.enabled); num('p-fgift-min',fg.threshold??2000); str('p-fgift-name',fg.productName||'Mini Sample');

  // First Order
  const fo=cfg.firstOrder||{};
  chk('p-fo-on',fo.enabled); str('p-fo-type',fo.type||'fixed'); num('p-fo-amt',fo.amount??100);

  // Free Shipping
  const fs=cfg.freeShipping||{};
  chk('p-fs-on',fs.enabled); num('p-fs-thresh',fs.threshold??1500);

  // Min Qty
  const mq=cfg.minQtyDiscount||{};
  chk('p-mqd-on',mq.enabled);
  renderMqdRows(mq.rules||[{qty:2,pct:5}]);

  // Bundle Builder
  const bb=cfg.bundleBuilder||{};
  chk('p-bb-on',bb.enabled); num('p-bb-min',bb.minItems??3); num('p-bb-pct',bb.pct??15);

  // Referral
  const ref=cfg.referral||{};
  chk('p-ref-on',ref.enabled); num('p-ref-fee',ref.refereeAmt??100); num('p-ref-rer',ref.referrerAmt??100);

  // Loyalty
  const lp=cfg.loyaltyPoints||{};
  chk('p-lp-on',lp.enabled); num('p-lp-earn',lp.earnPer??100); num('p-lp-val',lp.redeemValue??1); num('p-lp-min',lp.minRedeem??50);
  num('p-lp-min-order',lp.minOrderAmount??500); num('p-lp-max-pct',lp.maxRedeemPct??20);
  chk('p-lp-allow-promo', lp.allowDuringPromos!==false);
  chk('p-lp-allow-coupon', lp.allowWithCoupon!==false);
  chk('p-lp-allow-gift', lp.allowWithFreeGift!==false);
  // Enrollment mode
  const enrollMode = lp.enrollMode || 'auto';
  const enrollEl = $(enrollMode === 'approve' ? 'p-lp-approve' : 'p-lp-auto');
  if (enrollEl) enrollEl.checked = true;
  // Approval conditions
  const cond = lp.enrollConditions || {};
  num('p-lp-cond-min', cond.minPurchase ?? 0);
  if ($('p-lp-cond-text')) $('p-lp-cond-text').value = cond.text || '';
  const condWrap = document.getElementById('lp-conditions-wrap');
  if (condWrap) condWrap.style.display = enrollMode === 'approve' ? '' : 'none';
  // Tiers
  const tiersOn = !!(lp.tiers?.enabled);
  chk('p-lp-tiers-on', tiersOn);
  if ($('lp-tiers-wrap')) $('lp-tiers-wrap').style.display = tiersOn ? '' : 'none';
  const lt = lp.tiers || {};
  num('p-lp-silver-min', lt.silver?.minSpend??0); num('p-lp-silver-mult', lt.silver?.mult??1);
  num('p-lp-gold-min',   lt.gold?.minSpend??8000); num('p-lp-gold-mult',   lt.gold?.mult??2);
  num('p-lp-plat-min',   lt.platinum?.minSpend??15000); num('p-lp-plat-mult',  lt.platinum?.mult??3);
  $('p-lp-tiers-on')?.addEventListener('change', e => {
    if ($('lp-tiers-wrap')) $('lp-tiers-wrap').style.display = e.target.checked ? '' : 'none';
  });
  // Spin to Win
  const spin=cfg.spinToWin||{};
  chk('p-spin-on',spin.enabled); num('p-spin-sec',spin.showAfterSec??8);
  renderSpinPrizes(spin.prizes||[]);

  // Seasonal
  const seas=cfg.seasonal||{};
  chk('p-seas-on',seas.enabled);
  renderSeasEvents(seas.events||[]);

  // Combo
  const combo=cfg.comboDiscount||{};
  chk('p-combo-on',combo.enabled);
  renderComboRows(combo.combos||[]);

  function renderTierRows(tiers) {
    const wrap=$('p-tier-rows'); if(!wrap) return;
    wrap.innerHTML = tiers.map((t,i) =>
      `<div class="promo-row" data-tier="${i}"><label>Spend >= (TK)</label><input class="promo-input" data-field="min" type="number" min="0" value="${t.min}" style="width:80px;"><label>-></label><input class="promo-input" data-field="pct" type="number" min="1" max="99" value="${t.pct}" style="width:60px;"><label>%</label><button onclick="this.closest('[data-tier]').remove()" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem;padding:0;">x</button></div>`
    ).join('');
  }
  $('p-tier-add')?.addEventListener('click',()=>{
    const wrap=$('p-tier-rows'); if(!wrap) return;
    const div=document.createElement('div'); div.className='promo-row'; div.dataset.tier=wrap.children.length;
    div.innerHTML=`<label>Spend >= (TK)</label><input class="promo-input" data-field="min" type="number" min="0" value="500" style="width:80px;"><label>-></label><input class="promo-input" data-field="pct" type="number" min="1" max="99" value="5" style="width:60px;"><label>%</label><button onclick="this.closest('[data-tier]').remove()" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem;padding:0;">x</button>`;
    wrap.appendChild(div);
  });

  function renderMqdRows(rules) {
    const wrap=$('p-mqd-rows'); if(!wrap) return;
    wrap.innerHTML = rules.map((r,i) =>
      `<div class="promo-row" data-mqd="${i}"><label>Buy >=</label><input class="promo-input" data-field="qty" type="number" min="2" value="${r.qty}" style="width:70px;"><label>items -></label><input class="promo-input" data-field="pct" type="number" min="1" max="99" value="${r.pct}" style="width:60px;"><label>% off</label><button onclick="this.closest('[data-mqd]').remove()" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem;padding:0;">x</button></div>`
    ).join('');
  }
  $('p-mqd-add')?.addEventListener('click',()=>{
    const wrap=$('p-mqd-rows'); if(!wrap) return;
    const div=document.createElement('div'); div.className='promo-row'; div.dataset.mqd=wrap.children.length;
    div.innerHTML=`<label>Buy >=</label><input class="promo-input" data-field="qty" type="number" min="2" value="2" style="width:70px;"><label>items -></label><input class="promo-input" data-field="pct" type="number" min="1" max="99" value="5" style="width:60px;"><label>% off</label><button onclick="this.closest('[data-mqd]').remove()" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem;padding:0;">x</button>`;
    wrap.appendChild(div);
  });

  function renderSpinPrizes(prizes) {
    const wrap=$('p-spin-prizes'); if(!wrap) return;
    wrap.innerHTML = prizes.map((p,i) =>
      `<div class="promo-row" data-prize="${i}" style="margin-top:.4rem;align-items:center;">
        <input class="promo-input" data-field="label" type="text" value="${escapeHtml(p.label||'')}" placeholder="Label" style="width:100px;">
        <input class="promo-input" data-field="code" type="text" value="${escapeHtml(p.code||'')}" placeholder="Code" style="width:90px;text-transform:uppercase;">
        <input class="promo-input" data-field="prob" type="number" min="1" max="100" value="${p.prob||10}" placeholder="%" style="width:60px;" title="Probability (higher = appears more often)">
        <span style="color:var(--text-muted);font-size:.78rem;">%</span>
        <input class="promo-input" data-field="maxWinners" type="number" min="0" value="${p.maxWinners||0}" placeholder="0=সীমাহীন" style="width:80px;" title="কতজন customer এই prize জিততে পারবে — 0 লিখলে unlimited">
        <span style="color:var(--text-muted);font-size:.75rem;">${p.wonCount?`won:${p.wonCount}`:''}</span>
        <button onclick="this.closest('[data-prize]').remove()" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem;padding:0 .3rem;">×</button>
      </div>`
    ).join('');
  }

  function renderSeasEvents(events) {
    const wrap=$('p-seas-events'); if(!wrap) return;
    wrap.innerHTML = events.map((e,i) =>
      `<div class="promo-row" data-seas="${i}" style="flex-wrap:wrap;gap:.4rem;"><input class="promo-input" data-field="name" type="text" value="${escapeHtml(e.name||'')}" placeholder="Event name" style="width:110px;"><input class="promo-input" data-field="pct" type="number" min="1" max="99" value="${e.pct||10}" style="width:55px;"><label>%</label><input class="promo-input" data-field="startAt" type="date" value="${(e.startAt||'').slice(0,10)}" style="width:125px;"><label>to</label><input class="promo-input" data-field="endAt" type="date" value="${(e.endAt||'').slice(0,10)}" style="width:125px;"><button onclick="this.closest('[data-seas]').remove()" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem;padding:0;">x</button></div>`
    ).join('');
  }
  $('p-seas-add')?.addEventListener('click',()=>{
    const wrap=$('p-seas-events'); if(!wrap) return;
    const div=document.createElement('div'); div.className='promo-row'; div.dataset.seas=wrap.children.length;
    div.innerHTML=`<input class="promo-input" data-field="name" type="text" placeholder="Event name" style="width:110px;"><input class="promo-input" data-field="pct" type="number" min="1" max="99" value="10" style="width:55px;"><label>%</label><input class="promo-input" data-field="startAt" type="date" style="width:125px;"><label>to</label><input class="promo-input" data-field="endAt" type="date" style="width:125px;"><button onclick="this.closest('[data-seas]').remove()" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem;padding:0;">x</button>`;
    wrap.appendChild(div);
  });

  function renderComboRows(combos) {
    const wrap=$('p-combo-rows'); if(!wrap) return;
    wrap.innerHTML = combos.map((c,i) =>
      `<div class="promo-row" data-combo="${i}" style="flex-wrap:wrap;gap:.4rem;"><input class="promo-input" data-field="label" type="text" value="${escapeHtml(c.label||'')}" placeholder="Label" style="width:110px;"><input class="promo-input" data-field="productIds" type="text" value="${(c.productIds||[]).join(',')}" placeholder="Product IDs (comma)" style="width:150px;"><input class="promo-input" data-field="pct" type="number" min="1" max="99" value="${c.pct||10}" style="width:55px;"><label>% off</label><button onclick="this.closest('[data-combo]').remove()" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem;padding:0;">x</button></div>`
    ).join('');
  }
  $('p-combo-add')?.addEventListener('click',()=>{
    const wrap=$('p-combo-rows'); if(!wrap) return;
    const div=document.createElement('div'); div.className='promo-row'; div.dataset.combo=wrap.children.length;
    div.innerHTML=`<input class="promo-input" data-field="label" type="text" placeholder="Label" style="width:110px;"><input class="promo-input" data-field="productIds" type="text" placeholder="Product IDs (comma)" style="width:150px;"><input class="promo-input" data-field="pct" type="number" min="1" max="99" value="10" style="width:55px;"><label>% off</label><button onclick="this.closest('[data-combo]').remove()" style="background:none;border:none;cursor:pointer;color:#c0392b;font-size:1rem;padding:0;">x</button>`;
    wrap.appendChild(div);
  });

  // Bundle Deals
  await loadBundles();

  async function loadBundles() {
    const list=$('p-bundle-list'); if(!list) return;
    list.innerHTML='<p class="muted-note" style="text-align:center;padding:1rem 0;">Loading...</p>';
    const bundles = await P.getAllBundles();
    if(!bundles.length){ list.innerHTML='<p class="muted-note" style="text-align:center;padding:1rem 0;">No bundles yet. Click New Bundle above.</p>'; return; }
    list.innerHTML=`<table class="admin-table"><thead><tr><th>Name</th><th>Price</th><th>Products</th><th>Status</th><th></th></tr></thead><tbody>${
      bundles.map(b=>`<tr><td><strong>${escapeHtml(b.name||'')}</strong></td><td>TK${b.price||0}</td><td class="muted-note" style="font-size:.78rem;">${(b.productIds||[]).length} product(s)</td><td><span class="badge" style="${b.enabled!==false?'background:#e6f4ea;color:#1e7e34;':'background:#f0f0f0;color:#555;'}">${b.enabled!==false?'Active':'Off'}</span></td><td style="white-space:nowrap;"><button class="icon-btn" data-bundle-edit="${b.id}"><ion-icon name="create-outline"></ion-icon></button><button class="icon-btn danger" data-bundle-del="${b.id}"><ion-icon name="trash-outline"></ion-icon></button></td></tr>`).join('')
    }</tbody></table>`;
    list.querySelectorAll('[data-bundle-edit]').forEach(btn=>{ btn.addEventListener('click',()=>openBundleForm(bundles.find(b=>b.id===btn.dataset.bundleEdit))); });
    list.querySelectorAll('[data-bundle-del]').forEach(btn=>{ btn.addEventListener('click', async ()=>{
      if(!await zahrounConfirm('Delete this bundle?',{danger:true})) return;
      await P.deleteBundle(btn.dataset.bundleDel); await loadBundles();
    }); });
  }

  function buildProductChecks(selected=[]) {
    const wrap=$('pb-product-checks'); if(!wrap) return;
    wrap.innerHTML=(products||[]).map(p=>`<label style="display:flex;align-items:center;gap:.4rem;font-size:.82rem;cursor:pointer;padding:.25rem .5rem;border:1px solid var(--border-color);border-radius:6px;"><input type="checkbox" value="${p.id}" ${selected.includes(String(p.id))?'checked':''}> ${escapeHtml(p.name||'')}</label>`).join('');
  }

  let _editingBundleId=null;
  function openBundleForm(bundle) {
    const form=$('p-bundle-form'); if(!form) return;
    _editingBundleId=bundle?.id||null;
    $('p-bundle-form-title').textContent=bundle?'Edit Bundle':'New Bundle';
    str('pb-name',bundle?.name||''); num('pb-price',bundle?.price||'');
    str('pb-image',bundle?.image||''); chk('pb-enabled',bundle?.enabled!==false);
    buildProductChecks((bundle?.productIds||[]).map(String));
    form.style.display=''; form.scrollIntoView({behavior:'smooth',block:'start'});
  }

  $('p-bundle-add-btn')?.addEventListener('click',()=>openBundleForm(null));
  $('pb-cancel-btn')?.addEventListener('click',()=>{ $('p-bundle-form').style.display='none'; });
  $('pb-save-btn')?.addEventListener('click', async ()=>{
    const name=getStr('pb-name');
    if(!name){ adminToast('Bundle name required',false); return; }
    const productIds=[...($('pb-product-checks')?.querySelectorAll('input:checked')||[])].map(c=>c.value);
    const bundle={ name, price:getNum('pb-price'), productIds, image:getStr('pb-image'), enabled:getChk('pb-enabled'), updatedAt:new Date().toISOString() };
    if(_editingBundleId) bundle.id=_editingBundleId;
    await P.saveBundle(bundle);
    $('p-bundle-form').style.display='none';
    await loadBundles();
    adminToast('Bundle saved!');
  });

  // Save All
  $('promo-save-btn')?.addEventListener('click', async ()=>{
    const btn=$('promo-save-btn'); btn.disabled=true;

    const tierRows=[...($('p-tier-rows')?.querySelectorAll('[data-tier]')||[])];
    const tiers=tierRows.map(r=>({ min:parseFloat(r.querySelector("[data-field='min']")?.value)||0, pct:parseFloat(r.querySelector("[data-field='pct']")?.value)||0 })).filter(t=>t.min>0&&t.pct>0);

    const mqdRows=[...($('p-mqd-rows')?.querySelectorAll('[data-mqd]')||[])];
    const mqdRules=mqdRows.map(r=>({ qty:parseInt(r.querySelector("[data-field='qty']")?.value)||2, pct:parseFloat(r.querySelector("[data-field='pct']")?.value)||0 })).filter(r=>r.qty>=2&&r.pct>0);

    const prizeRows=[...($('p-spin-prizes')?.querySelectorAll('[data-prize]')||[])];
    const prizes=prizeRows.map(r=>({
      label: r.querySelector("[data-field='label']")?.value.trim()||'',
      code: (r.querySelector("[data-field='code']")?.value.trim()||'').toUpperCase()||null,
      prob: parseFloat(r.querySelector("[data-field='prob']")?.value)||0,
      maxWinners: parseInt(r.querySelector("[data-field='maxWinners']")?.value)||0,
      wonCount: parseInt(r.querySelector("[data-field='maxWinners']")?.closest('[data-prize]')?.querySelector('[data-field="wonCount"]')?.value)||0
    })).filter(p=>p.label&&p.prob>0);

    const seasRows=[...($('p-seas-events')?.querySelectorAll('[data-seas]')||[])];
    const events=seasRows.map(r=>({ name:r.querySelector("[data-field='name']")?.value.trim()||'', pct:parseFloat(r.querySelector("[data-field='pct']")?.value)||0, startAt:r.querySelector("[data-field='startAt']")?.value||'', endAt:r.querySelector("[data-field='endAt']")?.value||'', enabled:true })).filter(e=>e.name&&e.pct>0);

    const comboRows=[...($('p-combo-rows')?.querySelectorAll('[data-combo]')||[])];
    const combos=comboRows.map(r=>({ label:r.querySelector("[data-field='label']")?.value.trim()||'', productIds:(r.querySelector("[data-field='productIds']")?.value||'').split(',').map(s=>s.trim()).filter(Boolean), pct:parseFloat(r.querySelector("[data-field='pct']")?.value)||0 })).filter(c=>c.productIds.length>=2&&c.pct>0);

    // Collect BuyXGetY free product sizes (format: "productId_size")
    const bxgyFreeKeys = [...($('bxgy-prod-list')?.querySelectorAll('.bxgy-prod-chk:checked')||[])].map(c=>c.value);
    const bxgyFreeSizes = bxgyFreeKeys.map(k => {
      const parts = k.split('_');
      return { productId: parts[0], size: parts[1] || '50ML' };
    });
    const bxgyScopeVal = document.querySelector('input[name="bxgy-scope"]:checked')?.value || 'any';

    const newCfg={
      buyXGetY:       { enabled:getChk('p-bxgy-on'), rules:[{buy:getNum('p-bxgy-buy1'),getFree:getNum('p-bxgy-free1')},{buy:getNum('p-bxgy-buy2'),getFree:getNum('p-bxgy-free2')}], freeItemScope:bxgyScopeVal, freeProductSizes:bxgyFreeSizes },
      bogo:           { enabled:getChk('p-bogo-on'), discountPct:getNum('p-bogo-pct') },
      tieredDiscount: { enabled:getChk('p-tier-on'), tiers },
      freeGift:       { enabled:getChk('p-fgift-on'), threshold:getNum('p-fgift-min'), productName:getStr('p-fgift-name') },
      firstOrder:     { enabled:getChk('p-fo-on'), amount:getNum('p-fo-amt'), type:getStr('p-fo-type') },
      freeShipping:   { enabled:getChk('p-fs-on'), threshold:getNum('p-fs-thresh') },
      minQtyDiscount: { enabled:getChk('p-mqd-on'), rules:mqdRules },
      bundleBuilder:  { enabled:getChk('p-bb-on'), minItems:getNum('p-bb-min'), pct:getNum('p-bb-pct') },
      referral:       { enabled:getChk('p-ref-on'), refereeAmt:getNum('p-ref-fee'), referrerAmt:getNum('p-ref-rer') },
      loyaltyPoints:  cfg.loyaltyPoints || {},  // managed separately in the Loyalty section — preserve as-is
      spinToWin:      { enabled:getChk('p-spin-on'), showAfterSec:getNum('p-spin-sec'), prizes },
      seasonal:       { enabled:getChk('p-seas-on'), events },
      comboDiscount:  { enabled:getChk('p-combo-on'), combos }
    };

    try {
      await P.saveConfig(newCfg);
      const msg=$('promo-save-msg');
      if(msg){ msg.textContent='Saved successfully'; msg.style.display='block'; setTimeout(()=>{ msg.style.display='none'; },3000); }
      adminToast('Promotions saved!');
    } catch(e) {
      adminToast('Save failed: '+(e.message||e), false);
    } finally { btn.disabled=false; }
  });
}

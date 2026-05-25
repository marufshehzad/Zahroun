/* =========================================================================
   ZAHROUN — Admin dashboard logic
   ========================================================================= */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc, addDoc,
  serverTimestamp, Timestamp, query, limit, onSnapshot, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { uploadImage, optimizedUrl } from "./cloudinary.js";

const $ = (sel) => document.querySelector(sel);
const gate = $("#admin-gate");
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
  reviews: "Moderate customer reviews",
  messages: "Contact form submissions",
  analytics: "Traffic & sales insights",
  pages: "Manage hero banners, category cards & gallery images",
  settings: "Store configuration"
};
const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
const STATUS_COLORS = { pending: "#f0b429", confirmed: "#1a56b8", shipped: "#7c3aed", delivered: "#1e7e34", cancelled: "#9b2226" };

/* ---- Admin gate -------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    gateMsg.innerHTML = 'Please <a href="index.html" style="color:var(--primary-color);">log in</a> first, then open the Admin Panel from the account menu.';
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().role !== "admin") {
      gateMsg.innerHTML = 'Access denied — this account is not an admin.<br><a href="index.html" style="color:var(--primary-color);">Back to site</a>';
      return;
    }
    gate.style.display = "none";
    app.style.display = "block";
    initAdmin(user, snap.data());
  } catch (e) {
    gateMsg.textContent = "Could not verify access: " + (e.code || e.message);
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
  $("#product-form").addEventListener("submit", saveProduct);

  // Notification bell
  const notifBtn = document.getElementById("notif-btn");
  const notifDrop = document.getElementById("notif-dropdown");
  if (notifBtn) {
    notifBtn.addEventListener("click", e => {
      e.stopPropagation();
      const open = notifDrop.style.display !== "none";
      notifDrop.style.display = open ? "none" : "";
      if (!open) {
        orders.filter(o => isNewOrder(o)).forEach(o => acknowledgedOrderIds.add(o.id));
        localStorage.setItem("ackOrderIds", JSON.stringify([...acknowledgedOrderIds]));
        updateNotifications();
      }
    });
    document.addEventListener("click", e => {
      if (!document.getElementById("notif-wrap")?.contains(e.target)) notifDrop.style.display = "none";
    });
  }

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
  renderDashboard();
  updateNotifications();
  // Show unread messages badge without blocking
  fetchMessages().catch(() => {});
  // Real-time new-order notifications
  startOrderListener();
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

/* ---- Section switcher — lazy render ------------------------------------ */
function switchSection(name) {
  document.querySelectorAll("#admin-nav button").forEach(b => b.classList.toggle("active", b.dataset.section === name));
  document.querySelectorAll("[data-panel]").forEach(p => p.style.display = p.dataset.panel === name ? "" : "none");
  $("#section-title").textContent = name.charAt(0).toUpperCase() + name.slice(1);
  $("#section-subtitle").textContent = SUBTITLES[name] || "";

  if (name === "dashboard") {
    renderDashboard();
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
    else if (name === "reviews") fetchReviews().then(renderReviewTable);
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
  const weekAgo = Date.now() / 1000 - 7 * 86400;
  const inWeek = (ts) => ts && ts.seconds >= weekAgo;
  const active = orders.filter(o => o.status !== "cancelled");
  const totalRevenue = active.reduce((s, o) => s + (o.total || 0), 0);

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
  updateOrdersBadge();
  renderRevenueChart();
  renderStatusChart();
  renderRecentOrders();
  renderTopSelling();
  setDateRange();
  renderStockAlerts();
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
    tbody.innerHTML = `<tr><td colspan="8" class="muted-note" style="padding:2rem;text-align:center;">${products.length ? "No products match your filters." : "No products yet."}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((p, i) => {
    const price = (p.prices && p.prices["50ML"]) ? p.prices["50ML"] : (p.price || 0);
    const flags = [p.featured ? `<span class="badge green">Featured</span>` : "", p.bestseller ? `<span class="badge">Bestseller</span>` : "", p.hidden ? `<span class="badge">Hidden</span>` : ""].join(" ");
    return `<tr>
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
}

function isNewOrder(o) {
  try {
    const ms = o.createdAt?.toMillis ? o.createdAt.toMillis() : o.createdAt?.seconds ? o.createdAt.seconds * 1000 : null;
    return ms && (Date.now() - ms) < 86400000;
  } catch { return false; }
}

async function changeOrderStatus(orderId, newStatus) {
  const order = orders.find(o => o.id === orderId);
  const prevStatus = order?.status || "pending";
  try {
    if (newStatus === "confirmed" && prevStatus !== "confirmed") await deductOrderStock(order);
    if (newStatus === "cancelled" && prevStatus !== "cancelled") await restoreOrderStock(order);
    await updateDoc(doc(db, "orders", orderId), { status: newStatus });
    if (order) order.status = newStatus;
    updateOrdersBadge(); renderOrderTable(); renderDashboard(); updateNotifications();
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
    const items = (o.items || []).map(i => `${escapeHtml(i.name)} (${i.size}) ×${i.quantity}`).join("<br>");
    return `<tr data-oid="${o.id}" style="cursor:pointer;">
      <td><strong>${o.orderNum ? "#" + o.orderNum : "#" + o.id.slice(0,6).toUpperCase()}</strong></td>
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
      <td><select data-order="${o.id}" style="padding:.35rem;border-radius:6px;border:1px solid var(--border-color);">${opts(st)}</select></td>
      <td class="muted-note">${fmtDate(o.createdAt)}</td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("select[data-order]").forEach(sel => {
    sel.addEventListener("change", async () => { sel.disabled = true; await changeOrderStatus(sel.dataset.order, sel.value); });
  });
  tbody.querySelectorAll("tr[data-oid]").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest("select")) return;
      const order = orders.find(o => o.id === row.dataset.oid);
      if (order) openOrderDetail(order);
    });
  });

  // Mobile cards
  if (!cardsWrap) return;
  cardsWrap.innerHTML = visible.map(o => {
    const c = o.customer || {};
    const st = o.status || "pending";
    const ordId = o.orderNum ? "#" + String(o.orderNum).padStart(6,"0") : "#" + o.id.slice(0,6).toUpperCase();
    const initial = (c.name || "?")[0].toUpperCase();
    const d = fmtDate(o.createdAt);
    const itemsHtml = (o.items || []).map(i =>
      `<div class="orc-item"><span>${escapeHtml(i.name)} <span class="orc-size">(${i.size})</span></span><span class="orc-qty">×${i.quantity}</span></div>`
    ).join("");
    return `<div class="orc" data-oid="${o.id}">
      <div class="orc-head">
        <div>
          <div class="orc-ordnum">${ordId}</div>
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
    sel.addEventListener("change", async () => { sel.disabled = true; await changeOrderStatus(sel.dataset.order, sel.value); });
  });
}

async function verifyPayment(orderId) {
  try {
    await updateDoc(doc(db, "orders", orderId), { paymentStatus: "verified", status: "confirmed" });
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) { orders[idx].paymentStatus = "verified"; orders[idx].status = "confirmed"; }
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
  if (!confirm("Undo payment verification? Order will return to pending.")) return;
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
  $("#customers-count").textContent = `${customers.length} user(s)`;
  if (!customers.length) { tbody.innerHTML = `<tr><td colspan="4" class="muted-note" style="padding:2rem;text-align:center;">No users.</td></tr>`; return; }
  tbody.innerHTML = customers.map(u => `<tr>
    <td>${escapeHtml(u.name || "—")}</td>
    <td>${escapeHtml(u.email || "—")}</td>
    <td><span class="badge ${u.role === "admin" ? "green" : ""}">${escapeHtml(u.role || "customer")}</span></td>
    <td class="muted-note">${fmtDate(u.createdAt)}</td>
  </tr>`).join("");
  const expBtn = document.getElementById("export-customers-btn");
  if (expBtn && !expBtn._wired) { expBtn._wired = true; expBtn.addEventListener("click", exportCustomersCSV); }
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
  if (!confirm("Delete this category?")) return;
  try { await deleteDoc(doc(db, "categories", id)); await fetchCategories(); renderCategoryTable(); }
  catch (err) { alert("Delete failed: " + (err.code || err.message)); }
}

/* ---- Coupons ----------------------------------------------------------- */
function renderCouponTable() {
  const tbody = $("#coupon-rows");
  if (!coupons.length) { tbody.innerHTML = `<tr><td colspan="7" class="muted-note" style="padding:2rem;text-align:center;">No coupons yet.</td></tr>`; return; }
  tbody.innerHTML = coupons.map(c => {
    const discountText = c.type === "percent" ? `${c.value}% off` : `৳${c.value} off`;
    const isExpired = c.expiresAt && c.expiresAt.toDate && c.expiresAt.toDate() < new Date();
    const expiryText = c.expiresAt ? (c.expiresAt.toDate ? c.expiresAt.toDate().toLocaleDateString("en-GB") : c.expiresAt) : "No expiry";
    const maxText = c.maxUses ? `${c.usedCount || 0}/${c.maxUses}` : `${c.usedCount || 0}/∞`;
    const statusLabel = isExpired ? "expired" : (c.active ? "active" : "inactive");
    return `<tr>
      <td><code style="font-size:.9rem;font-weight:700;letter-spacing:1px;">${escapeHtml(c.id)}</code></td>
      <td>${discountText}</td>
      <td>${c.minOrder ? `৳${c.minOrder}` : "—"}</td>
      <td>${maxText}</td>
      <td class="${isExpired ? "muted-note" : ""}">${expiryText}</td>
      <td><span class="badge ${c.active && !isExpired ? "green" : ""}">${statusLabel}</span></td>
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
    if (coupon.expiresAt && coupon.expiresAt.toDate) f.querySelector("[name=expiresAt]").value = coupon.expiresAt.toDate().toISOString().split("T")[0];
  } else {
    codeInput.readOnly = false;
    f.querySelector("[name=active]").checked = true;
  }
  $("#coupon-modal").classList.add("open");
}
function closeCouponForm() { $("#coupon-modal").classList.remove("open"); }

async function saveCoupon(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Saving…";
  const code = f.querySelector("[name=code]").value.trim().toUpperCase();
  if (!code) { alert("Code is required"); btn.disabled = false; btn.textContent = "Save Coupon"; return; }
  const expiresVal = f.querySelector("[name=expiresAt]").value;
  try {
    await setDoc(doc(db, "coupons", code), {
      type: f.querySelector("[name=type]").value,
      value: parseFloat(f.querySelector("[name=value]").value) || 0,
      minOrder: parseFloat(f.querySelector("[name=minOrder]").value) || 0,
      maxUses: parseInt(f.querySelector("[name=maxUses]").value) || 0,
      active: f.querySelector("[name=active]").checked,
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
  if (!confirm(`Delete coupon "${id}"?`)) return;
  try { await deleteDoc(doc(db, "coupons", id)); await fetchCoupons(); renderCouponTable(); }
  catch (err) { alert("Delete failed: " + (err.code || err.message)); }
}

/* ---- Reviews ----------------------------------------------------------- */
function renderReviewTable() {
  const tbody = $("#review-rows");
  if (!reviews.length) { tbody.innerHTML = `<tr><td colspan="7" class="muted-note" style="padding:2rem;text-align:center;">No reviews yet.</td></tr>`; return; }
  tbody.innerHTML = reviews.map(r => {
    const stars = "★".repeat(r.rating || 0) + "☆".repeat(5 - (r.rating || 0));
    const isPending = !r.status || r.status === "pending";
    const isApproved = r.status === "approved";
    return `<tr>
      <td style="font-size:.85rem;">${escapeHtml(r.productName || "—")}</td>
      <td style="font-size:.85rem;">${escapeHtml(r.reviewerName || "—")}<br><span class="muted-note">${escapeHtml(r.reviewerEmail || "")}</span></td>
      <td style="color:#f0b429;letter-spacing:1px;font-size:.9rem;">${stars}</td>
      <td style="font-size:.82rem;max-width:200px;word-break:break-word;">${escapeHtml(r.text || "")}</td>
      <td><span class="badge ${isApproved ? "green" : r.status === "rejected" ? "" : ""}" style="${r.status === "rejected" ? "background:#fdecea;color:#9b2226;" : ""}">${r.status || "pending"}</span></td>
      <td class="muted-note">${fmtDate(r.createdAt)}</td>
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
  if (!confirm("Delete this review permanently?")) return;
  try {
    await deleteDoc(doc(db, "reviews", id));
    reviews = reviews.filter(r => r.id !== id);
    renderReviewTable();
  } catch (err) { alert("Failed: " + (err.code || err.message)); }
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
    if (!confirm("Delete this message?")) return;
    await deleteDoc(doc(db, "messages", b.dataset.msgDel));
    messages = messages.filter(m => m.id !== b.dataset.msgDel);
    renderMessagesTable();
    fetchMessages();
  }));
}

/* ---- Settings ---------------------------------------------------------- */
function renderSettingsForm() {
  const f = $("#settings-form");
  if (!f) return;
  f.querySelector("[name=whatsapp]").value = settings.whatsapp || "";
  f.querySelector("[name=contactEmail]").value = settings.contactEmail || "";
  f.querySelector("[name=announcement]").value = settings.announcement || "";
  f.querySelector("[name=announcementActive]").checked = !!settings.announcementActive;
  f.querySelector("[name=heroTitle]").value = settings.heroTitle || "";
  f.querySelector("[name=heroSubtitle]").value = settings.heroSubtitle || "";
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
  } else { f.id.value = ""; }
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
      galleryImages.push(url);
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
  const image = galleryImages[0] || (editing && editing.image) || "";
  const images = galleryImages.length ? [...galleryImages] : (editing?.images ? [...editing.images] : (image ? [image] : []));
  const sizeImages = {};
  SIZE_KEYS.forEach(k => { sizeImages[k] = sizeImagesMap[k] || image; });
  const data = {
    id, name: f.name.value.trim(), category: f.category.value, price: price50, prices, image, images, sizeImages: sizeImages || {},
    description: f.description.value.trim(), ingredients: f.ingredients.value.trim(),
    tags: { gender: f.gender.value.trim(), type: f.type.value.trim(), concentration: f.concentration.value.trim() },
    fragrance_notes: csv(f.fragrance_notes.value), seasons: csv(f.seasons.value), occasions: csv(f.occasions.value),
    stock: numOrNull(f.stock.value) ?? 0,
    featured: f.featured.checked, bestseller: f.bestseller.checked, newArrival: f.newArrival.checked, hidden: f.hidden.checked,
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
  if (!confirm(`Delete "${p ? p.name : id}"? This cannot be undone.`)) return;
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
      ${items.map(i => `
        <div style="display:flex;align-items:center;gap:.75rem;padding:.6rem 0;border-bottom:1px solid #f0eee8;">
          ${i.image ? `<img src="${optimizedUrl(i.image, 50)}" alt="" style="width:44px;height:44px;object-fit:contain;background:var(--bg-color);border-radius:6px;flex-shrink:0;">` : ""}
          <div style="flex:1;font-size:.88rem;">
            <div>${escapeHtml(i.name || "")}</div>
            <div style="color:var(--text-muted);font-size:.8rem;">${escapeHtml(i.size || "")} × ${i.quantity || 1}</div>
          </div>
          <div style="text-align:right;font-size:.88rem;">৳${((i.price || 0) * (i.quantity || 1)).toLocaleString()}</div>
        </div>`).join("")}
    </div>

    <div style="background:var(--bg-color);border-radius:8px;padding:1rem;margin-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.4rem;"><span style="color:var(--text-muted);">Subtotal</span><span>৳${subtotal.toLocaleString()}</span></div>
      ${discount ? `<div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.4rem;color:#1e7e34;"><span>Discount (${escapeHtml(couponCode)})</span><span>−৳${Number(discount).toLocaleString()}</span></div>` : ""}
      ${order.deliveryCharge ? `<div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.4rem;"><span style="color:var(--text-muted);">Delivery</span><span>৳${Number(order.deliveryCharge).toLocaleString()}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:1rem;border-top:1px solid var(--border-color);padding-top:.65rem;margin-top:.5rem;">
        <span>Total</span><span style="color:var(--primary-color);">৳${(order.total || 0).toLocaleString()}</span>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:.3rem;">Status</div>
        <span class="o-status ${escapeHtml(order.status || "pending")}">${escapeHtml(order.status || "pending")}</span>
      </div>
      <div style="text-align:right;">
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.05em;margin-bottom:.3rem;">Ordered</div>
        <div style="font-size:.85rem;">${fmtDate(order.createdAt)}</div>
      </div>
    </div>`;
  document.getElementById("order-detail-modal").classList.add("open");
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
    html += `<div style="padding:.45rem 1rem .2rem;font-size:.67rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--primary-color);">New Orders</div>`;
    html += newOrds.slice(0, 6).map(o => {
      const c = o.customer || {};
      const num = o.orderNum || o.id.slice(0, 8).toUpperCase();
      const ms = o.createdAt?.toMillis ? o.createdAt.toMillis() : (o.createdAt?.seconds || 0) * 1000;
      const isNew = !acknowledgedOrderIds.has(o.id);
      return `<div class="notif-item" data-goto="orders" style="display:flex;align-items:center;gap:.7rem;padding:.65rem 1rem;border-bottom:1px solid #f0eee8;cursor:pointer;background:${isNew ? '#fffaf5' : '#fff'};">
        <ion-icon name="cart-outline" style="font-size:1.2rem;color:var(--primary-color);flex-shrink:0;"></ion-icon>
        <div style="flex:1;min-width:0;">
          <div style="font-size:.82rem;font-weight:600;">#${escapeHtml(String(num))}${isNew ? '<span class="notif-new-pill">NEW</span>' : ''}</div>
          <div style="font-size:.74rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.name || "Customer")} · ৳${(o.total || 0).toLocaleString()}</div>
        </div>
        <span style="font-size:.7rem;color:var(--text-muted);white-space:nowrap;flex-shrink:0;">${timeAgo(ms)}</span>
      </div>`;
    }).join("");
  }

  const summaryItems = [];
  if (unreadMsgs) summaryItems.push({ icon: "mail-outline", text: `${unreadMsgs} unread message${unreadMsgs > 1 ? "s" : ""}`, go: "messages", color: "#1a56b8" });
  if (lowStock) summaryItems.push({ icon: "warning-outline", text: `${lowStock} product${lowStock > 1 ? "s" : ""} low in stock (<10)`, go: "products", color: "#9b2226" });
  html += summaryItems.map(item => `
    <div class="notif-item" data-goto="${item.go}" style="display:flex;align-items:center;gap:.7rem;padding:.75rem 1rem;border-bottom:1px solid #f0eee8;cursor:pointer;">
      <ion-icon name="${item.icon}" style="font-size:1.2rem;color:${item.color};flex-shrink:0;"></ion-icon>
      <span style="font-size:.85rem;">${item.text}</span>
      <ion-icon name="chevron-forward-outline" style="margin-left:auto;color:var(--text-muted);font-size:.9rem;"></ion-icon>
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
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

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
      statusEl.textContent = "File exceeds 5MB limit.";
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
      if (fileInput._uploadedUrl) fileInput._uploadedUrl = null;
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

async function handleGalleryPageUpload(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const statusEl = document.getElementById("status-gallery-multi");
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      statusEl.textContent = `"${file.name}" exceeds 5MB limit. Skipped.`;
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
    const heroDesktop = getPageUrl("prev-hero-desktop") || hp.heroDesktop || null;
    const heroMobile = getPageUrl("prev-hero-mobile") || hp.heroMobile || null;
    const catForHer = getPageUrl("prev-cat-forher") || hp.catImages?.forHer || null;
    const catUnisex = getPageUrl("prev-cat-unisex") || hp.catImages?.unisex || null;
    const catForHim = getPageUrl("prev-cat-forhim") || hp.catImages?.forHim || null;
    const prevWhy = hp.whyChoose || [];
    const whyChoose = [0, 1, 2].map(i => ({
      icon: getPageUrl(`prev-why-${i}`) || prevWhy[i]?.icon || null
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
    const heroImage = getPageUrl("prev-about-hero") || ab.heroImage || null;
    const heroOpacity = parseFloat(document.getElementById("about-hero-opacity")?.value) || 0.5;
    const missionImage = getPageUrl("prev-about-mission") || ab.missionImage || null;
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
    const heroImage = getPageUrl("prev-contact-hero") || ct.heroImage || null;
    const activeMode = document.querySelector(".map-toggle button.active")?.dataset.mapmode || "iframe";
    let mapEmbed = null, mapImage = null;
    if (activeMode === "iframe") {
      mapEmbed = document.getElementById("contact-map-embed")?.value.trim() || null;
    } else {
      mapImage = getPageUrl("prev-contact-map") || ct.mapImage || null;
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
function adminToast(msg, ok = true) {
  let t = document.getElementById("a-toast");
  if (!t) { t = document.createElement("div"); t.id = "a-toast"; document.body.appendChild(t); }
  Object.assign(t.style, { position: "fixed", bottom: "2rem", left: "50%", transform: "translateX(-50%)", background: ok ? "#163E34" : "#9b2226", color: "#fff", padding: ".75rem 2rem", borderRadius: "50px", fontFamily: "var(--font-sans)", fontSize: ".9rem", zIndex: "100000", opacity: "1", transition: "opacity .3s", maxWidth: "90vw", textAlign: "center", pointerEvents: "none" });
  t.textContent = (ok ? "✓ " : "⚠ ") + msg;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.opacity = "0"; }, 3200);
}

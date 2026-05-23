/* =========================================================================
   ZAHROUN — Admin dashboard logic
   ========================================================================= */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc,
  serverTimestamp, query, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { uploadImage, optimizedUrl } from "./cloudinary.js";

const $ = (sel) => document.querySelector(sel);
const gate = $("#admin-gate");
const gateMsg = $("#gate-msg");
const app = $("#admin-app");

let products = [], orders = [], customers = [], categories = [], coupons = [], reviews = [], messages = [], newsletter = [];
let settings = {};
let editing = null, editingCat = null, editingCoupon = null;
let revenueChart = null, statusChart = null, anRevChart = null, anStatusChart = null;
let anDays = 30;
let pfSearch = "", pfCategory = "", pfSort = "default";
const pfFlags = new Set();
const sectionLoaded = new Set();

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
  $("#side-nm").innerHTML = `${escapeHtml(name)}<small>Administrator</small>`;

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
  $("#img-file").addEventListener("change", handleImageUpload);
  $("#product-form").addEventListener("submit", saveProduct);

  // Notification bell
  const notifBtn = document.getElementById("notif-btn");
  const notifDrop = document.getElementById("notif-dropdown");
  if (notifBtn) {
    notifBtn.addEventListener("click", e => {
      e.stopPropagation();
      const open = notifDrop.style.display !== "none";
      notifDrop.style.display = open ? "none" : "";
      if (!open) updateNotifications();
    });
    document.addEventListener("click", e => {
      if (!document.getElementById("notif-wrap")?.contains(e.target)) notifDrop.style.display = "none";
    });
  }

  // Order detail modal close
  document.getElementById("od-close")?.addEventListener("click", () => document.getElementById("order-detail-modal")?.classList.remove("open"));
  document.getElementById("order-detail-modal")?.addEventListener("click", e => { if (e.target.id === "order-detail-modal") e.target.classList.remove("open"); });

  // Fetch all data once at startup (needed for dashboard stats)
  await Promise.all([fetchProducts(), fetchOrders(), fetchCustomers()]);
  renderDashboard();
  updateNotifications();
  // Show unread messages badge without blocking
  fetchMessages().catch(() => {});
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
  } else if (name === "settings") {
    $("#settings-form").addEventListener("submit", saveSettings);
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
  const pending = orders.filter(o => o.status === "pending").length;
  const badge = $("#nav-orders-badge");
  if (pending) { badge.textContent = pending; badge.style.display = ""; } else { badge.style.display = "none"; }
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
      <span><strong>#${o.id.slice(0,6).toUpperCase()}</strong></span>
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
    tbody.innerHTML = `<tr><td colspan="7" class="muted-note" style="padding:2rem;text-align:center;">${products.length ? "No products match your filters." : "No products yet."}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(p => {
    const price = (p.prices && p.prices["50ML"]) ? p.prices["50ML"] : (p.price || 0);
    const flags = [p.featured ? `<span class="badge green">Featured</span>` : "", p.bestseller ? `<span class="badge">Bestseller</span>` : "", p.hidden ? `<span class="badge">Hidden</span>` : ""].join(" ");
    return `<tr>
      <td><img src="${optimizedUrl(p.image, 80)}" alt=""></td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.category || "")}</td>
      <td>৳${price}</td>
      <td>${p.stock ?? "—"}</td>
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

function renderOrderTable() {
  const tbody = $("#order-rows");
  $("#orders-count").textContent = `${orders.length} order(s)`;
  if (!orders.length) { tbody.innerHTML = `<tr><td colspan="7" class="muted-note" style="padding:2rem;text-align:center;">No orders yet.</td></tr>`; return; }
  tbody.innerHTML = orders.map(o => {
    const c = o.customer || {};
    const items = (o.items || []).map(i => `${escapeHtml(i.name)} (${i.size}) ×${i.quantity}`).join("<br>");
    const opts = ORDER_STATUSES.map(s => `<option value="${s}" ${(o.status || "pending") === s ? "selected" : ""}>${s}</option>`).join("");
    return `<tr data-oid="${o.id}" style="cursor:pointer;" title="Click for order details">
      <td><strong>#${o.id.slice(0,8).toUpperCase()}</strong></td>
      <td>${escapeHtml(c.name || "")}<br><span class="muted-note">${escapeHtml(c.mobile || "")}</span><br><span class="muted-note">${escapeHtml(c.address || "")}</span></td>
      <td style="font-size:.82rem;">${items}</td>
      <td>৳${o.total || 0}</td>
      <td>${escapeHtml(o.payment?.method || "")}${o.payment?.txnId ? `<br><span class="muted-note">${escapeHtml(o.payment.txnId)}</span>` : ""}</td>
      <td><select data-order="${o.id}" style="padding:.35rem;border-radius:6px;border:1px solid var(--border-color);">${opts}</select></td>
      <td class="muted-note">${fmtDate(o.createdAt)}</td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("select[data-order]").forEach(sel => {
    sel.addEventListener("change", async () => {
      sel.disabled = true;
      try {
        await updateDoc(doc(db, "orders", sel.dataset.order), { status: sel.value });
        const order = orders.find(o => o.id === sel.dataset.order);
        if (order) order.status = sel.value;
        updateOrdersBadge();
        renderOrderTable();
        renderDashboard();
        updateNotifications();
      } catch (e) { alert("Update failed: " + (e.code || e.message)); sel.disabled = false; }
    });
  });
  tbody.querySelectorAll("tr[data-oid]").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest("select")) return;
      const order = orders.find(o => o.id === row.dataset.oid);
      if (order) openOrderDetail(order);
    });
  });
  const expBtn = document.getElementById("export-orders-btn");
  if (expBtn && !expBtn._wired) { expBtn._wired = true; expBtn.addEventListener("click", exportOrdersCSV); }
}

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
      expiresAt: expiresVal ? new Date(expiresVal) : null,
      usedCount: editingCoupon ? (editingCoupon.usedCount || 0) : 0,
      updatedAt: serverTimestamp(),
      ...(!editingCoupon ? { createdAt: serverTimestamp() } : {})
    });
    closeCouponForm();
    await fetchCoupons();
    renderCouponTable();
    adminToast("Coupon saved.");
  } catch (err) { alert("Save failed: " + (err.code || err.message)); }
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
    const date = m.sentAt?.toDate ? m.sentAt.toDate().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
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
  const img = product?.image || "";
  f.image.value = img;
  const preview = $("#img-preview");
  if (img) { preview.src = optimizedUrl(img, 140); preview.style.display = "block"; } else { preview.style.display = "none"; }
  $("#img-status").textContent = "Upload to Cloudinary (max 10MB).";
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

function closeForm() { $("#product-modal").classList.remove("open"); }

async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = $("#img-status");
  statusEl.textContent = "Uploading… 0%";
  try {
    const { url } = await uploadImage(file, { onProgress: (p) => statusEl.textContent = `Uploading… ${p}%` });
    $("#product-form").image.value = url;
    const preview = $("#img-preview");
    preview.src = optimizedUrl(url, 140); preview.style.display = "block";
    statusEl.textContent = "✓ Image uploaded.";
  } catch (err) { statusEl.textContent = "⚠ " + err.message; }
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
  const image = f.image.value || (editing && editing.image) || "";
  let sizeImages = (editing && editing.sizeImages) ? editing.sizeImages : null;
  if (!sizeImages && image) sizeImages = { "6ML": image, "15ML": image, "30ML": image, "50ML": image };
  const data = {
    id, name: f.name.value.trim(), category: f.category.value, price: price50, prices, image, sizeImages: sizeImages || {},
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
      anDays = parseInt(btn.dataset.days) || 0;
      renderAnalytics();
    });
  });
}

function anFilterOrders(days) {
  if (!days) return orders;
  const cutoff = Date.now() / 1000 - days * 86400;
  return orders.filter(o => o.createdAt && o.createdAt.seconds >= cutoff);
}

function anFilterCustomers(days) {
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

  const labelMap = { 7: "Last 7 days", 30: "Last 30 days", 90: "Last 90 days", 0: "All time" };
  const labelEl = $("#an-chart-label");
  if (labelEl) labelEl.textContent = labelMap[anDays] || "";

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
  const max = steps[0].val || steps[1].val || 1;
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
  const c = order.customer || {};
  const items = order.items || [];
  const subtotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
  const couponCode = typeof order.coupon === "string" ? order.coupon : (order.coupon?.id || order.coupon?.code || "");
  const discount = order.couponDiscount || (typeof order.coupon === "object" ? order.coupon?.discount : 0) || 0;

  document.getElementById("od-order-id").textContent = `Order #${order.id.slice(0, 8).toUpperCase()}`;
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
          <strong>${escapeHtml(order.payment?.method || "—")}</strong><br>
          ${order.payment?.txnId ? `TxnID: <code style="font-size:.82rem;background:var(--bg-color);padding:.1rem .3rem;border-radius:4px;">${escapeHtml(order.payment.txnId)}</code><br>` : ""}
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

/* ---- Notification system ---------------------------------------------- */
function updateNotifications() {
  const pendingOrders = orders.filter(o => o.status === "pending").length;
  const unreadMsgs = messages.filter(m => !m.read).length;
  const lowStock = products.filter(p => p.stock !== undefined && p.stock !== null && p.stock < 10).length;
  const total = pendingOrders + unreadMsgs + lowStock;

  const badge = document.getElementById("notif-badge");
  if (badge) { badge.textContent = total; badge.style.display = total ? "" : "none"; }

  const list = document.getElementById("notif-list");
  if (!list) return;
  const items = [];
  if (pendingOrders) items.push({ icon: "cart-outline", text: `${pendingOrders} pending order${pendingOrders > 1 ? "s" : ""}`, go: "orders", color: "#f0b429" });
  if (unreadMsgs) items.push({ icon: "mail-outline", text: `${unreadMsgs} unread message${unreadMsgs > 1 ? "s" : ""}`, go: "messages", color: "#1a56b8" });
  if (lowStock) items.push({ icon: "warning-outline", text: `${lowStock} product${lowStock > 1 ? "s" : ""} low in stock (<10)`, go: "products", color: "#9b2226" });

  if (!items.length) {
    list.innerHTML = `<div style="padding:1.1rem 1rem;text-align:center;color:var(--text-muted);font-size:.85rem;">All clear ✓</div>`;
  } else {
    list.innerHTML = items.map(item => `
      <div class="notif-item" data-goto="${item.go}" style="display:flex;align-items:center;gap:.7rem;padding:.75rem 1rem;border-bottom:1px solid #f0eee8;cursor:pointer;">
        <ion-icon name="${item.icon}" style="font-size:1.2rem;color:${item.color};flex-shrink:0;"></ion-icon>
        <span style="font-size:.85rem;">${item.text}</span>
        <ion-icon name="chevron-forward-outline" style="margin-left:auto;color:var(--text-muted);font-size:.9rem;"></ion-icon>
      </div>`).join("");
    list.querySelectorAll(".notif-item").forEach(el => {
      el.addEventListener("click", () => {
        document.getElementById("notif-dropdown").style.display = "none";
        switchSection(el.dataset.goto);
      });
    });
  }
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

/* ---- Helpers ----------------------------------------------------------- */
function fmtDate(ts) {
  try { return ts && ts.toDate ? ts.toDate().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }
  catch { return "—"; }
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

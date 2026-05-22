/* =========================================================================
   ZAHROUN — Admin dashboard logic
   =========================================================================
   Loaded only by admin.html. Verifies the signed-in user is an admin, then
   reveals the dashboard and powers Product Management (list / add / edit /
   delete) with Cloudinary image uploads. Other sections are stubs for now.
   ========================================================================= */

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { uploadImage, optimizedUrl } from "./cloudinary.js";

const $ = (sel) => document.querySelector(sel);
const gate = $("#admin-gate");
const gateMsg = $("#gate-msg");
const app = $("#admin-app");

let products = [];        // cached product list
let editing = null;       // product being edited (or null when adding)

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
function initAdmin(user, profile) {
  $("#admin-who").textContent = (profile.name || user.email) + " · admin";

  $("#admin-logout").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "index.html";
  });

  // Sidebar section switching
  document.querySelectorAll("#admin-nav button").forEach(btn => {
    btn.addEventListener("click", () => switchSection(btn.dataset.section));
  });

  // Product actions
  $("#add-product-btn").addEventListener("click", () => openForm(null));
  $("#cancel-product").addEventListener("click", closeForm);
  $("#product-modal").addEventListener("click", (e) => { if (e.target.id === "product-modal") closeForm(); });
  $("#img-file").addEventListener("change", handleImageUpload);
  $("#product-form").addEventListener("submit", saveProduct);

  loadProducts();
  loadOrders();
  loadCustomers();
}

function switchSection(name) {
  document.querySelectorAll("#admin-nav button").forEach(b => b.classList.toggle("active", b.dataset.section === name));
  document.querySelectorAll("[data-panel]").forEach(p => p.style.display = p.dataset.panel === name ? "" : "none");
  $("#section-title").textContent = name.charAt(0).toUpperCase() + name.slice(1);
}

/* ---- Orders ------------------------------------------------------------ */
const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

function fmtDate(ts) {
  try { return ts && ts.toDate ? ts.toDate().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }
  catch { return "—"; }
}

async function loadOrders() {
  const tbody = $("#order-rows");
  try {
    const snap = await getDocs(collection(db, "orders"));
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    // Dashboard stats
    $("#stat-orders").textContent = orders.length;
    const revenue = orders.filter(o => o.status !== "cancelled").reduce((s, o) => s + (o.total || 0), 0);
    $("#stat-revenue").textContent = "৳" + revenue.toLocaleString();
    $("#orders-count").textContent = `${orders.length} order(s)`;

    if (!orders.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted-note" style="padding:2rem;text-align:center;">No orders yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = orders.map(o => {
      const c = o.customer || {};
      const items = (o.items || []).map(i => `${escapeHtml(i.name)} (${i.size}) ×${i.quantity}`).join("<br>");
      const opts = ORDER_STATUSES.map(s => `<option value="${s}" ${o.status === s ? "selected" : ""}>${s}</option>`).join("");
      return `<tr>
        <td><strong>#${o.id.slice(0,8).toUpperCase()}</strong></td>
        <td>${escapeHtml(c.name || "")}<br><span class="muted-note">${escapeHtml(c.mobile || "")}</span><br><span class="muted-note">${escapeHtml(c.address || "")}</span></td>
        <td style="font-size:.82rem;">${items}</td>
        <td>৳${o.total || 0}</td>
        <td>${escapeHtml(o.payment?.method || "")}${o.payment?.txnId ? `<br><span class="muted-note">${escapeHtml(o.payment.txnId)}</span>` : ""}</td>
        <td><select class="fg" data-order="${o.id}" style="padding:.35rem;border-radius:6px;border:1px solid var(--border-color);">${opts}</select></td>
        <td class="muted-note">${fmtDate(o.createdAt)}</td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll("select[data-order]").forEach(sel => {
      sel.addEventListener("change", async () => {
        sel.disabled = true;
        try { await updateDoc(doc(db, "orders", sel.dataset.order), { status: sel.value }); loadOrders(); }
        catch (e) { alert("Update failed: " + (e.code || e.message)); sel.disabled = false; }
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="warn" style="padding:1rem;">Failed to load orders: ${e.code || e.message}</td></tr>`;
  }
}

/* ---- Customers --------------------------------------------------------- */
async function loadCustomers() {
  const tbody = $("#customer-rows");
  try {
    const snap = await getDocs(collection(db, "users"));
    const users = snap.docs.map(d => d.data());
    $("#stat-customers").textContent = users.length;
    $("#customers-count").textContent = `${users.length} user(s)`;
    tbody.innerHTML = users.map(u => `<tr>
      <td>${escapeHtml(u.name || "—")}</td>
      <td>${escapeHtml(u.email || "—")}</td>
      <td><span class="badge ${u.role === "admin" ? "green" : ""}">${escapeHtml(u.role || "customer")}</span></td>
      <td class="muted-note">${fmtDate(u.createdAt)}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="muted-note" style="padding:2rem;text-align:center;">No users.</td></tr>`;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="warn" style="padding:1rem;">Failed to load: ${e.code || e.message}</td></tr>`;
  }
}

/* ---- Products: list ---------------------------------------------------- */
async function loadProducts() {
  const tbody = $("#product-rows");
  try {
    const snap = await getDocs(collection(db, "products"));
    products = snap.docs.map(d => ({ id: Number(d.id), ...d.data() })).sort((a, b) => a.id - b.id);
    $("#stat-products").textContent = products.length;

    if (!products.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted-note" style="padding:2rem;text-align:center;">No products yet. Click “Add Product”.</td></tr>`;
      return;
    }
    tbody.innerHTML = products.map(p => {
      const price = (p.prices && p.prices["50ML"]) ? p.prices["50ML"] : (p.price || 0);
      const flags = [
        p.featured ? `<span class="badge green">Featured</span>` : "",
        p.bestseller ? `<span class="badge">Bestseller</span>` : "",
        p.hidden ? `<span class="badge">Hidden</span>` : ""
      ].join(" ");
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

    tbody.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => {
      openForm(products.find(p => p.id === Number(b.dataset.edit)));
    }));
    tbody.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
      deleteProduct(Number(b.dataset.del));
    }));
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="warn" style="padding:1rem;">Failed to load: ${e.code || e.message}</td></tr>`;
  }
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
  if (img) { preview.src = optimizedUrl(img, 140); preview.style.display = "block"; }
  else { preview.style.display = "none"; }
  $("#img-status").textContent = "Upload to Cloudinary (max 10MB).";

  if (product) {
    f.id.value = product.id;
    f.name.value = product.name || "";
    f.category.value = product.category || "Men";
    f.description.value = product.description || "";
    f.ingredients.value = product.ingredients || "";
    const pr = product.prices || {};
    f.price6.value = pr["6ML"] || "";
    f.price15.value = pr["15ML"] || "";
    f.price30.value = pr["30ML"] || "";
    f.price50.value = pr["50ML"] || product.price || "";
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
  } else {
    f.id.value = "";
  }
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
    preview.src = optimizedUrl(url, 140);
    preview.style.display = "block";
    statusEl.textContent = "✓ Image uploaded.";
  } catch (err) {
    statusEl.textContent = "⚠ " + err.message;
  }
}

function csv(v) { return v.split(",").map(s => s.trim()).filter(Boolean); }
function numOrNull(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }

async function saveProduct(e) {
  e.preventDefault();
  const f = e.target;
  const saveBtn = $("#save-product");
  saveBtn.disabled = true; saveBtn.textContent = "Saving…";

  // Determine id (new = max existing + 1)
  let id = numOrNull(f.id.value);
  if (id === null) id = (products.reduce((m, p) => Math.max(m, p.id), 0) || 0) + 1;

  const price50 = numOrNull(f.price50.value) || 0;
  const prices = {};
  [["6ML", f.price6.value], ["15ML", f.price15.value], ["30ML", f.price30.value], ["50ML", f.price50.value]]
    .forEach(([k, v]) => { const n = numOrNull(v); if (n !== null) prices[k] = n; });

  const image = f.image.value || (editing && editing.image) || "";
  // Preserve per-size images on edit; for new products reuse the main image.
  let sizeImages = (editing && editing.sizeImages) ? editing.sizeImages : null;
  if (!sizeImages && image) sizeImages = { "6ML": image, "15ML": image, "30ML": image, "50ML": image };

  const data = {
    id,
    name: f.name.value.trim(),
    category: f.category.value,
    price: price50,
    prices,
    image,
    sizeImages: sizeImages || {},
    description: f.description.value.trim(),
    ingredients: f.ingredients.value.trim(),
    tags: { gender: f.gender.value.trim(), type: f.type.value.trim(), concentration: f.concentration.value.trim() },
    fragrance_notes: csv(f.fragrance_notes.value),
    seasons: csv(f.seasons.value),
    occasions: csv(f.occasions.value),
    stock: numOrNull(f.stock.value) ?? 0,
    featured: f.featured.checked,
    bestseller: f.bestseller.checked,
    newArrival: f.newArrival.checked,
    hidden: f.hidden.checked,
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(doc(db, "products", String(id)), data, { merge: true });
    closeForm();
    await loadProducts();
  } catch (err) {
    alert("Save failed: " + (err.code || err.message));
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = "Save Product";
  }
}

async function deleteProduct(id) {
  const p = products.find(x => x.id === id);
  if (!confirm(`Delete "${p ? p.name : id}"? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, "products", String(id)));
    await loadProducts();
  } catch (err) {
    alert("Delete failed: " + (err.code || err.message));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

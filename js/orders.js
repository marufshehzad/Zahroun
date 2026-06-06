/* =========================================================================
   ZAHROUN — Order helper (used by checkout.html)
   =========================================================================
   Exposes window.saveOrder() so the (classic) checkout script can persist an
   order to Firestore. Orders require a logged-in user (Firestore rules tie
   the order's uid to the authenticated account), which also powers the
   customer's order history and the admin Orders dashboard.
   ========================================================================= */

import { db, auth } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, doc, getDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

window.getCurrentUser = () => auth.currentUser;

window.saveOrder = async function (order) {
  const user = auth.currentUser;

  // Server-side stock validation — reads fresh Firestore values, not cache
  const stockErrors = [];
  await Promise.all((order.items || []).map(async item => {
    if (!item.id || !item.quantity) return;
    try {
      const snap = await getDoc(doc(db, "products", String(item.id)));
      if (snap.exists()) {
        const stock = snap.data().stock;
        if (typeof stock === "number" && stock < item.quantity) {
          stockErrors.push(
            stock === 0
              ? `"${item.name || item.id}" is out of stock.`
              : `"${item.name || item.id}": only ${stock} left (you ordered ${item.quantity}).`
          );
        }
      }
    } catch { /* read failure — allow order, admin corrects if needed */ }
  }));

  if (stockErrors.length > 0) {
    const err = new Error(stockErrors[0]);
    err.code = "out-of-stock";
    err.allErrors = stockErrors;
    throw err;
  }

  // 6-digit order number: 100000–999999
  const orderNum = 100000 + Math.floor(Math.random() * 900000);
  const ref = await addDoc(collection(db, "orders"), {
    ...order,
    orderNum,
    uid: user ? user.uid : null,
    userEmail: user ? (user.email || order.guestEmail || null) : (order.guestEmail || null),
    isGuest: !user,
    status: "pending",
    createdAt: serverTimestamp()
  });

  // Atomically decrement stock with floor at 0 — prevents negative stock
  await Promise.all((order.items || []).map(async item => {
    if (!item.id || !item.quantity) return;
    try {
      const prodRef = doc(db, "products", String(item.id));
      await runTransaction(db, async tx => {
        const snap = await tx.get(prodRef);
        if (snap.exists() && typeof snap.data().stock === "number") {
          tx.update(prodRef, { stock: Math.max(0, snap.data().stock - item.quantity) });
        }
      });
    } catch { /* stock update failed silently — admin can correct manually */ }
  }));

  return { id: ref.id, orderNum };
};

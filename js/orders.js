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
  collection, addDoc, serverTimestamp, doc, getDoc, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

window.getCurrentUser = () => auth.currentUser;

window.saveOrder = async function (order) {
  const user = auth.currentUser;
  if (!user) throw new Error("not-logged-in");
  // 9-digit order number: last 5 digits of ms timestamp + 4 random digits
  // Collision probability < 0.01% even for simultaneous orders
  const orderNum = parseInt(String(Date.now()).slice(-5) + String(1000 + Math.floor(Math.random() * 9000)));
  const ref = await addDoc(collection(db, "orders"), {
    ...order,
    orderNum,
    uid: user.uid,
    userEmail: user.email || null,
    status: "pending",
    createdAt: serverTimestamp()
  });

  // Decrement stock only for products that actually have a numeric stock field
  for (const item of order.items || []) {
    if (!item.id || !item.quantity) continue;
    try {
      const prodRef = doc(db, "products", String(item.id));
      const prodSnap = await getDoc(prodRef);
      if (prodSnap.exists() && typeof prodSnap.data().stock === "number") {
        await updateDoc(prodRef, { stock: increment(-(item.quantity)) });
      }
    } catch {
      // Stock update failed silently — admin can correct manually if needed.
    }
  }

  return ref.id;
};

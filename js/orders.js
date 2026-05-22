/* =========================================================================
   ZAHROUN — Order helper (used by checkout.html)
   =========================================================================
   Exposes window.saveOrder() so the (classic) checkout script can persist an
   order to Firestore. Orders require a logged-in user (Firestore rules tie
   the order's uid to the authenticated account), which also powers the
   customer's order history and the admin Orders dashboard.
   ========================================================================= */

import { db, auth } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

window.getCurrentUser = () => auth.currentUser;

window.saveOrder = async function (order) {
  const user = auth.currentUser;
  if (!user) throw new Error("not-logged-in");
  const ref = await addDoc(collection(db, "orders"), {
    ...order,
    uid: user.uid,
    userEmail: user.email || null,
    status: "pending",
    createdAt: serverTimestamp()
  });
  return ref.id;
};

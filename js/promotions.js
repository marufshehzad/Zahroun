/**
 * Zahroun Promotions Engine
 * Manages all 15 promotional features. Exposes window.ZahrounPromos.
 */

import { db } from './firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, collection,
  getDocs, query, where, addDoc, limit, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const auth = getAuth();
let _cfg = null;
let _cfgFromFirestore = false; // true only when Firestore returned successfully
let _firstOrderResult = undefined; // undefined=unchecked, null=has orders, object=eligible

const _PROMO_CACHE_KEY = 'zhr_promo_v2';
const _PROMO_CACHE_TTL = 30 * 1000; // 30 s — real-time listener keeps active pages current
let _listenerActive = false;

function _dbg(event, detail) {
  if (!window.__ZHR_PROMO_DEBUG__ && localStorage.getItem('zhr_promo_debug') !== '1') return;
  console.log('[PROMO DEBUG]', event, detail ?? '', '|', performance.now().toFixed(1) + 'ms');
}

const DEFAULTS = {
  buyXGetY:       { enabled: false, rules: [{ buy: 2, getFree: 1 }, { buy: 3, getFree: 1 }] },
  bogo:           { enabled: false, discountPct: 100 },
  tieredDiscount: { enabled: false, tiers: [{ min: 1000, pct: 5 }, { min: 2000, pct: 10 }, { min: 3000, pct: 15 }] },
  freeGift:       { enabled: false, threshold: 2000, productName: 'Mini Sample', productImage: '' },
  firstOrder:     { enabled: false, amount: 100, type: 'fixed' },
  loyaltyPoints:  { enabled: false, earnPer: 100, redeemValue: 1, minRedeem: 50, minOrderAmount: 500, maxRedeemPct: 20, allowDuringPromos: true, allowWithCoupon: true, allowWithFreeGift: true },
  spinToWin:      { enabled: false, showAfterSec: 8, prizes: [
    { label: '5% Off',       code: 'SPIN5',   pct: 5,   prob: 30 },
    { label: '10% Off',      code: 'SPIN10',  pct: 10,  prob: 25 },
    { label: '৳100 Off',     code: 'SPIN100', fixed: 100, prob: 20 },
    { label: 'Free Delivery',code: 'SPINFD',  freeDelivery: true, prob: 15 },
    { label: 'Try Again',    code: null,      prob: 10 }
  ]},
  freeShipping:   { enabled: false, threshold: 1500 },
  bundleBuilder:  { enabled: false, minItems: 3, pct: 15 },
  minQtyDiscount: { enabled: false, rules: [{ qty: 2, pct: 5 }] },
  comboDiscount:  { enabled: false, combos: [] },
  referral:       { enabled: false, referrerAmt: 100, refereeAmt: 100 },
  seasonal:       { enabled: false, events: [] }
};

/* ── Config ─────────────────────────────────────────────────────────── */

async function loadConfig(force = false) {
  _dbg('loadConfig:start', 'force=' + force);
  if (_cfg && !force) { _dbg('loadConfig:finish', 'source=memory'); return _cfg; }

  // Fast path: sessionStorage cache (avoids Firestore on every page navigation)
  if (!force) {
    try {
      const raw = sessionStorage.getItem(_PROMO_CACHE_KEY);
      if (raw) {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < _PROMO_CACHE_TTL && data?.buyXGetY !== undefined) {
          _cfg = data;
          _cfgFromFirestore = true;
          _dbg('loadConfig:finish', 'source=sessionStorage');
          return _cfg;
        }
      }
    } catch {}
  }

  try {
    const snap = await getDoc(doc(db, 'settings', 'promotions'));
    _cfg = snap.exists() ? mergeDeep({ ...DEFAULTS }, snap.data()) : { ...DEFAULTS };
    _cfgFromFirestore = true;
    // Persist to sessionStorage so the next page navigation is instant
    try {
      sessionStorage.setItem(_PROMO_CACHE_KEY, JSON.stringify({ data: _cfg, ts: Date.now() }));
    } catch {}
  } catch {
    // Do NOT overwrite a previously-loaded real config with DEFAULTS on transient error
    if (!_cfg) _cfg = { ...DEFAULTS };
    // _cfgFromFirestore stays false — caller can detect Firestore was unreachable
  }
  _dbg('loadConfig:finish', 'source=firestore');
  return _cfg;
}

// Fires within 1-3 s when admin saves a promotion change.
// Updates _cfg in place so P.getConfig() is always current without a page reload.
// Also refreshes sessionStorage so the next page navigation starts with fresh data.
function _startRealtimePromoSync() {
  if (_listenerActive) return;
  _listenerActive = true;
  _dbg('onSnapshot:connected');
  onSnapshot(
    doc(db, 'settings', 'promotions'),
    snap => {
      _dbg('onSnapshot:fired', 'exists=' + snap.exists());
      const fresh = snap.exists() ? mergeDeep({ ...DEFAULTS }, snap.data()) : { ...DEFAULTS };
      _cfg = fresh;
      _dbg('cfg:updated', 'bxgy.enabled=' + (fresh?.buyXGetY?.enabled ?? 'n/a'));
      _cfgFromFirestore = true;
      try { sessionStorage.setItem(_PROMO_CACHE_KEY, JSON.stringify({ data: _cfg, ts: Date.now() })); _dbg('sessionStorage:updated'); } catch {}
    },
    () => { /* network error — keep existing _cfg intact */ }
  );
}

function mergeDeep(target, source) {
  const out = { ...target };
  for (const k of Object.keys(source)) {
    out[k] = (typeof source[k] === 'object' && !Array.isArray(source[k]) && source[k] !== null)
      ? mergeDeep(target[k] || {}, source[k])
      : source[k];
  }
  return out;
}

async function saveConfig(cfg) {
  await setDoc(doc(db, 'settings', 'promotions'), cfg);
  _cfg = cfg;
  _cfgFromFirestore = true;
  // Bust cache so the next page sees fresh config immediately
  try { sessionStorage.removeItem(_PROMO_CACHE_KEY); } catch {}
  window.dispatchEvent(new CustomEvent('promos-updated', { detail: cfg }));
}

/* ── Cart helpers ───────────────────────────────────────────────────── */

function subtotalOf(items) {
  return items.reduce((s, i) => s + parseFloat(i.selectedPrice || i.price || 0) * (i.quantity || 1), 0);
}

function expandItems(items) {
  return items.flatMap(i =>
    Array(i.quantity || 1).fill(parseFloat(i.selectedPrice || i.price || 0))
  );
}

/* ── Evaluators ─────────────────────────────────────────────────────── */

function evalBuyXGetY(items, cfg) {
  if (!cfg?.enabled) return null;
  // 'select' scope: customer picks from admin's list via the cart modal.
  // Discount is applied only via opts.bxgySelectedFree inside evaluate() — not here.
  if (cfg.freeItemScope === 'select') return null;
  const qty = items.reduce((s, i) => s + (i.quantity || 1), 0);
  const rules = [...(cfg.rules || [])].sort((a, b) => b.buy - a.buy);
  const rule = rules.find(r => qty >= r.buy);
  if (!rule) return null;
  const prices = expandItems(items).sort((a, b) => a - b);
  const discount = prices.slice(0, rule.getFree).reduce((s, p) => s + p, 0);
  if (!discount) return null;
  return { label: `Buy ${rule.buy} Get ${rule.getFree} Free`, discount, detail: `${rule.getFree} free item` };
}

function evalBOGO(items, cfg) {
  if (!cfg?.enabled) return null;
  const qty = items.reduce((s, i) => s + (i.quantity || 1), 0);
  if (qty < 2) return null;
  const prices = expandItems(items).sort((a, b) => a - b);
  const discount = prices[0] * ((cfg.discountPct || 100) / 100);
  if (!discount) return null;
  const lbl = cfg.discountPct === 100 ? 'BOGO — 2nd Item Free' : `BOGO — 2nd Item ${cfg.discountPct}% Off`;
  return { label: lbl, discount, detail: `2nd item ${cfg.discountPct === 100 ? 'free' : cfg.discountPct + '% off'}` };
}

function evalBundleBuilder(items, cfg) {
  if (!cfg?.enabled) return null;
  const qty = items.reduce((s, i) => s + (i.quantity || 1), 0);
  if (qty < (cfg.minItems || 3)) return null;
  const subtotal = subtotalOf(items);
  const discount = (subtotal * (cfg.pct || 15)) / 100;
  return { label: `Custom Bundle (${qty} items)`, discount, detail: `${cfg.pct || 15}% off` };
}

function evalTieredDiscount(subtotal, cfg) {
  if (!cfg?.enabled || !cfg.tiers?.length) return null;
  const tier = [...cfg.tiers].sort((a, b) => b.min - a.min).find(t => subtotal >= t.min);
  if (!tier) return null;
  return { label: `Spend ৳${tier.min}+ Discount`, discount: (subtotal * tier.pct) / 100, detail: `${tier.pct}% off` };
}

function evalMinQtyDiscount(items, cfg) {
  if (!cfg?.enabled || !cfg.rules?.length) return null;
  const qty = items.reduce((s, i) => s + (i.quantity || 1), 0);
  const rule = [...cfg.rules].sort((a, b) => b.qty - a.qty).find(r => qty >= r.qty);
  if (!rule) return null;
  const discount = (subtotalOf(items) * rule.pct) / 100;
  return { label: `${rule.qty}+ Items Discount`, discount, detail: `${rule.pct}% off` };
}

function evalComboDiscount(items, cfg) {
  if (!cfg?.enabled || !cfg.combos?.length) return null;
  const cartIds = new Set(items.map(i => String(i.id)));
  for (const combo of cfg.combos) {
    const ids = (combo.productIds || []).map(String);
    if (ids.length && ids.every(id => cartIds.has(id))) {
      const comboSubtotal = subtotalOf(items.filter(i => ids.includes(String(i.id))));
      return { label: combo.label || 'Combo Deal', discount: (comboSubtotal * combo.pct) / 100, detail: `${combo.pct}% off combo` };
    }
  }
  return null;
}

function evalSeasonal(subtotal, cfg) {
  if (!cfg?.enabled || !cfg.events?.length) return null;
  const now = Date.now();
  const active = cfg.events.filter(e =>
    e.enabled !== false &&
    now >= (e.startAt ? new Date(e.startAt).getTime() : 0) &&
    now <= (e.endAt   ? new Date(e.endAt).getTime()   : Infinity)
  );
  if (!active.length) return null;
  const best = active.reduce((b, e) => (e.pct > (b?.pct || 0) ? e : b), null);
  return { label: best.name || 'Seasonal Offer', discount: (subtotal * best.pct) / 100, detail: `${best.pct}% off` };
}

/* ── Main evaluate ──────────────────────────────────────────────────── */

async function evaluate(cartItems, opts = {}) {
  const cfg = await loadConfig();
  if (!cartItems?.length) return { discounts: [], totalDiscount: 0, freeShipping: false, freeGift: null, cfg };

  const subtotal = subtotalOf(cartItems);
  const discounts = [];

  // Quantity offers — best one wins (not stackable)
  // If customer manually selected free items (Buy X Get Y), override auto-calculation
  let bxgyResult = null;
  if (opts.bxgySelectedFree?.length && cfg.buyXGetY?.enabled) {
    const totalQty = cartItems.reduce((s, i) => s + (i.quantity || 1), 0);
    const rules = [...(cfg.buyXGetY.rules || [])].sort((a, b) => b.buy - a.buy);
    const rule = rules.find(r => totalQty >= r.buy);
    if (rule) {
      const discount = opts.bxgySelectedFree.slice(0, rule.getFree).reduce((s, f) => s + (parseFloat(f.price) || 0), 0);
      if (discount > 0) bxgyResult = { label: `Buy ${rule.buy} Get ${rule.getFree} Free`, discount, detail: `${rule.getFree} free item (selected)` };
    }
  }
  if (!bxgyResult) bxgyResult = evalBuyXGetY(cartItems, cfg.buyXGetY);

  const qOffers = [
    bxgyResult,
    evalBOGO(cartItems, cfg.bogo),
    evalBundleBuilder(cartItems, cfg.bundleBuilder)
  ].filter(Boolean);
  if (qOffers.length) discounts.push(qOffers.reduce((b, o) => o.discount > b.discount ? o : b));

  // Stackable discounts
  [
    evalTieredDiscount(subtotal, cfg.tieredDiscount),
    evalMinQtyDiscount(cartItems, cfg.minQtyDiscount),
    evalComboDiscount(cartItems, cfg.comboDiscount),
    evalSeasonal(subtotal, cfg.seasonal)
  ].filter(Boolean).forEach(d => discounts.push(d));

  // External discounts (passed in from checkout)
  if (opts.firstOrderDiscount) discounts.push(opts.firstOrderDiscount);
  if (opts.referralDiscount)   discounts.push(opts.referralDiscount);
  if (opts.loyaltyDiscount)    discounts.push(opts.loyaltyDiscount);

  const totalDiscount = Math.min(discounts.reduce((s, d) => s + d.discount, 0), subtotal);
  const fsCfg = cfg.freeShipping || {};
  const fgCfg = cfg.freeGift || {};

  return {
    discounts,
    totalDiscount,
    freeShipping: !!(fsCfg.enabled && subtotal >= fsCfg.threshold),
    freeGift: (fgCfg.enabled && subtotal >= fgCfg.threshold)
      ? { name: fgCfg.productName || 'Free Gift', image: fgCfg.productImage || '' }
      : null,
    cfg
  };
}

/* ── Progress helpers ───────────────────────────────────────────────── */

async function getFreeShippingInfo(subtotal) {
  const cfg = await loadConfig();
  const fs = cfg.freeShipping || {};
  if (!fs.enabled) return null;
  const threshold = fs.threshold || 1500;
  return { threshold, remaining: Math.max(0, threshold - subtotal), achieved: subtotal >= threshold };
}

async function getTierProgress(subtotal) {
  const cfg = await loadConfig();
  const td = cfg.tieredDiscount || {};
  if (!td.enabled || !td.tiers?.length) return null;
  const sorted = [...td.tiers].sort((a, b) => a.min - b.min);
  const current = [...sorted].reverse().find(t => subtotal >= t.min);
  const next = sorted.find(t => subtotal < t.min);
  return { current, next, remaining: next ? Math.ceil(next.min - subtotal) : 0 };
}

/* ── Loyalty Points ─────────────────────────────────────────────────── */

async function getLoyaltyBalance(uid) {
  if (!uid) return 0;
  try {
    const snap = await getDoc(doc(db, 'loyaltyPoints', uid));
    return snap.exists() ? (snap.data().points || 0) : 0;
  } catch { return 0; }
}

async function getLoyaltyData(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'loyaltyPoints', uid));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

async function awardLoyaltyPoints(uid, orderTotal, userTotalSpend) {
  const cfg = await loadConfig();
  const lp = cfg.loyaltyPoints || {};
  if (!lp.enabled || !uid || !orderTotal) return;

  // Check enrollment: if manual approval mode, only award to approved customers
  if (lp.enrollMode === 'approve') {
    try {
      const snap = await getDoc(doc(db, 'loyaltyPoints', uid));
      if (!snap.exists() || snap.data().status !== 'approved') return;
    } catch { return; }
  }

  // Tier multiplier
  let mult = 1;
  if (lp.tiers?.enabled && userTotalSpend != null) {
    const spend = userTotalSpend;
    const t = lp.tiers;
    if (spend >= (t.platinum?.minSpend || 15000)) mult = t.platinum?.mult || 3;
    else if (spend >= (t.gold?.minSpend || 8000)) mult = t.gold?.mult || 2;
    else mult = t.silver?.mult || 1;
  }

  const basePoints = Math.floor(orderTotal / (lp.earnPer || 100));
  const points = Math.floor(basePoints * mult);
  if (points <= 0) return;
  try {
    const ref = doc(db, 'loyaltyPoints', uid);
    const snap = await getDoc(ref);
    const totalSpend = (userTotalSpend || 0);
    const tier = lp.tiers?.enabled ? (
      totalSpend >= (lp.tiers.platinum?.minSpend || 15000) ? 'platinum' :
      totalSpend >= (lp.tiers.gold?.minSpend || 8000) ? 'gold' : 'silver'
    ) : null;
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
        uid, points, lifetimeEarned: points,
        lastEarnedDate: now, lastUpdated: now,
        status: lp.enrollMode === 'approve' ? 'pending' : 'approved'
      };
      if (tier) newDoc.tier = tier;
      await setDoc(ref, newDoc);
    }
  } catch { /* silent */ }
}

async function deductLoyaltyPoints(uid, points, isRefund = false) {
  if (!uid || !points) return;
  try {
    const ref = doc(db, 'loyaltyPoints', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const prev = snap.data();
      const cur = prev.points || 0;
      const now = new Date().toISOString();
      const update = { points: Math.max(0, cur - points), lastUpdated: now };
      if (!isRefund) {
        update.lifetimeRedeemed = (prev.lifetimeRedeemed || 0) + points;
        update.lastRedeemedDate = now;
      }
      await updateDoc(ref, update);
    }
  } catch { /* silent */ }
}

async function restoreLoyaltyPoints(uid, points) {
  if (!uid || !points) return;
  try {
    const ref = doc(db, 'loyaltyPoints', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const cur = snap.data().points || 0;
      await updateDoc(ref, { points: cur + points, lastUpdated: new Date().toISOString() });
    }
  } catch { /* silent */ }
}

async function redeemLoyaltyPoints(uid, pointsToRedeem, orderSubtotal = null) {
  const cfg = await loadConfig();
  const lp = cfg.loyaltyPoints || {};
  if (!lp.enabled || !uid) return { success: false, error: 'Loyalty not enabled' };
  const minRedeem = lp.minRedeem || 50;
  if (pointsToRedeem < minRedeem) return { success: false, error: `Minimum ${minRedeem} points required` };
  const balance = await getLoyaltyBalance(uid);
  if (balance < pointsToRedeem) return { success: false, error: 'Not enough points' };
  const redeemValue = lp.redeemValue || 1;
  const discount = pointsToRedeem * redeemValue;

  if (orderSubtotal && lp.maxRedeemPct) {
    const maxDiscount = (orderSubtotal * lp.maxRedeemPct) / 100;
    if (discount > maxDiscount) {
      const maxPoints = Math.floor(maxDiscount / redeemValue);
      return { success: false, error: `Max ${lp.maxRedeemPct}% of order value can be redeemed (${maxPoints} pts max = ৳${maxDiscount.toFixed(0)})` };
    }
  }

  return { success: true, discount, points: pointsToRedeem };
}

/* ── Referral ───────────────────────────────────────────────────────── */

async function getReferralCode(uid) {
  if (!uid) return null;
  try {
    const ref = doc(db, 'referrals', uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data().code;
    const code = 'REF' + uid.slice(0, 5).toUpperCase() + String(Math.floor(Math.random() * 900) + 100);
    await setDoc(ref, { uid, code, uses: 0, createdAt: new Date().toISOString() });
    return code;
  } catch { return null; }
}

async function validateReferral(code, currentUid) {
  const cfg = await loadConfig();
  const rc = cfg.referral || {};
  if (!rc.enabled || !code?.trim()) return null;
  const upperCode = code.trim().toUpperCase();
  try {
    // Check if user already used a referral
    const mySnap = await getDoc(doc(db, 'referrals', currentUid));
    if (mySnap.exists() && mySnap.data().usedCode) return { success: false, error: 'You already used a referral code' };

    const q = query(collection(db, 'referrals'), where('code', '==', upperCode));
    const res = await getDocs(q);
    if (res.empty) return { success: false, error: 'Invalid referral code' };
    const referrer = res.docs[0].data();
    if (referrer.uid === currentUid) return { success: false, error: 'Cannot use your own referral code' };
    const amt = rc.refereeAmt || 100;
    return { success: true, discount: amt, label: 'Referral Discount', detail: `৳${amt} off`, referrerUid: referrer.uid };
  } catch { return { success: false, error: 'Could not validate code' }; }
}

async function applyReferralAfterOrder(referralResult, buyerUid) {
  const cfg = await loadConfig();
  const rc = cfg.referral || {};
  if (!rc.enabled || !referralResult?.referrerUid) return;
  try {
    // Credit referrer
    if (rc.referrerAmt > 0) await awardLoyaltyPoints(referralResult.referrerUid, rc.referrerAmt);
    // Mark buyer used the code
    await updateDoc(doc(db, 'referrals', buyerUid), { usedCode: true }).catch(() =>
      setDoc(doc(db, 'referrals', buyerUid), { uid: buyerUid, usedCode: true }, { merge: true })
    );
    // Increment referrer use count
    const q = query(collection(db, 'referrals'), where('uid', '==', referralResult.referrerUid));
    const res = await getDocs(q);
    if (!res.empty) await updateDoc(res.docs[0].ref, { uses: (res.docs[0].data().uses || 0) + 1 });
  } catch { /* silent */ }
}

/* ── First Order ────────────────────────────────────────────────────── */

async function checkFirstOrder(uid) {
  const cfg = await loadConfig();
  const fo = cfg.firstOrder || {};
  if (!fo.enabled || !uid) return null;
  // Memory cache: only query Firestore once per page session per user
  if (_firstOrderResult !== undefined) return _firstOrderResult;
  try {
    // limit(1) — we only need to know if ANY order exists, not download them all
    const q = query(collection(db, 'orders'), where('uid', '==', uid), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) { _firstOrderResult = null; return null; }
    const discount = fo.type === 'percent' ? null : (fo.amount || 0);
    const pct = fo.type === 'percent' ? (fo.amount || 0) : null;
    _firstOrderResult = {
      label: 'First Order Discount',
      discount: discount || 0,
      pct,
      detail: discount ? `৳${discount} off` : `${pct}% off`
    };
    return _firstOrderResult;
  } catch {
    _firstOrderResult = undefined; // reset on error so it retries
    return null;
  }
}

/* ── Spin to Win ────────────────────────────────────────────────────── */

function shouldShowSpin() {
  const today = new Date().toDateString();
  return localStorage.getItem('z_spin_shown') !== today;
}

function markSpinShown() {
  localStorage.setItem('z_spin_shown', new Date().toDateString());
}

function pickPrize(prizes) {
  // Filter out prizes that have hit maxWinners limit
  const available = prizes.filter(p => !p.maxWinners || (p.wonCount || 0) < p.maxWinners);
  if (!available.length) return prizes[prizes.length - 1]; // fallback: last prize
  const total = available.reduce((s, p) => s + (p.prob || 0), 0);
  let rand = Math.random() * total;
  for (const p of available) {
    rand -= (p.prob || 0);
    if (rand <= 0) return p;
  }
  return available[available.length - 1];
}

async function createSpinCoupon(prize) {
  if (!prize?.code) return null;
  try {
    const ref = doc(db, 'coupons', prize.code);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        active: true,
        type:   prize.fixed ? 'flat' : prize.pct ? 'percent' : 'freeship',
        value:  prize.fixed || prize.pct || 0,
        freeDelivery: !!prize.freeDelivery,
        usedCount: 0,
        autoCreated: true,
        createdAt: new Date().toISOString()
      });
    }
    // Increment wonCount in promotions config for this prize
    try {
      const cfg = await loadConfig();
      const prizes = cfg.spinToWin?.prizes || [];
      const idx = prizes.findIndex(p => p.code === prize.code);
      if (idx >= 0) {
        prizes[idx].wonCount = (prizes[idx].wonCount || 0) + 1;
        await updateDoc(doc(db, 'settings', 'promotions'), { 'spinToWin.prizes': prizes });
      }
    } catch { /* silent */ }
    return prize.code;
  } catch { return prize.code; }
}

/* ── Bundle Deals ───────────────────────────────────────────────────── */

async function getFreeProductsByIds(ids) {
  if (!ids?.length) return [];
  try {
    const snaps = await Promise.all(ids.map(id => getDoc(doc(db, 'products', String(id)))));
    return snaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }));
  } catch { return []; }
}

// Returns enriched {id, name, size, price, image} objects for each product+size entry
async function getFreeProductsBySizesData(freeProductSizes) {
  if (!freeProductSizes?.length) return [];
  try {
    const uniqueIds = [...new Set(freeProductSizes.map(fps => String(fps.productId)))];
    const snaps = await Promise.all(uniqueIds.map(id => getDoc(doc(db, 'products', id))));
    const map = {};
    snaps.filter(s => s.exists()).forEach(s => { map[s.id] = { id: s.id, ...s.data() }; });
    return freeProductSizes.map(fps => {
      const prod = map[String(fps.productId)];
      if (!prod) return null;
      const price = (prod.prices && prod.prices[fps.size]) || prod.price || 0;
      const image = (prod.sizeImages && prod.sizeImages[fps.size]) || prod.image || '';
      return { id: String(fps.productId), name: prod.name, size: fps.size, price, image };
    }).filter(Boolean);
  } catch { return []; }
}

async function getBundles() {
  try {
    const snap = await getDocs(collection(db, 'bundles'));
    return snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(b => b.enabled !== false);
  } catch { return []; }
}

async function getAllBundles() {
  try {
    const snap = await getDocs(collection(db, 'bundles'));
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  } catch { return []; }
}

async function saveBundle(bundle) {
  if (bundle.id) {
    const { id, ...data } = bundle;
    await setDoc(doc(db, 'bundles', id), data);
    return id;
  } else {
    const ref = await addDoc(collection(db, 'bundles'), bundle);
    return ref.id;
  }
}

async function deleteBundle(id) {
  const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  await deleteDoc(doc(db, 'bundles', id));
}

/* ── Expose API ─────────────────────────────────────────────────────── */

// Resolved once the initial background loadConfig() completes (success or fail)
let _readyResolve;
const _readyPromise = new Promise(resolve => { _readyResolve = resolve; });

window.ZahrounPromos = {
  load:             loadConfig,
  evaluate,
  getConfig:        () => _cfg || { ...DEFAULTS },
  ready:            _readyPromise,
  isConfigReady:    () => _cfgFromFirestore,
  saveConfig,
  getFreeShippingInfo,
  getTierProgress,
  /* Loyalty */
  getLoyaltyBalance,
  getLoyaltyData,
  awardLoyaltyPoints,
  deductLoyaltyPoints,
  restoreLoyaltyPoints,
  redeemLoyaltyPoints,
  /* Referral */
  getReferralCode,
  validateReferral,
  applyReferralAfterOrder,
  /* First Order */
  checkFirstOrder,
  /* Spin */
  shouldShowSpin,
  markSpinShown,
  pickPrize,
  createSpinCoupon,
  /* Bundles */
  getBundles,
  getAllBundles,
  saveBundle,
  deleteBundle,
  /* BuyXGetY free product lookup */
  getFreeProductsByIds,
  getFreeProductsBySizesData
};

// Pre-load config on module init — resolves _readyPromise when done,
// then start a real-time listener so admin changes propagate within 1-3 s.
_dbg('module-loaded');
loadConfig().then(cfg => { _readyResolve(cfg); _startRealtimePromoSync(); })
            .catch(err => { _readyResolve(err); _startRealtimePromoSync(); });

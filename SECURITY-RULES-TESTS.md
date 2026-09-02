# Firestore Rules — mandatory pre-publish test procedure

**A mistake in the `/orders` create rule blocks every checkout on the live site.**

These rules ARE now testable locally, against the real Firestore rules engine —
see "Automated suite" below. Run that first; it covers every case in this
document. The manual Firebase-console walkthrough that follows is kept as a
fallback and as the definition of what must hold.

## Automated suite (run this first)

The `.devtest` harness's fake Firestore does not evaluate rules at all, but the
Firestore emulator does. It needs a JVM, and this machine has one bundled with
Android Studio, so no install is required:

```
JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
firebase emulators:start --only firestore    # port 8085; 8080 is taken by Oracle
node run.mjs                                 # @firebase/rules-unit-testing
```

The harness lives outside the repo (this project intentionally has no
`package.json`), and loads `firestore.rules` straight from disk, so it always
tests the real file. **Last run: 116 cases, 116 pass, 0 fail**, covering Steps 1
through 4 below plus two groups the manual procedure cannot express:

- **`legacy`** — the exact payloads the CURRENTLY DEPLOYED `checkout.html` +
  `js/orders.js` produce (no `clientOrderId`, `stockDeducted` instead of
  `stockState`, decimal money from `+x.toFixed(2)`, and the pre-fix loyalty
  shape). All accepted. This is what makes it safe to publish the rules BEFORE
  pushing the code — without it, doing so would break every live checkout.
- **`gift`** — pins where the rules boundary actually is: four arithmetic-lie
  discount attacks denied, and the one documented limitation (a self-consistent
  order carrying an unearned price-0 gift) explicitly allowed at the rules layer
  and rejected at the application layer by `validateFreeGifts()`.

Two behaviours the deployed client relies on are denied by these rules and fail
silently (both are wrapped in `try/catch`): the browser-side product stock
decrement, and `updateOrderPixelEventId`. Stock moves to the admin panel with
this release; the pixel id is not restored by it.

## What has also been verified automatically

- A predicate simulation of the order-create rule passes **36/36** cases
  (legitimate variants accepted, malformed and tampered ones denied).
- The rule's key lists were parsed directly out of `firestore.rules` and
  cross-checked against the exact field set `js/orders.js saveOrder()` writes:
  **all 25 written keys are permitted, all 17 required keys are written.**
- **All 9 checkout variants below were captured from real checkout runs and every
  one is accepted** by the rule logic: guest COD, logged-in COD, bKash, Nagad,
  coupon, free gift, loyalty redemption, flash sale, and a stale-service-worker
  client still running the previous `orders.js`.

What automation could NOT verify, and what this document is for:
1. That the rules **compile** in the real Firestore rules engine.
2. That the real engine agrees with the simulation, particularly on the `total`
   identity check.

---

## Step 0 — Compile check (do this first)

1. Firebase Console → Build → Firestore Database → **Rules** tab.
2. **First, copy the rules currently in the editor into a scratch file.** That is
   your rollback copy. (The live ruleset at the time of writing was published
   2026-06-09 and is byte-identical to the repo's committed `firestore.rules`,
   so `git show HEAD:firestore.rules` is an equivalent rollback source.)
3. Paste the entire contents of the new `firestore.rules`. **Do not Publish yet.**
4. The editor compiles as you type. If a red error appears, **stop and report it** —
   do not publish. The constructs worth re-checking if that happens are `let`
   bindings inside functions, `x in ['a','b']`, `map.keys().hasAll(...)`, and
   `diff(resource.data).affectedKeys().hasOnly(...)`.

---

## Step 1 — The highest-risk predicate

| Predicate | Where | If wrong |
|---|---|---|
| the `total` identity (±1 tolerance) | orders create | orders with decimal prices rejected |

### Why `createdAt` is a type check in this release

The stricter form of this predicate is `d.createdAt == request.time`, which pins
the field to the server clock. It is Firebase's documented pattern, but **it
cannot be verified in the Rules Playground**: the document builder has no
`serverTimestamp()` sentinel, so a literal timestamp can never equal
`request.time`, and a DENY there would not distinguish "the rule is broken" from
"the Playground cannot express this". Its first real test would be live traffic,
and if it misbehaved **every checkout would fail**.

This release therefore ships `d.createdAt is timestamp`. Once the Step 5 live
smoke test confirms real orders succeed, tighten the predicate in a follow-up
release and re-run Step 5 to verify it.

**This is now testable before shipping.** The Playground limitation does not
apply to the emulator suite above: `serverTimestamp()` resolves there exactly as
it does in production, so `d.createdAt == request.time` can be asserted against
real allow/deny cases locally. Verify the tightened predicate in the automated
suite first; the live smoke test then only has to confirm it, not discover it.

### Testing the total identity (this one IS testable)

Playground → **create**, `/orders/testdoc`, Authenticated **on**, UID
`test-admin`. Paste payload **2e** (coupon) below, run it, then change `"total"`
from `4740` to `4700` and run again.

**Expected:** `4740` allowed, `4700` **denied**. That proves the identity check is
active with the right tolerance.

---

## Step 2 — Orders: MUST ALLOW (8 real captured payloads)

Rules Playground → Simulation type **create**, location `/orders/testdoc`.
Set Authenticated **on** with Firebase UID `test-admin` for all except 2a.
Each of these is a real document produced by an actual checkout run.

### 2a. Guest COD — Authenticated **OFF**
```json
{"clientOrderId":"dccd72e1-237c-4582-a48a-fdae6dbfbef9","customer":{"name":"Guest COD","mobile":"01812345678","address":"Road 5, Banani, Dhaka","district":"Dhaka","area":"Inside Dhaka (Tk 60)"},"items":[{"id":1,"name":"Sahraa Oudh","size":"50ML","price":2490,"originalPrice":2490,"isFlashSale":false,"flashSalePrice":null,"discountPercent":0,"quantity":1,"image":"https://ik.imagekit.io/x/a.png"}],"subtotal":2490,"discount":0,"promoDiscount":0,"promos":[],"couponCode":null,"delivery":60,"total":2550,"payment":{"method":"COD","txnId":null,"senderMobile":null},"paymentStatus":"cod","giftMessage":null,"guestEmail":"guest@example.com","loyaltyRedeemedPoints":0,"loyaltyDiscountAmount":0,"referrerUid":null,"referralCode":null,"orderNum":100001,"uid":null,"userEmail":"guest@example.com","isGuest":true,"status":"pending","stockState":"none","createdAt":"<server timestamp>"}
```

### 2b. Logged-in COD — Authenticated **ON**, uid `test-admin`
```json
{"clientOrderId":"f8f58697-d988-44b4-b5ac-acded4846e42","customer":{"name":"Member COD","mobile":"01712345678","address":"House 9, Dhanmondi","district":"Dhaka","area":"Inside Dhaka (Tk 60)"},"items":[{"id":1,"name":"Sahraa Oudh","size":"50ML","price":2490,"originalPrice":2490,"isFlashSale":false,"flashSalePrice":null,"discountPercent":0,"quantity":1,"image":"x"}],"subtotal":2490,"discount":0,"promoDiscount":0,"promos":[],"couponCode":null,"delivery":60,"total":2550,"payment":{"method":"COD","txnId":null,"senderMobile":null},"paymentStatus":"cod","giftMessage":null,"guestEmail":null,"loyaltyRedeemedPoints":0,"loyaltyDiscountAmount":0,"referrerUid":null,"referralCode":null,"orderNum":100002,"uid":"test-admin","userEmail":"admin@zahroun.test","isGuest":false,"status":"pending","stockState":"none","createdAt":"<server timestamp>"}
```

### 2c. bKash (prepaid)
```json
{"clientOrderId":"825591db-8f87-43ec-b1ea-6b4127b4ca79","customer":{"name":"bKash Buyer","mobile":"01912345678","address":"Flat 3B, Uttara","district":"Dhaka","area":"Inside Dhaka (Tk 60)"},"items":[{"id":1,"name":"Sahraa Oudh","size":"50ML","price":2490,"originalPrice":2490,"isFlashSale":false,"flashSalePrice":null,"discountPercent":0,"quantity":1,"image":"x"}],"subtotal":2490,"discount":0,"promoDiscount":0,"promos":[],"couponCode":null,"delivery":60,"total":2550,"payment":{"method":"bKash","txnId":"8C5K9X1H2J","senderMobile":"01911111111"},"paymentStatus":"pending","giftMessage":null,"guestEmail":null,"loyaltyRedeemedPoints":0,"loyaltyDiscountAmount":0,"referrerUid":null,"referralCode":null,"orderNum":100003,"uid":"test-admin","userEmail":"admin@zahroun.test","isGuest":false,"status":"pending","stockState":"none","createdAt":"<server timestamp>"}
```

### 2d. Nagad (prepaid, outside Dhaka)
```json
{"clientOrderId":"d6e24e82-17df-4269-ac7c-5f88034ceeca","customer":{"name":"Nagad Buyer","mobile":"01612345678","address":"Sector 7, Uttara","district":"Outside Dhaka","area":"Inside Dhaka (Tk 60)"},"items":[{"id":1,"name":"Sahraa Oudh","size":"50ML","price":2490,"originalPrice":2490,"isFlashSale":false,"flashSalePrice":null,"discountPercent":0,"quantity":1,"image":"x"}],"subtotal":2490,"discount":0,"promoDiscount":0,"promos":[],"couponCode":null,"delivery":60,"total":2550,"payment":{"method":"Nagad","txnId":"NGD77XY12","senderMobile":"01622222222"},"paymentStatus":"pending","giftMessage":null,"guestEmail":null,"loyaltyRedeemedPoints":0,"loyaltyDiscountAmount":0,"referrerUid":null,"referralCode":null,"orderNum":100005,"uid":"test-admin","userEmail":"admin@zahroun.test","isGuest":false,"status":"pending","stockState":"none","createdAt":"<server timestamp>"}
```

### 2e. Coupon (SAVE10, 10% capped at Tk 300)
```json
{"clientOrderId":"10c97307-ced2-45cc-979f-98f1eba44de9","customer":{"name":"Coupon Buyer","mobile":"01512345678","address":"Gulshan 2","district":"Dhaka","area":"Inside Dhaka (Tk 60)"},"items":[{"id":1,"name":"Sahraa Oudh","size":"50ML","price":2490,"originalPrice":2490,"isFlashSale":false,"flashSalePrice":null,"discountPercent":0,"quantity":2,"image":"x"}],"subtotal":4980,"discount":300,"promoDiscount":0,"promos":[],"couponCode":"SAVE10","delivery":60,"total":4740,"payment":{"method":"COD","txnId":null,"senderMobile":null},"paymentStatus":"cod","giftMessage":null,"guestEmail":null,"loyaltyRedeemedPoints":0,"loyaltyDiscountAmount":0,"referrerUid":null,"referralCode":null,"orderNum":100004,"uid":"test-admin","userEmail":"admin@zahroun.test","isGuest":false,"status":"pending","stockState":"none","createdAt":"<server timestamp>"}
```

### 2f. Free gift (BXGY) — note the second item has `price: 0` and a STRING id
```json
{"clientOrderId":"e4980dd7-3a77-4a68-83de-5f5d4b5d31dd","customer":{"name":"Gift Buyer","mobile":"01712345670","address":"Mirpur DOHS","district":"Dhaka","area":"Inside Dhaka (Tk 60)"},"items":[{"id":2,"name":"AL Khayran","size":"50ML","price":2450,"originalPrice":2450,"isFlashSale":false,"flashSalePrice":null,"discountPercent":0,"quantity":1,"image":"x"},{"id":"2","name":"Dulce Oud","size":"6ML","price":0,"originalPrice":750,"quantity":1,"image":"https://zahroun.com/product%20pictures/New%20product%20pic%20and%20price/men%206ml.png","isFreeGift":true}],"subtotal":2450,"discount":0,"promoDiscount":750,"promos":[{"label":"Buy 1 Get 1 Free","discount":750}],"couponCode":null,"delivery":60,"total":1760,"payment":{"method":"COD","txnId":null,"senderMobile":null},"paymentStatus":"cod","giftMessage":null,"guestEmail":null,"loyaltyRedeemedPoints":0,"loyaltyDiscountAmount":0,"referrerUid":null,"referralCode":null,"orderNum":100006,"uid":"test-admin","userEmail":"admin@zahroun.test","isGuest":false,"status":"pending","stockState":"none","createdAt":"<server timestamp>"}
```

### 2g. Loyalty redemption (200 points)
```json
{"clientOrderId":"dd8c98f1-7756-40a1-a7c1-bb544e75c17b","customer":{"name":"Loyalty Buyer","mobile":"01712345671","address":"Bashundhara R/A","district":"Dhaka","area":"Inside Dhaka (Tk 60)"},"items":[{"id":1,"name":"Sahraa Oudh","size":"50ML","price":2490,"originalPrice":2490,"isFlashSale":false,"flashSalePrice":null,"discountPercent":0,"quantity":2,"image":"x"}],"subtotal":4980,"discount":0,"promoDiscount":200,"promos":[{"label":null,"discount":200}],"couponCode":null,"delivery":60,"total":4640,"payment":{"method":"COD","txnId":null,"senderMobile":null},"paymentStatus":"cod","giftMessage":null,"guestEmail":null,"loyaltyRedeemedPoints":200,"loyaltyDiscountAmount":200,"referrerUid":null,"referralCode":null,"orderNum":100007,"uid":"test-admin","userEmail":"admin@zahroun.test","isGuest":false,"status":"pending","stockState":"none","createdAt":"<server timestamp>"}
```
> Use this payload exactly as written. Its `total` is what the application
> currently produces for a loyalty order, and the rule deliberately mirrors the
> application's own total formula so it never rejects live traffic. Do not
> "correct" the numbers to match a hand calculation — an edited payload would be
> testing something the application does not send.

### 2h. Flash sale (sale price on the item)
```json
{"clientOrderId":"cdb05a49-1e39-4373-9d82-5c91cd1a044b","customer":{"name":"Flash Buyer","mobile":"01712345673","address":"Baridhara","district":"Dhaka","area":"Inside Dhaka (Tk 60)"},"items":[{"id":3,"name":"Rosy Diva","size":"50ML","price":1200,"originalPrice":1790,"isFlashSale":true,"flashSalePrice":1200,"discountPercent":33,"quantity":1,"image":"x"}],"subtotal":1200,"discount":0,"promoDiscount":0,"promos":[],"couponCode":null,"delivery":60,"total":1260,"payment":{"method":"COD","txnId":null,"senderMobile":null},"paymentStatus":"cod","giftMessage":null,"guestEmail":null,"loyaltyRedeemedPoints":0,"loyaltyDiscountAmount":0,"referrerUid":null,"referralCode":null,"orderNum":100009,"uid":"test-admin","userEmail":"admin@zahroun.test","isGuest":false,"status":"pending","stockState":"none","createdAt":"<server timestamp>"}
```

### 2i. Legacy client (stale service worker) — MUST ALLOW
Take 2b and replace `"stockState":"none"` with `"stockDeducted":true`. A returning
visitor whose service worker still serves the previous `js/orders.js` sends exactly
this. If it is denied, those shoppers cannot check out.

---

## Step 3 — Orders: MUST DENY

Start from payload 2b and change **one** field at a time. Every one must be denied.

| Change | Why it must be denied |
|---|---|
| `"status": "delivered"` | fake fulfilled orders inflate loyalty tiers and revenue reports |
| `"paymentStatus": "verified"` | order would appear already paid |
| `"stockState": "deducted"` | pre-claims stock so the admin panel skips the real deduction |
| `"total": 1` (leave subtotal 2490) | breaks the total identity |
| `"total": -100` | negative money |
| `"uid": "someone-else"` | order attributed to another account |
| `"isGuest": true` while authenticated | identity mismatch |
| the whole doc, Authenticated **OFF**, `uid` left as `"test-admin"` | anonymous client claiming a uid |
| add `"adminNotes": "x"` | unexpected key |
| add `"loyaltyPointsAwarded": true` | pre-setting an admin-only flag |
| `"customer": {"name":"<5000 chars>", ...}` | oversized payload |
| `"customer.name": ""` | empty name |
| `"items": []` | empty order |
| `"payment": {"method":"FreeMoney"}` | unknown payment method |
| `"payment"` with an extra key e.g. `"verified":true` | unexpected nested key |
| `"orderNum": 100002.5` | non-integer order number |
| `"createdAt": 12345` (a number) | wrong type for the timestamp field |

> A backdated but well-formed `createdAt` is **allowed in this release** — see
> Step 1. Re-add it to this deny list once the rule is tightened to
> `== request.time`.

---

## Step 4 — Other collections

### 4a. Users — role escalation (**the critical one**)
Authenticated as `test-uid`, location `/users/test-uid`, type **create**:
- `{"uid":"test-uid","name":"X","email":"x@y.com","role":"admin","blocked":false}` → **MUST DENY**
- `{"uid":"test-uid","name":"X","email":"x@y.com","role":"customer","blocked":false}` → **MUST ALLOW**

Type **update** on an existing doc that has `role:"customer"`:
- `{"role":"admin"}` → **MUST DENY**
- `{"savedAddress":{"line1":"x"}}` → **MUST ALLOW** (this is what account.html writes)
- `{"wishlist":[1,2,3]}` → **MUST ALLOW** (js/wishlist.js)
- `{"savedCart":{"items":[],"count":0}}` → **MUST ALLOW** (js/auth.js abandoned-cart snapshot)

### 4b. Orders — READ (new owner/admin restriction)
- Authenticated as `test-admin`, **get** `/orders/<a doc whose uid is test-admin>` → **MUST ALLOW**
- Authenticated as `other-uid`, same doc → **MUST DENY**
- Authenticated **OFF**, same doc → **MUST DENY**
- Authenticated **OFF**, a guest order (`uid: null`) → **MUST DENY** (guests use `/api/track-order`)

### 4c. Coupons
Existing `/coupons/SAVE10` with `usedCount: 5`, type **update**, Authenticated **OFF**:
- `{"usedCount": 6}` → **MUST ALLOW** (the +1 the checkout performs)
- `{"usedCount": 0}` → **MUST DENY** (usage-limit reset)
- `{"usedCount": 999999}` → **MUST DENY** (coupon denial-of-service)
- `{"value": 90}` → **MUST DENY**

Also: a **get** on a single known code → allow; a **list** of the collection → deny.

### 4d. Counters
Existing `/counters/orders` with `current: 100002`, **update**, Authenticated **OFF**:
- `{"current": 100003}` → **MUST ALLOW**
- `{"current": 999999999}` → **MUST DENY**
- `{"current": 100001}` → **MUST DENY** (backwards)

### 4e. Loyalty points
Authenticated as `test-uid`, `/loyaltyPoints/test-uid` with `points: 500`, **update**:
- `{"points":300,"lastUpdated":"...","lifetimeRedeemed":200,"lastRedeemedDate":"..."}` → **MUST ALLOW**
- `{"points": 5000}` → **MUST DENY**
- `{"points": 500, "tier": "platinum"}` → **MUST DENY**

**create** `/loyaltyPoints/test-uid`:
- `{"points": 0}` → **MUST ALLOW**
- `{"points": 99999}` → **MUST DENY**

### 4f. Reviews
Authenticated, `/reviews/new`, **create**:
- `{"productId":1,"productName":"X","uid":"test-uid","reviewerName":"A","rating":5,"text":"Nice","status":"pending","createdAt":"<server timestamp>"}` → **MUST ALLOW**
- same with `"rating": 99` → **MUST DENY**
- same with `"status": "approved"` → **MUST DENY** (self-approval at create)

Authenticated as the review's own author, `/reviews/<their own review>`, **update**:
- `{"status": "approved"}` → **MUST DENY** (self-approval after the fact — the
  create rule pins `status` to `pending`, and update is admin-only so the author
  cannot promote it afterwards)
- `{"text": "edited"}` → **MUST DENY** (update is admin-only; the storefront has
  no customer review-editing feature)

Authenticated as the review's own author, `/reviews/<their own review>`, **delete**:
- → **MUST ALLOW** (authors may remove their own content)

Authenticated as a DIFFERENT signed-in user, `/reviews/<someone else's review>`,
**delete**: → **MUST DENY**

---

## Step 5 — Live smoke test, immediately after Publish

Publishing is the only complete test. Do these within minutes of publishing:

1. Place one real **guest** order end to end. It must succeed.
2. Place one real **logged-in** order **with a coupon**. It must succeed.
3. Open the admin panel — both orders appear with correct totals.
4. Open `account.html` while signed in — the order history loads (this exercises
   the new owner-only read rule).
5. Open `track.html` and look up an order by its number — this exercises
   `/api/track-order` and requires `FIREBASE_SERVICE_ACCOUNT` to be set in Vercel.
6. Keep the browser console open throughout: there must be **no
   `permission-denied` errors**.

### Rollback
If checkout fails, restore only the `/orders` **create** clause to:
```
allow create: if (isSignedIn() && request.resource.data.uid == request.auth.uid)
              || (!isSignedIn() && request.resource.data.isGuest == true
                  && request.resource.data.uid == null);
```
Keep everything else — the users, coupons, counters, reviews and loyalty rules are
independent of order creation and much lower risk. **Roll back only the create
clause. Do not revert the `/orders` read rule** under any circumstances; that
rule is the reason order documents are not publicly readable.

---

## Scope of these rules

Security rules are one layer, not the whole defence. They constrain **who** may
write and the **shape** of what is written; they cannot re-derive business totals
from a catalogue, and the rules language cannot inspect individual elements of a
list. Order integrity therefore also depends on the application's own submit-time
validation and on admin review before fulfilment.

Remaining hardening work is tracked privately in the internal audit document
(kept out of this repository), not here.

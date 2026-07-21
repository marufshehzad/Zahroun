let cart = JSON.parse(localStorage.getItem('zahroun_cart')) || [];
let _prevCartCount = 0;

// Reconcile saved cart items against the live product list (refresh prices /
// images, drop deleted products). Runs only once products are loaded, so it
// never wipes the cart while the async product fetch is still in flight.
function reconcileCart() {
    if (typeof products === 'undefined' || !Array.isArray(products) || products.length === 0) return;
    cart = cart
        .filter(item => products.some(p => p.id === item.id))
        .map(item => {
            const prod = products.find(p => p.id === item.id);
            if (!item.size || item.size === 'undefined') item.size = '50ML';
            if (!prod.prices[item.size] && prod.prices['50ML']) item.size = '50ML';
            const catalogPrice = (prod.prices && prod.prices[item.size]) ? prod.prices[item.size] : prod.price;
            // Layer 1: explicit flash sale marker (set by addToCart when price < catalog)
            if (item.flashSalePrice) {
                item.selectedPrice = item.flashSalePrice;
                return { ...prod, size: item.size, selectedPrice: item.flashSalePrice, flashSalePrice: item.flashSalePrice, quantity: item.quantity || 1 };
            }
            // Layer 2: active flash sale covers this product (handles pre-marker cart items)
            const fs = window.zahFlashSale;
            if (fs && fs.enabled && Array.isArray(fs.items)) {
                const fsItem = fs.items.find(fi => String(fi.productId) === String(item.id));
                const fsPrice = fsItem?.prices?.[item.size];
                if (typeof fsPrice === 'number' && fsPrice > 0 && fsPrice < catalogPrice) {
                    item.selectedPrice = fsPrice;
                    item.flashSalePrice = fsPrice;
                    return { ...prod, size: item.size, selectedPrice: fsPrice, flashSalePrice: fsPrice, quantity: item.quantity || 1 };
                }
            }
            // Layer 3: never overwrite with a higher price (price below catalog = intentional)
            if (item.selectedPrice && catalogPrice && Number(item.selectedPrice) < Number(catalogPrice)) {
                return { ...prod, size: item.size, selectedPrice: item.selectedPrice,
                         ...(item.flashSalePrice ? { flashSalePrice: item.flashSalePrice } : {}),
                         quantity: item.quantity || 1 };
            }
            // Regular catalog price
            if (catalogPrice) {
                item.selectedPrice = catalogPrice;
            } else if (item.selectedPrice === undefined || isNaN(item.selectedPrice) || item.selectedPrice === null) {
                item.selectedPrice = prod.price;
            }
            return { ...prod, size: item.size, selectedPrice: item.selectedPrice, quantity: item.quantity || 1 };
        });
    saveCart();
}
document.addEventListener('products-ready', reconcileCart);

let discountMultiplier = 1;

function saveCart() {
    localStorage.setItem('zahroun_cart', JSON.stringify(cart));
    updateCartUI();
}

function cartToast(msg) {
    const el = document.getElementById("cart-toast");
    if (!el) {
        const t = document.createElement("div");
        t.id = "cart-toast";
        t.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#163E34;color:#fff;padding:.55rem 1.2rem;border-radius:20px;font-size:.85rem;font-weight:500;z-index:200001;opacity:0;transition:opacity .25s;pointer-events:none;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.18);";
        document.body.appendChild(t);
        t.textContent = msg;
        setTimeout(() => t.style.opacity = "1", 10);
        setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 2200);
    }
}

window.addToCart = function(productId, size = '50ML', price = null) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    let itemPrice = price;
    if (itemPrice === null || isNaN(itemPrice)) {
        itemPrice = (product.prices && product.prices[size]) ? product.prices[size] : product.price;
    }

    const regularPrice = (product.prices && product.prices[size]) ? product.prices[size] : product.price;
    const isFlashSale = price !== null && !isNaN(price) && Number(price) !== Number(regularPrice);

    const existingItem = cart.find(item => item.id === productId && item.size === size);
    if (existingItem) {
        existingItem.quantity += 1;
        if (isFlashSale) existingItem.flashSalePrice = Number(price);
        cartToast("Quantity updated ✓");
    } else {
        const newItem = { ...product, size, selectedPrice: itemPrice, quantity: 1 };
        if (isFlashSale) {
            newItem.flashSalePrice = Number(price);
            newItem.originalPrice = Number(regularPrice);
        }
        cart.push(newItem);
        cartToast("Added to cart ✓");
    }

    saveCart();
    openCart();
    if (window.zahrounGA) window.zahrounGA.trackAddToCart(product, size, itemPrice);
}

window.removeFromCart = function(productId, size) {
    const item = cart.find(i => i.id === productId && i.size === size);
    if (item && window.zahrounGA) window.zahrounGA.trackRemoveFromCart(item, size, item.selectedPrice);
    cart = cart.filter(item => !(item.id === productId && item.size === size));
    saveCart();
}

window.updateQuantity = function(productId, size, newQuantity) {
    if (newQuantity < 1) {
        removeFromCart(productId, size);
        return;
    }
    const item = cart.find(item => item.id === productId && item.size === size);
    if (item) {
        item.quantity = newQuantity;
        saveCart();
    }
}

function getCartSubtotal() {
    return cart.reduce((total, item) => total + (parseFloat(item.selectedPrice) * parseInt(item.quantity)), 0);
}

function getCartTotal() {
    return getCartSubtotal();
}

function getCartCount() {
    return cart.reduce((count, item) => count + item.quantity, 0);
}

function updateCartUI() {
    if (!document.getElementById('_cart-bounce-css')) {
        const s = document.createElement('style');
        s.id = '_cart-bounce-css';
        s.textContent = '@keyframes _cartBounce{0%,100%{transform:scale(1)}30%{transform:scale(1.5)}60%{transform:scale(.9)}80%{transform:scale(1.15)}} .cart-bounce{animation:_cartBounce .5s ease!important;}';
        document.head.appendChild(s);
    }
    // Update count badge
    const newCount = getCartCount();
    const countElements = document.querySelectorAll('.cart-count');
    countElements.forEach(el => {
        el.textContent = newCount;
        if (newCount > 0) {
            el.style.display = 'flex';
        } else {
            el.style.display = 'none';
        }
        if (newCount > _prevCartCount) {
            el.classList.remove('cart-bounce');
            void el.offsetWidth;
            el.classList.add('cart-bounce');
            setTimeout(() => el.classList.remove('cart-bounce'), 600);
        }
    });
    _prevCartCount = newCount;

    // Trigger broadcast bar update with promo info
    if (window.ZahrounPromos && newCount > 0) {
      window.ZahrounPromos.getFreeShippingInfo(getCartSubtotal())
        .then(info => window.dispatchEvent(new CustomEvent('zahroun-cart-promo', { detail: { fsInfo: info, subtotal: getCartSubtotal() } })))
        .catch(() => {});
    }

    // Update cart modal items
    const cartItemsContainer = document.getElementById('cart-items');
    if (!cartItemsContainer) return;

    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p style="text-align:center; padding: 2rem 0; color: var(--text-muted);">Your cart is empty.</p>';
    } else {
        cartItemsContainer.innerHTML = cart.map(item => `
            <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem;">
                <img src="${item.image}" alt="${item.name}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 4px; background: var(--surface-color);">
                <div style="flex: 1;">
                    <h4 style="font-size: 0.95rem; margin-bottom: 0.25rem;">${item.name}</h4>
                    <span style="font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 0.25rem;">Size: ${item.size}</span>
                    ${(() => {
                        const reg = (item.prices && item.prices[item.size]) ? item.prices[item.size] : 0;
                        const sp = item.flashSalePrice;
                        if (sp && reg && sp < reg) {
                            return `<div style="margin-bottom:.5rem;"><span style="text-decoration:line-through;color:#aaa;font-size:.78rem;margin-right:.3rem;">Tk ${Number(reg).toLocaleString()}</span><span style="color:#c0392b;font-weight:700;">Tk ${Number(sp).toLocaleString()}</span> <span style="background:#c0392b;color:#fff;font-size:.6rem;font-weight:700;border-radius:3px;padding:.1rem .3rem;">SALE</span></div>`;
                        }
                        return `<div style="color:var(--primary-color);font-weight:600;margin-bottom:.5rem;">Tk ${Number(item.selectedPrice).toLocaleString()}</div>`;
                    })()}
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <button onclick="updateQuantity(${item.id}, '${item.size}', ${item.quantity - 1})" style="width: 36px; height: 36px; border: 1px solid var(--border-color); background: none; cursor: pointer; border-radius: 8px; font-size: 1.1rem; display:flex; align-items:center; justify-content:center; touch-action:manipulation;">−</button>
                        <span style="font-size: 0.95rem; font-weight:600; min-width:20px; text-align:center;">${item.quantity}</span>
                        <button onclick="updateQuantity(${item.id}, '${item.size}', ${item.quantity + 1})" style="width: 36px; height: 36px; border: 1px solid var(--border-color); background: none; cursor: pointer; border-radius: 8px; font-size: 1.1rem; display:flex; align-items:center; justify-content:center; touch-action:manipulation;">+</button>
                    </div>
                </div>
                <button onclick="removeFromCart(${item.id}, '${item.size}')" style="background: none; border: none; cursor: pointer; color: var(--text-muted); align-self: flex-start;"><ion-icon name="trash-outline"></ion-icon></button>
            </div>
        `).join('');
    }

    const totalEl = document.getElementById('cart-total');
    if (totalEl) totalEl.textContent = 'Tk ' + Math.round(getCartTotal()).toLocaleString();

    // Buy X Get Y — free item selector
    renderBxgySelector();
}

// Dummy — no in-cart UI needed, checkout intercept handles everything
function renderBxgySelector() {}

/* ── Buy X Get Y — Checkout Intercept ─────────────────────────────── */

// Step 1: wait for window.ZahrounPromos to exist (module loads async)
function waitForPromos(timeout = 5000) {
    return new Promise(resolve => {
        if (window.ZahrounPromos) { resolve(window.ZahrounPromos); return; }
        const start = Date.now();
        const interval = setInterval(() => {
            if (window.ZahrounPromos) {
                clearInterval(interval);
                resolve(window.ZahrounPromos);
            } else if (Date.now() - start >= timeout) {
                clearInterval(interval);
                resolve(null);
            }
        }, 40);
    });
}

async function checkBxgyAndProceed() {
    // Synchronous check — no polling, no timeout.
    // If promotions.js is not loaded on this page window.ZahrounPromos is absent;
    // navigate immediately rather than waiting 5 s for waitForPromos to time out.
    const P = window.ZahrounPromos || null;
    if (!P) { window.location.href = 'checkout.html'; return; }

    // Join the background config load — never starts a second loadConfig() call.
    // P.ready resolves once when module-init loadConfig() finishes (cache, IDB, or network).
    // After this await _cfg is always set; P.getConfig() is synchronous.
    await P.ready;
    const cfg = P.getConfig();

    // If Firestore was unreachable AND no cache existed, _cfgFromFirestore is false
    // (cfg is DEFAULTS). Skip BXGY so the customer reaches checkout unblocked.
    if (!P.isConfigReady()) {
        localStorage.removeItem('zahroun_bxgy_free');
        window.location.href = 'checkout.html';
        return;
    }

    const bxgy = cfg?.buyXGetY;

    if (!bxgy?.enabled) {
        localStorage.removeItem('zahroun_bxgy_free');
        window.location.href = 'checkout.html';
        return;
    }

    const totalQty = cart.reduce((s, i) => s + (i.quantity || 1), 0);
    const rules = [...(bxgy.rules || [])].sort((a, b) => b.buy - a.buy);
    const rule = rules.find(r => totalQty >= r.buy);

    // "select" scope → redirect to premium gift selection page
    if (bxgy.freeItemScope === 'select') {
        const hasFreeItems = !!(bxgy.freeProductSizes?.length || bxgy.freeProductIds?.length);
        if (hasFreeItems && rule) {
            window.location.href = 'free-gift-selection.html';
            return;
        }
        localStorage.removeItem('zahroun_bxgy_free');
        window.location.href = 'checkout.html';
        return;
    }

    // "any" (cheapest) scope → show upsell popup if one item short of qualifying
    if (!rule) {
        const nearestRule = rules.find(r => totalQty === r.buy - 1);
        if (nearestRule) {
            showUpsellPopup(nearestRule);
            return;
        }
    }

    localStorage.removeItem('zahroun_bxgy_free');
    window.location.href = 'checkout.html';
}

function showUpsellPopup(rule) {
    const overlay = document.createElement('div');
    overlay.id = '_bxgy-upsell-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:300000;display:flex;align-items:center;justify-content:center;padding:1.25rem;backdrop-filter:blur(4px);';

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:400px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.28);">
        <div style="background:linear-gradient(150deg,#081c14,#163E34);padding:1.85rem 1.75rem 1.6rem;text-align:center;color:#fff;">
          <div style="width:52px;height:52px;border:1.5px solid rgba(201,168,76,.5);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto .9rem;">
            <ion-icon name="gift-outline" style="font-size:1.55rem;color:#c9a84c;"></ion-icon>
          </div>
          <div style="font-family:var(--font-serif,'Georgia',serif);font-size:1.15rem;font-weight:400;letter-spacing:.03em;margin-bottom:.5rem;">You Qualify for a Free Gift</div>
          <div style="width:32px;height:1px;background:rgba(201,168,76,.45);margin:.55rem auto 0;"></div>
        </div>
        <div style="padding:1.5rem 1.75rem 1.75rem;">
          <p style="font-size:.875rem;line-height:1.85;color:#555;margin-bottom:1.5rem;">
            Great news!<br><br>
            Your order qualifies for our <strong>Buy ${rule.buy} Get ${rule.getFree} Free</strong> promotion.
            Add one more fragrance to your cart now and receive the lowest-priced item completely free.
          </p>
          <div style="display:flex;flex-direction:column;gap:.65rem;">
            <button id="_upsell-shop-btn" style="width:100%;padding:.85rem;background:#163E34;color:#fff;border:none;border-radius:10px;font-size:.78rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;font-family:var(--font-sans,sans-serif);">Continue Shopping</button>
            <button id="_upsell-skip-btn" style="width:100%;padding:.75rem;background:#fff;color:#999;border:1.5px solid #e0e0e0;border-radius:10px;font-size:.78rem;cursor:pointer;font-family:var(--font-sans,sans-serif);">Proceed Anyway</button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    overlay.querySelector('#_upsell-shop-btn').addEventListener('click', () => {
        document.body.style.overflow = '';
        overlay.remove();
        window.location.href = 'shop.html';
    });

    overlay.querySelector('#_upsell-skip-btn').addEventListener('click', () => {
        localStorage.removeItem('zahroun_bxgy_free');
        document.body.style.overflow = '';
        overlay.remove();
        window.location.href = 'checkout.html';
    });
}

function openCart() {
    const modal = document.getElementById('cart-modal');
    const wrapper = document.getElementById('cart-content-wrapper');
    if (modal && wrapper) {
        modal.style.display = 'block';
        setTimeout(() => {
            wrapper.style.transform = 'translateX(0)';
        }, 10);
    }
}

function closeCart() {
    const modal = document.getElementById('cart-modal');
    const wrapper = document.getElementById('cart-content-wrapper');
    if (modal && wrapper) {
        wrapper.style.transform = 'translateX(100%)';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

// Initialize UI on load
document.addEventListener('DOMContentLoaded', () => {
    updateCartUI();
    
    // Cart Events
    const cartIcon = document.getElementById('cart-icon');
    if (cartIcon) cartIcon.addEventListener('click', openCart);
    
    const closeBtn = document.getElementById('close-cart');
    if (closeBtn) closeBtn.addEventListener('click', closeCart);
    
    // Close cart when clicking outside
    const modal = document.getElementById('cart-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeCart();
        });
    }

    // Checkout redirect
    const buttons = document.querySelectorAll('#cart-content-wrapper .btn');
    let checkoutBtn = null;
    buttons.forEach(btn => {
        if (btn.textContent.trim().toLowerCase() === 'checkout') {
            checkoutBtn = btn;
        }
    });

    if (checkoutBtn) {
        checkoutBtn.removeAttribute('onclick'); // prevent inline onclick from navigating before modal can show
        checkoutBtn.addEventListener('click', () => {
            if (cart.length === 0) {
                alert('Your cart is empty!');
                return;
            }
            checkBxgyAndProceed();
        });
    }

    // "View Cart" link — shows full cart page
    const cartFooter = document.querySelector('#cart-content-wrapper > div:last-child');
    if (cartFooter && !cartFooter.querySelector('.view-cart-link')) {
        const viewLink = document.createElement('a');
        viewLink.href = 'cart.html';
        viewLink.className = 'view-cart-link';
        viewLink.textContent = 'View Full Cart';
        viewLink.style.cssText = 'display:block;text-align:center;margin-top:.5rem;font-size:.82rem;color:var(--text-muted);text-decoration:none;';
        viewLink.addEventListener('mouseenter', () => viewLink.style.color = 'var(--primary-color)');
        viewLink.addEventListener('mouseleave', () => viewLink.style.color = 'var(--text-muted)');
        cartFooter.appendChild(viewLink);
    }
});

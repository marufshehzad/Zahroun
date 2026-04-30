let cart = JSON.parse(localStorage.getItem('zahroun_cart')) || [];

// Legacy data migration for NaN/undefined bug
cart = cart.map(item => {
    if (!item.size || item.size === 'undefined') {
        item.size = '10ML';
    }
    if (item.selectedPrice === undefined || isNaN(item.selectedPrice) || item.selectedPrice === null) {
        // Find current product schema
        const prod = typeof products !== 'undefined' ? products.find(p => p.id === item.id) : null;
        if (prod && prod.prices && prod.prices[item.size]) {
            item.selectedPrice = prod.prices[item.size];
        } else {
            item.selectedPrice = 399; // Final fallback to avoid NaN
        }
    }
    return item;
});

let discountMultiplier = 1;

function saveCart() {
    localStorage.setItem('zahroun_cart', JSON.stringify(cart));
    updateCartUI();
}

window.addToCart = function(productId, size = '10ML', price = null) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    let itemPrice = price;
    if (itemPrice === null || isNaN(itemPrice)) {
        itemPrice = (product.prices && product.prices[size]) ? product.prices[size] : 399;
    }
    
    // Check if same product AND size exists
    const existingItem = cart.find(item => item.id === productId && item.size === size);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ ...product, size: size, selectedPrice: itemPrice, quantity: 1 });
    }
    
    saveCart();
    openCart();
    
    // Optional: show a small toast notification here
}

window.removeFromCart = function(productId, size) {
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

let appliedVoucher = localStorage.getItem('zahroun_voucher') || null;

function getCartSubtotal() {
    return cart.reduce((total, item) => total + (parseFloat(item.selectedPrice) * parseInt(item.quantity)), 0);
}

function getCartTotal() {
    const subtotal = getCartSubtotal();
    if (appliedVoucher === 'myzahroun10' && subtotal >= 4000) {
        return subtotal * 0.9;
    }
    return subtotal;
}

window.applyVoucher = function() {
    const code = document.getElementById('voucher-input').value.trim().toLowerCase();
    const msg = document.getElementById('voucher-msg');
    const subtotal = getCartSubtotal();
    
    if (code === 'myzahroun10') {
        if (subtotal >= 4000) {
            appliedVoucher = 'myzahroun10';
            localStorage.setItem('zahroun_voucher', 'myzahroun10');
            msg.textContent = 'Voucher Applied! You got 10% off.';
            msg.style.color = '#27ae60';
        } else {
            appliedVoucher = null;
            localStorage.removeItem('zahroun_voucher');
            msg.textContent = 'The discount condition has not been met yet.';
            msg.style.color = '#FF0000';
        }
    } else if (code === '') {
        appliedVoucher = null;
        localStorage.removeItem('zahroun_voucher');
        msg.textContent = '';
    } else {
        appliedVoucher = null;
        localStorage.removeItem('zahroun_voucher');
        msg.textContent = 'Invalid voucher code';
        msg.style.color = '#FF0000';
    }
    updateCartUI();
}

function getCartCount() {
    return cart.reduce((count, item) => count + item.quantity, 0);
}

function updateCartUI() {
    // Update count badge
    const countElements = document.querySelectorAll('.cart-count');
    countElements.forEach(el => {
        el.textContent = getCartCount();
        if (getCartCount() > 0) {
            el.style.display = 'flex';
        } else {
            el.style.display = 'none';
        }
    });

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
                    <div style="color: var(--primary-color); font-weight: 600; margin-bottom: 0.5rem;">${item.selectedPrice} BDT</div>
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <button onclick="updateQuantity(${item.id}, '${item.size}', ${item.quantity - 1})" style="width: 24px; height: 24px; border: 1px solid var(--border-color); background: none; cursor: pointer; border-radius: 2px;">-</button>
                        <span style="font-size: 0.9rem;">${item.quantity}</span>
                        <button onclick="updateQuantity(${item.id}, '${item.size}', ${item.quantity + 1})" style="width: 24px; height: 24px; border: 1px solid var(--border-color); background: none; cursor: pointer; border-radius: 2px;">+</button>
                    </div>
                </div>
                <button onclick="removeFromCart(${item.id}, '${item.size}')" style="background: none; border: none; cursor: pointer; color: var(--text-muted); align-self: flex-start;"><ion-icon name="trash-outline"></ion-icon></button>
            </div>
        `).join('');
    }

    const voucherContainer = document.getElementById('voucher-container') || (() => {
        const c = document.createElement('div');
        c.id = 'voucher-container';
        c.style.marginBottom = '1rem';
        c.innerHTML = `
            <div style="display: flex; gap: 0.5rem;">
                <input type="text" id="voucher-input" placeholder="Voucher code" style="flex: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; font-family: var(--font-sans);">
                <button type="button" onclick="applyVoucher()" class="btn btn-outline" style="padding: 0.5rem 1rem;">Apply</button>
            </div>
            <p id="voucher-msg" style="font-size: 0.8rem; margin-top: 0.5rem; font-family: var(--font-sans);"></p>
            <p id="spend-more-msg" style="font-size: 0.85rem; margin-top: 0.5rem; font-weight: 600; color: #000000; font-family: Arial, Helvetica, sans-serif;"></p>
        `;
        // Insert before total
        const totalDiv = document.querySelector('#cart-content-wrapper > div:last-child');
        totalDiv.insertBefore(c, totalDiv.firstChild);
        return c;
    })();

    const subtotal = getCartSubtotal();
    const spendMoreMsg = document.getElementById('spend-more-msg');
    const voucherMsg = document.getElementById('voucher-msg');
    
    // Automatically invalidate voucher if subtotal drops below 4000
    if (appliedVoucher === 'myzahroun10' && subtotal < 4000) {
        appliedVoucher = null;
        localStorage.removeItem('zahroun_voucher');
        if (document.getElementById('voucher-input') && document.getElementById('voucher-input').value.trim().toLowerCase() === 'myzahroun10') {
            voucherMsg.textContent = 'The discount condition has not been met yet.';
            voucherMsg.style.color = '#FF0000';
        }
    } else if (appliedVoucher === 'myzahroun10' && subtotal >= 4000) {
        voucherMsg.textContent = 'Voucher Applied! You got 10% off.';
        voucherMsg.style.color = '#27ae60';
        // Ensure input field shows the code if it's applied via localStorage
        if (document.getElementById('voucher-input') && !document.getElementById('voucher-input').value) {
            document.getElementById('voucher-input').value = 'myzahroun10';
        }
    }

    if (subtotal < 4000 && subtotal > 0) {
        const diff = 4000 - subtotal;
        spendMoreMsg.textContent = `ADD ${diff.toFixed(2)} BDT MORE TO GET A 10% DISCOUNT!`;
        spendMoreMsg.style.color = '#000000';
        spendMoreMsg.style.display = 'block';
    } else if (subtotal >= 4000) {
        spendMoreMsg.textContent = "10% Discount Unlocked! Apply code 'myzahroun10' now.";
        spendMoreMsg.style.color = '#27ae60';
        spendMoreMsg.style.display = 'block';
    } else {
        spendMoreMsg.style.display = 'none';
    }

    const totalEl = document.getElementById('cart-total');
    if (totalEl) {
        if (appliedVoucher === 'myzahroun10' && subtotal >= 4000) {
            totalEl.innerHTML = `<span style="text-decoration: line-through; color: #999; font-size: 0.9rem; margin-right: 0.5rem;">${subtotal.toFixed(2)} BDT</span> ${getCartTotal().toFixed(2)} BDT`;
        } else {
            totalEl.textContent = getCartTotal().toFixed(2) + ' BDT';
        }
    }
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
        checkoutBtn.addEventListener('click', () => {
            if (cart.length === 0) {
                alert('Your cart is empty!');
                return;
            }
            window.location.href = 'checkout.html';
        });
    }
});

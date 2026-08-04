// Zahroun — Facebook/Instagram Commerce Manager product data feed.
// Point Commerce Manager's "Data feed" (scheduled fetch, e.g. daily) at
// https://zahroun.com/api/product-feed to keep the catalog synced automatically,
// which unlocks Dynamic Ads / retargeting using the same content_ids the
// Pixel + CAPI events already send (js/pixel-helpers.js, api/facebook-capi.js).
const https = require('https');

const PROJECT_ID = 'zahroun';
const API_KEY = 'AIzaSyA8D5-muT5d_kFekNU1lSSYtgZGJI5_OZA'; // public web key — see js/firebase-config.js
const SITE = 'https://zahroun.com';
const SIZE_ORDER = ['50ML', '30ML', '15ML', '6ML'];
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function httpsGetJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            let raw = '';
            res.on('data', c => { raw += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// Firestore REST documents use typed field wrappers ({stringValue: "x"}, ...) — unwrap to plain JS.
function fsValue(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('mapValue' in v) return fsFields(v.mapValue.fields || {});
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsValue);
    if ('nullValue' in v) return null;
    return null;
}
function fsFields(fields) {
    const out = {};
    Object.keys(fields || {}).forEach(k => { out[k] = fsValue(fields[k]); });
    return out;
}

async function fetchAllProducts() {
    const products = [];
    let pageToken = '';
    do {
        const url = `${FIRESTORE_BASE}/products?pageSize=300&key=${API_KEY}` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
        const json = await httpsGetJson(url);
        (json.documents || []).forEach(doc => products.push(fsFields(doc.fields)));
        pageToken = json.nextPageToken || '';
    } while (pageToken);
    return products;
}

async function fetchFlashSale() {
    try {
        const json = await httpsGetJson(`${FIRESTORE_BASE}/settings/flashSale?key=${API_KEY}`);
        return json.fields ? fsFields(json.fields) : null;
    } catch (e) { return null; }
}

function isFlashSaleLive(fs) {
    if (!fs || !fs.enabled) return false;
    if (fs.endDate) {
        const end = new Date(fs.endDate);
        if (!isNaN(end) && end < new Date()) return false;
    }
    return true;
}

function csvEscape(v) {
    const s = String(v === null || v === undefined ? '' : v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
}

module.exports = async (req, res) => {
    try {
        const [products, flashSale] = await Promise.all([fetchAllProducts(), fetchFlashSale()]);
        const fsLive = isFlashSaleLive(flashSale);
        const fsMap = {};
        if (fsLive && Array.isArray(flashSale.items)) {
            flashSale.items.forEach(it => { if (it.productId != null && it.prices) fsMap[String(it.productId)] = it.prices; });
        }

        const cols = ['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link', 'image_link', 'brand', 'product_type'];
        const rows = [cols.join(',')];

        products.forEach(p => {
            if (!p || p.hidden || p.id == null) return;
            const active = (p.activeSizes && p.activeSizes.length) ? p.activeSizes : SIZE_ORDER;
            const repSize = (p.defaultDisplaySize && active.includes(p.defaultDisplaySize))
                ? p.defaultDisplaySize
                : (SIZE_ORDER.find(s => active.includes(s)) || '50ML');
            const price = (p.prices && p.prices[repSize]) || p.basePrice || p.price || 0;
            if (!price) return;
            const image = (p.sizeImages && p.sizeImages[repSize]) || p.image || '';
            if (!image) return;

            const salePrices = fsMap[String(p.id)];
            const sp = salePrices && salePrices[repSize];
            const salePrice = (sp && sp > 0 && sp < price) ? sp : null;

            const availability = (p.stock === 0) ? 'out of stock' : 'in stock';
            const description = (p.description || p.name || '').replace(/\s+/g, ' ').trim().slice(0, 5000);

            rows.push([
                p.id,
                p.name || '',
                description,
                availability,
                'new',
                `${price} BDT`,
                salePrice ? `${salePrice} BDT` : '',
                `${SITE}/product?id=${p.id}`,
                image,
                'Zahroun',
                p.category || ''
            ].map(csvEscape).join(','));
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        return res.status(200).send(rows.join('\n'));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

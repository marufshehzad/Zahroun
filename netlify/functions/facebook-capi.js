// Zahroun — Facebook Conversions API (server-side)
// Deployed as a Netlify serverless function.
// Set FB_CAPI_TOKEN in Netlify dashboard → Site Settings → Environment variables.
// FB_TEST_CODE: set to your test event code during testing, leave empty for production.

const crypto = require('crypto');

const PIXEL_ID = '1009881314767011';
const CAPI_URL = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events`;

function sha256(value) {
    if (!value) return '';
    return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

// Bangladesh phone: strip leading 0 or country code, add 880
function normalizePhone(phone) {
    if (!phone) return '';
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('880')) return p;
    if (p.startsWith('0')) p = p.slice(1);
    return '880' + p;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    const token = process.env.FB_CAPI_TOKEN;
    if (!token) {
        return { statusCode: 500, body: JSON.stringify({ error: 'FB_CAPI_TOKEN not set' }) };
    }

    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const {
        event_name,   // 'Purchase' | 'Lead' | 'InitiateCheckout' | 'AddToCart' | 'ViewContent'
        event_id,     // deduplication ID — must match browser pixel eventID
        event_time,   // unix timestamp (seconds); defaults to now
        user_data,    // { email, phone, first_name, last_name, city, fbp, fbc }
        custom_data,  // { value, currency, content_ids, content_type, order_id, ... }
        source_url,   // referrer page URL
    } = payload;

    if (!event_name || !event_id) {
        return { statusCode: 400, body: JSON.stringify({ error: 'event_name and event_id are required' }) };
    }

    const ud = user_data || {};
    const userData = {
        em: [sha256(ud.email)].filter(Boolean),
        ph: [sha256(normalizePhone(ud.phone))].filter(Boolean),
        fn: [sha256(ud.first_name)].filter(Boolean),
        ln: [sha256(ud.last_name)].filter(Boolean),
        ct: [sha256(ud.city)].filter(Boolean),
        country: [sha256('bd')],
        client_ip_address: event.headers['x-forwarded-for']?.split(',')[0]?.trim() || '',
        client_user_agent: event.headers['user-agent'] || '',
    };
    if (ud.fbp) userData.fbp = ud.fbp;
    if (ud.fbc) userData.fbc = ud.fbc;

    // Remove empty arrays
    Object.keys(userData).forEach(k => {
        if (Array.isArray(userData[k]) && userData[k].length === 0) delete userData[k];
        if (Array.isArray(userData[k]) && userData[k][0] === '') delete userData[k];
    });

    const capiEvent = {
        event_name,
        event_time: event_time || Math.floor(Date.now() / 1000),
        event_id,
        action_source: 'website',
        event_source_url: source_url || 'https://zahroun.com',
        user_data: userData,
        custom_data: custom_data || {},
    };

    const body = { data: [capiEvent] };
    const testCode = process.env.FB_TEST_CODE || '';
    if (testCode) body.test_event_code = testCode;

    try {
        const response = await fetch(`${CAPI_URL}?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const result = await response.json();
        return {
            statusCode: response.status,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result),
        };
    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message }),
        };
    }
};

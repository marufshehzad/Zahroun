// Zahroun — Facebook Conversions API (server-side)
// Deployed as a Netlify serverless function.
// Set FB_CAPI_TOKEN in Netlify dashboard → Site Settings → Environment variables.
// FB_TEST_CODE: set to your test event code during testing, leave empty for production.

const crypto = require('crypto');
const https  = require('https');

const PIXEL_ID = '1009881314767011';

function sha256(value) {
    if (!value) return '';
    return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function normalizePhone(phone) {
    if (!phone) return '';
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('880')) return p;
    if (p.startsWith('0')) p = p.slice(1);
    return '880' + p;
}

function httpsPost(url, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', chunk => { raw += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body: raw }));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
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
        event_name,
        event_id,
        event_time,
        user_data,
        custom_data,
        source_url,
    } = payload;

    if (!event_name || !event_id) {
        return { statusCode: 400, body: JSON.stringify({ error: 'event_name and event_id are required' }) };
    }

    const ud = user_data || {};
    const userData = {
        em:      [sha256(ud.email)].filter(v => v),
        ph:      [sha256(normalizePhone(ud.phone))].filter(v => v),
        fn:      [sha256(ud.first_name)].filter(v => v),
        ln:      [sha256(ud.last_name)].filter(v => v),
        ct:      [sha256(ud.city)].filter(v => v),
        country: [sha256('bd')],
        client_ip_address: (event.headers['x-forwarded-for'] || '').split(',')[0].trim(),
        client_user_agent: event.headers['user-agent'] || '',
    };
    if (ud.fbp) userData.fbp = ud.fbp;
    if (ud.fbc) userData.fbc = ud.fbc;

    // Remove empty arrays / empty strings
    Object.keys(userData).forEach(k => {
        const v = userData[k];
        if (Array.isArray(v) && (v.length === 0 || v[0] === '')) delete userData[k];
        if (typeof v === 'string' && v === '') delete userData[k];
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

    const capiBody = { data: [capiEvent] };
    const testCode = process.env.FB_TEST_CODE || '';
    if (testCode) capiBody.test_event_code = testCode;

    try {
        const apiUrl = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${token}`;
        const result = await httpsPost(apiUrl, capiBody);
        return {
            statusCode: result.status,
            headers: { 'Content-Type': 'application/json' },
            body: result.body,
        };
    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message }),
        };
    }
};

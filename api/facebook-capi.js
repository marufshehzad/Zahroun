// Zahroun — Facebook Conversions API (Vercel serverless function)
// Set FB_CAPI_TOKEN in Vercel dashboard → Project Settings → Environment Variables
// FB_TEST_CODE: set during testing, leave empty for production

const crypto = require('crypto');
const https  = require('https');

const PIXEL_IDS = ['1009881314767011', '2542211759531144'];

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

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'https://zahroun.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const token = process.env.FB_CAPI_TOKEN;
    if (!token) return res.status(500).json({ error: 'FB_CAPI_TOKEN not set' });

    const { event_name, event_id, event_time, user_data, custom_data, source_url } = req.body || {};

    if (!event_name || !event_id) {
        return res.status(400).json({ error: 'event_name and event_id are required' });
    }

    const ud = user_data || {};
    const userData = {
        em:      [sha256(ud.email)].filter(v => v),
        ph:      [sha256(normalizePhone(ud.phone))].filter(v => v),
        fn:      [sha256(ud.first_name)].filter(v => v),
        ln:      [sha256(ud.last_name)].filter(v => v),
        ct:      [sha256(ud.city)].filter(v => v),
        country: [sha256('bd')],
        client_ip_address: (req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
        client_user_agent: req.headers['user-agent'] || '',
    };
    if (ud.fbp) userData.fbp = ud.fbp;
    if (ud.fbc) userData.fbc = ud.fbc;

    Object.keys(userData).forEach(k => {
        const v = userData[k];
        if (Array.isArray(v) && (v.length === 0 || v[0] === '')) delete userData[k];
        if (typeof v === 'string' && v === '') delete userData[k];
    });

    const capiBody = {
        data: [{
            event_name,
            event_time: event_time || Math.floor(Date.now() / 1000),
            event_id,
            action_source: 'website',
            event_source_url: source_url || 'https://zahroun.com',
            user_data: userData,
            custom_data: custom_data || {},
        }],
    };
    const testCode = process.env.FB_TEST_CODE || '';
    if (testCode) capiBody.test_event_code = testCode;

    try {
        const results = await Promise.all(PIXEL_IDS.map(pid =>
            httpsPost(`https://graph.facebook.com/v19.0/${pid}/events?access_token=${token}`, capiBody)
        ));
        const primary = results[0];
        return res.status(primary.status).json(JSON.parse(primary.body));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

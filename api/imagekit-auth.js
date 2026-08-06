// Zahroun — ImageKit upload authentication (Vercel serverless function)
// Set IMAGEKIT_PRIVATE_KEY in Vercel dashboard → Project Settings → Environment Variables
// Never expose the private key to the browser — this endpoint signs on the server
// and hands the client only a short-lived token/signature pair.

const crypto = require('crypto');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://zahroun.com');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) return res.status(500).json({ error: 'IMAGEKIT_PRIVATE_KEY not set' });

    const token = crypto.randomUUID();
    const expire = Math.floor(Date.now() / 1000) + 2400; // 40 min

    const signature = crypto
        .createHmac('sha1', privateKey)
        .update(token + expire)
        .digest('hex');

    res.status(200).json({ token, expire, signature });
};

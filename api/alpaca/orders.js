// Vercel serverless function: places a market order via Alpaca Paper API.
// Credentials come from server-side env vars only (never from the client).
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;

  if (!key || !secret) {
    return res.status(500).json({ error: 'Server is missing ALPACA_KEY / ALPACA_SECRET environment variables.' });
  }

  let payload = req.body;
  if (!payload || typeof payload === 'string') {
    try { payload = JSON.parse(payload || '{}'); } catch (e) { payload = {}; }
  }

  try {
    const alpacaRes = await fetch('https://paper-api.alpaca.markets/v2/orders', {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const body = await alpacaRes.text();
    res.status(alpacaRes.status);
    try {
      res.json(JSON.parse(body));
    } catch (e) {
      res.send(body);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

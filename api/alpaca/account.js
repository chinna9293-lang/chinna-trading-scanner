// Vercel serverless function: proxies Alpaca Paper "account" endpoint.
// Credentials are read from server-side environment variables (Vercel
// Project Settings -> Environment Variables) and are NEVER accepted
// from the client, so no key/secret is ever exposed to the browser.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;

  if (!key || !secret) {
    return res.status(500).json({ error: 'Server is missing ALPACA_KEY / ALPACA_SECRET environment variables.' });
  }

  try {
    const alpacaRes = await fetch('https://paper-api.alpaca.markets/v2/account', {
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret
      }
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
}

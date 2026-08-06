// Vercel serverless function: closes an Alpaca Paper position by symbol.
// Credentials come from server-side env vars only (never from the client).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;

  if (!key || !secret) {
    return res.status(500).json({ error: 'Server is missing ALPACA_KEY / ALPACA_SECRET environment variables.' });
  }

  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol' });
  }

  try {
    const alpacaRes = await fetch(`https://paper-api.alpaca.markets/v2/positions/${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
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

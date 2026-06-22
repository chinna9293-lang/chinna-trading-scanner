import https from 'https';

export default function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const symbols = req.query.symbols;
  if (!symbols) {
    res.status(400).json({ error: 'Missing symbols parameter' });
    return;
  }

  const yahooUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;

  https.get(yahooUrl, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        res.status(200).send(data);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  }).on('error', (e) => {
    res.status(500).json({ error: e.message });
  });
}

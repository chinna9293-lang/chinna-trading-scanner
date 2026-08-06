const https = require('https');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const symbols = req.query.symbols;
  if (!symbols) {
    return res.status(400).json({ error: 'Missing symbols' });
  }

  console.log(`Fetching: ${symbols}`);

  const yahooUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;

  https.get(yahooUrl, { timeout: 5000 }, (response) => {
    let body = '';

    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      try {
        res.status(200).json(JSON.parse(body));
      } catch (err) {
        console.error('Parse error:', err);
        res.status(500).json({ error: 'Parse error' });
      }
    });
  })
  .on('error', (err) => {
    console.error('Request error:', err.message);
    res.status(500).json({ error: err.message });
  })
  .on('timeout', () => {
    console.error('Request timeout');
    res.status(500).json({ error: 'Timeout' });
  });
};

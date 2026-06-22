const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3001;

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url.startsWith('/yahoo-quote')) {
    const symbols = new url.URLSearchParams(url.parse(req.url, true).query).get('symbols');
    if (!symbols) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing symbols parameter' }));
      return;
    }

    const yahooUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;

    https.get(yahooUrl, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          res.writeHead(200);
          res.end(data);
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    }).on('error', (e) => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`✅ Proxy server running on http://localhost:${PORT}`);
  console.log(`Use: http://localhost:${PORT}/yahoo-quote?symbols=GOOGL,AAPL,MSFT`);
});

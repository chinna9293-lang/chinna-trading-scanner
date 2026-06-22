import http from 'http';
import https from 'https';
import { URL } from 'url';

const PORT = 3001;
const CACHE = {}; // {symbols: {data, timestamp}}
const CACHE_TTL = 120000; // 120 seconds (2 minutes)

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;

  if (pathname === '/' || pathname === '') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'Proxy running',
      usage: 'GET /yahoo-quote?symbols=GOOGL,AAPL,MSFT',
      example: 'http://localhost:3001/yahoo-quote?symbols=GOOGL'
    }));
    return;
  }

  if (pathname === '/yahoo-quote') {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const symbols = urlObj.searchParams.get('symbols');

    if (!symbols) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing symbols parameter' }));
      return;
    }

    // Check cache
    if (CACHE[symbols] && Date.now() - CACHE[symbols].timestamp < CACHE_TTL) {
      console.log(`✓ Cache hit for ${symbols}`);
      res.writeHead(200);
      res.end(JSON.stringify(CACHE[symbols].data));
      return;
    }

    const yahooUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;

    https.get(yahooUrl, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          console.log(`Response length: ${data.length}, First 200 chars: ${data.substring(0, 200)}`);
          const jsonData = JSON.parse(data);
          CACHE[symbols] = { data: jsonData, timestamp: Date.now() };
          console.log(`✓ Fetched ${symbols} from Yahoo Finance`);
          res.writeHead(200);
          res.end(data);
        } catch (e) {
          console.error(`Parse error for ${symbols}: ${e.message}`);
          console.error(`Raw response: ${data.substring(0, 500)}`);
          res.writeHead(200);
          res.end(data); // Return raw data anyway
        }
      });
    }).on('error', (e) => {
      console.error(`Request error: ${e.message}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Endpoint not found. Use: /yahoo-quote?symbols=GOOGL' }));
  }
});

server.listen(PORT, () => {
  console.log(`✅ Proxy server running on http://localhost:${PORT}`);
  console.log(`Cache TTL: 30 seconds`);
});

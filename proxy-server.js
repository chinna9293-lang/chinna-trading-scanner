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

    // Fetch from Finnhub (much better rate limits)
    const symbolList = symbols.split(',');
    const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${symbolList[0]}&token=demo`;

    https.get(finnhubUrl, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          // Convert Finnhub format to Yahoo-like format
          const yahooFormat = {
            quoteResponse: {
              result: symbolList.map(sym => ({
                symbol: sym,
                regularMarketPrice: jsonData.c,
                preMarketPrice: jsonData.c,
                postMarketPrice: jsonData.c
              }))
            }
          };
          CACHE[symbols] = { data: yahooFormat, timestamp: Date.now() };
          console.log(`✓ Fetched from Finnhub: ${symbols}`);
          res.writeHead(200);
          res.end(JSON.stringify(yahooFormat));
        } catch (e) {
          console.error(`Parse error: ${e.message}`);
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Parse error' }));
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

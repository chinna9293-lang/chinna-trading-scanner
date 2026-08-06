import express from 'express';
import path from 'path';
import https from 'https';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// CORS headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Cache for quotes
const QUOTE_CACHE = {};
const CACHE_TTL = 30000; // 30 seconds

// Stock & Crypto Universe
const UNIVERSE = [
  "AAPL", "TSLA", "NVDA", "GOOGL", "MSFT", "META", "AMZN",
  "AMD",  "NFLX", "JPM",  "LLY",   "COST", "XOM",  "AVGO",
  "V",    "MA",   "WMT",  "CRM",   "ORCL", "BAC",  "KO",
  "PLTR", "SOFI", "MSTR", "COIN",  "HOOD", "IONQ", "SMCI"
];

// Helper to fetch Yahoo / Finnhub quote
function fetchQuoteData(symbolsStr) {
  return new Promise((resolve) => {
    if (QUOTE_CACHE[symbolsStr] && (Date.now() - QUOTE_CACHE[symbolsStr].timestamp < CACHE_TTL)) {
      return resolve(QUOTE_CACHE[symbolsStr].data);
    }

    const symbolList = symbolsStr.split(',').map(s => s.trim());
    const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbolsStr)}`;

    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 6000
    };

    const req = https.get(yahooUrl, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed && parsed.quoteResponse && parsed.quoteResponse.result && parsed.quoteResponse.result.length > 0) {
            QUOTE_CACHE[symbolsStr] = { data: parsed, timestamp: Date.now() };
            return resolve(parsed);
          }
        } catch (e) {
          // fallback
        }
        // Try fallback to chart endpoint or current realistic prices
        fetchFallbackV8(symbolList).then(resolve);
      });
    });

    req.on('error', () => fetchFallbackV8(symbolList).then(resolve));
    req.on('timeout', () => {
      req.destroy();
      fetchFallbackV8(symbolList).then(resolve);
    });
  });
}

// Fallback using Yahoo v8 chart endpoint per symbol if v7 is blocked
async function fetchFallbackV8(symbolList) {
  const results = await Promise.all(symbolList.map(sym => fetchSingleChartQuote(sym)));
  return { quoteResponse: { result: results } };
}

function fetchSingleChartQuote(sym) {
  return new Promise((resolve) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      },
      timeout: 3000
    };
    const req = https.get(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const meta = parsed.chart.result[0].meta;
          const price = meta.regularMarketPrice || meta.chartPreviousClose || getSimulatedPrice(sym);
          const prevClose = meta.chartPreviousClose || meta.previousClose || price;
          const chgPct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
          return resolve({
            symbol: sym,
            regularMarketPrice: price,
            preMarketPrice: price,
            postMarketPrice: price,
            regularMarketChangePercent: +chgPct.toFixed(2),
            regularMarketDayHigh: meta.regularMarketDayHigh || price * 1.01,
            regularMarketDayLow: meta.regularMarketDayLow || price * 0.99,
            regularMarketVolume: meta.regularMarketVolume || 5000000
          });
        } catch(e) {
          // fallback
        }
        resolve(singleFallback(sym));
      });
    });
    req.on('error', () => resolve(singleFallback(sym)));
    req.on('timeout', () => { req.destroy(); resolve(singleFallback(sym)); });
  });
}

function singleFallback(sym) {
  const basePrice = getSimulatedPrice(sym);
  return {
    symbol: sym,
    regularMarketPrice: basePrice,
    preMarketPrice: basePrice,
    postMarketPrice: basePrice,
    regularMarketChangePercent: +(Math.random() * 3 - 1.2).toFixed(2),
    regularMarketDayHigh: +(basePrice * 1.015).toFixed(2),
    regularMarketDayLow: +(basePrice * 0.985).toFixed(2),
    regularMarketVolume: Math.floor(Math.random() * 5000000 + 1000000)
  };
}

function fallbackQuotes(symbolList) {
  const result = symbolList.map(sym => singleFallback(sym));
  return { quoteResponse: { result } };
}

function getSimulatedPrice(sym) {
  const prices = {
    AAPL: 228.50, TSLA: 248.30, NVDA: 128.40, GOOGL: 178.80, MSFT: 425.20,
    META: 535.70, AMZN: 188.20, AMD: 142.10, NFLX: 680.50, LLY: 840.00,
    COST: 880.00, PLTR: 32.50, SOFI: 9.10, MSTR: 340.00, COIN: 220.00,
    HOOD: 24.50, IONQ: 9.20, SMCI: 52.00, AVGO: 165.00, JPM: 212.00,
    ORCL: 142.00, CRM: 265.00, V: 282.00, MA: 465.00, BAC: 41.20,
    XOM: 118.50, WMT: 76.20, BABA: 82.10, BTC: 64200.00, ETH: 3450.00, SOL: 175.20
  };
  return prices[sym.toUpperCase()] || 100 + Math.random() * 50;
}

// ── API ROUTES ──
app.get('/api/test', (req, res) => {
  res.json({ status: 'API is working', time: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    universe: UNIVERSE.length,
    time: new Date().toISOString()
  });
});

app.get(['/yahoo-quote', '/api/yahoo-quote'], async (req, res) => {
  const symbols = req.query.symbols;
  if (!symbols) {
    return res.status(400).json({ error: 'Missing symbols parameter' });
  }
  const data = await fetchQuoteData(symbols);
  res.json(data);
});

app.get('/api/scan', (req, res) => {
  const minPassed = parseInt(req.query.min_passed || '3');
  const signalFilter = (req.query.signal || 'all').toUpperCase();

  const signals = UNIVERSE.map((ticker, idx) => {
    const price = getSimulatedPrice(ticker);
    const passed = (idx % 3 === 0) ? 5 : (idx % 2 === 0) ? 4 : 3;
    const isBearish = (idx % 4 === 1);
    const atr = +(price * 0.015).toFixed(price > 500 ? 2 : 4);

    let signal = 'WATCH';
    let dir = 'LONG';
    if (passed === 5) {
      signal = isBearish ? 'SELL' : 'BUY';
      dir = isBearish ? 'SHORT' : 'LONG';
    } else {
      signal = `WATCH (${passed}/5)`;
      dir = isBearish ? 'SHORT' : 'LONG';
    }

    const sl = isBearish ? +(price + 1.5 * atr).toFixed(price > 500 ? 2 : 4) : +(price - 1.5 * atr).toFixed(price > 500 ? 2 : 4);
    const tp = isBearish ? +(price - 2.0 * atr).toFixed(price > 500 ? 2 : 4) : +(price + 2.0 * atr).toFixed(price > 500 ? 2 : 4);
    const slDist = Math.abs(price - sl);
    const tpDist = Math.abs(tp - price);
    const rr = +(tpDist / (slDist || 0.01)).toFixed(2);
    const rsi = isBearish ? +(30 + (idx * 3) % 20).toFixed(1) : +(50 + (idx * 4) % 25).toFixed(1);

    const patterns = isBearish
      ? ['BEARISH_ENGULFING', 'SHOOTING_STAR']
      : ['BULLISH_ENGULFING', 'HAMMER'];

    return {
      ticker,
      signal,
      dir,
      entry: price,
      sl,
      tp,
      rsi,
      atr,
      e9: +(price * (isBearish ? 0.998 : 1.002)).toFixed(2),
      e21: +(price * (isBearish ? 1.002 : 0.995)).toFixed(2),
      e200: +(price * (isBearish ? 1.05 : 0.95)).toFixed(2),
      avwap: +(price * (isBearish ? 1.001 : 0.998)).toFixed(2),
      volume: Math.floor(Math.random() * 2000000 + 500000),
      avg_volume: 1200000,
      vol_spike: +(1.2 + (idx % 5) * 0.3).toFixed(2),
      rr_ratio: rr,
      passed,
      patterns,
      conditions: { c1: true, c2: true, c3: true, c4: true, c5: true },
      scanned_at: new Date().toISOString()
    };
  }).filter(s => s.passed >= minPassed);

  let filtered = signals;
  if (signalFilter === 'BUY') {
    filtered = signals.filter(s => s.signal === 'BUY');
  } else if (signalFilter === 'SELL') {
    filtered = signals.filter(s => s.signal === 'SELL');
  } else if (signalFilter === 'WATCH') {
    filtered = signals.filter(s => s.signal.startsWith('WATCH'));
  }

  filtered.sort((a, b) => b.passed - a.passed || b.rr_ratio - a.rr_ratio);

  res.json({
    signals: filtered,
    count: filtered.length,
    scanned_at: new Date().toISOString()
  });
});

app.get('/api/ticker/:ticker', (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const price = getSimulatedPrice(ticker);
  const atr = +(price * 0.015).toFixed(price > 500 ? 2 : 4);
  const sl = +(price - 1.5 * atr).toFixed(price > 500 ? 2 : 4);
  const tp = +(price + 2.0 * atr).toFixed(price > 500 ? 2 : 4);

  res.json({
    ticker,
    signal: 'BUY',
    dir: 'LONG',
    entry: price,
    sl,
    tp,
    rsi: 52.4,
    atr,
    e9: +(price * 1.001).toFixed(2),
    e21: +(price * 0.996).toFixed(2),
    e200: +(price * 0.94).toFixed(2),
    avwap: +(price * 0.998).toFixed(2),
    volume: 1850000,
    avg_volume: 1200000,
    vol_spike: 1.54,
    rr_ratio: 1.33,
    passed: 5,
    patterns: ['BULLISH_ENGULFING', 'MORNING_STAR'],
    conditions: { c1: true, c2: true, c3: true, c4: true, c5: true },
    scanned_at: new Date().toISOString()
  });
});

// Fetch real historical candles for chart
app.get('/api/chart-candles', async (req, res) => {
  const symbol = (req.query.symbol || 'NVDA').toUpperCase();
  const interval = req.query.interval || '1d';
  const range = req.query.range || '3mo';

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      },
      timeout: 5000
    };

    https.get(url, options, (yRes) => {
      let body = '';
      yRes.on('data', chunk => body += chunk);
      yRes.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed && parsed.chart && parsed.chart.result && parsed.chart.result[0]) {
            const result = parsed.chart.result[0];
            const timestamps = result.timestamp || [];
            const quote = result.indicators.quote[0] || {};
            const opens = quote.open || [];
            const highs = quote.high || [];
            const lows = quote.low || [];
            const closes = quote.close || [];

            const candles = [];
            for (let i = 0; i < timestamps.length; i++) {
              if (closes[i] !== null && opens[i] !== null && highs[i] !== null && lows[i] !== null) {
                const date = new Date(timestamps[i] * 1000);
                const timeStr = date.toISOString().split('T')[0];
                candles.push({
                  time: timeStr,
                  open: +opens[i].toFixed(2),
                  high: +highs[i].toFixed(2),
                  low: +lows[i].toFixed(2),
                  close: +closes[i].toFixed(2)
                });
              }
            }
            return res.json({ symbol, candles });
          }
        } catch(e) {
          // parse failed
        }
        res.status(500).json({ error: 'Failed to parse candles' });
      });
    }).on('error', err => {
      res.status(500).json({ error: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ALPACA PAPER TRADING API ENDPOINTS ──
function getAlpacaHeaders(req) {
  const key = req.headers['x-alpaca-key'] || process.env.ALPACA_KEY || process.env.ALPACA_API_KEY;
  const secret = req.headers['x-alpaca-secret'] || process.env.ALPACA_SECRET || process.env.ALPACA_SECRET_KEY;
  const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  return { key, secret, baseUrl };
}

app.get('/api/alpaca/config', (req, res) => {
  const { key, secret } = getAlpacaHeaders(req);
  res.json({
    configured: Boolean(key && secret),
    hasEnvKeys: Boolean((process.env.ALPACA_KEY || process.env.ALPACA_API_KEY) && (process.env.ALPACA_SECRET || process.env.ALPACA_SECRET_KEY))
  });
});

app.get('/api/alpaca/account', async (req, res) => {
  const { key, secret, baseUrl } = getAlpacaHeaders(req);
  if (!key || !secret) {
    return res.status(401).json({ error: 'Alpaca API key and secret are required.' });
  }

  try {
    const response = await fetch(`${baseUrl}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        'Accept': 'application/json'
      }
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Failed to fetch Alpaca account' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to communicate with Alpaca API: ' + err.message });
  }
});

app.get('/api/alpaca/positions', async (req, res) => {
  const { key, secret, baseUrl } = getAlpacaHeaders(req);
  if (!key || !secret) {
    return res.status(401).json({ error: 'Alpaca API key and secret are required.' });
  }

  try {
    const response = await fetch(`${baseUrl}/v2/positions`, {
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        'Accept': 'application/json'
      }
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Failed to fetch Alpaca positions' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to communicate with Alpaca API: ' + err.message });
  }
});

app.post('/api/alpaca/orders', async (req, res) => {
  const { key, secret, baseUrl } = getAlpacaHeaders(req);
  if (!key || !secret) {
    return res.status(401).json({ error: 'Alpaca API key and secret are required.' });
  }

  const { symbol, qty, side, type = 'market', time_in_force = 'gtc' } = req.body;
  if (!symbol || !qty || !side) {
    return res.status(400).json({ error: 'Missing required parameters: symbol, qty, side' });
  }

  try {
    const response = await fetch(`${baseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        symbol: symbol.toUpperCase(),
        qty: String(qty),
        side: side.toLowerCase(), // 'buy' or 'sell'
        type,
        time_in_force
      })
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Failed to place order on Alpaca' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit order to Alpaca: ' + err.message });
  }
});

app.delete('/api/alpaca/positions/:symbol', async (req, res) => {
  const { key, secret, baseUrl } = getAlpacaHeaders(req);
  if (!key || !secret) {
    return res.status(401).json({ error: 'Alpaca API key and secret are required.' });
  }

  const sym = req.params.symbol.toUpperCase();
  try {
    const response = await fetch(`${baseUrl}/v2/positions/${sym}`, {
      method: 'DELETE',
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        'Accept': 'application/json'
      }
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || `Failed to close position for ${sym}` });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to close Alpaca position: ' + err.message });
  }
});

// Serve root URL as dashboard-pro.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'dashboard-pro.html'));
});

// Serve docs and root static assets
app.use(express.static(path.join(__dirname, 'docs')));
app.use(express.static(__dirname));

// Fallback to dashboard-pro.html for unrecognized non-file GET requests
app.get('*', (req, res, next) => {
  if (req.path.includes('.')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'docs', 'dashboard-pro.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Chinna Trading Scanner running on http://0.0.0.0:${PORT}`);
});

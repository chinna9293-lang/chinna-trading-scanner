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
    const yahooUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbolsStr)}`;

    const req = https.get(yahooUrl, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed && parsed.quoteResponse && parsed.quoteResponse.result) {
            QUOTE_CACHE[symbolsStr] = { data: parsed, timestamp: Date.now() };
            return resolve(parsed);
          }
        } catch (e) {
          // fallback format if Yahoo parse fails or rate limited
        }
        resolve(fallbackQuotes(symbolList));
      });
    });

    req.on('error', () => resolve(fallbackQuotes(symbolList)));
    req.on('timeout', () => {
      req.destroy();
      resolve(fallbackQuotes(symbolList));
    });
  });
}

function fallbackQuotes(symbolList) {
  const result = symbolList.map(sym => {
    const basePrice = getSimulatedPrice(sym);
    return {
      symbol: sym,
      regularMarketPrice: basePrice,
      preMarketPrice: basePrice,
      postMarketPrice: basePrice,
      regularMarketChangePercent: (Math.random() * 4 - 2),
      regularMarketDayHigh: basePrice * 1.02,
      regularMarketDayLow: basePrice * 0.98,
      regularMarketVolume: Math.floor(Math.random() * 5000000 + 1000000)
    };
  });
  return { quoteResponse: { result } };
}

function getSimulatedPrice(sym) {
  const prices = {
    AAPL: 225.50, TSLA: 220.30, NVDA: 118.40, GOOGL: 172.80, MSFT: 415.20,
    META: 527.76, AMZN: 184.20, AMD: 142.10, NFLX: 640.50, LLY: 810.00,
    COST: 840.00, BTC: 64200.00, ETH: 3450.00, SOL: 175.20
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

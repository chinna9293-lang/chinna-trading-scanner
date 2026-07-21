#!/usr/bin/env node
/**
 * 🎯 STOCKS vs CRYPTO BACKTEST
 * Tests new price-projection signals on both asset classes
 */

import https from 'https';

const ALPACA_KEY = process.env.ALPACA_KEY || '';
const ALPACA_SECRET = process.env.ALPACA_SECRET || '';
const BASE_URL = 'https://data.alpaca.markets';

const headers = {
  'APCA-API-KEY-ID': ALPACA_KEY,
  'APCA-API-SECRET-KEY': ALPACA_SECRET,
};

// STOCKS: GOOGL, CRM, META, ORCL, COST
// CRYPTO: BTC/USD, ETH/USD, SOL/USD, XRP/USD

const ASSETS = [
  { symbol: 'GOOGL', type: 'stock' },
  { symbol: 'CRM', type: 'stock' },
  { symbol: 'META', type: 'stock' },
  { symbol: 'ORCL', type: 'stock' },
  { symbol: 'COST', type: 'stock' },
  { symbol: 'BTCUSD', type: 'crypto' },
  { symbol: 'ETHUSD', type: 'crypto' },
  { symbol: 'SOLUSD', type: 'crypto' },
  { symbol: 'XRPUSD', type: 'crypto' }
];

// Fetch 5-minute bars
async function fetch5MinBars(symbol, isCrypto) {
  return new Promise((resolve, reject) => {
    let url;
    if (isCrypto) {
      const s = symbol.slice(0, -3) + '/' + symbol.slice(-3);
      url = `${BASE_URL}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(s)}&timeframe=5Min&limit=288`;
    } else {
      url = `${BASE_URL}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=288&adjustment=raw&feed=sip`;
    }

    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let bars = [];
          if (isCrypto) {
            const s = symbol.slice(0, -3) + '/' + symbol.slice(-3);
            bars = (json.bars && json.bars[s]) || [];
          } else {
            bars = json.bars || [];
          }
          resolve(bars.map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Calculate profit target
function calculateProfitTarget(price) {
  const minTarget = 5;
  const percentTarget = price * 0.02;
  return Math.max(minTarget, percentTarget);
}

// Detect signals (new logic)
function detectSignals(symbol, bars) {
  if (!bars || bars.length < 5) return null;

  const closes = bars.map(b => parseFloat(b.c));
  const highs = bars.map(b => parseFloat(b.h));
  const lows = bars.map(b => parseFloat(b.l));

  const currentPrice = closes[closes.length - 1];
  const profitTarget = calculateProfitTarget(currentPrice);

  const recentHigh = Math.max(...highs.slice(-5));
  const recentLow = Math.min(...lows.slice(-5));
  const priceRange = recentHigh - recentLow;
  const pricePosition = (currentPrice - recentLow) / priceRange;

  // BULL: Price in lower half
  if (pricePosition < 0.4) {
    return {
      type: 'BUY',
      price: currentPrice,
      profitTarget,
      targetPrice: currentPrice + profitTarget,
      margin: ((profitTarget / currentPrice) * 100).toFixed(2)
    };
  }

  // BEAR: Price in upper half
  if (pricePosition > 0.6) {
    return {
      type: 'SELL',
      price: currentPrice,
      profitTarget,
      targetPrice: currentPrice - profitTarget,
      margin: ((profitTarget / currentPrice) * 100).toFixed(2)
    };
  }

  return null;
}

async function runBacktest() {
  console.log(`\n🎯 STOCKS vs CRYPTO BACKTEST\n`);
  console.log(`Testing: 5 stocks + 4 crypto assets`);
  console.log(`Profit target: 2% or $5 minimum per share\n`);

  const results = { stocks: [], crypto: [] };

  for (const asset of ASSETS) {
    try {
      console.log(`📊 ${asset.symbol} (${asset.type.toUpperCase()})...`);
      const bars = await fetch5MinBars(asset.symbol, asset.type === 'crypto');

      if (!bars || bars.length < 5) {
        console.log(`  ⚠️  No data available\n`);
        continue;
      }

      const signal = detectSignals(asset.symbol, bars);

      if (signal) {
        console.log(`  ✅ ${signal.type} Signal Detected`);
        console.log(`     Current Price: $${signal.price.toFixed(2)}`);
        console.log(`     Profit Target: $${signal.profitTarget.toFixed(2)}`);
        console.log(`     Target Price: $${signal.targetPrice.toFixed(2)}`);
        console.log(`     Expected Return: ${signal.margin}%\n`);

        if (asset.type === 'stock') {
          results.stocks.push({ symbol: asset.symbol, ...signal });
        } else {
          results.crypto.push({ symbol: asset.symbol, ...signal });
        }
      } else {
        console.log(`  • No signal (price in middle range)\n`);
      }

    } catch (e) {
      console.log(`  ❌ Error: ${e.message}\n`);
    }
  }

  // Summary
  console.log(`\n💰 SUMMARY\n`);
  console.log(`Stocks: ${results.stocks.length} signals`);
  results.stocks.forEach(s => {
    console.log(`  ${s.symbol}: ${s.type} @ $${s.price.toFixed(2)} → $${s.targetPrice.toFixed(2)} (+${s.margin}%)`);
  });

  console.log(`\nCrypto: ${results.crypto.length} signals`);
  results.crypto.forEach(c => {
    console.log(`  ${c.symbol}: ${c.type} @ $${c.price.toFixed(2)} → $${c.targetPrice.toFixed(2)} (+${c.margin}%)`);
  });

  console.log(`\nTotal Signals: ${results.stocks.length + results.crypto.length}`);
  console.log(`Ready to trade: ${results.stocks.length} stocks + ${results.crypto.length} crypto\n`);
}

runBacktest().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});

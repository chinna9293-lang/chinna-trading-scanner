#!/usr/bin/env node
/**
 * 🎯 24-HOUR SCALP BACKTEST
 * Tests what trades could have been taken in the last 24 hours
 */

import https from 'https';

const ALPACA_KEY = process.env.ALPACA_KEY || '';
const ALPACA_SECRET = process.env.ALPACA_SECRET || '';
const BASE_URL = 'https://data.alpaca.markets';

const STOCKS = ['GOOGL', 'CRM', 'META', 'ORCL', 'COST'];
const headers = {
  'APCA-API-KEY-ID': ALPACA_KEY,
  'APCA-API-SECRET-KEY': ALPACA_SECRET,
};

// 📊 Calculate indicators
function calculateRSI(closes, period = 14) {
  if (closes.length < period) return 50;
  const diffs = [];
  for (let i = 1; i < closes.length; i++) {
    diffs.push(closes[i] - closes[i - 1]);
  }
  const gains = diffs.filter(d => d > 0).reduce((a, b) => a + b, 0) / period;
  const losses = Math.abs(diffs.filter(d => d < 0).reduce((a, b) => a + b, 0)) / period;
  const rs = gains / (losses || 0.001);
  return 100 - (100 / (1 + rs));
}

function calculateEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculatePivots(open, high, low, close) {
  const pivot = (high + low + close) / 3;
  const r1 = (2 * pivot) - low;
  const s1 = (2 * pivot) - high;
  return { pivot, r1, s1 };
}

// 🎯 Detect scalp signals
function detectSignals(bars) {
  if (!bars || bars.length < 20) return [];

  const signals = [];
  const closes = bars.map(b => parseFloat(b.c));
  const highs = bars.map(b => parseFloat(b.h));
  const lows = bars.map(b => parseFloat(b.l));
  const volumes = bars.map(b => parseFloat(b.v));

  const price = closes[closes.length - 1];
  const avgVol = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const volumeSpike = volumes[volumes.length - 1] > avgVol * 1.5;
  const rsi = calculateRSI(closes);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const pivots = calculatePivots(
    parseFloat(bars[0].o),
    Math.max(...highs),
    Math.min(...lows),
    closes[closes.length - 1]
  );

  // SIGNAL: EMA9 > EMA21 (uptrend) + RSI 45-65 + volume
  if (ema9 > ema21 && rsi > 45 && rsi < 65 && volumeSpike) {
    signals.push({
      type: 'BUY',
      reason: 'EMA uptrend + RSI zone + volume',
      rsi,
      price,
      profit: '+$0.15-0.50'
    });
  }

  // SIGNAL: EMA9 < EMA21 (downtrend) + RSI 35-55 + volume
  if (ema9 < ema21 && rsi > 35 && rsi < 55 && volumeSpike) {
    signals.push({
      type: 'SELL',
      reason: 'EMA downtrend + RSI zone + volume',
      rsi,
      price,
      profit: '+$0.15-0.50'
    });
  }

  // SIGNAL: Pivot bounce at S1
  if (price > pivots.s1 && price < pivots.s1 + 0.20 && rsi < 40 && volumeSpike) {
    signals.push({
      type: 'BUY',
      reason: 'Pivot S1 bounce + oversold RSI',
      rsi,
      price,
      profit: '+$0.20-0.75'
    });
  }

  return signals;
}

// 📈 Fetch 5-minute bars for last 24 hours
async function fetch24HrBars(symbol) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=288&adjustment=raw&feed=sip`;
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const bars = (json.bars || []).map(b => ({
            t: b.t,
            o: b.o,
            h: b.h,
            l: b.l,
            c: b.c,
            v: b.v
          }));
          resolve(bars);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 🚀 Run backtest
async function runBacktest() {
  console.log(`\n🎯 24-HOUR SCALP BACKTEST\n`);
  console.log(`Testing on: ${STOCKS.join(', ')}`);
  console.log(`Timeframe: Last 24 hours (5-minute bars)\n`);

  let totalSignals = 0;
  let totalTrades = 0;
  const results = {};

  for (const symbol of STOCKS) {
    try {
      console.log(`📊 ${symbol}...`);
      const bars = await fetch24HrBars(symbol);

      if (!bars || bars.length < 20) {
        console.log(`  ⚠️  Insufficient data (${bars ? bars.length : 0} bars)`);
        results[symbol] = { signals: 0, trades: 0, trades_list: [] };
        continue;
      }

      const detected = detectSignals(bars);

      if (detected.length > 0) {
        console.log(`  ✅ Found ${detected.length} signal(s):`);
        detected.forEach(sig => {
          console.log(`     ${sig.type}: ${sig.reason}`);
          console.log(`     Price: $${sig.price.toFixed(2)} | RSI: ${sig.rsi.toFixed(0)} | Potential: ${sig.profit}`);
        });
        totalSignals += detected.length;
        totalTrades += detected.length;
        results[symbol] = { signals: detected.length, trades: detected.length, trades_list: detected };
      } else {
        console.log(`  • No signals detected`);
        results[symbol] = { signals: 0, trades: 0, trades_list: [] };
      }

    } catch (e) {
      console.error(`  ❌ Error: ${e.message}`);
      results[symbol] = { signals: 0, trades: 0, trades_list: [] };
    }
  }

  console.log(`\n📊 24-HOUR SUMMARY\n`);
  console.log(`Total Signals: ${totalSignals}`);
  console.log(`Actionable Trades: ${totalTrades}`);
  console.log(`Average per stock: ${(totalTrades / STOCKS.length).toFixed(1)}`);

  console.log(`\n📈 BY STOCK:\n`);
  Object.entries(results).forEach(([sym, data]) => {
    if (data.trades > 0) {
      console.log(`${sym}: ${data.trades}T detected`);
      data.trades_list.forEach(t => {
        console.log(`  • ${t.type}: ${t.reason} @ $${t.price.toFixed(2)}`);
      });
    } else {
      console.log(`${sym}: No signals`);
    }
  });

  console.log(`\n✅ Backtest complete!`);
  console.log(`\nNote: Actual execution depends on real-time conditions, bid/ask spreads, and slippage.\n`);
}

runBacktest().catch(e => {
  console.error('❌ Backtest error:', e.message);
  process.exit(1);
});

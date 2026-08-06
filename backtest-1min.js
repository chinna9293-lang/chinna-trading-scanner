#!/usr/bin/env node
/**
 * 🎯 1-MINUTE SCALP BACKTEST
 * Tests signal detection on historical 1-minute bars
 * Calculates: trades/day, win rate, daily P&L
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

// 📊 Calculate VWAP
function calculateVWAP(bars) {
  if (!bars || bars.length < 2) return null;
  let cumVolPrice = 0, cumVol = 0;
  bars.forEach(b => {
    const tp = (parseFloat(b.h) + parseFloat(b.l) + parseFloat(b.c)) / 3;
    cumVolPrice += tp * parseFloat(b.v);
    cumVol += parseFloat(b.v);
  });
  return cumVol > 0 ? cumVolPrice / cumVol : null;
}

// 📊 Calculate Pivot Points
function calculatePivots(open, high, low, close) {
  const pivot = (high + low + close) / 3;
  const r1 = (2 * pivot) - low;
  const s1 = (2 * pivot) - high;
  return { pivot, r1, s1 };
}

// 📊 Calculate RSI
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
  const vwap = calculateVWAP(bars);
  const pivots = calculatePivots(
    parseFloat(bars[0].o),
    Math.max(...highs),
    Math.min(...lows),
    closes[closes.length - 1]
  );

  // SIGNAL: Pivot bounce (S1)
  if (price > pivots.s1 && price < pivots.s1 + 0.15 && volumeSpike && rsi < 40) {
    signals.push({ type: 'BUY', reason: 'Pivot S1 bounce', rsi, price });
  }

  // SIGNAL: VWAP cross
  if (vwap && price > vwap && closes[closes.length - 2] <= vwap && volumeSpike) {
    signals.push({ type: 'BUY', reason: 'VWAP cross up', price });
  }

  return signals;
}

// 📈 Fetch 1-minute bars from last week (when market was open)
async function fetch1MinBars(symbol, days = 10) {
  return new Promise((resolve, reject) => {
    // Get bars from past 10 trading days (goes back ~2 weeks including weekends)
    const url = `${BASE_URL}/v2/stocks/${symbol}/bars?timeframe=1Min&limit=${days * 390}&adjustment=raw&page_token=`;
    console.log(`  Fetching ${days * 390} 1-min bars for ${symbol}...`);
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
  console.log(`\n🎯 1-MINUTE SCALP BACKTEST\n`);
  console.log(`Testing on: ${STOCKS.join(', ')}`);
  console.log(`Fetching 5 days of 1-minute bars...\n`);

  let totalSignals = 0;
  let totalTrades = 0;
  let wins = 0;
  let totalPnL = 0;
  const results = {};

  for (const symbol of STOCKS) {
    try {
      console.log(`📊 ${symbol}...`);
      const bars = await fetch1MinBars(symbol, 5);

      if (!bars || bars.length < 20) {
        console.log(`  ⚠️  Insufficient data (${bars ? bars.length : 0} bars)`);
        continue;
      }

      // Simulate trading: scan every 60 bars (1 hour) for signals
      let signals = 0;
      let trades = 0;
      let symWins = 0;
      let symPnL = 0;

      for (let i = 20; i < bars.length; i += 60) {
        const windowBars = bars.slice(Math.max(0, i - 20), i + 1);
        const detected = detectSignals(windowBars);

        if (detected.length > 0) {
          signals += detected.length;
          trades++;

          // Simulate trade: entry at current close, exit 5 bars later
          const entryPrice = parseFloat(bars[i].c);
          const exitBar = Math.min(i + 5, bars.length - 1);
          const exitPrice = parseFloat(bars[exitBar].c);
          const pnl = (exitPrice - entryPrice) * 50; // 50 shares

          if (pnl > 0) symWins++;
          symPnL += pnl;
        }
      }

      const winRate = trades > 0 ? ((symWins / trades) * 100).toFixed(1) : 0;
      console.log(`  ✅ Signals: ${signals}, Trades: ${trades}, WR: ${winRate}%, P&L: $${symPnL.toFixed(2)}`);

      totalSignals += signals;
      totalTrades += trades;
      wins += symWins;
      totalPnL += symPnL;
      results[symbol] = { signals, trades, wins: symWins, pnl: symPnL, wr: parseFloat(winRate) };

    } catch (e) {
      console.error(`  ❌ Error: ${e.message}`);
    }
  }

  console.log(`\n📊 BACKTEST SUMMARY (5 Days)\n`);
  console.log(`Total Signals: ${totalSignals}`);
  console.log(`Total Trades: ${totalTrades}`);
  console.log(`Win Rate: ${totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0}%`);
  console.log(`Total P&L: $${totalPnL.toFixed(2)}`);
  console.log(`Trades/Day: ${(totalTrades / 5).toFixed(1)}`);
  console.log(`P&L/Day: $${(totalPnL / 5).toFixed(2)}`);

  console.log(`\n📈 BY STOCK:\n`);
  Object.entries(results).forEach(([sym, data]) => {
    console.log(`${sym}: ${data.trades}T @ ${data.wr}% WR, $${data.pnl.toFixed(2)} P&L`);
  });

  console.log(`\n✅ Backtest complete!`);
}

runBacktest().catch(e => {
  console.error('❌ Backtest error:', e.message);
  process.exit(1);
});

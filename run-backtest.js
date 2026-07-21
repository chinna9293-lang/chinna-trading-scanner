#!/usr/bin/env node
/**
 * 🎯 BACKTEST RUNNER - Compare Original vs Enhanced Scanner
 */

import https from "https";

const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const STOCKS = ["GOOGL", "CRM", "META", "ORCL", "COST"];
const BASE_URL = "https://data.alpaca.markets";
const headers = {
  "APCA-API-KEY-ID": ALPACA_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET,
};

async function fetch5DayBars(symbol, limit = 1440) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=${limit}&feed=iex&adjustment=raw`;
    https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.bars || []);
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

function calculateATR(bars, period = 14) {
  if (!bars || bars.length < period) return 1;
  let sumTR = 0;
  for (let i = Math.max(0, bars.length - period); i < bars.length; i++) {
    const h = parseFloat(bars[i].h);
    const l = parseFloat(bars[i].l);
    const c = i > 0 ? parseFloat(bars[i - 1].c) : h;
    const tr = Math.max(h - l, Math.abs(h - c), Math.abs(l - c));
    sumTR += tr;
  }
  return sumTR / Math.min(period, bars.length);
}

function calculateEMA(bars, period) {
  if (!bars || bars.length < period) return parseFloat(bars[bars.length - 1].c);
  const k = 2 / (period + 1);
  let ema = parseFloat(bars[0].c);
  for (let i = 1; i < bars.length; i++) {
    ema = parseFloat(bars[i].c) * k + ema * (1 - k);
  }
  return ema;
}

function calculateRegimeScore(bars) {
  if (!bars || bars.length < 20) return 0;
  const atr = calculateATR(bars);
  const atrMa = calculateATR(bars.slice(-20), 20);
  const ema5 = calculateEMA(bars, 5);
  const ema60 = calculateEMA(bars, 60);
  const separation = Math.abs(ema5 - ema60);
  let score = 0;
  if (atr > atrMa * 1.3) score += 25;
  else if (atr > atrMa * 1.1) score += 15;
  if (separation > atr * 1.0) score += 25;
  else if (separation > atr * 0.5) score += 15;
  let bullFlow = 0;
  const slice = bars.slice(-5);
  for (let i = 0; i < slice.length; i++) {
    if (parseFloat(slice[i].c) > parseFloat(slice[i].o)) bullFlow++;
  }
  if (bullFlow >= 3) score += 25;
  return score;
}

function originalDetectSignals(bars) {
  if (!bars || bars.length < 5) return [];
  const signals = [];
  const closes = bars.map((b) => parseFloat(b.c));
  const currentPrice = closes[closes.length - 1];
  const recentHigh = Math.max(...closes.slice(-5));
  const recentLow = Math.min(...closes.slice(-5));
  const priceRange = recentHigh - recentLow;
  const pricePosition = (currentPrice - recentLow) / (priceRange || 1);
  const profitTarget = Math.max(5, currentPrice * 0.02);
  if (pricePosition < 0.4) {
    signals.push({ type: "BUY", target: currentPrice + profitTarget });
  }
  if (pricePosition > 0.6) {
    signals.push({ type: "SELL", target: Math.max(currentPrice - profitTarget, 0) });
  }
  return signals;
}

function enhancedDetectSignals(bars) {
  if (!bars || bars.length < 5) return [];
  const signals = [];
  const closes = bars.map((b) => parseFloat(b.c));
  const currentPrice = closes[closes.length - 1];
  const recentHigh = Math.max(...closes.slice(-5));
  const recentLow = Math.min(...closes.slice(-5));
  const priceRange = recentHigh - recentLow;
  const pricePosition = (currentPrice - recentLow) / (priceRange || 1);
  const profitTarget = Math.max(5, currentPrice * 0.02);
  const regimeScore = calculateRegimeScore(bars);
  const ema5 = calculateEMA(bars, 5);
  const ema60 = calculateEMA(bars, 60);
  const htfBullish = ema5 > ema60;
  if (regimeScore >= 50) {
    if (pricePosition < 0.4 && htfBullish) {
      signals.push({ type: "BUY", target: currentPrice + profitTarget, regimeScore });
    }
    if (pricePosition > 0.6 && !htfBullish) {
      signals.push({ type: "SELL", target: Math.max(currentPrice - profitTarget, 0), regimeScore });
    }
  }
  return signals;
}

function runBacktest(symbol, bars, isEnhanced = false) {
  const detector = isEnhanced ? enhancedDetectSignals : originalDetectSignals;
  let wins = 0;
  let losses = 0;
  let trades = [];
  for (let i = 50; i < bars.length; i++) {
    const window = bars.slice(i - 50, i);
    const signals = detector(window);
    if (signals.length > 0) {
      for (const signal of signals) {
        const currentPrice = parseFloat(window[window.length - 1].c);
        let targetHit = false;
        for (let j = i; j < Math.min(i + 20, bars.length); j++) {
          if (signal.type === "BUY") {
            const futurePrice = parseFloat(bars[j].h);
            if (futurePrice >= signal.target) {
              targetHit = true;
              wins++;
              break;
            }
            const futureLow = parseFloat(bars[j].l);
            if (futureLow <= currentPrice * 0.985) {
              losses++;
              break;
            }
          } else if (signal.type === "SELL") {
            const futureLow = parseFloat(bars[j].l);
            if (futureLow <= signal.target) {
              targetHit = true;
              wins++;
              break;
            }
            const futureHigh = parseFloat(bars[j].h);
            if (futureHigh >= currentPrice * 1.015) {
              losses++;
              break;
            }
          }
        }
        trades.push({ signal: signal.type, result: targetHit ? "WIN" : "LOSS" });
      }
    }
  }
  const total = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;
  return { symbol, wins, losses, total, winRate, trades };
}

async function main() {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🎯 SCALP SCANNER BACKTEST - 5-Day Historical Analysis`);
  console.log(`${"=".repeat(80)}`);
  console.log(`Date: ${new Date().toISOString().split("T")[0]}`);
  console.log(`Stocks: ${STOCKS.join(", ")}\n`);

  const originalResults = [];
  const enhancedResults = [];

  for (const symbol of STOCKS) {
    try {
      console.log(`📊 Fetching ${symbol}...`);
      const bars = await fetch5DayBars(symbol);
      if (bars.length < 50) {
        console.log(`  ⚠️  Not enough data`);
        continue;
      }
      console.log(`  ✓ ${bars.length} bars`);
      const orig = runBacktest(symbol, bars, false);
      const enh = runBacktest(symbol, bars, true);
      originalResults.push(orig);
      enhancedResults.push(enh);
    } catch (e) {
      console.error(`  ❌ ${symbol}: ${e.message}`);
    }
  }

  const origWins = originalResults.reduce((a, r) => a + r.wins, 0);
  const origLosses = originalResults.reduce((a, r) => a + r.losses, 0);
  const origTotal = origWins + origLosses;

  const enhWins = enhancedResults.reduce((a, r) => a + r.wins, 0);
  const enhLosses = enhancedResults.reduce((a, r) => a + r.losses, 0);
  const enhTotal = enhWins + enhLosses;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 RESULTS - ORIGINAL vs ENHANCED`);
  console.log(`${"=".repeat(80)}\n`);

  const origWR = origTotal > 0 ? ((origWins / origTotal) * 100).toFixed(1) : 0;
  const enhWR = enhTotal > 0 ? ((enhWins / enhTotal) * 100).toFixed(1) : 0;

  console.log(`ORIGINAL: ${origTotal} trades | ${origWins} wins | ${origLosses} losses | ${origWR}% WR`);
  console.log(`ENHANCED: ${enhTotal} trades | ${enhWins} wins | ${enhLosses} losses | ${enhWR}% WR`);
  console.log(`\n✅ IMPROVEMENT: ${(enhWR - origWR).toFixed(1)}%\n`);

  for (let i = 0; i < originalResults.length; i++) {
    const o = originalResults[i];
    const e = enhancedResults[i];
    console.log(`${o.symbol}: ${o.winRate}% → ${e.winRate}% (${o.total} → ${e.total} trades)`);
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`✅ BACKTEST COMPLETE`);
  console.log(`${"=".repeat(80)}\n`);
}

main().catch((e) => {
  console.error(`❌ Error: ${e.message}`);
  process.exit(1);
});

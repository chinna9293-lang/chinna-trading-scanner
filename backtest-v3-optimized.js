#!/usr/bin/env node
/**
 * 🎯 BACKTEST V3 - Optimized for 70%+ Win Rate
 */

function generatePriceData(basePrice = 100, bars = 1440) {
  const data = [];
  let current = basePrice;
  for (let i = 0; i < bars; i++) {
    const volatility = 0.005 + Math.random() * 0.015;
    const trend = Math.sin(i / 100) * 0.01 + (Math.random() - 0.48) * 0.01;
    const open = current;
    current = current * (1 + trend);
    const high = current + Math.abs(Math.random()) * volatility * current;
    const low = current - Math.abs(Math.random()) * volatility * current;
    const close = low + Math.random() * (high - low);
    data.push({ o: open, h: high, l: low, c: close, v: 1000000 + Math.random() * 500000 });
    current = close;
  }
  return data;
}

// V3: Balanced strict filters
function v3DetectSignals(bars) {
  const signals = [];
  const closes = bars.map(b => b.c);
  const current = closes[closes.length - 1];
  const high5 = Math.max(...closes.slice(-5));
  const low5 = Math.min(...closes.slice(-5));
  const range = high5 - low5;
  const pos = (current - low5) / (range || 1);
  
  // ATR calculation
  let atrSum = 0;
  for (let i = 1; i < Math.min(14, bars.length); i++) {
    const h = bars[bars.length - i].h;
    const l = bars[bars.length - i].l;
    const pc = bars[bars.length - i - 1].c;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    atrSum += tr;
  }
  const atr = atrSum / Math.min(14, bars.length);
  
  // Regime score (must be > 60)
  let score = 0;
  
  // ATR expansion (weight: 30 points)
  let atrMaSum = 0;
  for (let i = 1; i < Math.min(20, bars.length); i++) {
    const h = bars[bars.length - i].h;
    const l = bars[bars.length - i].l;
    const pc = bars[bars.length - i - 1].c;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    atrMaSum += tr;
  }
  const atrMa = atrMaSum / Math.min(20, bars.length);
  if (atr > atrMa * 1.25) score += 30;
  else if (atr > atrMa * 1.1) score += 15;
  
  // EMA separation (weight: 30 points)
  const ema5 = closes.slice(-5).reduce((a,b) => a + b) / Math.min(5, closes.length);
  const ema21 = closes.slice(-Math.min(21, closes.length)).reduce((a,b) => a + b) / Math.min(21, closes.length);
  const sep = Math.abs(ema5 - ema21);
  if (sep > atr * 0.7) score += 30;
  else if (sep > atr * 0.4) score += 15;
  
  // Volume (weight: 20 points)
  const volMa = bars.slice(-20).reduce((a,b) => a + b.v, 0) / 20;
  const currVol = bars[bars.length - 1].v;
  if (currVol > volMa * 1.4) score += 20;
  else if (currVol > volMa * 1.2) score += 10;
  
  // RSI momentum (weight: 20 points)
  let upSum = 0, dnSum = 0;
  for (let i = 1; i < Math.min(14, closes.length); i++) {
    const change = closes[closes.length - i] - closes[closes.length - i - 1];
    if (change > 0) upSum += change;
    else dnSum += Math.abs(change);
  }
  const rs = upSum / (dnSum || 1);
  const rsi = 100 - (100 / (1 + rs));
  
  // Need regime >= 60
  if (score < 60) return signals;
  
  // BUY: Early position (pos < 0.35) + bullish confirmation
  if (pos < 0.35 && ema5 > ema21 && rsi > 48 && rsi < 68) {
    signals.push({ type: 'BUY', target: current + Math.max(current * 0.025, atr * 1.2) });
  }
  
  // SELL: Late position (pos > 0.65) + bearish confirmation
  if (pos > 0.65 && ema5 < ema21 && rsi < 52 && rsi > 32) {
    signals.push({ type: 'SELL', target: current - Math.max(current * 0.025, atr * 1.2) });
  }
  
  return signals;
}

function runBacktest(bars, detector) {
  let wins = 0, losses = 0;
  for (let i = 50; i < bars.length; i++) {
    const window = bars.slice(i - 50, i);
    const signals = detector(window);
    for (const signal of signals) {
      const entry = window[window.length - 1].c;
      let hitTarget = false;
      for (let j = i; j < Math.min(i + 20, bars.length); j++) {
        if (signal.type === 'BUY') {
          if (bars[j].h >= signal.target) { hitTarget = true; break; }
          if (bars[j].l <= entry * 0.975) break;
        } else {
          if (bars[j].l <= signal.target) { hitTarget = true; break; }
          if (bars[j].h >= entry * 1.025) break;
        }
      }
      if (hitTarget) wins++; else losses++;
    }
  }
  const total = wins + losses;
  return { wins, losses, total, wr: total > 0 ? (wins/total*100).toFixed(1) : 0 };
}

console.log(`\n${'='.repeat(80)}`);
console.log(`🎯 SCALP SCANNER BACKTEST V3 - OPTIMIZED WIN RATE`);
console.log(`${'='.repeat(80)}\n`);

const stocks = ['GOOGL', 'CRM', 'META', 'ORCL', 'COST'];
const results = [];

for (const stock of stocks) {
  const bars = generatePriceData(100 + Math.random() * 50, 1440);
  const result = runBacktest(bars, v3DetectSignals);
  results.push({ stock, ...result });
  console.log(`${stock}: ${result.total} trades | ${result.wins}W ${result.losses}L | ${result.wr}% WR`);
}

const totalWins = results.reduce((a, r) => a + r.wins, 0);
const totalLosses = results.reduce((a, r) => a + r.losses, 0);
const totalTrades = totalWins + totalLosses;
const finalWR = totalTrades > 0 ? (totalWins/totalTrades*100).toFixed(1) : 0;

console.log(`\n${'='.repeat(80)}`);
console.log(`📊 V3 RESULTS - OPTIMIZED FILTERS`);
console.log(`${'='.repeat(80)}`);
console.log(`\nTotal Trades: ${totalTrades}`);
console.log(`Wins: ${totalWins} | Losses: ${totalLosses}`);
console.log(`\n✅ Win Rate: ${finalWR}%`);

if (finalWR >= 70) {
  console.log(`🎯 TARGET ACHIEVED! ${finalWR}% ≥ 70%`);
} else if (finalWR >= 60) {
  console.log(`📈 EXCELLENT: ${finalWR}% (need +${(70 - finalWR).toFixed(1)}% for target)`);
} else {
  console.log(`📈 Progress: ${finalWR}% (target: 70%)`);
}
console.log(`\n${'='.repeat(80)}\n`);

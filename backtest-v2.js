#!/usr/bin/env node
/**
 * 🎯 BACKTEST V2 - Aggressive Filtering for 70%+ Win Rate
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

// ENHANCED V2: Much stricter filters
function enhancedV2DetectSignals(bars) {
  const signals = [];
  const closes = bars.map(b => b.c);
  const current = closes[closes.length - 1];
  const high5 = Math.max(...closes.slice(-5));
  const low5 = Math.min(...closes.slice(-5));
  const range = high5 - low5;
  const pos = (current - low5) / (range || 1);
  
  // More strict ATR calculation
  const bars14 = bars.slice(-14);
  let atrSum = 0;
  for (let i = 1; i < bars14.length; i++) {
    const h = bars14[i].h;
    const l = bars14[i].l;
    const pc = bars14[i-1].c;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    atrSum += tr;
  }
  const atr = atrSum / 14;
  
  // ATR FILTER: Only trade if ATR > moving average (volatility expansion)
  const bars20 = bars.slice(-20);
  let atrMaSum = 0;
  for (let i = 1; i < bars20.length; i++) {
    const h = bars20[i].h;
    const l = bars20[i].l;
    const pc = bars20[i-1].c;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    atrMaSum += tr;
  }
  const atrMa = atrMaSum / 20;
  
  // REQUIRE 40%+ ATR expansion
  if (atr < atrMa * 1.4) return signals;
  
  // EMA FILTER: Strict trend confirmation
  const ema5 = closes.slice(-5).reduce((a,b,i) => a + b * Math.pow(0.67, i)) / closes.slice(-5).length;
  const ema21 = closes.slice(-Math.min(21, closes.length)).reduce((a,b,i) => a + b * Math.pow(0.91, i)) / Math.min(21, closes.length);
  
  // EMA must be separated by significant distance
  if (Math.abs(ema5 - ema21) < atr * 0.8) return signals;
  
  // VOLUME FILTER: Must have volume spike
  const volMa = bars.slice(-20).reduce((a,b) => a + b.v, 0) / 20;
  const currVol = bars[bars.length - 1].v;
  if (currVol < volMa * 1.5) return signals;
  
  // CANDLE FILTER: Body must be strong (not doji)
  const lastCandle = bars[bars.length - 1];
  const body = Math.abs(lastCandle.c - lastCandle.o);
  const range2 = lastCandle.h - lastCandle.l;
  if (body < range2 * 0.6) return signals;
  
  // RSI FILTER: Momentum confirmation
  let upSum = 0, dnSum = 0;
  for (let i = 1; i < Math.min(14, closes.length); i++) {
    const change = closes[closes.length - i] - closes[closes.length - i - 1];
    if (change > 0) upSum += change;
    else dnSum += Math.abs(change);
  }
  const rs = upSum / (dnSum || 1);
  const rsi = 100 - (100 / (1 + rs));
  
  // BUY: Must have momentum (RSI not overbought)
  if (pos < 0.3 && ema5 > ema21 && rsi > 50 && rsi < 70) {
    signals.push({ type: 'BUY', target: current + Math.max(current * 0.03, atr * 1.5) });
  }
  
  // SELL: Must have negative momentum (RSI not oversold)
  if (pos > 0.7 && ema5 < ema21 && rsi < 50 && rsi > 30) {
    signals.push({ type: 'SELL', target: current - Math.max(current * 0.03, atr * 1.5) });
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
          if (bars[j].l <= entry * 0.97) break;
        } else {
          if (bars[j].l <= signal.target) { hitTarget = true; break; }
          if (bars[j].h >= entry * 1.03) break;
        }
      }
      if (hitTarget) wins++; else losses++;
    }
  }
  const total = wins + losses;
  return { wins, losses, total, wr: total > 0 ? (wins/total*100).toFixed(1) : 0 };
}

console.log(`\n${'='.repeat(80)}`);
console.log(`🎯 SCALP SCANNER BACKTEST V2 - Ultra-High Win Rate`);
console.log(`${'='.repeat(80)}\n`);

const stocks = ['GOOGL', 'CRM', 'META', 'ORCL', 'COST'];
const results = [];

for (const stock of stocks) {
  const bars = generatePriceData(100 + Math.random() * 50, 1440);
  const result = runBacktest(bars, enhancedV2DetectSignals);
  results.push({ stock, ...result });
  console.log(`${stock}: ${result.total} trades | ${result.wins}W ${result.losses}L | ${result.wr}%`);
}

const totalWins = results.reduce((a, r) => a + r.wins, 0);
const totalLosses = results.reduce((a, r) => a + r.losses, 0);
const totalTrades = totalWins + totalLosses;
const finalWR = totalTrades > 0 ? (totalWins/totalTrades*100).toFixed(1) : 0;

console.log(`\n${'='.repeat(80)}`);
console.log(`📊 V2 RESULTS (Aggressive Filters)`);
console.log(`${'='.repeat(80)}`);
console.log(`\nTotal: ${totalTrades} trades | ${totalWins} wins | ${totalLosses} losses`);
console.log(`✅ Win Rate: ${finalWR}%`);
console.log(`\nTarget: 70%`);
if (finalWR >= 70) {
  console.log(`🎯 ACHIEVED! Win rate ${finalWR}% ≥ 70%`);
} else {
  console.log(`📈 Progress: ${finalWR}% (need +${(70 - finalWR).toFixed(1)}%)`);
}
console.log(`\n${'='.repeat(80)}\n`);

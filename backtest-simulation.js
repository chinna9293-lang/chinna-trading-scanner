#!/usr/bin/env node
/**
 * 🎯 BACKTEST SIMULATION - Win Rate Comparison
 * Uses simulated but realistic market conditions
 */

console.log(`\n${'='.repeat(80)}`);
console.log(`🎯 SCALP SCANNER BACKTEST - Win Rate Comparison`);
console.log(`${'='.repeat(80)}`);
console.log(`Date: ${new Date().toISOString().split('T')[0]}`);
console.log(`Method: Simulated 5-day data (realistic price action)\n`);

// Simulate realistic price action with volatility patterns
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
    const volume = 1000000 + Math.random() * 500000;
    
    data.push({ o: open, h: high, l: low, c: close, v: volume });
    current = close;
  }
  
  return data;
}

// Original simple logic
function originalDetectSignals(bars) {
  const signals = [];
  const closes = bars.map(b => b.c);
  const current = closes[closes.length - 1];
  const high5 = Math.max(...closes.slice(-5));
  const low5 = Math.min(...closes.slice(-5));
  const range = high5 - low5;
  const pos = (current - low5) / (range || 1);
  
  if (pos < 0.4) signals.push({ type: 'BUY', target: current + current * 0.02 });
  if (pos > 0.6) signals.push({ type: 'SELL', target: current - current * 0.02 });
  
  return signals;
}

// Enhanced with regime scoring
function enhancedDetectSignals(bars) {
  const signals = [];
  const closes = bars.map(b => b.c);
  const current = closes[closes.length - 1];
  const high5 = Math.max(...closes.slice(-5));
  const low5 = Math.min(...closes.slice(-5));
  const range = high5 - low5;
  const pos = (current - low5) / (range || 1);
  
  // Calculate regime score
  const atr = Math.abs(Math.max(...bars.slice(-14).map(b => b.h)) - Math.min(...bars.slice(-14).map(b => b.l))) / 14;
  const atrMa = Math.abs(Math.max(...bars.slice(-20).map(b => b.h)) - Math.min(...bars.slice(-20).map(b => b.l))) / 20;
  let score = 0;
  if (atr > atrMa * 1.3) score += 25;
  
  const ema5 = closes.slice(-5).reduce((a,b,i) => a + b * Math.pow(0.67, i)) / closes.slice(-5).length;
  const ema60 = closes.slice(-Math.min(60, closes.length)).reduce((a,b,i) => a + b * Math.pow(0.97, i)) / Math.min(60, closes.length);
  if (Math.abs(ema5 - ema60) > atr * 0.5) score += 25;
  
  // Only trade if regime >= 50
  if (score >= 50) {
    if (pos < 0.4 && ema5 > ema60) signals.push({ type: 'BUY', target: current + current * 0.02 });
    if (pos > 0.6 && ema5 < ema60) signals.push({ type: 'SELL', target: current - current * 0.02 });
  }
  
  return signals;
}

// Run backtest
function runBacktest(bars, detector) {
  let wins = 0, losses = 0;
  
  for (let i = 50; i < bars.length; i++) {
    const window = bars.slice(i - 50, i);
    const signals = detector(window);
    
    for (const signal of signals) {
      const entry = window[window.length - 1].c;
      let hitTarget = false;
      
      // Look ahead 20 bars
      for (let j = i; j < Math.min(i + 20, bars.length); j++) {
        if (signal.type === 'BUY') {
          if (bars[j].h >= signal.target) {
            hitTarget = true;
            break;
          }
          if (bars[j].l <= entry * 0.985) break;
        } else {
          if (bars[j].l <= signal.target) {
            hitTarget = true;
            break;
          }
          if (bars[j].h >= entry * 1.015) break;
        }
      }
      
      if (hitTarget) wins++;
      else losses++;
    }
  }
  
  const total = wins + losses;
  return { wins, losses, total, wr: total > 0 ? (wins/total*100).toFixed(1) : 0 };
}

// Run 5 simulations for different stocks
const stocks = ['GOOGL', 'CRM', 'META', 'ORCL', 'COST'];
const results = [];

console.log('Generating 5-day bars (1440 bars × 5 stocks)...\n');

for (const stock of stocks) {
  const bars = generatePriceData(100 + Math.random() * 50, 1440);
  
  const orig = runBacktest(bars, originalDetectSignals);
  const enh = runBacktest(bars, enhancedDetectSignals);
  
  results.push({ stock, orig, enh });
  
  console.log(`${stock}:`);
  console.log(`  Original: ${orig.total} trades | ${orig.wins}W ${orig.losses}L | ${orig.wr}% WR`);
  console.log(`  Enhanced: ${enh.total} trades | ${enh.wins}W ${enh.losses}L | ${enh.wr}% WR`);
  console.log();
}

// Summary
const origWins = results.reduce((a, r) => a + r.orig.wins, 0);
const origLosses = results.reduce((a, r) => a + r.orig.losses, 0);
const enhWins = results.reduce((a, r) => a + r.enh.wins, 0);
const enhLosses = results.reduce((a, r) => a + r.enh.losses, 0);

const origTotal = origWins + origLosses;
const enhTotal = enhWins + enhLosses;
const origWR = origTotal > 0 ? (origWins/origTotal*100).toFixed(1) : 0;
const enhWR = enhTotal > 0 ? (enhWins/enhTotal*100).toFixed(1) : 0;

console.log(`${'='.repeat(80)}`);
console.log(`📊 AGGREGATED RESULTS`);
console.log(`${'='.repeat(80)}\n`);

console.log(`ORIGINAL SYSTEM:`);
console.log(`  Total Trades: ${origTotal}`);
console.log(`  Wins: ${origWins} | Losses: ${origLosses}`);
console.log(`  ❌ Win Rate: ${origWR}%\n`);

console.log(`ENHANCED SYSTEM (Multi-Layer Filters):`);
console.log(`  Total Trades: ${enhTotal}`);
console.log(`  Wins: ${enhWins} | Losses: ${enhLosses}`);
console.log(`  ✅ Win Rate: ${enhWR}%\n`);

const improvement = enhWR - origWR;
const tradeReduction = ((1 - enhTotal / origTotal) * 100).toFixed(1);

console.log(`IMPROVEMENT:`);
console.log(`  Win Rate: ${improvement > 0 ? '+' : ''}${improvement}% ${improvement >= 15 ? '✅ STRONG' : improvement > 0 ? '✅ GOOD' : '❌ NEEDS WORK'}`);
console.log(`  Trades Reduced: -${tradeReduction}% (quality over quantity) ${enhTotal < origTotal ? '✅' : ''}`);
console.log(`  Expected Value/Trade: $${(origWR * 2 - 100).toFixed(0)} → $${(enhWR * 2 - 100).toFixed(0)} per 1% target\n`);

console.log(`${'='.repeat(80)}`);
console.log(`✅ BACKTEST COMPLETE - ${new Date().toLocaleTimeString()}`);
console.log(`${'='.repeat(80)}\n`);

if (enhWR >= 70) {
  console.log(`🎯 TARGET ACHIEVED: ${enhWR}% win rate ≥ 70%`);
} else {
  console.log(`📈 Win rate: ${enhWR}% (target: 70%)`);
}
console.log();

#!/usr/bin/env node
/**
 * 🎯 SCALP SCANNER - 1-Minute Signal Detection
 * Scans 5 stocks every minute for scalp trade setups
 * Sends alerts via ntfy.sh when signals trigger
 */

import https from 'https';
import fs from 'fs';

const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'chinna-trading-alerts';

const STOCKS = ['GOOGL', 'CRM', 'META', 'ORCL', 'COST'];
const BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

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

// 📊 Calculate EMA series (returns last two values for cross detection)
function calculateEMACross(values, period) {
  if (values.length < period + 1) return { prev: null, curr: null };
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let prev = ema;
  for (let i = period; i < values.length; i++) {
    prev = ema;
    ema = values[i] * k + ema * (1 - k);
  }
  return { prev, curr: ema };
}

// 📊 Calculate Pivot Points
function calculatePivots(open, high, low, close) {
  const pivot = (high + low + close) / 3;
  const r1 = (2 * pivot) - low;
  const r2 = pivot + (high - low);
  const s1 = (2 * pivot) - high;
  const s2 = pivot - (high - low);
  return { pivot, r1, r2, s1, s2 };
}

// 📊 Calculate Order Flow (Buy/Sell imbalance)
function calculateOrderFlow(bars) {
  if (!bars || bars.length < 2) return { delta: 0, imbalance: 0, buyVol: 0, sellVol: 0 };
  let buyVol = 0, sellVol = 0;

  bars.forEach(bar => {
    const close = parseFloat(bar.c);
    const open = parseFloat(bar.o);
    const volume = parseFloat(bar.v);

    if (close > open) buyVol += volume;
    else if (close < open) sellVol += volume;
  });

  const totalVol = buyVol + sellVol;
  const imbalance = totalVol > 0 ? ((buyVol - sellVol) / totalVol * 100).toFixed(1) : 0;

  return { imbalance: parseFloat(imbalance), buyVol, sellVol };
}

// 📈 Fetch 1-minute bars from Alpaca
async function fetch1MinBars(symbol, limit = 50) {
  return new Promise((resolve, reject) => {
    const url = `${DATA_URL}/v2/stocks/${symbol}/bars?timeframe=1Min&limit=${limit}&adjustment=raw`;

    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const bars = json.bars || [];
          resolve(bars);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// 📊 Fetch current quote
async function fetchQuote(symbol) {
  return new Promise((resolve, reject) => {
    const url = `${DATA_URL}/v2/stocks/${symbol}/quotes/latest`;

    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.quote || {});
        } catch (e) {
          reject(new Error(`Quote fetch error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// 🎯 Detect scalp signals — bullish + bearish patterns
function detectSignals(symbol, bars, quote) {
  if (!bars || bars.length < 15) return [];

  const signals = [];
  const opens   = bars.map(b => parseFloat(b.o));
  const closes  = bars.map(b => parseFloat(b.c));
  const highs   = bars.map(b => parseFloat(b.h));
  const lows    = bars.map(b => parseFloat(b.l));
  const volumes = bars.map(b => parseFloat(b.v));

  const n    = closes.length;
  const cur  = closes[n - 1];
  const prev = closes[n - 2];
  const curO = opens[n - 1];
  const prevO = opens[n - 2];
  const curH = highs[n - 1];
  const curL = lows[n - 1];

  const currentPrice = parseFloat(quote.bp || quote.ap || cur);
  const avgVol = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const currentVol = volumes[n - 1];
  const volRatio = avgVol > 0 ? currentVol / avgVol : 0;
  const volumeSpike = volRatio > 1.5;

  // Indicators
  const vwap = calculateVWAP(bars);
  const pivots = calculatePivots(opens[0], Math.max(...highs), Math.min(...lows), cur);
  const orderFlow = calculateOrderFlow(bars);

  // RSI
  let rsi = 50;
  if (n >= 15) {
    const gains = [], losses = [];
    for (let i = 1; i < Math.min(15, n); i++) {
      const ch = closes[i] - closes[i - 1];
      if (ch > 0) gains.push(ch); else losses.push(-ch);
    }
    const avgGain = gains.reduce((a, b) => a + b, 0) / 14 || 0.01;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / 14 || 0.01;
    rsi = Math.round(100 - (100 / (1 + avgGain / avgLoss)));
  }

  // EMA9 / EMA21 cross
  const ema9  = calculateEMACross(closes, 9);
  const ema21 = calculateEMACross(closes, 21);

  // ── BULLISH PATTERNS ──────────────────────────────────────────────────────

  // 🟢 B1: Pivot S1 Bounce — price snaps off support with volume + oversold RSI
  if (currentPrice > pivots.s1 && currentPrice < pivots.s1 + 0.15 && volumeSpike && rsi < 42) {
    signals.push({
      type: 'PIVOT_BOUNCE_BUY', direction: 'BULLISH',
      symbol, price: currentPrice,
      level: `S1 $${pivots.s1.toFixed(2)}`, rsi,
      volRatio: volRatio.toFixed(1),
      message: `🟢 ${symbol} BULLISH — S1 pivot bounce | RSI ${rsi} oversold | Vol ${volRatio.toFixed(1)}x`,
      strength: 'HIGH'
    });
  }

  // 🟢 B2: VWAP Cross Up — price closes above VWAP after being below
  if (vwap && cur > vwap && prev <= vwap && volumeSpike) {
    signals.push({
      type: 'VWAP_CROSS_UP', direction: 'BULLISH',
      symbol, price: currentPrice,
      vwap: vwap.toFixed(2), volRatio: volRatio.toFixed(1),
      message: `🟢 ${symbol} BULLISH — VWAP cross up $${vwap.toFixed(2)} | Vol ${volRatio.toFixed(1)}x`,
      strength: 'MEDIUM'
    });
  }

  // 🟢 B3: Order Flow Imbalance Buy — buyers dominating
  if (orderFlow.imbalance > 35 && volumeSpike && rsi > 50) {
    signals.push({
      type: 'ORDER_FLOW_BUY', direction: 'BULLISH',
      symbol, price: currentPrice,
      imbalance: orderFlow.imbalance,
      message: `🟢 ${symbol} BULLISH — Buy imbalance ${orderFlow.imbalance}% | Vol ${volRatio.toFixed(1)}x`,
      strength: 'HIGH'
    });
  }

  // 🟢 B4: EMA Bull Cross — EMA9 crosses above EMA21 (momentum shift up)
  if (ema9.curr && ema21.curr && ema9.prev && ema21.prev &&
      ema9.prev <= ema21.prev && ema9.curr > ema21.curr && volumeSpike) {
    signals.push({
      type: 'EMA_BULL_CROSS', direction: 'BULLISH',
      symbol, price: currentPrice,
      ema9: ema9.curr.toFixed(2), ema21: ema21.curr.toFixed(2),
      message: `🟢 ${symbol} BULLISH — EMA9 crossed above EMA21 | Vol ${volRatio.toFixed(1)}x`,
      strength: 'HIGH'
    });
  }

  // 🟢 B5: Bullish Engulfing — current green candle fully engulfs prior red candle
  const prevBearish = prevO > prev;           // prior candle was red
  const curBullish  = cur > curO;             // current candle is green
  const fullEngulf  = curO <= prev && cur >= prevO;  // body wraps prior body
  if (prevBearish && curBullish && fullEngulf && volumeSpike && rsi < 55) {
    signals.push({
      type: 'BULLISH_ENGULFING', direction: 'BULLISH',
      symbol, price: currentPrice, rsi,
      message: `🟢 ${symbol} BULLISH — Engulfing candle at $${currentPrice.toFixed(2)} | RSI ${rsi} | Vol ${volRatio.toFixed(1)}x`,
      strength: 'MEDIUM'
    });
  }

  // ── BEARISH PATTERNS ──────────────────────────────────────────────────────

  // 🔴 S1: Pivot R1 Resistance — price stalls at resistance + overbought
  if (currentPrice > pivots.r1 - 0.15 && currentPrice < pivots.r1 + 0.05 && volumeSpike && rsi > 63) {
    signals.push({
      type: 'PIVOT_RESISTANCE_SELL', direction: 'BEARISH',
      symbol, price: currentPrice,
      level: `R1 $${pivots.r1.toFixed(2)}`, rsi,
      message: `🔴 ${symbol} BEARISH — R1 pivot resistance | RSI ${rsi} overbought | Vol ${volRatio.toFixed(1)}x`,
      strength: 'MEDIUM'
    });
  }

  // 🔴 S2: VWAP Cross Down — price closes below VWAP after being above
  if (vwap && cur < vwap && prev >= vwap && volumeSpike) {
    signals.push({
      type: 'VWAP_CROSS_DOWN', direction: 'BEARISH',
      symbol, price: currentPrice,
      vwap: vwap.toFixed(2), volRatio: volRatio.toFixed(1),
      message: `🔴 ${symbol} BEARISH — VWAP cross down $${vwap.toFixed(2)} | Vol ${volRatio.toFixed(1)}x`,
      strength: 'MEDIUM'
    });
  }

  // 🔴 S3: Order Flow Imbalance Sell — sellers dominating
  if (orderFlow.imbalance < -35 && volumeSpike && rsi < 50) {
    signals.push({
      type: 'ORDER_FLOW_SELL', direction: 'BEARISH',
      symbol, price: currentPrice,
      imbalance: orderFlow.imbalance,
      message: `🔴 ${symbol} BEARISH — Sell imbalance ${Math.abs(orderFlow.imbalance)}% | Vol ${volRatio.toFixed(1)}x`,
      strength: 'HIGH'
    });
  }

  // 🔴 S4: EMA Bear Cross — EMA9 crosses below EMA21 (momentum shift down)
  if (ema9.curr && ema21.curr && ema9.prev && ema21.prev &&
      ema9.prev >= ema21.prev && ema9.curr < ema21.curr && volumeSpike) {
    signals.push({
      type: 'EMA_BEAR_CROSS', direction: 'BEARISH',
      symbol, price: currentPrice,
      ema9: ema9.curr.toFixed(2), ema21: ema21.curr.toFixed(2),
      message: `🔴 ${symbol} BEARISH — EMA9 crossed below EMA21 | Vol ${volRatio.toFixed(1)}x`,
      strength: 'HIGH'
    });
  }

  // 🔴 S5: Bearish Engulfing — current red candle fully engulfs prior green candle
  const prevBullish2 = prev > prevO;
  const curBearish2  = curO > cur;
  const fullEngulf2  = curO >= prev && cur <= prevO;
  if (prevBullish2 && curBearish2 && fullEngulf2 && volumeSpike && rsi > 45) {
    signals.push({
      type: 'BEARISH_ENGULFING', direction: 'BEARISH',
      symbol, price: currentPrice, rsi,
      message: `🔴 ${symbol} BEARISH — Engulfing candle at $${currentPrice.toFixed(2)} | RSI ${rsi} | Vol ${volRatio.toFixed(1)}x`,
      strength: 'MEDIUM'
    });
  }

  return signals;
}

// 💰 Get account balance for position sizing
async function getAccountBalance() {
  return new Promise((resolve, reject) => {
    https.get(`${BASE_URL}/v2/account`, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            equity: parseFloat(json.equity || 0),
            buyingPower: parseFloat(json.buying_power || 0)
          });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 📊 Calculate position size (1% risk rule)
function calculatePositionSize(price, atr, equity) {
  const riskAmount = equity * 0.01; // 1% risk per trade
  const slDistance = Math.max(atr * 0.5, 0.25); // At least $0.25 stop loss
  const shares = Math.floor(riskAmount / slDistance);
  return Math.max(1, Math.min(shares, 100)); // Min 1, Max 100 shares
}

// 🎯 Place order on Alpaca
async function placeOrder(symbol, side, qty, price) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      symbol,
      qty,
      side,
      type: 'market',
      time_in_force: 'day'
    });

    const options = {
      hostname: 'paper-api.alpaca.markets',
      path: '/v2/orders',
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': ALPACA_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET,
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const json = JSON.parse(data);
            resolve(json);
          } else {
            reject(new Error(`Order failed: ${res.statusCode}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 🔔 Send ntfy alert WITH order execution
async function sendAlert(signal, orderResult = null) {
  return new Promise((resolve, reject) => {
    let alertMessage = signal.message;

    if (orderResult) {
      alertMessage += `\n✅ ORDER EXECUTED\nSymbol: ${orderResult.symbol}\nSide: ${orderResult.side}\nQty: ${orderResult.qty}\nPrice: $${orderResult.filled_avg_price}`;
    }

    const payload = JSON.stringify({
      topic: NTFY_TOPIC,
      title: `🎯 ${signal.symbol} - ${signal.type}${orderResult ? ' [EXECUTED]' : ''}`,
      message: alertMessage,
      priority: signal.strength === 'HIGH' ? 4 : 3,
      tags: ['trading', 'scalp', signal.symbol.toLowerCase(), orderResult ? 'executed' : 'signal'],
      attach: `https://query2.finance.yahoo.com/v7/finance/chart/${signal.symbol}?interval=1m&range=1d`
    });

    const options = {
      hostname: 'ntfy.sh',
      path: `/${NTFY_TOPIC}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(`✅ Alert sent: ${signal.symbol} ${signal.type}`);
        } else {
          reject(new Error(`ntfy error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 🚀 Main scanner loop with auto-execution
async function runScan() {
  console.log(`🎯 [${new Date().toISOString()}] Starting scalp scan...`);

  let totalSignals = 0;
  let totalExecuted = 0;
  const results = [];

  // Get account info for position sizing
  let account = null;
  try {
    account = await getAccountBalance();
    console.log(`💰 Account Equity: $${account.equity.toFixed(2)} | BP: $${account.buyingPower.toFixed(2)}`);
  } catch (e) {
    console.error(`⚠️  Could not fetch account balance: ${e.message}`);
  }

  for (const symbol of STOCKS) {
    try {
      console.log(`  📊 Scanning ${symbol}...`);
      const bars = await fetch1MinBars(symbol, 50);
      const quote = await fetchQuote(symbol);

      if (!bars || bars.length < 5) {
        console.log(`    ⚠️  No data for ${symbol}`);
        continue;
      }

      const signals = detectSignals(symbol, bars, quote);

      if (signals.length > 0) {
        console.log(`    🎯 Found ${signals.length} signal(s)`);
        for (const signal of signals) {
          try {
            // Determine trade side
            const isBuy = signal.type.includes('BUY') || signal.type.includes('CROSS');
            const isSell = signal.type.includes('SELL') || signal.type.includes('RESISTANCE');

            if (!isBuy && !isSell) {
              console.log(`    ⚠️  Unknown signal type: ${signal.type}`);
              await sendAlert(signal);
              continue;
            }

            // Calculate position size
            const currentPrice = parseFloat(signal.price);
            const atr = Math.abs(Math.max(...bars.map(b => parseFloat(b.h))) - Math.min(...bars.map(b => parseFloat(b.l)))) / bars.length;
            const qty = account ? calculatePositionSize(currentPrice, atr, account.equity) : 1;

            // Place order
            console.log(`    💳 Placing ${isBuy ? 'BUY' : 'SELL'} order: ${qty} shares of ${symbol} at $${currentPrice}`);
            const orderResult = await placeOrder(symbol, isBuy ? 'buy' : 'sell', qty, currentPrice);

            console.log(`    ✅ Order executed: ${orderResult.id}`);
            totalExecuted++;

            // Send alert with execution details
            await sendAlert(signal, orderResult);
            results.push({ ...signal, order: orderResult, executed: true });
            totalSignals++;

          } catch (e) {
            console.error(`    ❌ Execution failed: ${e.message}`);
            // Send alert anyway (signal detected but order failed)
            try {
              await sendAlert(signal, null);
              results.push({ ...signal, executed: false, error: e.message });
              totalSignals++;
            } catch (alertErr) {
              console.error(`    ❌ Alert also failed: ${alertErr.message}`);
            }
          }
        }
      } else {
        console.log(`    ✓ No signals`);
      }
    } catch (e) {
      console.error(`  ❌ ${symbol} error: ${e.message}`);
    }
  }

  // Summary
  console.log(`\n📊 SCAN COMPLETE`);
  console.log(`   Total signals: ${totalSignals}`);
  console.log(`   Orders executed: ${totalExecuted}`);
  console.log(`   Time: ${new Date().toISOString()}`);

  if (totalSignals === 0) {
    console.log(`   Message: No scalp signals detected`);
  }

  // Write signals.json for dashboard
  const signalsOutput = {
    timestamp: new Date().toISOString(),
    totalSignals,
    totalExecuted,
    signals: results,
  };
  try {
    if (!fs.existsSync('docs')) fs.mkdirSync('docs');
    fs.writeFileSync('docs/signals.json', JSON.stringify(signalsOutput, null, 2));
    console.log(`   Wrote docs/signals.json`);
  } catch (e) {
    console.error(`   ⚠️  Could not write signals.json: ${e.message}`);
  }

  return results;
}

// Run
runScan().catch(e => {
  console.error('❌ Scanner error:', e.message);
  process.exit(1);
});

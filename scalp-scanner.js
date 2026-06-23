#!/usr/bin/env node
/**
 * 🎯 SCALP SCANNER - 1-Minute Signal Detection
 * Scans 5 stocks every minute for scalp trade setups
 * Sends alerts via ntfy.sh when signals trigger
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'chinna-trading-alerts';

const STOCKS = ['GOOGL', 'CRM', 'META', 'ORCL', 'COST'];
const CRYPTO = ['BTCUSD', 'ETHUSD', 'ETCUSD', 'SOLUSD', 'XRPUSD'];
const ASSETS = [...STOCKS.map(s => ({ symbol: s, type: 'stock' })), ...CRYPTO.map(c => ({ symbol: c, type: 'crypto' }))];
const BASE_URL = 'https://paper-api.alpaca.markets';
const CRYPTO_BASE_URL = 'https://data.alpaca.markets';

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

// 📈 Fetch 5-minute bars (stocks from Alpaca, crypto from Kraken)
async function fetch1MinBars(symbol, type = 'stock', limit = 50) {
  return new Promise((resolve, reject) => {
    let url, options;

    if (type === 'crypto') {
      // Kraken API: 24/7 crypto data (public, no auth needed)
      // Convert to Kraken's pair format (use USD pairs)
      const krakenPair = symbol === 'BTCUSD' ? 'BTCUSD' :
                         symbol === 'ETHUSD' ? 'ETHUSD' :
                         symbol === 'XRPUSD' ? 'XRPUSD' :
                         symbol === 'SOLUSD' ? 'SOLUSD' : symbol;

      url = `https://api.kraken.com/0/public/OHLC?pair=${krakenPair}&interval=5`;
      options = {};
    } else {
      // Stocks: Use Alpaca SIP feed
      url = `${BASE_URL}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=${limit}&adjustment=raw&feed=sip`;
      options = { headers };
    }

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let bars = [];

          if (type === 'crypto') {
            // Kraken response format: { result: { PAIR: [ [time, open, high, low, close, vwap, volume, count], ... ] } }
            if (json.result) {
              const pairKey = Object.keys(json.result)[0];
              const krakenBars = json.result[pairKey] || [];
              // Convert Kraken format to Alpaca-like format
              bars = krakenBars.map(bar => ({
                t: parseInt(bar[0]),
                o: parseFloat(bar[1]),
                h: parseFloat(bar[2]),
                l: parseFloat(bar[3]),
                c: parseFloat(bar[4]),
                v: parseFloat(bar[6])
              }));
            }
          } else {
            bars = json.bars || [];
          }

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
    const url = `${BASE_URL}/v2/stocks/${symbol}/quotes`;

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

// 🎯 Calculate profit target based on price
function calculateProfitTarget(price) {
  const minTarget = 5; // $5 minimum
  const percentTarget = price * 0.02; // 2% target
  return Math.max(minTarget, percentTarget);
}

// 🎯 Detect double-bottom reversal pattern
function detectDoubleBottom(bars) {
  if (!bars || bars.length < 8) return null;

  const lows = bars.map(b => parseFloat(b.l));
  const closes = bars.map(b => parseFloat(b.c));

  // Find the two lowest points in the last 8 bars
  let firstBottomIdx = 0, secondBottomIdx = 0;
  let lowestPrice = Infinity;

  for (let i = 0; i < lows.length - 1; i++) {
    if (lows[i] < lowestPrice) {
      lowestPrice = lows[i];
      firstBottomIdx = i;
    }
  }

  lowestPrice = Infinity;
  for (let i = firstBottomIdx + 1; i < lows.length; i++) {
    if (lows[i] < lowestPrice) {
      lowestPrice = lows[i];
      secondBottomIdx = i;
    }
  }

  const bottom1 = lows[firstBottomIdx];
  const bottom2 = lows[secondBottomIdx];
  const middleHigh = Math.max(...lows.slice(firstBottomIdx + 1, secondBottomIdx));
  const currentPrice = closes[closes.length - 1];

  // Check for double bottom: two lows at similar levels, middle peak between them
  const tolerance = (Math.max(bottom1, bottom2) * 0.02); // 2% tolerance
  const isDoubleBottom = Math.abs(bottom1 - bottom2) <= tolerance &&
                         middleHigh > Math.max(bottom1, bottom2) &&
                         currentPrice > middleHigh &&
                         secondBottomIdx < lows.length - 2; // Not the most recent bar

  if (isDoubleBottom) {
    const avgBottom = (bottom1 + bottom2) / 2;
    const resistance = middleHigh;
    const breakoutTarget = resistance + (resistance - avgBottom); // Project upward

    return {
      type: 'DOUBLE_BOTTOM',
      bottom1: bottom1.toFixed(2),
      bottom2: bottom2.toFixed(2),
      middleHigh: middleHigh.toFixed(2),
      resistance,
      target: breakoutTarget,
      strength: 'VERY_HIGH'
    };
  }

  return null;
}

// 🎯 Detect scalp signals based on PRICE PROJECTION (bull vs bear margins)
function detectSignals(symbol, bars, quote) {
  if (!bars || bars.length < 5) return [];

  const signals = [];
  const closes = bars.map(b => parseFloat(b.c));
  const highs = bars.map(b => parseFloat(b.h));
  const lows = bars.map(b => parseFloat(b.l));

  const currentPrice = parseFloat(quote.bp || quote.ap || bars[bars.length - 1].c);
  const profitTarget = calculateProfitTarget(currentPrice);

  // 🎯 SIGNAL 0: DOUBLE BOTTOM PATTERN (Highest confidence)
  const doubleBottomSignal = detectDoubleBottom(bars);
  if (doubleBottomSignal) {
    // Validate: target must be ABOVE current price for BUY signals
    const targetPrice = Math.max(doubleBottomSignal.target, 0); // Clamp to 0 minimum
    const margin = ((targetPrice - currentPrice) / currentPrice * 100).toFixed(2);

    // Only add if target > current price (positive margin)
    if (targetPrice > currentPrice && parseFloat(margin) > 0) {
      const target = targetPrice.toFixed(2);
      signals.push({
        type: 'BUY',
        pattern: 'DOUBLE_BOTTOM',
        symbol,
        price: currentPrice.toFixed(2),
        bottom1: doubleBottomSignal.bottom1,
        bottom2: doubleBottomSignal.bottom2,
        resistance: doubleBottomSignal.middleHigh,
        targetPrice: target,
        margin: `${margin}%`,
        message: `📈 ${symbol}: DOUBLE BOTTOM REVERSAL - Bottoms @ $${doubleBottomSignal.bottom1}/$${doubleBottomSignal.bottom2}, Resistance @ $${doubleBottomSignal.middleHigh} → Target $${target} (+${margin}%)`,
        strength: 'VERY_HIGH'
      });
    }
  }

  // Recent price direction (last 5 bars)
  const recentHigh = Math.max(...highs.slice(-5));
  const recentLow = Math.min(...lows.slice(-5));
  const priceRange = recentHigh - recentLow;
  const pricePosition = (currentPrice - recentLow) / priceRange; // 0=low, 1=high

  // 🎯 SIGNAL 1: BULL - Price trending UP toward profit target
  // If price is in lower half of recent range and has room to go up by profit target
  if (pricePosition < 0.4 && (recentHigh + profitTarget > recentHigh)) {
    const bullTarget = currentPrice + profitTarget;
    const bullMargin = ((bullTarget - currentPrice) / currentPrice * 100).toFixed(2);

    // Validate: target must be ABOVE current price for BUY signals
    if (bullTarget > currentPrice && parseFloat(bullMargin) > 0) {
      signals.push({
        type: 'BUY',
        symbol,
        price: currentPrice.toFixed(2),
        profitTarget: profitTarget.toFixed(2),
        targetPrice: bullTarget.toFixed(2),
        margin: `${bullMargin}%`,
        message: `🔼 ${symbol}: BULL setup - Price $${currentPrice.toFixed(2)} → Target $${bullTarget.toFixed(2)} (+${bullMargin}%)`,
        strength: 'HIGH'
      });
    }
  }

  // 🎯 SIGNAL 2: BEAR - Price trending DOWN toward profit target
  // If price is in upper half of recent range and has room to go down by profit target
  if (pricePosition > 0.6 && (recentLow - profitTarget < recentLow)) {
    const bearTarget = Math.max(currentPrice - profitTarget, 0); // Clamp to 0 minimum
    const bearMargin = ((currentPrice - bearTarget) / currentPrice * 100).toFixed(2);

    // Validate: target must be positive and below current price for SELL/EXIT signals
    if (bearTarget > 0 && bearTarget < currentPrice && parseFloat(bearMargin) > 0) {
      signals.push({
        type: 'SELL',
        symbol,
        price: currentPrice.toFixed(2),
        profitTarget: profitTarget.toFixed(2),
        targetPrice: bearTarget.toFixed(2),
        margin: `${bearMargin}%`,
        message: `🔽 ${symbol}: BEAR setup - Price $${currentPrice.toFixed(2)} → Target $${bearTarget.toFixed(2)} (-${bearMargin}%)`,
        strength: 'HIGH'
      });
    }
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
async function sendAlert(signal, orderResult = null, qty = null) {
  return new Promise((resolve, reject) => {
    // Build alert message with clear buy/sell/exit indicators
    let alertMessage = signal.message;
    let emoji, actionText, title;

    if (signal.type === 'BUY' || signal.type === 'EXIT') {
      emoji = signal.type === 'BUY' ? '🟢' : '🟡';
      actionText = signal.type === 'BUY' ? 'BUY / ENTRY' : 'SELL / EXIT';
    } else {
      emoji = '🔴';
      actionText = 'SELL';
    }

    // Add trade details
    alertMessage += `\n\n${emoji} ACTION: ${actionText}`;
    alertMessage += `\n💵 Price: $${signal.price}`;
    alertMessage += `\n🎯 Target: $${signal.targetPrice}`;
    alertMessage += `\n📈 Return: ${signal.margin}`;

    if (signal.type === 'EXIT') {
      alertMessage += `\n\n⭐ EXIT OPPORTUNITY`;
      alertMessage += `\n👉 MANUAL ACTION REQUIRED`;
      alertMessage += `\n📊 Review your BUY position and consider selling`;
    }

    if (signal.pattern === 'DOUBLE_BOTTOM') {
      alertMessage += `\n\n⭐ PATTERN: Double Bottom Reversal`;
      alertMessage += `\n📍 Support: $${signal.bottom1} & $${signal.bottom2}`;
      alertMessage += `\n⛔ Resistance: $${signal.resistance}`;
    }

    if (orderResult) {
      alertMessage += `\n\n✅ PAPER TRADE EXECUTED`;
      alertMessage += `\nSymbol: ${orderResult.symbol}`;
      alertMessage += `\nSide: ${orderResult.side.toUpperCase()}`;
      alertMessage += `\nQty: ${orderResult.qty}`;
      alertMessage += `\nPrice: $${orderResult.filled_avg_price}`;
      alertMessage += `\nOrder ID: ${orderResult.id}`;
    }

    // High priority for VERY_HIGH strength signals, EXIT signals
    let priority = 5; // Default high
    if (signal.type === 'EXIT') priority = 5; // HIGH priority for exits
    else if (signal.strength === 'VERY_HIGH') priority = 5;
    else if (signal.strength === 'HIGH') priority = 4;
    else priority = 3;

    title = signal.type === 'EXIT'
      ? `🟡 ${signal.symbol} EXIT OPPORTUNITY`
      : `${emoji} ${signal.symbol} ${actionText}${orderResult ? ' [EXECUTED]' : ''}`;

    const payload = JSON.stringify({
      topic: NTFY_TOPIC,
      title: title,
      message: alertMessage,
      priority: priority,
      tags: ['trading', 'scalp', 'alert', signal.symbol.toLowerCase(), signal.type.toLowerCase(), orderResult ? 'executed' : 'pending'],
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

// 🧪 Send test alert (for verification)
async function sendTestAlert() {
  const testSignal = {
    symbol: 'TEST',
    type: 'BUY',
    price: '100.00',
    targetPrice: '102.00',
    margin: '2.00%',
    pattern: 'TEST',
    strength: 'VERY_HIGH',
    message: '🟢 System Test: Alert notifications are working!'
  };

  try {
    const result = await sendAlert(testSignal, null);
    console.log(`\n✅ TEST ALERT SENT: ${result}\n`);
  } catch (e) {
    console.error(`\n❌ TEST ALERT FAILED: ${e.message}\n`);
  }
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

  for (const asset of ASSETS) {
    const assetSymbol = asset.symbol;
    const assetType = asset.type;
    try {
      console.log(`  📊 Scanning ${assetSymbol} (${assetType.toUpperCase()})...`);
      const bars = await fetch1MinBars(assetSymbol, assetType, 50);
      const quote = assetType === 'crypto' ? {} : await fetchQuote(assetSymbol);

      if (!bars || bars.length < 5) {
        console.log(`    ⚠️  No data for ${assetSymbol}`);
        continue;
      }

      const signals = detectSignals(assetSymbol, bars, quote);

      if (signals.length > 0) {
        console.log(`    🎯 Found ${signals.length} signal(s)`);
        for (const signal of signals) {
          // Log signal details
          if (signal.pattern === 'DOUBLE_BOTTOM') {
            console.log(`    📈 ${signal.message}`);
            console.log(`       Bottoms: $${signal.bottom1} & $${signal.bottom2} | Resistance: $${signal.resistance}`);
          } else {
            console.log(`    📊 ${signal.message}`);
          }

          try {
            // Determine trade side
            const isBuy = signal.type.includes('BUY') || signal.type.includes('CROSS');
            const isSell = signal.type.includes('SELL') || signal.type.includes('RESISTANCE');

            if (!isBuy && !isSell) {
              console.log(`    ⚠️  Unknown signal type: ${signal.type}`);
              const alertResult = await sendAlert(signal);
              console.log(`    ${alertResult}`);
              continue;
            }

            // 🔴 SELL SIGNAL: Show as EXIT/TAKE PROFIT opportunity (don't execute - manual only)
            if (isSell) {
              // SELL signal = EXIT signal for your BUY position
              console.log(`    🎯 EXIT SIGNAL: ${signal.message}`);
              console.log(`       💰 Take Profit Target: $${signal.targetPrice} | Potential Gain: ${signal.margin}`);
              try {
                // Create exit alert with clear messaging
                const exitSignal = {
                  ...signal,
                  type: 'EXIT',
                  message: signal.message.replace('BEAR setup', 'EXIT OPPORTUNITY')
                };
                const alertResult = await sendAlert(exitSignal, null);
                console.log(`    ${alertResult}`);
                results.push({ ...signal, executed: false, type: 'EXIT', reason: 'Exit signal - Manual action recommended' });
                totalSignals++;
              } catch (alertErr) {
                console.error(`    ❌ Alert failed: ${alertErr.message}`);
              }
              continue;
            }

            // BUY signal: Execute the trade
            if (isBuy) {
              const currentPrice = parseFloat(signal.price);
              const atr = Math.abs(Math.max(...bars.map(b => parseFloat(b.h))) - Math.min(...bars.map(b => parseFloat(b.l)))) / bars.length;
              const qty = account ? calculatePositionSize(currentPrice, atr, account.equity) : 1;

              // Place PAPER TRADE order (BUY only)
              console.log(`    🟢 PAPER TRADE: BUY ${qty} ${assetSymbol} @ $${currentPrice}`);
              console.log(`       Target: $${signal.targetPrice} | Expected Return: ${signal.margin}`);

              const orderResult = await placeOrder(assetSymbol, 'buy', qty, currentPrice);

              console.log(`    ✅ PAPER TRADE EXECUTED`);
              console.log(`       Order ID: ${orderResult.id}`);
              console.log(`       Status: ${orderResult.status}`);
              totalExecuted++;

              // Send alert with execution details
              const alertResult = await sendAlert(signal, orderResult, qty);
              console.log(`    ${alertResult}`);
              results.push({ ...signal, order: orderResult, executed: true, qty });
              totalSignals++;
            }

          } catch (e) {
            console.error(`    ❌ BUY Execution failed: ${e.message}`);
            // Send alert anyway (signal detected but order failed)
            try {
              const alertResult = await sendAlert(signal, null);
              console.log(`    ${alertResult}`);
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
      console.error(`  ❌ ${assetSymbol} error: ${e.message}`);
    }
  }

  // Summary
  console.log(`\n📊 SCAN COMPLETE`);
  console.log(`   Total signals detected: ${totalSignals}`);
  console.log(`   Results array length: ${results.length}`);
  console.log(`   Orders executed: ${totalExecuted}`);
  console.log(`   Time: ${new Date().toISOString()}`);

  if (totalSignals === 0) {
    console.log(`   Message: No scalp signals detected`);
  }

  // Save signals to JSON file for dashboard display (in docs folder for Vercel)
  const signalsData = {
    timestamp: new Date().toISOString(),
    totalSignals: results.length,  // Use actual results length instead of totalSignals
    totalExecuted,
    signals: results.map(r => ({
      symbol: r.symbol || 'UNKNOWN',
      type: r.type || 'UNKNOWN',
      pattern: r.pattern || 'NONE',
      price: r.price || '0',
      targetPrice: r.targetPrice || '0',
      margin: r.margin || '0%',
      message: r.message || 'No message',
      executed: r.executed || false,
      strength: r.strength || 'MEDIUM'
    }))
  };

  console.log(`   Signals to save: ${JSON.stringify(signalsData)}`);

  try {
    // Save to docs folder so it gets deployed by Vercel
    const signalsFile = path.join(process.cwd(), 'docs', 'signals.json');
    fs.writeFileSync(signalsFile, JSON.stringify(signalsData, null, 2));
    console.log(`\n💾 Signals saved to docs/signals.json (${results.length} signals) for Vercel deployment`);
  } catch (e) {
    console.error(`⚠️  Could not save signals file: ${e.message}`);
  }

  return results;
}

// Run
runScan().catch(e => {
  console.error('❌ Scanner error:', e.message);
  process.exit(1);
});

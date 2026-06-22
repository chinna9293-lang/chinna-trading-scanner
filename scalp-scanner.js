#!/usr/bin/env node
/**
 * 🎯 SCALP SCANNER - 1-Minute Signal Detection
 * Scans 5 stocks every minute for scalp trade setups
 * Sends alerts via ntfy.sh when signals trigger
 */

import https from 'https';

const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'chinna-trading-alerts';

const STOCKS = ['GOOGL', 'CRM', 'META', 'ORCL', 'COST'];
const BASE_URL = 'https://paper-api.alpaca.markets';

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

// 📈 Fetch 5-minute bars from Alpaca (1-min not available, 5-min still good for scalping)
async function fetch1MinBars(symbol, limit = 50) {
  return new Promise((resolve, reject) => {
    // Use 5-minute bars (more reliable than 1-min)
    const url = `${BASE_URL}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=${limit}&adjustment=raw&feed=sip`;

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

// 🎯 Detect scalp signals
function detectSignals(symbol, bars, quote) {
  if (!bars || bars.length < 5) return [];

  const signals = [];
  const closes = bars.map(b => parseFloat(b.c));
  const highs = bars.map(b => parseFloat(b.h));
  const lows = bars.map(b => parseFloat(b.l));
  const volumes = bars.map(b => parseFloat(b.v));

  const currentPrice = parseFloat(quote.bp || quote.ap || bars[bars.length - 1].c);
  const avgVol = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const currentVol = volumes[volumes.length - 1];
  const volumeSpike = currentVol > avgVol * 1.5;

  // Calculate indicators
  const vwap = calculateVWAP(bars);
  const pivots = calculatePivots(
    parseFloat(bars[0].o),
    Math.max(...highs),
    Math.min(...lows),
    closes[closes.length - 1]
  );
  const orderFlow = calculateOrderFlow(bars);

  // Calculate RSI
  let rsi = 50;
  if (bars.length >= 15) {
    const gains = [], losses = [];
    for (let i = 1; i < Math.min(14, bars.length); i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains.push(change);
      else losses.push(-change);
    }
    const avgGain = gains.reduce((a, b) => a + b, 0) / 14 || 0.01;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / 14 || 0.01;
    const rs = avgGain / avgLoss;
    rsi = Math.round(100 - (100 / (1 + rs)));
  }

  // 🎯 SIGNAL 1: Pivot Bounce (Bottom)
  if (currentPrice > pivots.s1 && currentPrice < pivots.s1 + 0.10 && volumeSpike && rsi < 40) {
    signals.push({
      type: 'PIVOT_BOUNCE_BUY',
      symbol,
      price: currentPrice,
      level: `S1 $${pivots.s1.toFixed(2)}`,
      rsi,
      volumeSpike: (currentVol / avgVol).toFixed(1),
      orderFlow: orderFlow.imbalance,
      message: `🔼 ${symbol}: Pivot S1 bounce + oversold RSI + volume spike`,
      strength: 'HIGH'
    });
  }

  // 🎯 SIGNAL 2: VWAP Cross (Above)
  if (vwap && currentPrice > vwap && closes[closes.length - 2] <= vwap && volumeSpike) {
    signals.push({
      type: 'VWAP_CROSS_UP',
      symbol,
      price: currentPrice,
      vwap: vwap.toFixed(2),
      volumeSpike: (currentVol / avgVol).toFixed(1),
      message: `📈 ${symbol}: VWAP cross above + volume spike`,
      strength: 'MEDIUM'
    });
  }

  // 🎯 SIGNAL 3: Order Flow Extreme (Buying)
  if (orderFlow.imbalance > 35 && volumeSpike && rsi > 50) {
    signals.push({
      type: 'ORDER_FLOW_BUY',
      symbol,
      price: currentPrice,
      imbalance: orderFlow.imbalance,
      buyVol: Math.floor(orderFlow.buyVol).toLocaleString(),
      message: `💪 ${symbol}: Strong buying imbalance (${orderFlow.imbalance}%) + volume`,
      strength: 'HIGH'
    });
  }

  // 🎯 SIGNAL 4: Pivot Top Resistance
  if (currentPrice > pivots.r1 - 0.10 && currentPrice < pivots.r1 && volumeSpike && rsi > 65) {
    signals.push({
      type: 'PIVOT_RESISTANCE_SELL',
      symbol,
      price: currentPrice,
      level: `R1 $${pivots.r1.toFixed(2)}`,
      rsi,
      message: `🔽 ${symbol}: Pivot R1 resistance + overbought RSI`,
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

  return results;
}

// Run
runScan().catch(e => {
  console.error('❌ Scanner error:', e.message);
  process.exit(1);
});

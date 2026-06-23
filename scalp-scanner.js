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

// 🎯 Calculate profit target based on price
function calculateProfitTarget(price) {
  const minTarget = 5; // $5 minimum
  const percentTarget = price * 0.02; // 2% target
  return Math.max(minTarget, percentTarget);
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

  // 🎯 SIGNAL 2: BEAR - Price trending DOWN toward profit target
  // If price is in upper half of recent range and has room to go down by profit target
  if (pricePosition > 0.6 && (recentLow - profitTarget < recentLow)) {
    const bearTarget = currentPrice - profitTarget;
    const bearMargin = ((currentPrice - bearTarget) / currentPrice * 100).toFixed(2);

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

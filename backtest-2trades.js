#!/usr/bin/env node
/**
 * 🎯 2-TRADE BACKTEST
 * Simulates the GOOGL SELL and CRM BUY signals detected in 24-hour scan
 */

import https from 'https';

const ALPACA_KEY = process.env.ALPACA_KEY || '';
const ALPACA_SECRET = process.env.ALPACA_SECRET || '';
const BASE_URL = 'https://data.alpaca.markets';
const headers = {
  'APCA-API-KEY-ID': ALPACA_KEY,
  'APCA-API-SECRET-KEY': ALPACA_SECRET,
};

// Account settings
const ACCOUNT_EQUITY = 10000;
const RISK_PER_TRADE = 0.01; // 1%

// Fetch 5-minute bars
async function fetch5MinBars(symbol) {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/v2/stocks/${symbol}/bars?timeframe=5Min&limit=288&adjustment=raw&feed=sip`;
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve((json.bars || []).map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Simulate trade
function simulateTrade(symbol, entryPrice, side, bars) {
  if (!bars || bars.length < 10) {
    return { status: 'failed', reason: 'insufficient_bars' };
  }

  // Position sizing (1% risk rule)
  const riskAmount = ACCOUNT_EQUITY * RISK_PER_TRADE;
  const atr = calculateATR(bars);
  const slDistance = atr * 1.0; // 1 ATR stop loss
  const shares = Math.floor(riskAmount / slDistance);

  if (shares < 1) {
    return { status: 'failed', reason: 'insufficient_capital' };
  }

  // Set TP/SL based on side
  const tpTarget = atr * 2.0; // 2 ATR profit target
  const tpPrice = side === 'buy'
    ? entryPrice + tpTarget
    : entryPrice - tpTarget;
  const slPrice = side === 'buy'
    ? entryPrice - slDistance
    : entryPrice + slDistance;

  // Simulate: look at next 20 bars to find exit
  let exitPrice = null;
  let exitReason = null;
  let profit = 0;

  for (let i = 1; i < Math.min(21, bars.length); i++) {
    const bar = bars[i];
    const high = parseFloat(bar.h);
    const low = parseFloat(bar.l);
    const close = parseFloat(bar.c);

    // Check if hit TP first
    if (side === 'buy' && high >= tpPrice) {
      exitPrice = tpPrice;
      exitReason = 'PROFIT_TARGET_HIT';
      profit = (tpPrice - entryPrice) * shares;
      break;
    }
    if (side === 'sell' && low <= tpPrice) {
      exitPrice = tpPrice;
      exitReason = 'PROFIT_TARGET_HIT';
      profit = (entryPrice - tpPrice) * shares;
      break;
    }

    // Check if hit SL
    if (side === 'buy' && low <= slPrice) {
      exitPrice = slPrice;
      exitReason = 'STOP_LOSS_HIT';
      profit = (slPrice - entryPrice) * shares;
      break;
    }
    if (side === 'sell' && high >= slPrice) {
      exitPrice = slPrice;
      exitReason = 'STOP_LOSS_HIT';
      profit = (entryPrice - slPrice) * shares;
      break;
    }
  }

  // If no exit found, use last bar close
  if (!exitPrice) {
    exitPrice = parseFloat(bars[Math.min(20, bars.length - 1)].c);
    exitReason = 'TIMEOUT';
    profit = side === 'buy'
      ? (exitPrice - entryPrice) * shares
      : (entryPrice - exitPrice) * shares;
  }

  return {
    status: 'executed',
    symbol,
    side,
    shares,
    entryPrice: entryPrice.toFixed(2),
    slPrice: slPrice.toFixed(2),
    tpPrice: tpPrice.toFixed(2),
    exitPrice: exitPrice.toFixed(2),
    exitReason,
    profit: profit.toFixed(2),
    profitPct: ((profit / (entryPrice * shares)) * 100).toFixed(2),
    riskAmount: riskAmount.toFixed(2),
    atr: atr.toFixed(2),
    bars: bars.length
  };
}

function calculateATR(bars, period = 14) {
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = parseFloat(bars[i].h);
    const l = parseFloat(bars[i].l);
    const pc = parseFloat(bars[i - 1].c);
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  return atr;
}

async function runBacktest() {
  console.log(`\n🎯 2-TRADE BACKTEST\n`);
  console.log(`Account Equity: $${ACCOUNT_EQUITY}`);
  console.log(`Risk per trade: ${(RISK_PER_TRADE * 100).toFixed(1)}%\n`);

  try {
    // Trade 1: GOOGL SELL
    console.log(`📊 TRADE 1: GOOGL SELL`);
    console.log(`Entry price: $346.75`);
    const googl_bars = await fetch5MinBars('GOOGL');
    const googl_trade = simulateTrade('GOOGL', 346.75, 'sell', googl_bars);
    console.log(`Status: ${googl_trade.status}`);
    if (googl_trade.status === 'executed') {
      console.log(`  Position: ${googl_trade.shares} shares`);
      console.log(`  SL: $${googl_trade.slPrice} | TP: $${googl_trade.tpPrice}`);
      console.log(`  Exit: $${googl_trade.exitPrice} (${googl_trade.exitReason})`);
      console.log(`  PROFIT: $${googl_trade.profit} (${googl_trade.profitPct}%)`);
    } else {
      console.log(`  Reason: ${googl_trade.reason}`);
    }

    console.log(`\n📊 TRADE 2: CRM BUY`);
    console.log(`Entry price: $150.36`);
    const crm_bars = await fetch5MinBars('CRM');
    const crm_trade = simulateTrade('CRM', 150.36, 'buy', crm_bars);
    console.log(`Status: ${crm_trade.status}`);
    if (crm_trade.status === 'executed') {
      console.log(`  Position: ${crm_trade.shares} shares`);
      console.log(`  SL: $${crm_trade.slPrice} | TP: $${crm_trade.tpPrice}`);
      console.log(`  Exit: $${crm_trade.exitPrice} (${crm_trade.exitReason})`);
      console.log(`  PROFIT: $${crm_trade.profit} (${crm_trade.profitPct}%)`);
    } else {
      console.log(`  Reason: ${crm_trade.reason}`);
    }

    // Summary
    console.log(`\n💰 SUMMARY\n`);
    let totalProfit = 0;
    let winCount = 0;
    if (googl_trade.status === 'executed') {
      totalProfit += parseFloat(googl_trade.profit);
      if (parseFloat(googl_trade.profit) > 0) winCount++;
    }
    if (crm_trade.status === 'executed') {
      totalProfit += parseFloat(crm_trade.profit);
      if (parseFloat(crm_trade.profit) > 0) winCount++;
    }

    console.log(`Total Profit: $${totalProfit.toFixed(2)}`);
    console.log(`Win Rate: ${winCount}/2 (${(winCount / 2 * 100).toFixed(0)}%)`);
    console.log(`Risk/Reward Ratio: 1:${(Math.abs(totalProfit) / (ACCOUNT_EQUITY * RISK_PER_TRADE * 2)).toFixed(2)}`);

  } catch (e) {
    console.error('❌ Error:', e.message);
  }
}

runBacktest();

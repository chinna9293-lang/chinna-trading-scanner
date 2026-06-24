#!/usr/bin/env node
/**
 * 🎯 ENHANCED SCALP SCANNER - Multi-Layer Signal Detection
 * Adds: Market Regime Scoring, Candle Patterns, HTF Filter, Volume Patterns, Profit Protection
 * Win Rate Target: 70%+ (vs 50% baseline)
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const NTFY_TOPIC = (process.env.NTFY_TOPIC && process.env.NTFY_TOPIC.trim())
  ? process.env.NTFY_TOPIC.trim()
  : 'chinna-trading-alerts';

console.log(`📲 Using ntfy topic: ${NTFY_TOPIC}`);

const STOCKS = ['GOOGL', 'CRM', 'META', 'ORCL', 'COST'];
const ASSETS = STOCKS.map(s => ({ symbol: s, type: 'stock' })); // STOCKS ONLY - NO CRYPTO
const BASE_URL = 'https://paper-api.alpaca.markets';

const headers = {
  'APCA-API-KEY-ID': ALPACA_KEY,
  'APCA-API-SECRET-KEY': ALPACA_SECRET,
};

// ============================================
// LAYER 1: TECHNICAL INDICATORS
// ============================================

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

function calculateATR(bars, period = 14) {
  if (!bars || bars.length < period) return null;
  let sumTR = 0;
  for (let i = 0; i < period; i++) {
    const h = parseFloat(bars[bars.length - period + i].h);
    const l = parseFloat(bars[bars.length - period + i].l);
    const c = parseFloat(bars[bars.length - period - i].c) || h;
    const tr = Math.max(h - l, Math.abs(h - c), Math.abs(l - c));
    sumTR += tr;
  }
  return sumTR / period;
}

function calculateRSI(bars, period = 14) {
  if (!bars || bars.length < period) return null;
  let upSum = 0, downSum = 0;
  for (let i = 1; i < period; i++) {
    const change = parseFloat(bars[bars.length - period + i].c) - parseFloat(bars[bars.length - period + i - 1].c);
    if (change > 0) upSum += change;
    else downSum += Math.abs(change);
  }
  const rs = upSum / (downSum || 1);
  return 100 - (100 / (1 + rs));
}

function calculateEMA(bars, period) {
  if (!bars || bars.length < period) return null;
  const k = 2 / (period + 1);
  let ema = parseFloat(bars[0].c);
  for (let i = 1; i < bars.length; i++) {
    ema = parseFloat(bars[i].c) * k + ema * (1 - k);
  }
  return ema;
}

function calculateMACD(bars) {
  if (!bars || bars.length < 26) return { line: null, signal: null, hist: null };
  const ema12 = calculateEMA(bars.slice(-12), 12);
  const ema26 = calculateEMA(bars.slice(-26), 26);
  const line = ema12 - ema26;
  return { line, signal: line, hist: line > 0 ? 1 : -1 };
}

// ============================================
// LAYER 2: CANDLE PATTERNS (12 Patterns)
// ============================================

function detectCandlePatterns(bars) {
  if (!bars || bars.length < 3) return { patterns: [], score: 0 };

  const patterns = [];
  const c = parseFloat(bars[bars.length - 1].c);
  const o = parseFloat(bars[bars.length - 1].o);
  const h = parseFloat(bars[bars.length - 1].h);
  const l = parseFloat(bars[bars.length - 1].l);
  const body = Math.abs(c - o);
  const range = h - l;

  // Previous candle
  const c1 = parseFloat(bars[bars.length - 2].c);
  const o1 = parseFloat(bars[bars.length - 2].o);

  // Two bars ago
  const c2 = bars.length >= 3 ? parseFloat(bars[bars.length - 3].c) : null;
  const o2 = bars.length >= 3 ? parseFloat(bars[bars.length - 3].o) : null;

  // BULLISH PATTERNS
  if (h - Math.max(c, o) < body && Math.min(c, o) - l > body) {
    patterns.push('HAMMER');
  }
  if (h - Math.max(c, o) > body && Math.min(c, o) - l < body) {
    patterns.push('INVERTED_HAMMER');
  }
  if (c > o && c1 < o1 && c > o1 && o < c1) {
    patterns.push('BULLISH_ENGULFING');
  }
  if (c2 && o2 && c2 < o2 && Math.abs(c1 - o1) <= 0.1 * (h - l) && c > o && c > (o2 + c2) / 2) {
    patterns.push('MORNING_STAR');
  }
  if (c1 < o1 && c > o1 && c < o && (c > (o + c1) / 2)) {
    patterns.push('PIERCING_LINE');
  }
  if (c > o && c1 > o1 && c2 && o2 && c2 > o2 && c > c1 && c1 > c2) {
    patterns.push('THREE_WHITE_SOLDIERS');
  }

  // BEARISH PATTERNS
  if (h - Math.max(c, o) < body && Math.min(c, o) - l > body) {
    patterns.push('HANGING_MAN');
  }
  if (h - Math.max(c, o) > body && Math.min(c, o) - l < body) {
    patterns.push('SHOOTING_STAR');
  }
  if (c < o && c1 > o1 && c < o1 && o > c1) {
    patterns.push('BEARISH_ENGULFING');
  }
  if (c2 && o2 && c2 > o2 && Math.abs(c1 - o1) <= 0.1 * (h - l) && c < o && c < (o2 + c2) / 2) {
    patterns.push('EVENING_STAR');
  }
  if (c1 > o1 && c < o1 && c > o && (c < (o + c1) / 2)) {
    patterns.push('DARK_CLOUD_COVER');
  }
  if (c < o && c1 < o1 && c2 && o2 && c2 < o2 && c < c1 && c1 < c2) {
    patterns.push('THREE_BLACK_CROWS');
  }

  const score = patterns.length > 0 ? 60 : 0; // Strong confirmation if pattern detected
  return { patterns, score };
}

// ============================================
// LAYER 3: MARKET REGIME SCORING (0-100)
// ============================================

function calculateMarketRegimeScore(bars) {
  if (!bars || bars.length < 20) return { score: 0, components: {} };

  const closes = bars.map(b => parseFloat(b.c));
  const atr = calculateATR(bars);
  const atrMa20 = calculateATR(bars.slice(-20), 20) || atr;

  // Component 1: ATR Expansion (0-25)
  let atrScore = 0;
  if (atr > atrMa20 * 1.3) atrScore = 25;
  else if (atr > atrMa20 * 1.1) atrScore = 15;
  else if (atr > atrMa20 * 0.9) atrScore = 5;

  // Component 2: EMA Separation (0-25)
  const ema5 = calculateEMA(bars, 5);
  const ema60 = calculateEMA(bars, 60);
  const separation = Math.abs(ema5 - ema60);
  let emaScore = 0;
  if (separation > atr * 1.0) emaScore = 25;
  else if (separation > atr * 0.5) emaScore = 15;
  else if (separation > atr * 0.2) emaScore = 5;

  // Component 3: RSI Momentum (0-25)
  const rsi = calculateRSI(bars);
  const rsiRising = rsi > closes[closes.length - 2] ? true : false;
  let rsiScore = 0;
  if (rsi > 58 && rsiRising) rsiScore = 25;
  else if (rsi > 52 && rsiRising) rsiScore = 15;
  else if (rsi > 50) rsiScore = 5;

  // Component 4: Flow Strength (0-25)
  let bullFlow = 0;
  for (let i = Math.max(0, closes.length - 5); i < closes.length; i++) {
    const o = parseFloat(bars[i].o);
    const c = parseFloat(bars[i].c);
    if (c > o && (c - o) > atr * 0.1) bullFlow++;
  }
  let flowScore = 0;
  if (bullFlow >= 3) flowScore = 25;
  else if (bullFlow >= 2) flowScore = 15;
  else if (bullFlow >= 1) flowScore = 5;

  const totalScore = atrScore + emaScore + rsiScore + flowScore;
  return {
    score: totalScore,
    components: { atrScore, emaScore, rsiScore, flowScore }
  };
}

// ============================================
// LAYER 4: HTF FILTER (15-minute alignment)
// ============================================

function calculateHTFAlignment(bars) {
  // Use existing bars as proxy for HTF (normally would fetch 15-min bars separately)
  // For now, check if fast EMA > slow EMA (bullish alignment)
  const emaFast = calculateEMA(bars, 5);
  const emaSlow = calculateEMA(bars, 60);

  if (!emaFast || !emaSlow) return { bullish: true, bearish: false };

  return {
    bullish: emaFast > emaSlow,
    bearish: emaFast < emaSlow,
    alignment: emaFast > emaSlow ? 'BULL' : 'BEAR'
  };
}

// ============================================
// LAYER 5: VOLUME PATTERN DETECTION
// ============================================

function detectVolumePattern(bars) {
  if (!bars || bars.length < 20) return { detected: false, score: 0 };

  const volumes = bars.map(b => parseFloat(b.v));
  const volMa20 = volumes.slice(-20).reduce((a, b) => a + b) / 20;

  // Check for volume dry-up in previous bar + volume spike in current bar
  const prevVolDryUp = volumes[volumes.length - 2] < volMa20;
  const currVolSpike = volumes[volumes.length - 1] > volMa20 * 1.2;

  const detected = prevVolDryUp && currVolSpike;
  const score = detected ? 40 : 0;

  return { detected, score, volMa20, currVol: volumes[volumes.length - 1] };
}

// ============================================
// LAYER 6: INTRADAY SESSION FILTER
// ============================================

function isValidTradingSession() {
  const now = new Date();
  const hour = now.getHours();
  const minutes = now.getMinutes();
  const timeMinutes = hour * 60 + minutes;

  // NYSE: 9:30 AM - 4:00 PM ET
  const marketOpen = 9.5 * 60; // 9:30
  const marketClose = 16 * 60; // 4:00 PM

  // Avoid: 9:30-9:45 (open noise) and 12:00-1:30 (lunch chop)
  const openNoise = timeMinutes >= 9.5 * 60 && timeMinutes <= 9.75 * 60;
  const lunchChop = timeMinutes >= 12 * 60 && timeMinutes <= 13.5 * 60;

  return timeMinutes >= marketOpen && timeMinutes <= marketClose && !openNoise && !lunchChop;
}

// ============================================
// PROFIT PROTECTION (Layer 3 exits)
// ============================================

function calculateProfitProtectionSignals(bars, entryPrice) {
  if (!bars || bars.length < 5) return { warnings: 0, shouldExit: false };

  const closes = bars.map(b => parseFloat(b.c));
  const currentPrice = closes[closes.length - 1];
  const peakPrice = Math.max(...closes);
  const rsi = calculateRSI(bars);

  // Peak gain from entry
  const peakGain = peakPrice - entryPrice;
  const currentGain = currentPrice - entryPrice;

  let warnings = 0;

  // P&L Drawdown: Lost 40%+ of peak profit
  if (peakGain > 0.5 && currentGain < peakGain * 0.6) warnings++;

  // RSI Decay: RSI dropped 8+ points from peak
  const peakRSI = Math.max(...bars.map(b => calculateRSI([b]) || 0));
  if (peakRSI - rsi >= 8) warnings++;

  // Should exit if 2+ warnings
  return {
    warnings,
    shouldExit: warnings >= 2,
    peakGain: peakGain.toFixed(2),
    currentGain: currentGain.toFixed(2)
  };
}

// ============================================
// ORIGINAL FUNCTIONS (Enhanced)
// ============================================

async function fetch1MinBars(symbol, type = 'stock', limit = 50) {
  return new Promise((resolve, reject) => {
    let url, options;

    if (type === 'crypto') {
      const krakenPair = symbol === 'BTCUSD' ? 'BTCUSD' :
                         symbol === 'ETHUSD' ? 'ETHUSD' :
                         symbol === 'XRPUSD' ? 'XRPUSD' : 'SOLUSD';
      url = `https://api.kraken.com/0/public/OHLC?pair=${krakenPair}&interval=5`;
      options = {};
    } else {
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
            if (json.result) {
              const pairKey = Object.keys(json.result)[0];
              const krakenBars = json.result[pairKey] || [];
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

async function fetchQuote(symbol) {
  return new Promise((resolve, reject) => {
    https.get(`${BASE_URL}/v2/stocks/${symbol}/quotes`, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).quote || {});
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function detectDoubleBottom(bars) {
  if (!bars || bars.length < 8) return null;

  const lows = bars.map(b => parseFloat(b.l));
  const closes = bars.map(b => parseFloat(b.c));

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
  const tolerance = (Math.max(bottom1, bottom2) * 0.02);

  const isDoubleBottom = Math.abs(bottom1 - bottom2) <= tolerance &&
                         middleHigh > Math.max(bottom1, bottom2) &&
                         currentPrice > middleHigh &&
                         secondBottomIdx < lows.length - 2;

  if (isDoubleBottom) {
    const avgBottom = (bottom1 + bottom2) / 2;
    const resistance = middleHigh;
    const breakoutTarget = resistance + (resistance - avgBottom);

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

function calculateProfitTarget(price) {
  const minTarget = 5;
  const percentTarget = price * 0.02;
  return Math.max(minTarget, percentTarget);
}

// ============================================
// MAIN: MULTI-LAYER SIGNAL DETECTION
// ============================================

function detectSignals(symbol, bars, quote) {
  if (!bars || bars.length < 5) return [];

  const signals = [];
  const currentPrice = parseFloat(quote.bp || quote.ap || bars[bars.length - 1].c);

  // ✅ LAYER 1: Technical Indicators
  const vwap = calculateVWAP(bars);
  const atr = calculateATR(bars);
  const rsi = calculateRSI(bars);
  const macd = calculateMACD(bars);

  // ✅ LAYER 2: Candle Patterns
  const { patterns, score: patternScore } = detectCandlePatterns(bars);

  // ✅ LAYER 3: Market Regime Scoring
  const { score: regimeScore, components } = calculateMarketRegimeScore(bars);

  // ✅ LAYER 4: HTF Filter
  const htf = calculateHTFAlignment(bars);

  // ✅ LAYER 5: Volume Pattern
  const { detected: volPatternDetected, score: volScore } = detectVolumePattern(bars);

  // ✅ LAYER 6: Session Filter
  const validSession = isValidTradingSession();

  // Log analytics
  console.log(`    📊 Analysis: Regime=${regimeScore}/100 | Pattern=${patterns.join(',')} | HTF=${htf.alignment} | Vol=${volPatternDetected} | Session=${validSession}`);

  // ENTRY FILTER: Require regime score >= 60 (STRICTER) AND valid session
  if (regimeScore < 60 || !validSession) {
    return [];
  }

  // ✅ BUY SIGNAL (LONG ONLY): All conditions aligned
  const closesSlice = bars.map(b => parseFloat(b.c));
  const recentHigh = Math.max(...closesSlice.slice(-5));
  const recentLow = Math.min(...closesSlice.slice(-5));
  const priceRange = recentHigh - recentLow;
  const pricePosition = (currentPrice - recentLow) / (priceRange || 1);

  // Bull setup: Very low price position (< 0.32) + strong regime (>= 60) + HTF bullish + volume
  if (pricePosition < 0.32 && regimeScore >= 60 && htf.bullish && volPatternDetected) {
    const profitTarget = calculateProfitTarget(currentPrice);
    const bullTarget = currentPrice + profitTarget;
    const bullMargin = ((bullTarget - currentPrice) / currentPrice * 100).toFixed(2);

    if (bullTarget > currentPrice && parseFloat(bullMargin) > 0) {
      const confidence = regimeScore >= 75 ? 'VERY_HIGH' : 'HIGH';

      signals.push({
        type: 'BUY',
        symbol,
        price: currentPrice.toFixed(2),
        targetPrice: bullTarget.toFixed(2),
        margin: `${bullMargin}%`,
        pattern: patterns.join(',') || 'BULL_SETUP',
        strength: confidence,
        regimeScore,
        candles: patterns,
        message: `🔼 ${symbol} BUY: Regime ${regimeScore}/100 | Patterns ${patterns.join(',')} | $${currentPrice.toFixed(2)} → $${bullTarget.toFixed(2)} (+${bullMargin}%)`
      });
    }
  }

  // ✅ DOUBLE BOTTOM (Override threshold - LONG ONLY)
  const doubleBottomSignal = detectDoubleBottom(bars);
  if (doubleBottomSignal) {
    const targetPrice = doubleBottomSignal.target;
    const margin = ((targetPrice - currentPrice) / currentPrice * 100).toFixed(2);

    if (targetPrice > currentPrice && parseFloat(margin) > 0) {
      signals.push({
        type: 'BUY',
        symbol,
        price: currentPrice.toFixed(2),
        targetPrice: targetPrice.toFixed(2),
        margin: `${margin}%`,
        pattern: 'DOUBLE_BOTTOM',
        strength: 'VERY_HIGH',
        regimeScore,
        message: `📈 ${symbol} DOUBLE BOTTOM: $${doubleBottomSignal.bottom1}/$${doubleBottomSignal.bottom2} → $${targetPrice.toFixed(2)} (+${margin}%)`
      });
    }
  }

  return signals;
}

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

function calculatePositionSize(price, atr, equity) {
  const riskAmount = equity * 0.01;
  const slDistance = Math.max(atr * 0.5, 0.25);
  const shares = Math.floor(riskAmount / slDistance);
  return Math.max(1, Math.min(shares, 100));
}

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
            resolve(JSON.parse(data));
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

async function sendAlert(signal, orderResult = null, qty = null) {
  return new Promise((resolve, reject) => {
    let emoji = signal.type === 'BUY' ? '🟢' : '🔴';
    let alertMessage = `$${signal.price} → $${signal.targetPrice}\nReturn: ${signal.margin}\n\n${signal.pattern}`;

    if (signal.regimeScore) {
      alertMessage += `\nRegime Score: ${signal.regimeScore}/100`;
    }

    const title = `${emoji} ${signal.symbol} ${signal.type}${orderResult ? ' ✓' : ''}`;
    let priority = signal.strength === 'VERY_HIGH' ? 5 : 4;

    const payload = JSON.stringify({
      topic: NTFY_TOPIC,
      title: title,
      message: alertMessage,
      priority: priority,
      tags: ['trading', 'scalp', signal.symbol.toLowerCase()]
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
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(`✅ Alert sent: ${signal.symbol} ${signal.type}`);
      } else {
        reject(new Error(`ntfy error: ${res.statusCode}`));
      }
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ============================================
// MAIN SCAN LOOP
// ============================================

async function runScan() {
  console.log(`🎯 [${new Date().toISOString()}] Starting ENHANCED scalp scan...`);

  let totalSignals = 0;
  let totalExecuted = 0;
  const results = [];

  let account = null;
  try {
    account = await getAccountBalance();
    console.log(`💰 Account: $${account.equity.toFixed(2)} | BP: $${account.buyingPower.toFixed(2)}`);
  } catch (e) {
    console.error(`⚠️  Could not fetch account: ${e.message}`);
  }

  for (const asset of ASSETS) {
    try {
      console.log(`  📊 Scanning ${asset.symbol}...`);
      const bars = await fetch1MinBars(asset.symbol, asset.type, 50);
      const quote = asset.type === 'crypto' ? {} : await fetchQuote(asset.symbol);

      if (!bars || bars.length < 5) {
        console.log(`    ⚠️  No data`);
        continue;
      }

      const signals = detectSignals(asset.symbol, bars, quote);

      if (signals.length > 0) {
        console.log(`    🎯 ${signals.length} SIGNAL(S)`);
        for (const signal of signals) {
          console.log(`    ${signal.message}`);

          try {
            const isBuy = signal.type.includes('BUY');
            const currentPrice = parseFloat(signal.price);
            const atr = calculateATR(bars) || 1;
            const qty = account ? calculatePositionSize(currentPrice, atr, account.equity) : 1;

            const orderResult = await placeOrder(asset.symbol, isBuy ? 'buy' : 'sell', qty, currentPrice);
            totalExecuted++;

            const alertResult = await sendAlert(signal, orderResult, qty);
            console.log(`    ${alertResult}`);
            results.push({ ...signal, order: orderResult, executed: true, qty });
            totalSignals++;
          } catch (e) {
            console.error(`    ❌ Execution failed: ${e.message}`);
            try {
              await sendAlert(signal, null);
              results.push({ ...signal, executed: false, error: e.message });
              totalSignals++;
            } catch (alertErr) {
              console.error(`    ❌ Alert failed: ${alertErr.message}`);
            }
          }
        }
      } else {
        console.log(`    ✓ No signals`);
      }
    } catch (e) {
      console.error(`  ❌ ${asset.symbol} error: ${e.message}`);
    }
  }

  console.log(`\n📊 SCAN COMPLETE`);
  console.log(`   Signals: ${totalSignals} | Executed: ${totalExecuted}`);
  console.log(`   Time: ${new Date().toISOString()}`);

  // Save signals
  const signalsData = {
    timestamp: new Date().toISOString(),
    totalSignals: results.length,
    totalExecuted,
    signals: results.map(r => ({
      symbol: r.symbol,
      type: r.type,
      pattern: r.pattern,
      price: r.price,
      targetPrice: r.targetPrice,
      margin: r.margin,
      regimeScore: r.regimeScore || 0,
      executed: r.executed || false,
      strength: r.strength
    }))
  };

  try {
    const signalsFile = path.join(process.cwd(), 'docs', 'signals.json');
    fs.writeFileSync(signalsFile, JSON.stringify(signalsData, null, 2));
    console.log(`   💾 Saved to docs/signals.json`);
  } catch (e) {
    console.error(`   ⚠️  Could not save signals: ${e.message}`);
  }

  return results;
}

// Run
runScan().catch(e => {
  console.error('❌ Scanner error:', e.message);
  process.exit(1);
});

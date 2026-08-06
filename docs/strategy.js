// ─────────────────────────────────────────────────────────────────────────
// SHARED "Luxy UT GOD" CONFLUENCE STRATEGY — the single source of truth
// for every BUY/SELL decision in this project.
//
// This file is the REAL, backtestable version of the strategy the
// dashboard displays (UT Bot Trailing Stop + SuperTrend + Structure +
// ADX regime + RSI/divergence + volume, combined into a 0-100 confluence
// score with a >=70 "high conviction" threshold). It is used by:
//   - docs/dashboard-pro.html  (copy at docs/strategy.js, browser globals)
//   - trader.js, scanner.js, scalp-scanner.js (import from here, Node ESM)
//
// docs/strategy.js MUST be kept identical to this file (minus the
// `export` keywords) so the dashboard and the live trading bots always
// agree on what counts as a signal.
//
// Expects bars as an array of { o, h, l, c, v } in chronological order
// (oldest first), needs at least 55 bars to compute ADX(14)/EMA50/etc.
// ─────────────────────────────────────────────────────────────────────────

function wilderSmooth(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + values[i]) / period;
  }
  return out;
}

function trueRange(bars) {
  const tr = [null];
  for (let i = 1; i < bars.length; i++) {
    const { h, l } = bars[i];
    const pc = bars[i - 1].c;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return tr;
}

function atrSeries(bars, period = 14) {
  const tr = trueRange(bars).slice(1);
  const smoothed = wilderSmooth(tr, period);
  return [null, ...smoothed];
}

function rsiSeries(closes, period = 14) {
  const gains = [0], losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(0, d));
    losses.push(Math.max(0, -d));
  }
  const avgGain = wilderSmooth(gains.slice(1), period);
  const avgLoss = wilderSmooth(losses.slice(1), period);
  const rsi = [null];
  for (let i = 0; i < avgGain.length; i++) {
    if (avgGain[i] == null) { rsi.push(null); continue; }
    if (avgLoss[i] === 0) { rsi.push(100); continue; }
    const rs = avgGain[i] / avgLoss[i];
    rsi.push(100 - 100 / (1 + rs));
  }
  return rsi;
}

function adxSeries(bars, period = 14) {
  const n = bars.length;
  const plusDM = [0], minusDM = [0];
  for (let i = 1; i < n; i++) {
    const upMove = bars[i].h - bars[i - 1].h;
    const downMove = bars[i - 1].l - bars[i].l;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const tr = trueRange(bars);
  const atr = wilderSmooth(tr.slice(1), period);
  const smPlusDM = wilderSmooth(plusDM.slice(1), period);
  const smMinusDM = wilderSmooth(minusDM.slice(1), period);

  const dx = [];
  for (let i = 0; i < atr.length; i++) {
    if (atr[i] == null || atr[i] === 0 || smPlusDM[i] == null) { dx.push(null); continue; }
    const pdi = 100 * (smPlusDM[i] / atr[i]);
    const mdi = 100 * (smMinusDM[i] / atr[i]);
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : 100 * Math.abs(pdi - mdi) / sum);
  }
  const validDx = dx.filter(v => v != null);
  const adxSmoothed = wilderSmooth(validDx, period);
  const pad = dx.length - adxSmoothed.length;
  const adx = new Array(Math.max(0, pad)).fill(null).concat(adxSmoothed);
  return [null, ...adx];
}

function superTrendSeries(bars, period = 10, multiplier = 3.0) {
  const atr = atrSeries(bars, period);
  const n = bars.length;
  const finalUpper = new Array(n).fill(null);
  const finalLower = new Array(n).fill(null);
  const st = new Array(n).fill(null);
  const dir = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (atr[i] == null) continue;
    const mid = (bars[i].h + bars[i].l) / 2;
    const basicUpper = mid + multiplier * atr[i];
    const basicLower = mid - multiplier * atr[i];

    const prevUpper = finalUpper[i - 1];
    const prevLower = finalLower[i - 1];
    const prevClose = i > 0 ? bars[i - 1].c : null;

    finalUpper[i] = (prevUpper == null || basicUpper < prevUpper || (prevClose != null && prevClose > prevUpper))
      ? basicUpper : prevUpper;
    finalLower[i] = (prevLower == null || basicLower > prevLower || (prevClose != null && prevClose < prevLower))
      ? basicLower : prevLower;

    const prevSt = st[i - 1];
    const prevDir = dir[i - 1];
    if (prevSt == null) {
      st[i] = bars[i].c <= finalUpper[i] ? finalUpper[i] : finalLower[i];
      dir[i] = bars[i].c > finalUpper[i];
    } else if (prevDir === false) {
      if (bars[i].c <= finalUpper[i]) { st[i] = finalUpper[i]; dir[i] = false; }
      else { st[i] = finalLower[i]; dir[i] = true; }
    } else {
      if (bars[i].c >= finalLower[i]) { st[i] = finalLower[i]; dir[i] = true; }
      else { st[i] = finalUpper[i]; dir[i] = false; }
    }
  }
  return { st, dir };
}

// UT Bot Alerts style ATR trailing stop (QuantNomad-popularized formula).
function utBotSeries(bars, atrPeriod = 10, keyValue = 1.5) {
  const atr = atrSeries(bars, atrPeriod);
  const n = bars.length;
  const stop = new Array(n).fill(null);
  const dir = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (atr[i] == null) continue;
    const nLoss = keyValue * atr[i];
    const close = bars[i].c;
    const prevStop = stop[i - 1];
    const prevClose = i > 0 ? bars[i - 1].c : null;

    if (prevStop == null) {
      stop[i] = close - nLoss;
      dir[i] = true;
      continue;
    }
    if (close > prevStop && prevClose > prevStop) {
      stop[i] = Math.max(prevStop, close - nLoss);
    } else if (close < prevStop && prevClose < prevStop) {
      stop[i] = Math.min(prevStop, close + nLoss);
    } else if (close > prevStop) {
      stop[i] = close - nLoss;
    } else {
      stop[i] = close + nLoss;
    }
    dir[i] = close > stop[i];
  }
  return { stop, dir };
}

function swingStructure(bars, lookback = 20) {
  const n = bars.length;
  if (n < lookback + 1) return null;
  const recent = bars.slice(n - lookback, n - 1);
  const swingHigh = Math.max(...recent.map(b => b.h));
  const swingLow = Math.min(...recent.map(b => b.l));
  const mid = (swingHigh + swingLow) / 2;
  return { swingHigh, swingLow, mid, isBull: bars[n - 1].c >= mid };
}

// Basic RSI divergence over the trailing window: does the most recent
// price extreme agree with the most recent RSI extreme?
function rsiDivergence(closes, rsi, lookback = 14) {
  const n = closes.length;
  if (n < lookback + 2) return { bullish: false, bearish: false };
  const priceWindow = closes.slice(n - lookback);
  const rsiWindow = rsi.slice(n - lookback).map(v => v == null ? 50 : v);
  const lastIdx = priceWindow.length - 1;
  const priceMaxIdx = priceWindow.indexOf(Math.max(...priceWindow));
  const priceMinIdx = priceWindow.indexOf(Math.min(...priceWindow));
  const bearish = priceMaxIdx === lastIdx && rsiWindow[lastIdx] < Math.max(...rsiWindow.slice(0, lastIdx));
  const bullish = priceMinIdx === lastIdx && rsiWindow[lastIdx] > Math.min(...rsiWindow.slice(0, lastIdx));
  return { bullish, bearish };
}

function emaCalc(vals, len) {
  const k = 2 / (len + 1);
  let e = vals[0];
  for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}

// Master confluence engine. Returns null if there isn't enough history yet.
// signal is always 'BUY' or 'SELL' (UT Bot direction); highConviction is
// true once score >= 70, matching the dashboard's LUX UT GOD threshold.
function evaluateStrategy(bars) {
  const n = bars.length;
  if (n < 55) return null;

  const closes = bars.map(b => b.c);
  const volumes = bars.map(b => b.v || 0);
  const last = bars[n - 1];

  const { dir: utDirSeries, stop: utStopSeries } = utBotSeries(bars);
  const { st: stSeries, dir: stDirSeries } = superTrendSeries(bars);
  const adxSer = adxSeries(bars);
  const rsiSer = rsiSeries(closes);
  const structure = swingStructure(bars);
  const div = rsiDivergence(closes, rsiSer);

  const utTrailStop = utStopSeries[n - 1];
  const isUtBull = utDirSeries[n - 1];
  const superTrendVal = stSeries[n - 1];
  const isStBull = stDirSeries[n - 1];
  const adxVal = adxSer[n - 1] ?? 20;
  const isAdxTrending = adxVal >= 20;
  const rsi = rsiSer[n - 1] ?? 50;

  const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
  const rvol = avgVol20 > 0 ? (last.v || 0) / avgVol20 : 1;

  const ema50 = emaCalc(closes.slice(-50), 50);
  const trendFilterBull = last.c > ema50;

  if (utTrailStop == null || superTrendVal == null || !structure) return null;

  const confUt  = 26;
  const confSt  = (isStBull === isUtBull) ? 17.7 : 4;
  const confSb  = (structure.isBull === isUtBull) ? 17.6 : 4;
  const confAdx = isAdxTrending ? 13 : 4;
  const confMtf = (trendFilterBull === isUtBull) ? 8 : 2;
  const confVol = rvol >= 1.5 ? 10 : (rvol >= 1.0 ? 6 : 3);
  const confDiv = (isUtBull && div.bullish) || (!isUtBull && div.bearish) ? 4 : 2;

  let score = Math.round(confUt + confSt + confSb + confAdx + confMtf + confVol + confDiv);
  score = Math.min(98, Math.max(15, score));

  const signal = isUtBull ? 'BUY' : 'SELL';
  const highConviction = score >= 70;
  const verdict = isUtBull
    ? (highConviction ? 'LUX UT GOD BUY' : 'UT BOT BULLISH')
    : (highConviction ? 'LUX UT GOD SELL' : 'UT BOT BEARISH');

  const atrVal = atrSeries(bars)[n - 1] || (last.c * 0.01);
  const sl  = isUtBull ? last.c - 1.5 * atrVal : last.c + 1.5 * atrVal;
  const tp1 = isUtBull ? last.c + 1.5 * atrVal : last.c - 1.5 * atrVal;
  const tp2 = isUtBull ? last.c + 3.0 * atrVal : last.c - 3.0 * atrVal;

  return {
    price: last.c, signal, verdict, score, highConviction,
    isUtBull, utTrailStop,
    isStBull, superTrendVal,
    isSbBull: structure.isBull, swingHigh: structure.swingHigh, swingLow: structure.swingLow, sbMid: structure.mid,
    adxVal, isAdxTrending,
    rsi, rvol,
    confUt, confSt, confSb, confAdx, confMtf, confVol, confDiv,
    atr: atrVal, sl, tp1, tp2,
  };
}

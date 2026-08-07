// ─────────────────────────────────────────────────────────────────────────
// SMA STACK + VWAP + DTR/ATR + VOLUME — textbook trend/range strategy
//
// Deliberately kept SEPARATE from strategy.js (the "Luxy UT GOD" engine
// used by trader.js / scanner.js / scalp-scanner.js / the dashboard).
// This is its own standalone module -- nothing in this repo imports it
// automatically, and it does not place any orders itself. Read
// strategies/SMA-VWAP-STRATEGY.md for the plain-English rules this
// code implements.
//
// Needs two bar sets:
//   dailyBars    — daily OHLCV, oldest first, 200+ bars (for SMA200)
//   intradayBars — TODAY's intraday OHLCV (e.g. 1m/5m), oldest first,
//                  used for VWAP, relative volume, and entry timing
//
// Bar shape: { o, h, l, c, v }
// ─────────────────────────────────────────────────────────────────────────

export function sma(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function trueRange(bars, i) {
  const { h, l } = bars[i];
  const pc = bars[i - 1].c;
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}

export function atr(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = bars.length - period; i < bars.length; i++) trs.push(trueRange(bars, i));
  return trs.reduce((a, b) => a + b, 0) / period;
}

export function vwap(intradayBars) {
  let cumPV = 0, cumV = 0;
  for (const b of intradayBars) {
    const tp = (b.h + b.l + b.c) / 3;
    cumPV += tp * b.v;
    cumV += b.v;
  }
  return cumV > 0 ? cumPV / cumV : null;
}

export function relativeVolume(intradayBars, lookback = 20) {
  if (intradayBars.length < lookback + 1) return null;
  const recent = intradayBars.slice(-(lookback + 1), -1); // exclude current bar
  const avgVol = recent.reduce((a, b) => a + b.v, 0) / recent.length;
  const currentVol = intradayBars[intradayBars.length - 1].v;
  return avgVol > 0 ? currentVol / avgVol : null;
}

// ── TREND FILTER: SMA 5/10/50/100/200 stack alignment ──────────────────
export function smaStack(dailyBars) {
  const closes = dailyBars.map(b => b.c);
  const sma5   = sma(closes, 5);
  const sma10  = sma(closes, 10);
  const sma50  = sma(closes, 50);
  const sma100 = sma(closes, 100);
  const sma200 = sma(closes, 200);
  const price  = closes[closes.length - 1];

  if ([sma5, sma10, sma50, sma100, sma200].some(v => v == null)) return null;

  const bullishStack = price > sma5 && sma5 > sma10 && sma10 > sma50 && sma50 > sma100 && sma100 > sma200;
  const bearishStack = price < sma5 && sma5 < sma10 && sma10 < sma50 && sma50 < sma100 && sma100 < sma200;

  return { price, sma5, sma10, sma50, sma100, sma200, bullishStack, bearishStack };
}

// ── RANGE CONTEXT: today's Daily Trading Range vs ATR(14) ──────────────
export function rangeContext(dailyBars) {
  const today = dailyBars[dailyBars.length - 1];
  const dtr = today.h - today.l;
  const atrVal = atr(dailyBars.slice(0, -1)); // ATR computed from bars BEFORE today
  if (atrVal == null) return null;
  const dtrToAtr = dtr / atrVal;
  return {
    dtr, atr: atrVal, dtrToAtr,
    compressed: dtrToAtr < 0.7,  // today's range well below normal -- coiling for a breakout
    exhausted: dtrToAtr >= 1.5,  // today's range already far above normal -- move may be spent
  };
}

// ── ENTRY: textbook long/short setups ───────────────────────────────────
// Returns null if no setup, otherwise { side, rule, price, vwap, rvol,
// dtrToAtr, stop, target }.
export function checkEntry(dailyBars, intradayBars) {
  const stack = smaStack(dailyBars);
  const range = rangeContext(dailyBars);
  if (!stack || !range || intradayBars.length < 21) return null;

  const vw = vwap(intradayBars);
  const rvol = relativeVolume(intradayBars);
  const last = intradayBars[intradayBars.length - 1];
  const prev = intradayBars[intradayBars.length - 2];
  if (vw == null || rvol == null) return null;

  const priceAboveVwap    = last.c > vw;
  const justReclaimedVwap = prev.c <= vw && last.c > vw;
  const priceBelowVwap    = last.c < vw;
  const justLostVwap      = prev.c >= vw && last.c < vw;

  // LONG: bullish daily stack + holding/reclaiming VWAP + volume confirms
  // + today's range hasn't already run its course.
  if (stack.bullishStack && (priceAboveVwap || justReclaimedVwap) && rvol >= 1.5 && !range.exhausted) {
    return {
      side: 'BUY',
      rule: justReclaimedVwap ? 'VWAP Reclaim + Bullish SMA Stack' : 'VWAP Hold + Bullish SMA Stack',
      price: last.c, vwap: vw, rvol, dtrToAtr: range.dtrToAtr,
      stop: Math.min(stack.sma10, vw),  // tighter of SMA10 or VWAP
      target: last.c + 2 * range.atr,   // textbook 2x ATR target
    };
  }

  // SHORT: mirror image.
  if (stack.bearishStack && (priceBelowVwap || justLostVwap) && rvol >= 1.5 && !range.exhausted) {
    return {
      side: 'SELL',
      rule: justLostVwap ? 'VWAP Loss + Bearish SMA Stack' : 'VWAP Reject + Bearish SMA Stack',
      price: last.c, vwap: vw, rvol, dtrToAtr: range.dtrToAtr,
      stop: Math.max(stack.sma10, vw),
      target: last.c - 2 * range.atr,
    };
  }

  return null;
}

// ── EXIT: textbook rules for an already-open position ───────────────────
// position: { side: 'BUY' | 'SELL' }
// Returns { exit: boolean, reasons: string[], price }.
export function checkExit(position, dailyBars, intradayBars) {
  const stack = smaStack(dailyBars);
  const range = rangeContext(dailyBars);
  const vw = vwap(intradayBars);
  const rvol = relativeVolume(intradayBars);
  const last = intradayBars[intradayBars.length - 1];
  if (!stack || !range || vw == null || !last) return { exit: false, reasons: [] };

  const reasons = [];

  if (position.side === 'BUY') {
    if (last.c < stack.sma10) reasons.push('Close below SMA10 — short-term trend broken');
    if (last.c < vw) reasons.push('Close below VWAP — session control lost');
    if (range.exhausted) reasons.push(`Range exhausted (DTR ${range.dtrToAtr.toFixed(2)}x ATR) — tighten/trail stop`);
    if (rvol != null && rvol < 0.7) reasons.push('Volume drying up — momentum fading');
  } else if (position.side === 'SELL') {
    if (last.c > stack.sma10) reasons.push('Close above SMA10 — short-term trend broken');
    if (last.c > vw) reasons.push('Close above VWAP — session control lost');
    if (range.exhausted) reasons.push(`Range exhausted (DTR ${range.dtrToAtr.toFixed(2)}x ATR) — tighten/trail stop`);
    if (rvol != null && rvol < 0.7) reasons.push('Volume drying up — momentum fading');
  }

  return { exit: reasons.length > 0, reasons, price: last.c };
}

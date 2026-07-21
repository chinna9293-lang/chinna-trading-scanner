// Chinna Trading Scanner — Four-Gate Institutional Framework
// G1: Regime (ADX ≥ 20 + Choppiness Index < 61.8 + ATR Percentile 25–80)
// G2: Daily Trend (close > SMA50, SMA50 > SMA200)
// G3: Entry Score ≥ 4/6 (Trend: EMA structure + slope + position | Momentum: MACD accel + RSI zone + volume)
// G4: Risk (daily loss limit ≤ 3 SL hits)
// Exits: TP1 40% @ 2×ATR → TP2 40% @ 3.5×ATR → trail 20%

const NTFY    = process.env.NTFY_TOPIC      || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY      || '';
const ALP_SEC = process.env.ALPACA_SECRET   || '';
const ALP_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const DATA    = 'https://data.alpaca.markets';

// ── Universe ───────────────────────────────────────────────────────────────────
// MSFT removed: 0%WR on breakout signal (too range-bound, 80-100% SL hit rate)
const UNIVERSE = {
  LLY:  { type:'stock',  risk:'low'  },
  COST: { type:'stock',  risk:'low'  },
  TSLA: { type:'stock',  risk:'low'  },
  AMD:  { type:'stock',  risk:'low'  },
  CRM:  { type:'stock',  risk:'low'  },
  WMT:  { type:'stock',  risk:'low'  },
  META: { type:'stock',  risk:'high' },
  GOOGL:{ type:'stock',  risk:'high' },
  NFLX: { type:'stock',  risk:'high' },
  'DOGE/USD': { type:'crypto', risk:'low'  },
  'LTC/USD':  { type:'crypto', risk:'low'  },
  'LINK/USD': { type:'crypto', risk:'low'  },
  'BTC/USD':  { type:'crypto', risk:'high' },
  'ETH/USD':  { type:'crypto', risk:'high' },
  'SOL/USD':  { type:'crypto', risk:'high' },
};

// ── Exit architecture (ATR multiples) ──────────────────────────────────────────
const ATR_SL        = 1.5;   // stop loss at 1.5×ATR (was 1.0 — too tight for opening noise)
const ATR_BE        = 1.0;   // move stop to breakeven when price gains 1×ATR
const ATR_TP1       = 2.0;   // exit 40% of position
const ATR_TP2       = 3.5;   // exit 40% of position
// remaining 20% trailed at swing_high − 2×ATR until stopped out

const TIME_STOP_BARS = 12;   // bars before time-stop exit

// ── Regime thresholds (G1) ─────────────────────────────────────────────────────
const CI_MAX        = 61.8;  // Choppiness Index: > 61.8 = choppy, skip
const ATR_PCT_MIN   = 25;    // skip if ATR below 25th percentile (too quiet)
const ATR_PCT_MAX   = 80;    // halve size if ATR above 80th percentile (too wild)
const ADX_MIN       = 20;    // trending market minimum

// ── Risk per trade (G4) ────────────────────────────────────────────────────────
const RISK_PCT      = 0.01;  // risk 1% of equity per trade
const MAX_SL_DAY    = 3;     // halt after 3 stop-loss hits in one day

const alpH = { 'APCA-API-KEY-ID': ALP_KEY, 'APCA-API-SECRET-KEY': ALP_SEC };

// ── Helpers ────────────────────────────────────────────────────────────────────
async function apGet(url) {
  const r = await fetch(url, { headers: alpH });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} — ${url}`);
  return r.json();
}

async function apPost(path, body) {
  const r = await fetch(ALP_URL + path, {
    method: 'POST',
    headers: { ...alpH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function apDelete(orderId) {
  await fetch(`${ALP_URL}/v2/orders/${orderId}`, { method: 'DELETE', headers: alpH });
}

async function notify(title, body, priority, tags) {
  try {
    await fetch('https://ntfy.sh/' + NTFY, {
      method: 'POST',
      headers: {
        'Title':    title.replace(/[^\x00-\x7F]/g, ''),
        'Priority': priority || 'default',
        'Tags':     tags || 'chart_with_upwards_trend',
      },
      body,
    });
    console.log('[ntfy]', title);
  } catch(e) { console.error('ntfy error:', e.message); }
}

// ── Market data ────────────────────────────────────────────────────────────────
async function getBars(symbol, limit, tf) {
  tf = tf || '1Hour';
  const sym = symbol.replace('/', '%2F');
  const isCrypto = symbol.includes('/');
  const days = tf === '1Day' ? 400 : tf === '4Hour' ? 90 : tf === '1Hour' ? 30 : 15;
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  if (isCrypto) {
    const url = `${DATA}/v1beta3/crypto/us/bars?symbols=${sym}&timeframe=${tf}&limit=${limit}&start=${start}`;
    const d = await (await fetch(url, { headers: alpH })).json();
    return (d.bars && d.bars[symbol]) ? d.bars[symbol] : [];
  }
  for (const feed of ['sip', 'iex']) {
    try {
      const url = `${DATA}/v2/stocks/${symbol}/bars?timeframe=${tf}&limit=${limit}&feed=${feed}&adjustment=raw&start=${start}&extended_hours=true`;
      const d = await (await fetch(url, { headers: alpH })).json();
      if ((d.bars || []).length >= 5) return d.bars;
    } catch {}
  }
  return [];
}

// ── Core indicators ────────────────────────────────────────────────────────────

// Single final EMA value
function ema(arr, n) {
  const k = 2 / (n + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

// Full EMA history array — needed for MACD and slope comparisons
function emaArray(arr, n) {
  const k = 2 / (n + 1);
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k));
  return out;
}

// Simple Moving Average (final value)
function smaCalc(arr, n) {
  const sl = arr.slice(-n);
  return sl.reduce((a, b) => a + b, 0) / sl.length;
}

// RSI (14-bar)
function rsiCalc(closes) {
  const slice = closes.slice(-15);
  let g = 0, l = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  return 100 - 100 / (1 + (g / (l || 0.001)));
}

// ATR
function atrCalc(bars, n) {
  n = n || 14;
  const relevant = bars.slice(-n - 1);
  let sum = 0;
  for (let i = 1; i < relevant.length; i++) {
    const b = relevant[i], p = relevant[i - 1];
    sum += Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
  }
  return sum / Math.min(n, relevant.length - 1);
}

// ADX (trend strength, not direction)
function adxCalc(bars, n) {
  n = n || 14;
  const sl = bars.slice(-(n * 2 + 1));
  let atr = 0, pdm = 0, ndm = 0;
  const b1 = sl[1], p1 = sl[0];
  atr = Math.max(b1.h - b1.l, Math.abs(b1.h - p1.c), Math.abs(b1.l - p1.c));
  pdm = Math.max(b1.h - p1.h, 0) > Math.max(p1.l - b1.l, 0) ? Math.max(b1.h - p1.h, 0) : 0;
  ndm = Math.max(p1.l - b1.l, 0) > Math.max(b1.h - p1.h, 0) ? Math.max(p1.l - b1.l, 0) : 0;
  let adx = 0;
  for (let i = 2; i < sl.length; i++) {
    const b = sl[i], p = sl[i - 1];
    const tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    const pm = Math.max(b.h - p.h, 0) > Math.max(p.l - b.l, 0) ? Math.max(b.h - p.h, 0) : 0;
    const nm = Math.max(p.l - b.l, 0) > Math.max(b.h - p.h, 0) ? Math.max(p.l - b.l, 0) : 0;
    atr = atr - atr / n + tr;
    pdm = pdm - pdm / n + pm;
    ndm = ndm - ndm / n + nm;
    const pdi = atr > 0 ? 100 * pdm / atr : 0;
    const ndi = atr > 0 ? 100 * ndm / atr : 0;
    const dx  = (pdi + ndi) > 0 ? 100 * Math.abs(pdi - ndi) / (pdi + ndi) : 0;
    adx = adx === 0 ? dx : adx * (n - 1) / n + dx / n;
  }
  return +adx.toFixed(1);
}

// MACD histogram — returns current bar and previous bar values
// Acceleration (curr > prev) means momentum is building, not just present
function macdHist(closes) {
  if (closes.length < 40) return { curr: 0, prev: 0 };
  const fastArr  = emaArray(closes, 12);
  const slowArr  = emaArray(closes, 26);
  const macdLine = fastArr.map((v, i) => v - slowArr[i]).slice(25);
  const sigArr   = emaArray(macdLine, 9);
  const hist     = macdLine.map((v, i) => v - sigArr[i]);
  const n        = hist.length;
  return { curr: hist[n - 1], prev: hist[n - 2] || 0 };
}

// Choppiness Index — measures how efficiently price moved over n bars
// CI > 61.8 = range-bound/choppy → breakouts fail → skip
// CI < 38.2 = strong trend → optimal
function choppinessIndex(bars, n) {
  n = n || 14;
  const sl = bars.slice(-(n + 1));
  if (sl.length < n) return 50;
  let atrSum = 0;
  for (let i = 1; i < sl.length; i++) {
    const b = sl[i], p = sl[i - 1];
    atrSum += Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
  }
  const hi  = Math.max(...sl.map(b => b.h));
  const lo  = Math.min(...sl.map(b => b.l));
  const rng = hi - lo;
  if (rng === 0 || atrSum === 0) return 100;
  return +(100 * Math.log10(atrSum / rng) / Math.log10(n)).toFixed(1);
}

// ATR Percentile Rank — where current ATR sits vs its own 100-bar history
// Trade when ATR_pct ∈ [25, 80]: enough movement to reach TP, not so much that slippage destroys edge
function atrPercentileRank(bars, n, lookback) {
  n = n || 14;
  lookback = lookback || 100;
  if (bars.length < lookback + n) return 50;
  const cur = atrCalc(bars.slice(-(n + 1)));
  const sl  = bars.slice(-(lookback + n));
  let below = 0;
  for (let i = n; i < sl.length - 1; i++) {
    if (atrCalc(sl.slice(i - n, i + 1)) < cur) below++;
  }
  return +((below / (lookback - 1)) * 100).toFixed(1);
}

// ── GATE 1: Regime Detection ───────────────────────────────────────────────────
// All three must pass. sizeReduction = 0.5 when volatility is high (ATR > 80th pct).
function regimeGate(bars) {
  const adx    = adxCalc(bars);
  const ci     = choppinessIndex(bars);
  const atrPct = atrPercentileRank(bars);
  const pass   = adx >= ADX_MIN && ci < CI_MAX && atrPct >= ATR_PCT_MIN;
  const sizeReduction = atrPct > ATR_PCT_MAX ? 0.5 : 1.0;
  return { pass, adx, ci, atrPct, sizeReduction };
}

// ── GATE 2: Daily Trend Alignment ─────────────────────────────────────────────
// Daily golden cross (SMA50 > SMA200) + price above SMA50 = confirmed bull structure.
// Only long entries allowed when bullish. Only short entries when bearish.
function dailyGate(dailyBars) {
  if (!dailyBars || dailyBars.length < 205) {
    return { pass: false, bullish: false, bearish: false, reason: 'insufficient daily bars' };
  }
  const closes = dailyBars.map(b => b.c);
  const sma50  = smaCalc(closes, 50);
  const sma200 = smaCalc(closes, 200);
  const last   = closes[closes.length - 1];
  const bullish = last > sma50 && sma50 > sma200;
  const bearish = last < sma50 && sma50 < sma200;
  return { pass: bullish || bearish, bullish, bearish, sma50: +sma50.toFixed(2), sma200: +sma200.toFixed(2) };
}

// ── GATE 3: Entry Signal ───────────────────────────────────────────────────────
// Trend Score (0–3): EMA structure + EMA slope + price above trend
// Momentum Score (0–3): MACD acceleration + RSI zone + volume expansion
// Signal fires when combined score ≥ 4 AND a quality breakout is detected
function entrySignal(bars) {
  if (bars.length < 55) return null;
  const n      = bars.length;
  const closes = bars.map(b => b.c);
  const highs  = bars.map(b => b.h);
  const lows   = bars.map(b => b.l);
  const vols   = bars.map(b => b.v || 0);
  const last   = bars[n - 1];
  const prev   = bars[n - 2];

  // EMA arrays for slope calculation
  const e9Arr  = emaArray(closes, 9);
  const e20Arr = emaArray(closes, 20);
  const e50Arr = emaArray(closes, 50);
  const e9     = e9Arr[e9Arr.length - 1];
  const e20    = e20Arr[e20Arr.length - 1];
  const e50    = e50Arr[e50Arr.length - 1];
  const e20_3  = e20Arr[Math.max(0, e20Arr.length - 4)]; // EMA20 value 3 bars ago

  // Swing levels (12-bar lookback, excluding current bar)
  const swingH = Math.max(...highs.slice(n - 13, n - 1));
  const swingL = Math.min(...lows.slice(n - 13, n - 1));

  const atrVal = atrCalc(bars);
  const rsi    = rsiCalc(closes);
  const avgVol = smaCalc(vols, 20);
  const { curr: macdCurr, prev: macdPrev } = macdHist(closes);

  // ── LONG signal ──────────────────────────────────────────────────────────────
  // Trend Score
  const T1 = e20 > e50 ? 1 : 0;                     // EMA structure bullish
  const T2 = e20 > e20_3 ? 1 : 0;                   // EMA20 slope rising
  const T3 = last.c > e50 ? 1 : 0;                  // price above EMA50
  const trendBull = T1 + T2 + T3;

  // Momentum Score
  const M1 = (macdCurr > 0 && macdCurr > macdPrev) ? 1 : 0;  // MACD histogram accelerating up
  const M2 = (rsi > 52 && rsi < 70) ? 1 : 0;                  // RSI in momentum zone (not overbought)
  const M3 = (avgVol > 0 && last.v > avgVol * 1.5) ? 1 : 0;  // institutional volume

  const momentumBull = M1 + M2 + M3;
  const scoreBull    = trendBull + momentumBull;

  // Breakout quality (false breakout filter)
  const bodyBull  = Math.abs(last.c - last.o) > 0.5 * atrVal;  // meaningful candle body
  const closeBull = last.c > swingH;                             // closed through resistance
  const volBull   = last.v > prev.v * 1.2;                      // expanding volume
  const breakBull = bodyBull && closeBull && volBull && prev.c <= swingH; // first bar of break

  if (scoreBull >= 4 && breakBull && e9 > e20) {
    return {
      side: 'buy', price: last.c, atr: atrVal, rsi, e9, e20, e50,
      trendScore: trendBull, momentumScore: momentumBull, entryScore: scoreBull,
      swingH, swingL, macdCurr,
      T1, T2, T3, M1, M2, M3,
    };
  }

  // ── SHORT signal ──────────────────────────────────────────────────────────────
  const T1b = e20 < e50 ? 1 : 0;                    // EMA structure bearish
  const T2b = e20 < e20_3 ? 1 : 0;                  // EMA20 slope falling
  const T3b = last.c < e50 ? 1 : 0;                 // price below EMA50
  const trendBear = T1b + T2b + T3b;

  const M1b = (macdCurr < 0 && macdCurr < macdPrev) ? 1 : 0;  // MACD histogram accelerating down
  const M2b = (rsi > 30 && rsi < 48) ? 1 : 0;                  // RSI in bearish zone
  const momentumBear = M1b + M2b + M3;                           // M3 (volume) same for both

  const scoreBear = trendBear + momentumBear;

  const bodyBear  = Math.abs(last.c - last.o) > 0.5 * atrVal;
  const closeBear = last.c < swingL;
  const volBear   = last.v > prev.v * 1.2;
  const breakBear = bodyBear && closeBear && volBear && prev.c >= swingL;

  if (scoreBear >= 4 && breakBear && e9 < e20) {
    return {
      side: 'sell', price: last.c, atr: atrVal, rsi, e9, e20, e50,
      trendScore: trendBear, momentumScore: momentumBear, entryScore: scoreBear,
      swingH, swingL, macdCurr,
      T1: T1b, T2: T2b, T3: T3b, M1: M1b, M2: M2b, M3,
    };
  }

  return null;
}

// ── GATE 4: Daily Loss Limit ───────────────────────────────────────────────────
// Count SL-hit orders today. If ≥ MAX_SL_DAY, halt trading for the rest of the day.
// Losing days cluster — continued trading during a losing session compounds the damage.
async function riskGate() {
  try {
    const today  = new Date().toISOString().slice(0, 10);
    const orders = await apGet(`${ALP_URL}/v2/orders?status=closed&after=${today}T00:00:00Z&limit=200`);
    if (!Array.isArray(orders)) return { pass: true };
    const slHits = orders.filter(o =>
      o.type === 'stop' && o.status === 'filled' ||
      o.order_class === 'stop_loss' && o.status === 'filled'
    ).length;
    if (slHits >= MAX_SL_DAY) return { pass: false, slHits, reason: `Daily loss limit hit (${slHits} SL hits today)` };
    return { pass: true, slHits };
  } catch { return { pass: true }; }
}

// ── Four-Gate Signal Check ────────────────────────────────────────────────────
// Returns a signal object only when ALL four gates pass.
// Direction is filtered by G2: longs only in daily uptrend, shorts only in daily downtrend.
function check(bars, dailyBars) {
  if (bars.length < 55) return null;

  const g1 = regimeGate(bars);
  if (!g1.pass) return null;

  const g2 = dailyGate(dailyBars);
  if (!g2.pass) return null;

  const g3 = entrySignal(bars);
  if (!g3) return null;

  if (g3.side === 'buy'  && !g2.bullish) return null;
  if (g3.side === 'sell' && !g2.bearish) return null;

  return { ...g3, regime: g1, daily: g2 };
}

// ── Backtest (walk-forward, hourly bars) ───────────────────────────────────────
function backtestSymbol(bars, dailyBars) {
  const results = [];
  const n = bars.length;
  if (n < 60) return results;

  let i = 55;
  while (i < n - 2) {
    const slice     = bars.slice(0, i + 1);
    const sig       = check(slice, dailyBars);
    if (!sig) { i++; continue; }

    const entry  = bars[i + 1]?.o || bars[i].c;
    const atrVal = sig.atr || atrCalc(slice);
    const tp1    = sig.side === 'buy'  ? entry + ATR_TP1 * atrVal : entry - ATR_TP1 * atrVal;
    const sl     = sig.side === 'buy'  ? entry - ATR_SL  * atrVal : entry + ATR_SL  * atrVal;
    const pctTP1 = +(ATR_TP1 * atrVal / entry * 100).toFixed(2);
    const pctSL  = +(ATR_SL  * atrVal / entry * 100).toFixed(2);

    let outcome = null;
    const maxBar = Math.min(i + 1 + TIME_STOP_BARS, n);

    for (let j = i + 1; j < maxBar; j++) {
      const b = bars[j];
      if (sig.side === 'buy') {
        if (b.h >= tp1) { outcome = { win: true,  pct: +pctTP1, how: 'TP1' }; break; }
        if (b.l <= sl)  { outcome = { win: false, pct: -pctSL,  how: 'SL'  }; break; }
      } else {
        if (b.l <= tp1) { outcome = { win: true,  pct: +pctTP1, how: 'TP1' }; break; }
        if (b.h >= sl)  { outcome = { win: false, pct: -pctSL,  how: 'SL'  }; break; }
      }
    }

    if (!outcome) {
      const exitBar = bars[Math.min(i + 1 + TIME_STOP_BARS, n - 1)];
      const rawPct  = sig.side === 'buy'
        ? (exitBar.c - entry) / entry * 100
        : (entry - exitBar.c) / entry * 100;
      outcome = { win: rawPct > 0, pct: +rawPct.toFixed(2), how: 'TIME' };
    }

    results.push({ date: bars[i].t, side: sig.side, entry, tp1, sl, atr: atrVal, ...outcome });
    i += Math.max(3, TIME_STOP_BARS);
  }

  return results;
}

function btSummary(results) {
  if (!results.length) return null;
  const wins     = results.filter(r => r.win);
  const wr       = +(wins.length / results.length * 100).toFixed(1);
  const totalPct = +results.reduce((s, r) => s + r.pct, 0).toFixed(2);
  const avgPct   = +(totalPct / results.length).toFixed(2);
  const tp1Hits  = results.filter(r => r.how === 'TP1').length;
  const slHits   = results.filter(r => r.how === 'SL').length;
  const timeHits = results.filter(r => r.how === 'TIME').length;
  return { trades: results.length, wins: wins.length, wr, totalPct, avgPct, tp1Hits, slHits, timeHits };
}

async function runBacktests() {
  console.log('\n=== BACKTEST — Four-Gate Framework ===');
  const rows = [];
  let totalWins = 0, totalTrades = 0, totalPnl = 0;

  for (const [symbol] of Object.entries(UNIVERSE)) {
    try {
      const [bars, dailyBars] = await Promise.all([
        getBars(symbol, 200, '1Hour'),
        getBars(symbol, 300, '1Day'),
      ]);
      if (bars.length < 60) { console.log(symbol, 'insufficient bars'); continue; }

      const results = backtestSymbol(bars, dailyBars);
      const s = btSummary(results);
      if (!s) { console.log(symbol, 'no signals'); continue; }

      const icon = s.wr >= 55 ? '✅' : s.wr >= 45 ? '📊' : '❌';
      const row  = `${icon} ${symbol.padEnd(10)} ${s.trades}T ${s.wr}%WR ${s.totalPct >= 0 ? '+' : ''}${s.totalPct}% [TP1:${s.tp1Hits} SL:${s.slHits} TIME:${s.timeHits}]`;
      rows.push(row);
      console.log(row);
      totalWins   += s.wins;
      totalTrades += s.trades;
      totalPnl    += s.totalPct;
    } catch(e) { console.error(symbol, 'backtest error:', e.message); }
  }

  if (!rows.length) return;

  const overallWR = +(totalWins / totalTrades * 100).toFixed(1);
  await notify(
    `Backtest Complete — ${overallWR}% WR`,
    `📊 Four-Gate Framework Backtest\n` +
    `G1:Regime | G2:Daily(SMA50>200) | G3:Score≥4/6 | G4:Risk\n` +
    `SL=${ATR_SL}×ATR | TP1=${ATR_TP1}×ATR | TP2=${ATR_TP2}×ATR\n\n` +
    rows.join('\n') +
    `\n\n────────────────────\n` +
    `OVERALL: ${totalTrades} trades | ${overallWR}% WR | ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}% P&L`,
    'default', 'bar_chart'
  );
}

// ── Check for filled orders (runs every hour) ──────────────────────────────────
async function checkFilledOrders() {
  try {
    const since  = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const orders = await apGet(`${ALP_URL}/v2/orders?status=closed&after=${since}&limit=50`);
    if (!Array.isArray(orders)) return;

    for (const o of orders) {
      if (o.status !== 'filled') continue;
      const side   = o.side.toUpperCase();
      const sym    = o.symbol;
      const qty    = o.filled_qty;
      const fillPx = parseFloat(o.filled_avg_price || 0).toFixed(2);

      if (o.order_class === 'take_profit' || o.order_class === 'stop_loss') {
        const isProfit = o.order_class === 'take_profit';
        await notify(
          `${isProfit ? '✅ PROFIT TAKEN' : '⛔ STOP HIT'} ${sym}`,
          `${side} ${qty} ${sym} filled @ $${fillPx}\n${isProfit ? 'Take Profit hit 🎯' : 'Stop Loss hit ⛔'}\nOrder: ${o.id}`,
          isProfit ? 'high' : 'urgent',
          isProfit ? 'white_check_mark' : 'stop_sign'
        );
      } else {
        await notify(
          `FILLED ${side} ${sym} @ $${fillPx}`,
          `${qty} shares/units entered\nOrder ID: ${o.id}\nTime: ${new Date(o.filled_at || Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`,
          'high', 'white_check_mark'
        );
      }
    }
  } catch(e) { console.error('checkFilledOrders error:', e.message); }
}

// ── Already traded this symbol today? ─────────────────────────────────────────
async function alreadyTraded(symbol) {
  const alpSym = symbol.replace('/', '');
  const pos    = await apGet(ALP_URL + '/v2/positions');
  if (Array.isArray(pos) && pos.find(p => p.symbol === alpSym)) return true;
  const today  = new Date().toISOString().slice(0, 10);
  const orders = await apGet(`${ALP_URL}/v2/orders?status=all&after=${today}T00:00:00Z&limit=200`);
  if (Array.isArray(orders) && orders.find(o => o.symbol === alpSym)) return true;
  return false;
}

// ── ATR-based position sizing ──────────────────────────────────────────────────
// shares = floor(dollar_risk / stop_distance)
// 1% of equity is at risk regardless of price or volatility level
function calcShares(equity, atrVal, sizeReduction) {
  const dollarRisk   = equity * RISK_PCT * (sizeReduction || 1);
  const stopDistance = ATR_SL * atrVal;
  return Math.max(1, Math.floor(dollarRisk / stopDistance));
}

// ── Place stock order (entry + separate protective stop) ───────────────────────
async function placeStockOrder(symbol, side, price, atrVal, sizeReduction) {
  const acct    = await apGet(ALP_URL + '/v2/account');
  const equity  = parseFloat(acct.equity || 10000);
  const qty     = calcShares(equity, atrVal, sizeReduction);
  const m       = side === 'buy' ? 1 : -1;
  const slPx    = (price - m * ATR_SL * atrVal).toFixed(2);
  const exitSide = side === 'buy' ? 'sell' : 'buy';

  // Entry at market
  const entry = await apPost('/v2/orders', {
    symbol, qty: String(qty), side, type: 'market', time_in_force: 'day',
  });
  if (!entry.id) return { order: entry, qty, equity, slPx, slOrderId: null };

  // Small delay for fill, then place protective stop
  await new Promise(r => setTimeout(r, 3000));
  const slOrder = await apPost('/v2/orders', {
    symbol, qty: String(qty), side: exitSide,
    type: 'stop', stop_price: slPx, time_in_force: 'day',
  });

  return { order: entry, qty, equity, slPx, slOrderId: slOrder.id };
}

// ── Place crypto order (entry + protective stop) ───────────────────────────────
async function placeCryptoOrder(symbol, side, price, atrVal, sizeReduction) {
  const acct    = await apGet(ALP_URL + '/v2/account');
  const equity  = parseFloat(acct.equity || 10000);
  const shares  = calcShares(equity, atrVal, sizeReduction);
  const qty     = (shares * atrVal / price).toFixed(6); // convert to crypto units by notional
  const m       = side === 'buy' ? 1 : -1;
  const slPx    = (price - m * ATR_SL * atrVal).toFixed(4);
  const exitSide = side === 'buy' ? 'sell' : 'buy';

  const entry = await apPost('/v2/orders', {
    symbol, qty, side, type: 'market', time_in_force: 'gtc',
  });
  if (!entry.id) return { order: entry, qty, equity, slPx, slOrderId: null };

  await new Promise(r => setTimeout(r, 2000));
  const slOrder = await apPost('/v2/orders', {
    symbol, qty, side: exitSide,
    type: 'stop', stop_price: slPx, time_in_force: 'gtc',
  });

  return { order: entry, qty, equity, slPx, slOrderId: slOrder.id };
}

// ── Monitor open trade — 3-stage exit ─────────────────────────────────────────
// Stage 0 → full position with SL at 1.5×ATR
// Stage 1 → +1×ATR reached: cancel SL, place breakeven stop
// TP1     → +2×ATR: sell 40%, replace stop for remaining 60% at breakeven
// TP2     → +3.5×ATR: sell another 40%, let last 20% trail
// Trail   → sell remainder when price drops 2×ATR from swing high
// Time    → hard exit after TIME_STOP_BARS bars
async function monitorTrade(symbol, side, entryPrice, atrVal, totalQty, isCrypto, initialSlOrderId) {
  const alpSym   = symbol.replace('/', '');
  const m        = side === 'buy' ? 1 : -1;
  const tf       = isCrypto ? 'gtc' : 'day';
  const exitSide = side === 'buy' ? 'sell' : 'buy';

  const beTrigger  = entryPrice + m * ATR_BE  * atrVal;
  const tp1Price   = entryPrice + m * ATR_TP1 * atrVal;
  const tp2Price   = entryPrice + m * ATR_TP2 * atrVal;
  const initSlPrice = entryPrice - m * ATR_SL * atrVal;

  let currentSlOrderId = initialSlOrderId;
  let beMoved  = false;
  let tp1Hit   = false;
  let tp2Hit   = false;
  let swingRef = entryPrice; // trailing reference (highest high for longs)
  let checkCount = 0;
  const maxChecks = 720; // 6h × 30s

  console.log(
    `\n📊 MONITOR ${symbol} | Entry $${entryPrice.toFixed(2)} | Qty ${totalQty}` +
    ` | SL $${initSlPrice.toFixed(2)} | TP1 $${tp1Price.toFixed(2)} | TP2 $${tp2Price.toFixed(2)}`
  );

  while (checkCount < maxChecks) {
    await new Promise(r => setTimeout(r, 30000));
    checkCount++;

    try {
      const positions = await apGet(ALP_URL + '/v2/positions');
      const pos = Array.isArray(positions) && positions.find(p => p.symbol === alpSym);

      // Position closed (SL hit or partial exits exhausted position)
      if (!pos) {
        const stageTxt = tp2Hit ? 'after TP2' : tp1Hit ? 'after TP1' : 'SL hit';
        await notify(
          `✅ TRADE CLOSED ${symbol}`,
          `Entry: $${entryPrice.toFixed(2)} | ATR: $${atrVal.toFixed(3)}\n` +
          `Closed ${stageTxt}\nSL was $${initSlPrice.toFixed(2)} | TP1 $${tp1Price.toFixed(2)} | TP2 $${tp2Price.toFixed(2)}`,
          'high', 'checkered_flag'
        );
        console.log(`✅ ${symbol} closed ${stageTxt}`);
        return;
      }

      const curPrice = parseFloat(pos.current_price);
      const curQty   = parseFloat(pos.qty);
      const pnl      = parseFloat(pos.unrealized_pl);
      const pnlPct   = (parseFloat(pos.unrealized_plpc) * 100).toFixed(2);

      // Update trailing reference
      if (side === 'buy' && curPrice > swingRef) swingRef = curPrice;
      if (side === 'sell' && curPrice < swingRef) swingRef = curPrice;

      // ── Stage: Move SL to breakeven ──────────────────────────────────────
      if (!beMoved && !tp1Hit) {
        const beTriggered = side === 'buy' ? curPrice >= beTrigger : curPrice <= beTrigger;
        if (beTriggered) {
          if (currentSlOrderId) await apDelete(currentSlOrderId).catch(() => {});
          const bePx = (entryPrice + m * 0.05).toFixed(isCrypto ? 4 : 2);
          const beOrder = await apPost('/v2/orders', {
            symbol: alpSym, qty: String(Math.round(curQty)),
            side: exitSide, type: 'stop', stop_price: bePx, time_in_force: tf,
          });
          currentSlOrderId = beOrder.id;
          beMoved = true;
          console.log(`🔒 ${symbol} SL → breakeven $${bePx}`);
          await notify(`🔒 BREAKEVEN ${symbol}`, `Stop → $${bePx} | P&L +$${pnl.toFixed(2)} (${pnlPct}%)`, 'default', 'lock');
        }
      }

      // ── Stage: TP1 — sell 40% ─────────────────────────────────────────────
      if (!tp1Hit) {
        const tp1Triggered = side === 'buy' ? curPrice >= tp1Price : curPrice <= tp1Price;
        if (tp1Triggered) {
          const sellQty = Math.max(1, Math.round(curQty * 0.4));
          await apPost('/v2/orders', {
            symbol: alpSym, qty: String(sellQty),
            side: exitSide, type: 'market', time_in_force: tf,
          });

          // Cancel old SL, place new breakeven stop for remaining 60%
          if (currentSlOrderId) await apDelete(currentSlOrderId).catch(() => {});
          const bePx = (entryPrice + m * 0.05).toFixed(isCrypto ? 4 : 2);
          const remQty = Math.round(curQty - sellQty);
          if (remQty > 0) {
            const newSl = await apPost('/v2/orders', {
              symbol: alpSym, qty: String(remQty),
              side: exitSide, type: 'stop', stop_price: bePx, time_in_force: tf,
            });
            currentSlOrderId = newSl.id;
          }

          tp1Hit = true;
          beMoved = true;
          console.log(`🎯 ${symbol} TP1 → sold ${sellQty} shares @ ~$${curPrice.toFixed(2)}`);
          await notify(
            `🎯 TP1 HIT ${symbol}`,
            `Sold 40% (${sellQty} shares) @ $${curPrice.toFixed(2)}\n` +
            `+${ATR_TP1}×ATR from entry\nRemaining: ~${Math.round(curQty * 0.6)} shares\nStop moved to breakeven`,
            'high', 'white_check_mark'
          );
        }
      }

      // ── Stage: TP2 — sell another 40% ────────────────────────────────────
      if (tp1Hit && !tp2Hit) {
        const tp2Triggered = side === 'buy' ? curPrice >= tp2Price : curPrice <= tp2Price;
        if (tp2Triggered) {
          const sellQty = Math.max(1, Math.round(curQty * 0.667)); // ~40% of original
          await apPost('/v2/orders', {
            symbol: alpSym, qty: String(sellQty),
            side: exitSide, type: 'market', time_in_force: tf,
          });

          // Update SL for the trailing 20%
          if (currentSlOrderId) await apDelete(currentSlOrderId).catch(() => {});
          const remQty = Math.round(curQty - sellQty);
          if (remQty > 0) {
            const trailSl = (swingRef - m * ATR_TP1 * atrVal).toFixed(isCrypto ? 4 : 2);
            const newSl = await apPost('/v2/orders', {
              symbol: alpSym, qty: String(remQty),
              side: exitSide, type: 'stop', stop_price: trailSl, time_in_force: tf,
            });
            currentSlOrderId = newSl.id;
          }

          tp2Hit = true;
          console.log(`🎯 ${symbol} TP2 → sold ${sellQty} shares @ ~$${curPrice.toFixed(2)}`);
          await notify(
            `🎯 TP2 HIT ${symbol}`,
            `Sold 40% more (${sellQty} shares) @ $${curPrice.toFixed(2)}\n` +
            `+${ATR_TP2}×ATR from entry\nTrailing 20% (~${Math.round(curQty - sellQty)} shares)`,
            'high', 'white_check_mark'
          );
        }
      }

      // ── Stage: Trail remaining 20% ────────────────────────────────────────
      if (tp2Hit) {
        const trailStop  = swingRef - m * ATR_TP1 * atrVal;
        const trailHit   = side === 'buy' ? curPrice <= trailStop : curPrice >= trailStop;
        if (trailHit) {
          if (currentSlOrderId) await apDelete(currentSlOrderId).catch(() => {});
          await apPost('/v2/orders', {
            symbol: alpSym, qty: String(Math.round(curQty)),
            side: exitSide, type: 'market', time_in_force: tf,
          });
          await notify(
            `🏁 TRAIL EXIT ${symbol}`,
            `Sold remaining ~20% (${Math.round(curQty)} shares) @ $${curPrice.toFixed(2)}\n` +
            `Swing ref: $${swingRef.toFixed(2)} | Trail: $${trailStop.toFixed(2)}`,
            'high', 'checkered_flag'
          );
          console.log(`🏁 ${symbol} trail exit @ $${curPrice.toFixed(2)}`);
          return;
        }
      }

      // ── Time stop ────────────────────────────────────────────────────────
      if (checkCount >= TIME_STOP_BARS * 2) { // 2 checks per bar (30s each, bars ~1hr)
        if (!tp1Hit) {
          if (currentSlOrderId) await apDelete(currentSlOrderId).catch(() => {});
          await apPost('/v2/orders', {
            symbol: alpSym, qty: String(Math.round(curQty)),
            side: exitSide, type: 'market', time_in_force: tf,
          });
          await notify(
            `⏱️ TIME STOP ${symbol}`,
            `Exited after ${Math.round(checkCount / 2)} bars — no TP hit\nPrice: $${curPrice.toFixed(2)} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct}%)`,
            'default', 'alarm_clock'
          );
          console.log(`⏱️ ${symbol} time stop @ $${curPrice.toFixed(2)}`);
          return;
        }
      }

      // Log every 10 min
      if (checkCount % 20 === 0) {
        const stage = tp2Hit ? 'trailing 20%' : tp1Hit ? 'TP2 zone' : beMoved ? 'at breakeven' : 'TP1 zone';
        console.log(`[${Math.round(checkCount * 0.5)}min] ${symbol} @ $${curPrice.toFixed(2)} | P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct}%) | ${stage}`);
      }

    } catch(e) { console.error(`Monitor ${symbol}:`, e.message); }
  }

  console.log(`⏱️ ${symbol} monitor 6h timeout`);
}

// ── Crypto SL monitor (passive check each scan cycle) ─────────────────────────
async function checkCryptoSL() {
  const positions = await apGet(ALP_URL + '/v2/positions');
  if (!Array.isArray(positions)) return;

  for (const pos of positions) {
    const sym = pos.symbol;
    const cfg = Object.entries(UNIVERSE).find(([k]) => k.replace('/', '') === sym && UNIVERSE[k].type === 'crypto');
    if (!cfg) continue;

    const pnlPct = parseFloat(pos.unrealized_plpc) * 100;
    const bars   = await getBars(cfg[0], 20).catch(() => []);
    const slPct  = bars.length >= 15 ? (atrCalc(bars) * ATR_SL / parseFloat(pos.avg_entry_price) * 100) : 2.0;

    if (pnlPct <= -slPct) {
      const open = await apGet(`${ALP_URL}/v2/orders?status=open&symbols=${sym}`);
      if (Array.isArray(open)) {
        for (const o of open) await apDelete(o.id).catch(() => {});
      }
      await apPost('/v2/orders', { symbol: cfg[0], qty: pos.qty, side: 'sell', type: 'market', time_in_force: 'gtc' });
      await notify(
        `⛔ CRYPTO SL HIT ${sym}`,
        `Stopped at ${pnlPct.toFixed(2)}% loss\nSold ${pos.qty} ${sym} at market\nATR SL was -${slPct.toFixed(2)}%`,
        'urgent', 'stop_sign'
      );
    }
  }
}

// ── Main scan ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Scan:', new Date().toISOString(), '===');
  const day = new Date().getUTCDay();
  if (day === 0 || day === 6) console.log('Weekend — crypto only');

  await checkFilledOrders();
  await checkCryptoSL();

  const hour = new Date().getUTCHours();
  if (hour === 0) await runBacktests();

  // G4: Check daily loss limit before scanning
  const g4 = await riskGate();
  if (!g4.pass) {
    console.log(`G4 HALT: ${g4.reason}`);
    await notify('⛔ DAILY LOSS LIMIT — SCANNING HALTED', g4.reason, 'urgent', 'stop_sign');
    return;
  }

  let signals = 0;
  const summaryLines = [];

  for (const [symbol, cfg] of Object.entries(UNIVERSE)) {
    try {
      if (cfg.type === 'stock' && (day === 0 || day === 6)) continue;
      if (await alreadyTraded(symbol)) { process.stdout.write('_'); continue; }

      // Fetch execution (1-hour) and daily bars in parallel
      const [bars, dailyBars] = await Promise.all([
        getBars(symbol, 150, '1Hour'),
        getBars(symbol, 300, '1Day'),
      ]);
      if (bars.length < 55) { process.stdout.write('?'); continue; }

      const sig  = check(bars, dailyBars);
      const g1   = regimeGate(bars);
      const last = bars[bars.length - 1];

      // Summary line (shows why each symbol is passing/blocked)
      const arrow = sig
        ? (sig.side === 'buy' ? '🟢' : '🔴')
        : (!g1.pass ? '⛔' : '→');
      const closes = bars.map(b => b.c);
      const rsi    = rsiCalc(closes);
      summaryLines.push(
        `${arrow} ${symbol.replace('/','').padEnd(8)} $${last.c.toFixed(2)} ADX:${g1.adx} CI:${g1.ci} ATR%:${g1.atrPct.toFixed(0)} RSI:${Math.round(rsi)}`
      );

      if (!sig) { process.stdout.write('.'); continue; }

      signals++;
      const dir    = sig.side === 'buy' ? 'LONG' : 'SHORT';
      const m_     = sig.side === 'buy' ? 1 : -1;
      const slPx   = (sig.price - m_ * ATR_SL  * sig.atr).toFixed(2);
      const tp1Px  = (sig.price + m_ * ATR_TP1 * sig.atr).toFixed(2);
      const tp2Px  = (sig.price + m_ * ATR_TP2 * sig.atr).toFixed(2);
      const slPct  = +(ATR_SL  * sig.atr / sig.price * 100).toFixed(2);
      const tp1Pct = +(ATR_TP1 * sig.atr / sig.price * 100).toFixed(2);
      const tp2Pct = +(ATR_TP2 * sig.atr / sig.price * 100).toFixed(2);
      const tag    = cfg.risk === 'high' ? '⚠️ HIGH-RISK' : '✅ LOW-RISK';
      const sizeNote = sig.regime.sizeReduction < 1 ? ' (50% size — high vol)' : '';

      console.log(`\n🚦 ${symbol} ${dir} @$${sig.price} | Score ${sig.entryScore}/6 | ATR $${sig.atr.toFixed(3)} | SL $${slPx} | TP1 $${tp1Px} | TP2 $${tp2Px}`);

      await notify(
        `${tag} ${dir} ${symbol} @ $${sig.price}`,
        `🚦 ALL 4 GATES PASSED\n\n` +
        `G1 Regime:  ADX ${sig.regime.adx} | CI ${sig.regime.ci} | ATR% ${sig.regime.atrPct.toFixed(0)}\n` +
        `G2 Daily:   ${sig.daily.bullish ? '📈' : '📉'} SMA50 $${sig.daily.sma50} | SMA200 $${sig.daily.sma200}\n` +
        `G3 Score:   ${sig.entryScore}/6 (Trend ${sig.trendScore}/3 · Mom ${sig.momentumScore}/3)\n` +
        `   Trend:  EMA-struct ${sig.T1 ? '✓' : '✗'} · Slope ${sig.T2 ? '✓' : '✗'} · Above-EMA50 ${sig.T3 ? '✓' : '✗'}\n` +
        `   Mom:    MACD-accel ${sig.M1 ? '✓' : '✗'} · RSI ${Math.round(sig.rsi)} ${sig.M2 ? '✓' : '✗'} · Volume ${sig.M3 ? '✓' : '✗'}\n` +
        `G4 Risk:    OK (${g4.slHits || 0}/${MAX_SL_DAY} SL hits today)\n\n` +
        `Entry:  $${sig.price}\n` +
        `SL:     $${slPx}  (−${slPct}% = ${ATR_SL}×ATR)\n` +
        `TP1:    $${tp1Px}  (+${tp1Pct}% = ${ATR_TP1}×ATR)  → exit 40%\n` +
        `TP2:    $${tp2Px}  (+${tp2Pct}% = ${ATR_TP2}×ATR)  → exit 40%\n` +
        `Trail:  remaining 20% from swing high\n` +
        `Size:   1% equity risk${sizeNote}`,
        'high', 'rotating_light'
      );

      // Place order
      const fn = cfg.type === 'crypto' ? placeCryptoOrder : placeStockOrder;
      const { order, qty, equity, slPx: filledSl, slOrderId } = await fn(
        symbol, sig.side, sig.price, sig.atr, sig.regime.sizeReduction
      );

      if (order.id) {
        await notify(
          `ORDER PLACED ${symbol} ${dir}`,
          `${sig.side.toUpperCase()} ${qty} ${cfg.type === 'crypto' ? 'units' : 'shares'} @ $${sig.price}\n` +
          `SL: $${filledSl} | TP1: $${tp1Px} | TP2: $${tp2Px}\n` +
          `Equity: $${parseFloat(equity).toFixed(2)} | Risk: 1% ($${(equity * RISK_PCT).toFixed(2)})\n` +
          `Order ID: ${order.id}`,
          'high', 'package'
        );
        console.log(symbol, 'order placed:', order.id, '| qty:', qty, '| equity: $' + parseFloat(equity).toFixed(2));

        // Monitor with 3-stage exit until position closes
        await monitorTrade(symbol, sig.side, sig.price, sig.atr, qty, cfg.type === 'crypto', slOrderId);

        console.log(`\n✅ ${symbol} trade complete — resuming scan next cycle`);
        break;
      } else {
        await notify(`ORDER FAILED ${symbol}`, order.message || JSON.stringify(order), 'urgent', 'x');
        console.error(symbol, 'order failed:', order.message);
      }

    } catch(e) { console.error('\n' + symbol, 'error:', e.message); }
  }

  // Hourly summary push
  console.log(`\n=== Done. Signals: ${signals} ===`);
  const etTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true });
  const header = signals > 0 ? `🔔 ${signals} SIGNAL(S) FIRED` : '📊 No signals this hour';
  await notify(
    `Scan ${etTime} | ${signals} signal${signals === 1 ? '' : 's'}`,
    header + '\n\n' + summaryLines.join('\n') + '\n\n' +
    `🟢=BUY  🔴=SELL  ⛔=Regime blocked  →=No signal\n` +
    `Framework: G1(Regime) × G2(Daily) × G3(Score≥4) × G4(Risk)\n` +
    `SL=${ATR_SL}×ATR | TP1=${ATR_TP1}×ATR | TP2=${ATR_TP2}×ATR`,
    signals > 0 ? 'high' : 'low',
    signals > 0 ? 'bell' : 'chart_with_upwards_trend'
  );
}

process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
process.on('uncaughtException',  err => console.error('[uncaughtException]',  err));

main();

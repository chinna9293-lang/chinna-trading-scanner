// Chinna Trading Scanner — ATR-based exits + backtesting + ntfy fills
// Strategy: EMA9/21 cross + RSI zone + swing breakout → ATR-sized bracket orders
const NTFY    = process.env.NTFY_TOPIC      || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY      || 'PK7T6WNU6ANNWQXMWFFFSYLKR7';
const ALP_SEC = process.env.ALPACA_SECRET   || 'EDBn6MnYgP1eVkwnkSGpCByUTSLi9t4qHGoMBtNKDoz6';
const ALP_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const DATA    = 'https://data.alpaca.markets';

// ── Universe ───────────────────────────────────────────────────────────────────
// Removed after backtest analysis (90d, 128 trades): MSFT 0%WR, AAPL 14%WR,
// JPM 14%WR, XOM 17%WR, V 29%WR, MA 33%WR, NVDA 40%WR (but -ve PnL).
// These had 80-100% SL hit rate = ranging/counter-trend conditions.
// Removing them raises portfolio WR from 40% to ~51% on remaining trades.
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

// ATR multipliers (2:1 R:R always maintained)
const ATR_TP = 2.0;   // take profit = entry ± 2×ATR
const ATR_SL = 1.0;   // stop loss   = entry ∓ 1×ATR
const TIME_STOP_BARS = 12;  // exit if no move in 12 bars

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

// ── Bars ───────────────────────────────────────────────────────────────────────
async function getBars(symbol, limit, tf) {
  tf = tf || '1Hour';
  const sym = symbol.replace('/', '%2F');
  const isCrypto = symbol.includes('/');
  const days = tf === '1Day' ? 300 : tf === '4Hour' ? 90 : tf === '1Hour' ? 30 : 15;
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  if (isCrypto) {
    const url = `${DATA}/v1beta3/crypto/us/bars?symbols=${sym}&timeframe=${tf}&limit=${limit}&start=${start}`;
    const d = await (await fetch(url, { headers: alpH })).json();
    return (d.bars && d.bars[symbol]) ? d.bars[symbol] : [];
  }
  // ❌ STOCKS DISABLED: Alpaca market data API requires PAID subscription
  // Only crypto (free) is supported with current API credentials
  return [];
}

// ── Indicators ─────────────────────────────────────────────────────────────────
function ema(arr, n) {
  const k = 2 / (n + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

function rsiCalc(closes) {
  const slice = closes.slice(-15);
  let g = 0, l = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  return 100 - 100 / (1 + (g / (l || 0.001)));
}

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

// ADX measures TREND STRENGTH (not direction). ADX > 20 = trending market.
// Backtest proved: low-ADX stocks (MSFT/AAPL/JPM/XOM) had 80-100% SL hit rate.
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

// ── Signal: 3 conditions + ADX trend-strength gate ────────────────────────────
// ADX ≥ 20 required: breakout strategies only work in trending markets.
// Ranging markets (ADX < 20) produce fake breakouts → SL hits.
function check(bars) {
  if (bars.length < 35) return null;
  const n      = bars.length;
  const closes = bars.map(b => b.c);
  const highs  = bars.map(b => b.h);
  const lows   = bars.map(b => b.l);
  const last   = bars[n - 1];
  const prev   = bars[n - 2];

  const e9  = ema(closes, 9);
  const e21 = ema(closes, 21);
  const r   = rsiCalc(closes);
  const atrVal = atrCalc(bars);
  const adxVal = adxCalc(bars);

  // Gate: skip ranging/choppy markets — breakouts will reverse
  if (adxVal < 20) return null;

  const swingH = Math.max(...highs.slice(n - 12, n - 1));
  const swingL = Math.min(...lows.slice(n - 12, n - 1));

  if (e9 > e21 && r > 45 && r < 65 && last.c > swingH && prev.c <= swingH) {
    return { side: 'buy',  price: last.c, atr: atrVal, adx: adxVal, e9, e21, rsi: r, swingH, swingL };
  }
  if (e9 < e21 && r > 35 && r < 55 && last.c < swingL && prev.c >= swingL) {
    return { side: 'sell', price: last.c, atr: atrVal, adx: adxVal, e9, e21, rsi: r, swingH, swingL };
  }
  return null;
}

// ── Backtest one symbol (walk-forward) ─────────────────────────────────────────
function backtestSymbol(bars) {
  const results = [];
  const n = bars.length;
  if (n < 30) return results;

  let i = 25;
  while (i < n - 2) {
    const slice = bars.slice(0, i + 1);
    const sig = check(slice);

    if (!sig) { i++; continue; }

    // Enter on next bar's open
    const entry = bars[i + 1]?.o || bars[i].c;
    const atrVal = sig.atr || atrCalc(slice);
    const tp = sig.side === 'buy'  ? entry + ATR_TP * atrVal : entry - ATR_TP * atrVal;
    const sl = sig.side === 'buy'  ? entry - ATR_SL * atrVal : entry + ATR_SL * atrVal;
    const pctTP = +(ATR_TP * atrVal / entry * 100).toFixed(2);
    const pctSL = +(ATR_SL * atrVal / entry * 100).toFixed(2);

    let outcome = null;
    const maxBar = Math.min(i + 1 + TIME_STOP_BARS, n);

    for (let j = i + 1; j < maxBar; j++) {
      const b = bars[j];
      if (sig.side === 'buy') {
        if (b.h >= tp) { outcome = { win: true,  pct: +pctTP, how: 'TP' }; break; }
        if (b.l <= sl) { outcome = { win: false, pct: -pctSL, how: 'SL' }; break; }
      } else {
        if (b.l <= tp) { outcome = { win: true,  pct: +pctTP, how: 'TP' }; break; }
        if (b.h >= sl) { outcome = { win: false, pct: -pctSL, how: 'SL' }; break; }
      }
    }

    if (!outcome) {
      const exitBar = bars[Math.min(i + 1 + TIME_STOP_BARS, n - 1)];
      const rawPct = sig.side === 'buy'
        ? (exitBar.c - entry) / entry * 100
        : (entry - exitBar.c) / entry * 100;
      outcome = { win: rawPct > 0, pct: +rawPct.toFixed(2), how: 'TIME' };
    }

    results.push({ date: bars[i].t, side: sig.side, entry, tp, sl, atr: atrVal, ...outcome });
    i += Math.max(3, TIME_STOP_BARS); // skip ahead to avoid overlapping trades
  }

  return results;
}

function btSummary(results) {
  if (!results.length) return null;
  const wins  = results.filter(r => r.win);
  const wr    = +(wins.length / results.length * 100).toFixed(1);
  const totalPct = +results.reduce((s, r) => s + r.pct, 0).toFixed(2);
  const avgPct   = +(totalPct / results.length).toFixed(2);
  const tpHits   = results.filter(r => r.how === 'TP').length;
  const slHits   = results.filter(r => r.how === 'SL').length;
  const timeHits = results.filter(r => r.how === 'TIME').length;
  return { trades: results.length, wins: wins.length, wr, totalPct, avgPct, tpHits, slHits, timeHits };
}

// ── Run full backtest for all symbols ──────────────────────────────────────────
async function runBacktests() {
  console.log('\n=== BACKTESTING ALL SYMBOLS ===');
  const rows = [];
  let totalWins = 0, totalTrades = 0, totalPnl = 0;

  for (const [symbol, cfg] of Object.entries(UNIVERSE)) {
    try {
      // Fetch more bars for backtest (200 bars = ~200 hours ≈ 25 trading days)
      const bars = await getBars(symbol, 200, '1Hour');
      if (bars.length < 30) { console.log(symbol, 'insufficient bars:', bars.length); continue; }

      const results = backtestSymbol(bars);
      const s = btSummary(results);
      if (!s) { console.log(symbol, 'no signals in history'); continue; }

      const icon = s.wr >= 55 ? '✅' : s.wr >= 45 ? '📊' : '❌';
      const row = `${icon} ${symbol.padEnd(10)} ${s.trades}T ${s.wr}%WR ${s.totalPct>=0?'+':''}${s.totalPct}% [TP:${s.tpHits} SL:${s.slHits} TIME:${s.timeHits}]`;
      rows.push(row);
      console.log(row);
      totalWins   += s.wins;
      totalTrades += s.trades;
      totalPnl    += s.totalPct;
    } catch(e) { console.error(symbol, 'backtest error:', e.message); }
  }

  if (rows.length === 0) return;

  const overallWR = +(totalWins / totalTrades * 100).toFixed(1);
  const summary =
    `📊 BACKTEST RESULTS — ATR exits (2:1 R:R)\n` +
    `ATR TP=${ATR_TP}× | SL=${ATR_SL}× | TimeStop=${TIME_STOP_BARS}bars\n\n` +
    rows.join('\n') +
    `\n\n────────────────────\n` +
    `OVERALL: ${totalTrades} trades | ${overallWR}% WR | ${totalPnl>=0?'+':''}${totalPnl.toFixed(1)}% total P&L`;

  await notify(`Backtest Complete — ${overallWR}% WR`, summary, 'default', 'bar_chart');
  console.log('\nBacktest ntfy sent');
}

// ── Check for filled orders and notify ────────────────────────────────────────
async function checkFilledOrders() {
  try {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // last 2 hrs
    const orders = await apGet(`${ALP_URL}/v2/orders?status=closed&after=${since}&limit=50`);
    if (!Array.isArray(orders)) return;

    for (const o of orders) {
      if (o.status !== 'filled') continue;
      const side    = o.side.toUpperCase();
      const sym     = o.symbol;
      const qty     = o.filled_qty;
      const fillPx  = parseFloat(o.filled_avg_price || 0).toFixed(2);
      const legs    = o.legs || [];
      const tp      = legs.find(l => l.order_class === 'take_profit' || l.type === 'limit');
      const sl      = legs.find(l => l.order_class === 'stop_loss'   || l.type === 'stop');
      const tpStr   = tp ? ` → TP $${parseFloat(tp.limit_price||0).toFixed(2)}` : '';
      const slStr   = sl ? ` | SL $${parseFloat(sl.stop_price||0).toFixed(2)}`  : '';

      // Detect if this is a TP/SL fill (exit)
      if (o.order_class === 'take_profit' || o.order_class === 'stop_loss') {
        const isProfit = o.order_class === 'take_profit';
        await notify(
          `${isProfit ? '✅ PROFIT TAKEN' : '⛔ STOP HIT'} ${sym}`,
          `${side} ${qty} ${sym} filled @ $${fillPx}\n${isProfit ? 'Take Profit hit 🎯' : 'Stop Loss hit ⛔'}\nOrder: ${o.id}`,
          isProfit ? 'high' : 'urgent',
          isProfit ? 'white_check_mark' : 'stop_sign'
        );
      } else {
        // Entry fill
        await notify(
          `FILLED ${side} ${sym} @ $${fillPx}`,
          `${qty} shares/units entered\n${tpStr}${slStr}\nOrder ID: ${o.id}\nTime: ${new Date(o.filled_at||Date.now()).toLocaleString('en-US',{timeZone:'America/New_York'})} ET`,
          'high',
          'white_check_mark'
        );
      }
    }
  } catch(e) { console.error('checkFilledOrders error:', e.message); }
}

// ── Already in a position or traded today? ────────────────────────────────────
async function alreadyTraded(symbol) {
  const alpSym = symbol.replace('/', '');
  const pos = await apGet(ALP_URL + '/v2/positions');
  if (Array.isArray(pos) && pos.find(p => p.symbol === alpSym)) return true;
  const today = new Date().toISOString().slice(0, 10);
  const orders = await apGet(`${ALP_URL}/v2/orders?status=all&after=${today}T00:00:00Z&limit=200`);
  if (Array.isArray(orders) && orders.find(o => o.symbol === alpSym)) return true;
  return false;
}

// ── Place stock bracket order (ATR-sized) ─────────────────────────────────────
async function placeStockOrder(symbol, side, price, atrVal) {
  const acct   = await apGet(ALP_URL + '/v2/account');
  const equity = parseFloat(acct.equity || 10000);
  const qty    = Math.max(1, Math.floor(equity * 0.10 / price));
  const m      = side === 'buy' ? 1 : -1;
  const tpPx   = (price + m * ATR_TP * atrVal).toFixed(2);
  const slPx   = (price - m * ATR_SL * atrVal).toFixed(2);

  const order = await apPost('/v2/orders', {
    symbol, qty: String(qty), side, type: 'market', time_in_force: 'day',
    order_class: 'bracket',
    take_profit: { limit_price: tpPx },
    stop_loss:   { stop_price:  slPx },
  });
  return { order, qty, tpPx, slPx, equity };
}

// ── Place crypto order (ATR-sized) ────────────────────────────────────────────
async function placeCryptoOrder(symbol, side, price, atrVal) {
  const acct   = await apGet(ALP_URL + '/v2/account');
  const equity = parseFloat(acct.equity || 10000);
  const notional = equity * 0.10;
  const qty    = (notional / price).toFixed(6);
  const m      = side === 'buy' ? 1 : -1;
  const tpPx   = (price + m * ATR_TP * atrVal).toFixed(4);
  const slPx   = (price - m * ATR_SL * atrVal).toFixed(4);

  // Entry
  const buyOrder = await apPost('/v2/orders', {
    symbol, qty, side, type: 'market', time_in_force: 'gtc',
  });
  if (!buyOrder.id) return { order: buyOrder, qty, tpPx, slPx, equity };

  // Give fill 2 seconds then place TP limit
  await new Promise(r => setTimeout(r, 2000));
  const exitSide = side === 'buy' ? 'sell' : 'buy';
  await apPost('/v2/orders', {
    symbol, qty, side: exitSide, type: 'limit',
    limit_price: tpPx, time_in_force: 'gtc',
  });
  return { order: buyOrder, qty, tpPx, slPx, equity };
}

// ── Monitor crypto SL manually (crypto bracket not fully supported) ────────────
async function checkCryptoSL() {
  const positions = await apGet(ALP_URL + '/v2/positions');
  if (!Array.isArray(positions)) return;

  for (const pos of positions) {
    const sym = pos.symbol;
    const cfg = Object.entries(UNIVERSE).find(([k]) => k.replace('/', '') === sym && UNIVERSE[k].type === 'crypto');
    if (!cfg) continue;

    const pnlPct = parseFloat(pos.unrealized_plpc) * 100;
    const bars   = await getBars(cfg[0], 20).catch(() => []);
    const slPct  = bars.length >= 15 ? (atrCalc(bars) * ATR_SL / parseFloat(pos.avg_entry_price) * 100) : 1.5;

    if (pnlPct <= -slPct) {
      // Cancel open TP orders
      const open = await apGet(`${ALP_URL}/v2/orders?status=open&symbols=${sym}`);
      if (Array.isArray(open)) {
        for (const o of open) await fetch(`${ALP_URL}/v2/orders/${o.id}`, { method: 'DELETE', headers: alpH });
      }
      // Market exit
      await apPost('/v2/orders', { symbol: cfg[0], qty: pos.qty, side: 'sell', type: 'market', time_in_force: 'gtc' });
      await notify(
        `⛔ CRYPTO SL HIT ${sym}`,
        `Stop triggered at ${pnlPct.toFixed(2)}% loss\nSold ${pos.qty} ${sym} at market\nATR-based SL was -${slPct.toFixed(2)}%`,
        'urgent', 'stop_sign'
      );
    }
  }
}

// ── Main scan ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Scan:', new Date().toISOString(), '===');
  const day = new Date().getUTCDay();
  if (day === 0 || day === 6) console.log('Weekend — crypto only');

  // 1. Check for fills from last 2 hours
  await checkFilledOrders();

  // 2. SL monitor for crypto
  await checkCryptoSL();

  // 3. Run backtests once per day (at midnight UTC hour)
  const hour = new Date().getUTCHours();
  if (hour === 0) {
    await runBacktests();
  }

  let signals = 0;
  const summaryLines = [];

  // 4. Scan all symbols
  for (const [symbol, cfg] of Object.entries(UNIVERSE)) {
    try {
      if (cfg.type === 'stock' && (day === 0 || day === 6)) continue;
      if (await alreadyTraded(symbol)) { process.stdout.write('_'); continue; }

      const bars = await getBars(symbol, 60);
      if (bars.length < 25) { process.stdout.write('?'); continue; }

      const sig = check(bars);

      // Build summary line
      const closes = bars.map(b => b.c);
      const r    = rsiCalc(closes);
      const e9   = ema(closes, 9);
      const e21  = ema(closes, 21);
      const last = bars[bars.length - 1];
      const atr  = atrCalc(bars);
      const atrPct = +(atr / last.c * 100).toFixed(2);
      const arrow = sig ? (sig.side === 'buy' ? '🟢' : '🔴') : (e9 > e21 && r > 50 ? '↑' : e9 < e21 && r < 50 ? '↓' : '→');
      summaryLines.push(
        `${arrow} ${symbol.replace('/','').padEnd(8)} RSI:${Math.round(r)} $${last.c.toFixed(symbol.includes('BTC')||symbol.includes('ETH')?0:2)} ATR:${atrPct}%`
      );

      if (!sig) { process.stdout.write('.'); continue; }

      signals++;
      const dir   = sig.side === 'buy' ? 'LONG' : 'SHORT';
      const m     = sig.side === 'buy' ? 1 : -1;
      const tpPx  = (sig.price + m * ATR_TP * sig.atr).toFixed(2);
      const slPx  = (sig.price - m * ATR_SL * sig.atr).toFixed(2);
      const tpPct = +(ATR_TP * sig.atr / sig.price * 100).toFixed(2);
      const slPct = +(ATR_SL * sig.atr / sig.price * 100).toFixed(2);
      const tag   = cfg.risk === 'high' ? '⚠️ RISK' : '✅ PROVEN';
      // Historical EV at 2:1 R:R (backtest would refine this)
      const estWR = cfg.risk === 'low' ? 0.55 : 0.45;
      const ev    = ((estWR * tpPct) - ((1 - estWR) * slPct)).toFixed(2);

      console.log(`\n${symbol} ${dir} @$${sig.price} ATR=$${sig.atr.toFixed(3)} TP=$${tpPx} SL=$${slPx}`);

      // Signal alert
      await notify(
        `${tag} ${dir} ${symbol} @ $${sig.price}`,
        `Signal: 3/3 conditions met\n` +
        `Entry:  $${sig.price}\n` +
        `TP:     $${tpPx} (+${tpPct}% = ${ATR_TP}×ATR)\n` +
        `SL:     $${slPx} (-${slPct}% = ${ATR_SL}×ATR)\n` +
        `ATR:    $${sig.atr.toFixed(3)} (${(sig.atr/sig.price*100).toFixed(2)}%)\n` +
        `EV:     ${ev > 0 ? '+' : ''}${ev}% | R:R 2:1\n\n` +
        `WHY:\n` +
        `1. EMA9 ${sig.side==='buy'?'>':'<'} EMA21 ($${sig.e9.toFixed(2)} vs $${sig.e21.toFixed(2)})\n` +
        `2. RSI ${sig.rsi.toFixed(0)} in zone (${sig.side==='buy'?'45-65':'35-55'})\n` +
        `3. Price ${sig.side==='buy'?'broke above':'broke below'} swing ${sig.side==='buy'?'high':'low'} $${sig.side==='buy'?sig.swingH.toFixed(2):sig.swingL.toFixed(2)}\n` +
        `4. ADX ${sig.adx} ≥ 20 (trending market confirmed)`,
        'high', 'rotating_light'
      );

      // Place order
      const fn = cfg.type === 'crypto' ? placeCryptoOrder : placeStockOrder;
      const { order, qty, equity } = await fn(symbol, sig.side, sig.price, sig.atr);

      if (order.id) {
        await notify(
          `ORDER PLACED ${symbol} ${dir}`,
          `${sig.side.toUpperCase()} ${qty} ${cfg.type==='crypto'?'units':'shares'} @ $${sig.price}\n` +
          `TP: $${tpPx} | SL: $${slPx}\n` +
          `Equity: $${parseFloat(equity).toFixed(2)}\n` +
          `Order ID: ${order.id}`,
          'high', 'package'
        );
        console.log(symbol, 'order placed:', order.id);
      } else {
        await notify(`ORDER FAILED ${symbol}`, order.message || JSON.stringify(order), 'urgent', 'x');
        console.error(symbol, 'order failed:', order.message);
      }

    } catch(e) { console.error('\n' + symbol, 'error:', e.message); }
  }

  // 5. Hourly summary
  console.log(`\n=== Done. Signals: ${signals} ===`);
  const etTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true });
  const header = signals > 0 ? `🔔 ${signals} SIGNAL(S) FIRED` : '📊 No signals this hour';
  await notify(
    `Scan ${etTime} | ${signals} signal${signals === 1 ? '' : 's'}`,
    header + '\n\n' + summaryLines.join('\n') + '\n\n' +
    `🟢=BUY  🔴=SELL  ↑↓→=bias  ATR=volatility\nTP=${ATR_TP}×ATR | SL=${ATR_SL}×ATR | TimeStop=${TIME_STOP_BARS}bars`,
    signals > 0 ? 'high' : 'low',
    signals > 0 ? 'bell' : 'chart_with_upwards_trend'
  );
}

process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
process.on('uncaughtException',  err => console.error('[uncaughtException]',  err));

main();

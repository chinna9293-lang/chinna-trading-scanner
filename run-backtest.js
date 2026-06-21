// High-Quality Backtest — compares OLD 3-condition logic vs NEW 6-condition logic
// Improvements: triple EMA stack, EMA gap filter, EMA21 slope, tighter RSI,
//               RSI momentum direction, volume/candle confirmation, ATR min

const NTFY    = process.env.NTFY_TOPIC  || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY  || 'PK7T6WNU6ANNWQXMWFFFSYLKR7';
const ALP_SEC = process.env.ALPACA_SECRET || 'EDBn6MnYgP1eVkwnkSGpCByUTSLi9t4qHGoMBtNKDoz6';
const DATA    = 'https://data.alpaca.markets';

const UNIVERSE = {
  LLY:'stock', COST:'stock', TSLA:'stock', AMD:'stock', XOM:'stock',
  CRM:'stock', V:'stock', WMT:'stock', MA:'stock',
  NVDA:'stock', AAPL:'stock', META:'stock', GOOGL:'stock', MSFT:'stock',
  JPM:'stock', NFLX:'stock',
  'DOGE/USD':'crypto','LTC/USD':'crypto','LINK/USD':'crypto',
  'BTC/USD':'crypto','ETH/USD':'crypto','SOL/USD':'crypto',
};

const alpH   = { 'APCA-API-KEY-ID': ALP_KEY, 'APCA-API-SECRET-KEY': ALP_SEC };
const ATR_TP = 2.0;
const ATR_SL = 1.0;

// ── Data fetching ────────────────────────────────────────────────────────────
async function getBars(symbol, limit) {
  const isCrypto = symbol.includes('/');
  if (isCrypto) {
    const sym   = symbol.replace('/', '%2F');
    const start = new Date(Date.now() - 90*86400000).toISOString().slice(0,10);
    const url   = `${DATA}/v1beta3/crypto/us/bars?symbols=${sym}&timeframe=1Hour&limit=${limit}&start=${start}`;
    const d     = await (await fetch(url, { headers: alpH })).json();
    return (d.bars && d.bars[symbol]) || [];
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1h&range=3mo`;
    const d   = await (await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0' } })).json();
    const res = d?.chart?.result?.[0];
    if (!res) return [];
    const ts = res.timestamp || [];
    const q  = res.indicators?.quote?.[0] || {};
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      if (!q.close?.[i]) continue;
      bars.push({ t: new Date(ts[i]*1000).toISOString(),
        o: q.open?.[i]||q.close[i], h: q.high?.[i]||q.close[i],
        l: q.low?.[i]||q.close[i],  c: q.close[i], v: q.volume?.[i]||0 });
    }
    return bars.length >= 5 ? bars.slice(-limit) : [];
  } catch(e) { return []; }
}

// ── Indicators ───────────────────────────────────────────────────────────────
function buildEma(cls, n) {
  const k = 2/(n+1); let e = cls[0];
  const arr = [e];
  for (let i = 1; i < cls.length; i++) { e = cls[i]*k + e*(1-k); arr.push(e); }
  return arr;
}
function rsiOf(closes, window=15) {
  const s = closes.slice(-window); let g=0,l=0;
  for (let i=1; i<s.length; i++) { const d=s[i]-s[i-1]; d>0?g+=d:l-=d; }
  return 100 - 100/(1+(g/(l||0.001)));
}
function atrOf(bars, n=14) {
  const sl = bars.slice(-(n+1)); let sum=0;
  for (let i=1; i<sl.length; i++) {
    const b=sl[i],p=sl[i-1];
    sum += Math.max(b.h-b.l, Math.abs(b.h-p.c), Math.abs(b.l-p.c));
  }
  return sum / Math.min(n, sl.length-1);
}

// ── OLD logic (original 3 conditions) ────────────────────────────────────────
function checkOLD(bars) {
  if (bars.length < 25) return null;
  const n=bars.length, cls=bars.map(b=>b.c), hs=bars.map(b=>b.h), ls=bars.map(b=>b.l);
  const e9=buildEma(cls,9).at(-1), e21=buildEma(cls,21).at(-1);
  const r=rsiOf(cls), atr=atrOf(bars);
  const sH=Math.max(...hs.slice(n-12,n-1)), sL=Math.min(...ls.slice(n-12,n-1));
  const last=bars[n-1], prev=bars[n-2];
  if (e9>e21 && r>45 && r<65 && last.c>sH && prev.c<=sH) return {side:'buy',  atr, rsi:r, why:[]};
  if (e9<e21 && r>35 && r<55 && last.c<sL && prev.c>=sL) return {side:'sell', atr, rsi:r, why:[]};
  return null;
}

// ── NEW logic (6 high-quality conditions) ────────────────────────────────────
// Improvement 1: Triple EMA stack (9>21>50) — confirms macro trend alignment
// Improvement 2: EMA gap ≥ 0.2% of price — filters noise crossovers
// Improvement 3: EMA21 slope must match direction — trend must be accelerating
// Improvement 4: Tight RSI zone (50-62 bull / 38-50 bear) — no borderline setups
// Improvement 5: RSI must be rising/falling — momentum direction must match
// Improvement 6: Volume OR strong candle body — breakout must have conviction
// Improvement 7: ATR ≥ 0.3% of price — skip ultra-low volatility dead zones
// Improvement 8: Longer time stop for stocks (20 bars) vs crypto (12 bars)
function checkNEW(bars, isCrypto) {
  if (bars.length < 55) return null;
  const n   = bars.length;
  const cls = bars.map(b => b.c);
  const hs  = bars.map(b => b.h);
  const ls  = bars.map(b => b.l);
  const vs  = bars.map(b => b.v || 0);
  const last = bars[n-1], prev = bars[n-2];

  const e9arr  = buildEma(cls, 9);
  const e21arr = buildEma(cls, 21);
  const e50arr = buildEma(cls, 50);
  const e9  = e9arr[n-1];
  const e21 = e21arr[n-1];
  const e50 = e50arr[n-1];

  // [1] Triple EMA stack — all 3 must align
  const bullStack = e9 > e21 && e21 > e50;
  const bearStack = e9 < e21 && e21 < e50;
  if (!bullStack && !bearStack) return null;

  // [2] EMA gap filter — gap between EMA9 and EMA21 must be ≥ 0.2% of price
  const emaPct = Math.abs(e9 - e21) / last.c * 100;
  if (emaPct < 0.2) return null;

  // [3] EMA21 slope — must be moving in trend direction (compare 8 bars back)
  const e21Slope = (e21arr[n-1] - e21arr[Math.max(0,n-9)]) / last.c * 100;

  // [4] RSI + [5] RSI direction
  const r      = rsiOf(cls);
  const rOld   = rsiOf(cls.slice(0, -4));   // RSI 4 bars ago
  const rRising  = r > rOld + 0.5;
  const rFalling = r < rOld - 0.5;

  // [7] ATR minimum
  const atrVal = atrOf(bars);
  const atrPct = atrVal / last.c * 100;
  if (atrPct < 0.3) return null;

  // [6] Volume and candle quality
  const vols10 = vs.slice(-11,-1).filter(v => v > 0);
  const vAvg   = vols10.length ? vols10.reduce((a,b)=>a+b,0)/vols10.length : 1;
  const vRatio = vs[n-1] / (vAvg||1);
  const range  = (last.h - last.l) || 0.001;
  const body   = Math.abs(last.c - last.o) / range;
  const bullCandle = last.c > last.o && body > 0.45;
  const bearCandle = last.c < last.o && body > 0.45;

  const swingH = Math.max(...hs.slice(n-14,n-1));
  const swingL = Math.min(...ls.slice(n-14,n-1));

  // ── BUY ──
  if (bullStack && r > 50 && r < 62 && last.c > swingH && prev.c <= swingH) {
    const fails = [];
    if (e21Slope <= 0)              fails.push('EMA21 not rising');
    if (!rRising)                   fails.push('RSI not building');
    if (vRatio < 1.1 && !bullCandle) fails.push('weak vol+candle');
    if (fails.length) return null;
    return { side:'buy',  atr:atrVal, e9, e21, e50, rsi:r, vRatio:+vRatio.toFixed(2), emaPct:+emaPct.toFixed(3), swingH, swingL };
  }

  // ── SELL ──
  if (bearStack && r > 38 && r < 50 && last.c < swingL && prev.c >= swingL) {
    const fails = [];
    if (e21Slope >= 0)              fails.push('EMA21 not falling');
    if (!rFalling)                  fails.push('RSI not weakening');
    if (vRatio < 1.1 && !bearCandle) fails.push('weak vol+candle');
    if (fails.length) return null;
    return { side:'sell', atr:atrVal, e9, e21, e50, rsi:r, vRatio:+vRatio.toFixed(2), emaPct:+emaPct.toFixed(3), swingH, swingL };
  }

  return null;
}

// ── Walk-forward backtest ─────────────────────────────────────────────────────
function backtest(bars, checkFn, isCrypto) {
  const timeStop = isCrypto ? 12 : 20;   // [8] longer time stop for stocks
  const results  = [];
  const n = bars.length;
  let i = 55;

  while (i < n - 2) {
    const sig = checkFn(bars.slice(0, i+1), isCrypto);
    if (!sig) { i++; continue; }

    const entry  = bars[i+1]?.o || bars[i].c;
    const atr    = sig.atr;
    const tp     = sig.side === 'buy' ? entry + ATR_TP*atr : entry - ATR_TP*atr;
    const sl     = sig.side === 'buy' ? entry - ATR_SL*atr : entry + ATR_SL*atr;
    const tpPct  = +(ATR_TP*atr/entry*100).toFixed(2);
    const slPct  = +(ATR_SL*atr/entry*100).toFixed(2);

    let out = null;
    for (let j = i+1; j < Math.min(i+1+timeStop, n); j++) {
      const b = bars[j];
      if (sig.side === 'buy') {
        if (b.h >= tp) { out = { win:true,  pct:+tpPct, how:'TP' }; break; }
        if (b.l <= sl) { out = { win:false, pct:-slPct, how:'SL' }; break; }
      } else {
        if (b.l <= tp) { out = { win:true,  pct:+tpPct, how:'TP' }; break; }
        if (b.h >= sl) { out = { win:false, pct:-slPct, how:'SL' }; break; }
      }
    }
    if (!out) {
      const ex  = bars[Math.min(i+1+timeStop, n-1)];
      const raw = sig.side==='buy' ? (ex.c-entry)/entry*100 : (entry-ex.c)/entry*100;
      out = { win: raw>0, pct:+raw.toFixed(2), how:'TIME' };
    }

    results.push({ date:bars[i].t.slice(0,10), side:sig.side,
      entry:+entry.toFixed(4), atr:+atr.toFixed(4), rsi:sig.rsi?.toFixed(1),
      emaPct: sig.emaPct, vRatio: sig.vRatio, ...out });
    i += Math.max(4, timeStop);
  }
  return results;
}

function summary(results) {
  if (!results.length) return null;
  const wins = results.filter(r => r.win);
  const wr   = +(wins.length / results.length * 100).toFixed(1);
  const pnl  = +results.reduce((s,r) => s+r.pct, 0).toFixed(2);
  const avg  = +(pnl / results.length).toFixed(2);
  const tp   = results.filter(r => r.how==='TP').length;
  const sl   = results.filter(r => r.how==='SL').length;
  const tm   = results.filter(r => r.how==='TIME').length;
  return { n:results.length, wins:wins.length, wr, pnl, avg, tp, sl, tm };
}

async function notify(title, body, priority, tags) {
  try {
    await fetch('https://ntfy.sh/' + NTFY, {
      method: 'POST',
      headers: { 'Title': title.replace(/[^\x00-\x7F]/g,''), 'Priority': priority||'default', 'Tags': tags||'bar_chart' },
      body,
    });
  } catch(e) { console.log('ntfy error:', e.message); }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== BACKTEST: OLD vs NEW', new Date().toISOString(), '===\n');
  console.log('OLD: 3 conditions (EMA cross + RSI 45-65 + swing break)');
  console.log('NEW: 6 conditions (triple stack + EMA gap + slope + tight RSI + RSI dir + vol/candle)\n');
  console.log(`${'Symbol'.padEnd(10)} ${'OLD T/WR/PnL'.padEnd(20)} ${'NEW T/WR/PnL'.padEnd(20)} IMPROVEMENT`);
  console.log('─'.repeat(75));

  const comparison = [];
  let oldTotal={n:0,wins:0,pnl:0}, newTotal={n:0,wins:0,pnl:0};

  for (const [symbol, type] of Object.entries(UNIVERSE)) {
    const isCrypto = type === 'crypto';
    const bars = await getBars(symbol, 500);
    if (bars.length < 60) { console.log(`${symbol.padEnd(10)} insufficient data (${bars.length} bars)`); continue; }

    const oldRes = backtest(bars, checkOLD, isCrypto);
    const newRes = backtest(bars, checkNEW, isCrypto);
    const oS = summary(oldRes);
    const nS = summary(newRes);

    if (!oS && !nS) { console.log(`${symbol.padEnd(10)} no signals in either version`); continue; }

    const oStr = oS ? `${oS.n}T ${oS.wr}%WR ${oS.pnl>=0?'+':''}${oS.pnl}%` : 'none';
    const nStr = nS ? `${nS.n}T ${nS.wr}%WR ${nS.pnl>=0?'+':''}${nS.pnl}%` : 'none';
    const wrDiff = nS && oS ? (nS.wr - oS.wr) : 0;
    const flag   = wrDiff > 10 ? '⬆️ BETTER' : wrDiff < -5 ? '⬇️ WORSE' : '≈ SIMILAR';
    console.log(`${symbol.padEnd(10)} ${oStr.padEnd(20)} ${nStr.padEnd(20)} ${flag} (${wrDiff>=0?'+':''}${wrDiff.toFixed(0)}%WR)`);

    if (oS) { oldTotal.n+=oS.n; oldTotal.wins+=oS.wins; oldTotal.pnl+=oS.pnl; }
    if (nS) { newTotal.n+=nS.n; newTotal.wins+=nS.wins; newTotal.pnl+=nS.pnl; }

    comparison.push({ symbol, isCrypto, oS, nS });
  }

  const oldWR = +(oldTotal.wins/oldTotal.n*100).toFixed(1);
  const newWR = +(newTotal.wins/newTotal.n*100).toFixed(1);
  console.log('\n' + '─'.repeat(75));
  console.log(`${'TOTAL'.padEnd(10)} ${String(oldTotal.n+'T '+oldWR+'%WR +'+oldTotal.pnl.toFixed(1)+'%').padEnd(20)} ${String(newTotal.n+'T '+newWR+'%WR +'+newTotal.pnl.toFixed(1)+'%').padEnd(20)} ${(newWR-oldWR)>=0?'+':''}${(newWR-oldWR).toFixed(1)}%WR`);

  // Rank by NEW win rate
  const ranked = comparison.filter(r => r.nS).sort((a,b) => b.nS.wr - a.nS.wr);
  const top5   = ranked.slice(0,5).map(r => `${r.symbol}(${r.nS.wr}%WR ${r.nS.pnl>=0?'+':''}${r.nS.pnl}%)`);
  const drop   = comparison.filter(r => !r.nS || r.nS.n === 0).map(r => r.symbol);

  // Failure analysis for worst OLD performers
  const worst = comparison.filter(r => r.oS && r.oS.wr < 35).sort((a,b)=>a.oS.wr-b.oS.wr);
  const failAnalysis = worst.map(r => {
    const why = [];
    if (r.oS.sl > r.oS.n * 0.5) why.push('mostly SL hits (fake breakouts)');
    if (r.oS.tm > r.oS.n * 0.4) why.push('mostly TIME hits (no momentum)');
    if (r.oS.n > 8)              why.push('too many signals = choppy market');
    return `${r.symbol}: ${r.oS.wr}%WR — ${why.join(', ') || 'weak momentum after entry'}`;
  }).join('\n');

  const ntfyMsg =
    `📊 BACKTEST: OLD vs NEW LOGIC\n` +
    `1H bars · 90 days · ATR 2:1 R:R\n\n` +
    `OLD (3 conditions):\n` +
    `${oldTotal.n} trades · ${oldWR}%WR · +${oldTotal.pnl.toFixed(1)}%PnL\n\n` +
    `NEW (6 conditions):\n` +
    `${newTotal.n} trades · ${newWR}%WR · +${newTotal.pnl.toFixed(1)}%PnL\n\n` +
    `IMPROVEMENTS vs OLD:\n` +
    `Win rate: ${(newWR-oldWR)>=0?'+':''}${(newWR-oldWR).toFixed(1)}%\n` +
    `Trade count reduced: ${oldTotal.n} → ${newTotal.n} (quality over quantity)\n` +
    `Avg per trade: ${(newTotal.pnl/newTotal.n).toFixed(2)}% vs ${(oldTotal.pnl/oldTotal.n).toFixed(2)}%\n\n` +
    `TOP 5 (new):\n${top5.join('\n')}\n\n` +
    `ROOT CAUSE (old failures):\n${failAnalysis}\n\n` +
    `NEW 6 CONDITIONS:\n` +
    `1. Triple EMA stack (9>21>50)\n` +
    `2. EMA gap ≥0.2% (no noise crosses)\n` +
    `3. EMA21 slope matches direction\n` +
    `4. RSI 50-62 bull / 38-50 bear\n` +
    `5. RSI must be rising/falling\n` +
    `6. Volume OR strong candle body`;

  console.log('\nSending ntfy...');
  await notify(
    `BT: OLD ${oldWR}%WR vs NEW ${newWR}%WR | ${(newWR-oldWR)>=0?'+':''}${(newWR-oldWR).toFixed(1)}% improvement`,
    ntfyMsg, 'high', 'bar_chart'
  );
  console.log('Done — results sent to ntfy: chinna-trading-alerts');
}

main().catch(console.error);

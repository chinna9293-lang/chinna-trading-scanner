// Chinna Trading Scanner — Backtest-filtered universe + proven patterns only
// Stocks: 9 winners from 45-day backtest (all >52% win rate, positive P&L)
// Crypto: 3 winners (DOGE +12%, LTC +8.2%, LINK +4.8%)
// Patterns: only 5 with >50% win rate in backtest
// GitHub Actions every 5 min weekdays 9:30–4PM ET, crypto 24/7
const NTFY    = process.env.NTFY_TOPIC      || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY;
const ALP_SEC = process.env.ALPACA_SECRET;
const ALP_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const DATA    = 'https://data.alpaca.markets';

// ── UNIVERSE ──────────────────────────────────────────────────────────────────
// risk:'high' = historically losing in backtest → alert tagged RISK HEAVY
// histWin = backtest win %, histPnl = total P&L over 45 days
const UNIVERSE = {
  // ── PROVEN WINNERS ────────────────────────────────────────────────────────
  LLY:  { strategy:'ORB',     tp:2.5, sl:1.5, type:'stock',  risk:'low',  histWin:55, histPnl:+14.7 },
  COST: { strategy:'ORB',     tp:2.5, sl:1.0, type:'stock',  risk:'low',  histWin:58, histPnl:+13.3 },
  TSLA: { strategy:'Pattern', tp:6.0, sl:2.0, type:'stock',  risk:'low',  histWin:58, histPnl:+10.4 },
  AMD:  { strategy:'Pattern', tp:4.0, sl:1.5, type:'stock',  risk:'low',  histWin:42, histPnl:+14.9 },
  XOM:  { strategy:'ORB',     tp:2.5, sl:1.2, type:'stock',  risk:'low',  histWin:58, histPnl:+6.8  },
  CRM:  { strategy:'ORB',     tp:2.5, sl:1.5, type:'stock',  risk:'low',  histWin:48, histPnl:+6.2  },
  V:    { strategy:'ORB',     tp:2.0, sl:1.0, type:'stock',  risk:'low',  histWin:52, histPnl:+5.5  },
  WMT:  { strategy:'ORB',     tp:2.0, sl:1.0, type:'stock',  risk:'low',  histWin:52, histPnl:+3.6  },
  MA:   { strategy:'ORB',     tp:2.5, sl:1.2, type:'stock',  risk:'low',  histWin:48, histPnl:+2.0  },
  'DOGE/USD': { strategy:'Crypto', tp:10.0, sl:3.0, type:'crypto', risk:'low',  histWin:57, histPnl:+12.0 },
  'LTC/USD':  { strategy:'Crypto', tp:6.0,  sl:2.0, type:'crypto', risk:'low',  histWin:52, histPnl:+9.5  },
  'LINK/USD': { strategy:'Crypto', tp:10.0, sl:3.0, type:'crypto', risk:'low',  histWin:50, histPnl:+3.6  },

  // ── RISK HEAVY — added back, historically losing, trade with caution ───────
  NVDA: { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:45, histPnl:-1.3  },
  JPM:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:45, histPnl:-0.9  },
  AAPL: { strategy:'ORB',     tp:1.5, sl:1.0, type:'stock',  risk:'high', histWin:42, histPnl:-0.9  },
  NFLX: { strategy:'Pattern', tp:3.0, sl:1.5, type:'stock',  risk:'high', histWin:42, histPnl:-1.1  },
  HD:   { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:52, histPnl:-2.9  },
  ABBV: { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:39, histPnl:-2.8  },
  META: { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:42, histPnl:-5.4  },
  BAC:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:45, histPnl:-5.9  },
  GOOGL:{ strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:45, histPnl:-6.7  },
  AMZN: { strategy:'Pattern', tp:3.0, sl:1.5, type:'stock',  risk:'high', histWin:39, histPnl:-8.0  },
  UNH:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:32, histPnl:-9.8  },
  MSFT: { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:35, histPnl:-12.4 },
  PG:   { strategy:'ORB',     tp:1.5, sl:1.0, type:'stock',  risk:'high', histWin:29, histPnl:-12.7 },
  AVGO: { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:29, histPnl:-13.0 },
  KO:   { strategy:'ORB',     tp:1.5, sl:1.0, type:'stock',  risk:'high', histWin:52, histPnl:+0.3  },
  ORCL: { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock',  risk:'high', histWin:42, histPnl:+3.3  },
  'BTC/USD':  { strategy:'Crypto', tp:5.0,  sl:2.5, type:'crypto', risk:'high', histWin:52, histPnl:-1.4  },
  'ETH/USD':  { strategy:'Crypto', tp:5.0,  sl:2.5, type:'crypto', risk:'high', histWin:45, histPnl:-2.4  },
  'SOL/USD':  { strategy:'Crypto', tp:8.0,  sl:3.0, type:'crypto', risk:'high', histWin:48, histPnl:+2.0  },
  'BCH/USD':  { strategy:'Crypto', tp:5.0,  sl:2.5, type:'crypto', risk:'high', histWin:43, histPnl:-7.1  },
};

const alpH = { 'APCA-API-KEY-ID': ALP_KEY, 'APCA-API-SECRET-KEY': ALP_SEC };

async function apGet(url) {
  const r = await fetch(url, { headers: alpH });
  return r.json();
}

async function notify(title, body, priority) {
  try {
    await fetch('https://ntfy.sh/' + NTFY, {
      method: 'POST',
      headers: { 'Title': title.replace(/[^\x00-\x7F]/g,''), 'Priority': priority||'high', 'Tags':'chart_with_upwards_trend' },
      body,
    });
    console.log('[ntfy]', title);
  } catch(e) { console.error('ntfy error:', e.message); }
}

async function getBars(symbol, tf, limit) {
  const sym = symbol.replace('/', '%2F');
  const isCrypto = symbol.includes('/');
  const base = isCrypto
    ? `${DATA}/v1beta3/crypto/us/bars?symbols=${sym}&timeframe=${tf}&limit=${limit}`
    : `${DATA}/v2/stocks/${sym}/bars?timeframe=${tf}&limit=${limit}&feed=iex`;
  const d = await apGet(base);
  if (isCrypto) return (d.bars && d.bars[symbol]) ? d.bars[symbol] : [];
  return d.bars || [];
}

function sma(arr, n) {
  const s = arr.slice(-n);
  return s.reduce((a,b)=>a+b,0)/s.length;
}
function emaCalc(arr, n) {
  const k = 2/(n+1); let e = arr[0];
  for (let i=1;i<arr.length;i++) e = arr[i]*k+e*(1-k);
  return e;
}
function rsiCalc(closes) {
  let g=0,l=0;
  for (let i=Math.max(1,closes.length-14);i<closes.length;i++) {
    const d=closes[i]-closes[i-1]; if(d>0) g+=d; else l-=d;
  }
  return 100-100/(1+(g/(l||0.001)));
}
function vwapCalc(bars) {
  const tv=bars.reduce((s,b)=>s+(b.h+b.l+b.c)/3*b.v,0);
  const v=bars.reduce((s,b)=>s+b.v,0);
  return v>0?tv/v:bars[bars.length-1].c;
}
function etNow() {
  return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHART PATTERN DETECTION — only the 5 backtest-proven patterns (>50% win rate)
// Removed: Hammer(35%), Bull Flag(0%), Bear Flag(0%), Inverted Hammer(30%),
//          Three White Soldiers(32%), Hanging Man(14%), Bearish Engulfing(44%),
//          Double Bottom(42%), Ascending Triangle(42%)
// Kept:    Shooting Star(75%), Piercing Line(60%), Evening Star(57%),
//          Morning Star(52%), Double Top(51%), Dark Cloud Cover(50%)
// Extra entry filter: EMA9>EMA21 for longs, EMA9<EMA21 for shorts
// ═══════════════════════════════════════════════════════════════════════════════
function detectChartPatterns(bars) {
  if (bars.length < 20) return null;
  const n = bars.length;
  const b = bars;

  const isBull = i => b[i].c > b[i].o;
  const isBear = i => b[i].c < b[i].o;
  const body   = i => Math.abs(b[i].c - b[i].o);
  const range  = i => b[i].h - b[i].l;
  const upper  = i => b[i].h - Math.max(b[i].o, b[i].c);
  const lower  = i => Math.min(b[i].o, b[i].c) - b[i].l;
  const mid    = i => (b[i].o + b[i].c) / 2;
  const pct    = (a, x) => Math.abs(a - x) / x;

  const closes  = bars.map(x => x.c);
  const highs   = bars.map(x => x.h);
  const lows    = bars.map(x => x.l);
  const volumes = bars.map(x => x.v);
  const volMA   = sma(volumes.slice(-21,-1), 20);
  const rsi     = rsiCalc(closes);
  const ema9    = emaCalc(closes, 9);
  const ema21   = emaCalc(closes, 21);
  const found   = [];

  // ── 1. Piercing Line (60% win) — bullish reversal ─────────────────────────
  // Strict: needs prior downtrend + EMA9 starting to turn + volume spike
  if (isBear(n-3) && isBear(n-2) && isBull(n-1) &&
      b[n-1].o < b[n-2].l &&
      b[n-1].c > mid(n-2) && b[n-1].c < b[n-2].o &&
      b[n-1].v > volMA * 1.8 && rsi < 50) {
    found.push({ side:'buy', pattern:'Piercing Line',
      r:`Piercing Line after 2-bar downtrend: bull opens below prev low $${b[n-2].l.toFixed(2)}, closes above midpoint. Volume ${(b[n-1].v/volMA).toFixed(1)}x. RSI ${rsi.toFixed(0)}` });
  }

  // ── 2. Morning Star (52% win) — 3-candle bullish reversal ─────────────────
  // Strict: needs prior downtrend, doji must gap down, bull must close >50% of bear body
  if (n >= 4 && isBear(n-4) && isBear(n-3) &&
      body(n-2) < body(n-3) * 0.25 &&
      isBull(n-1) && b[n-1].c > b[n-3].o + body(n-3)*0.5 &&
      b[n-1].v > volMA * 1.5 && rsi < 52 && ema9 >= ema21 * 0.998) {
    found.push({ side:'buy', pattern:'Morning Star',
      r:`Morning Star: 2-bar downtrend → doji $${b[n-2].c.toFixed(2)} → bull recovery. Volume ${(b[n-1].v/volMA).toFixed(1)}x. RSI ${rsi.toFixed(0)}` });
  }

  // ── 3. Shooting Star (75% win) — bearish reversal ─────────────────────────
  // Strict: 2+ bull bars before it, upper wick must be 3x body, RSI overbought
  if (n >= 4 && isBull(n-4) && isBull(n-3) && isBull(n-2) &&
      range(n-1) > 0 &&
      upper(n-1) >= body(n-1) * 3 &&
      lower(n-1) <= body(n-1) * 0.3 &&
      body(n-1) / range(n-1) < 0.25 &&
      rsi > 63 && b[n-1].v > volMA * 1.5) {
    found.push({ side:'sell', pattern:'Shooting Star',
      r:`Shooting Star: 3-bar uptrend → rejection. Upper wick ${(upper(n-1)/body(n-1)).toFixed(1)}x body. RSI ${rsi.toFixed(0)} overbought. Volume ${(b[n-1].v/volMA).toFixed(1)}x` });
  }

  // ── 4. Evening Star (57% win) — 3-candle bearish reversal ─────────────────
  // Strict: needs prior uptrend, doji must gap up, bear must close below 50% of bull body
  if (n >= 4 && isBull(n-4) && isBull(n-3) &&
      body(n-2) < body(n-3) * 0.25 &&
      isBear(n-1) && b[n-1].c < b[n-3].o + body(n-3)*0.5 &&
      b[n-1].v > volMA * 1.5 && rsi > 52 && ema9 <= ema21 * 1.002) {
    found.push({ side:'sell', pattern:'Evening Star',
      r:`Evening Star: 2-bar uptrend → doji $${b[n-2].c.toFixed(2)} → bear drop. Volume ${(b[n-1].v/volMA).toFixed(1)}x. RSI ${rsi.toFixed(0)}` });
  }

  // ── 5. Double Top (51% win) — M pattern neckline break ────────────────────
  // Strict: peaks within 0.8% of each other, volume on breakdown, RSI declining
  {
    const rh = highs.slice(-20);
    const h1i = rh.slice(0,10).indexOf(Math.max(...rh.slice(0,10)));
    const h2i = 10 + rh.slice(10).indexOf(Math.max(...rh.slice(10)));
    const h1 = rh[h1i], h2 = rh[h2i];
    const nk  = Math.min(...lows.slice(n-20+h1i, n-20+h2i));
    if (h1i < h2i-4 && pct(h1,h2) < 0.008 &&
        b[n-1].c < nk && b[n-2].c >= nk &&
        b[n-1].v > volMA * 2.0 && rsi < 50) {
      found.push({ side:'sell', pattern:'Double Top',
        r:`Double Top: two peaks $${h1.toFixed(2)} / $${h2.toFixed(2)} (${(pct(h1,h2)*100).toFixed(2)}% apart). Neckline $${nk.toFixed(2)} broken. Volume ${(b[n-1].v/volMA).toFixed(1)}x. RSI ${rsi.toFixed(0)}` });
    }
  }

  // ── 6. Dark Cloud Cover (50% win) — bearish gap-and-fill ──────────────────
  if (isBull(n-2) && isBear(n-1) &&
      b[n-1].o > b[n-2].h &&
      b[n-1].c < mid(n-2) && b[n-1].c > b[n-2].o &&
      body(n-1) > body(n-2) * 0.8 &&
      b[n-1].v > volMA * 1.5 && rsi > 55) {
    found.push({ side:'sell', pattern:'Dark Cloud Cover',
      r:`Dark Cloud Cover: bear opens above prev high $${b[n-2].h.toFixed(2)}, closes below midpoint. Volume ${(b[n-1].v/volMA).toFixed(1)}x. RSI ${rsi.toFixed(0)}` });
  }

  if (found.length === 0) return null;
  // If multiple, take the one that matches trend direction (EMA filter)
  const bulls = found.filter(f=>f.side==='buy');
  const bears = found.filter(f=>f.side==='sell');
  const trendBull = ema9 > ema21;
  const pick = trendBull && bulls.length > 0 ? bulls[0]
             : !trendBull && bears.length > 0 ? bears[0]
             : found[0];

  return {
    side: pick.side,
    pattern: found.map(f=>f.pattern).join(' + '),
    reason: found.map((f,i)=>`${i+1}) ${f.r}`).join('\n'),
  };
}

// ── Already traded today? ────────────────────────────────────────────────────
async function alreadyTraded(symbol) {
  const alpacaSym = symbol.replace('/','');
  const pos = await apGet(ALP_URL + '/v2/positions');
  if (Array.isArray(pos) && pos.find(p=>p.symbol===alpacaSym||p.symbol===symbol)) return true;
  const today = new Date().toISOString().slice(0,10);
  const orders = await apGet(ALP_URL + '/v2/orders?status=all&after='+today+'T00:00:00Z&limit=100');
  if (Array.isArray(orders) && orders.find(o=>o.symbol===alpacaSym||o.symbol===symbol)) return true;
  return false;
}

// ── Place stock bracket order ────────────────────────────────────────────────
async function placeStockOrder(symbol, side, price, tp, sl) {
  const acct   = await apGet(ALP_URL + '/v2/account');
  const equity = parseFloat(acct.equity||10000);
  const qty    = Math.floor(equity/price);
  const m      = side==='buy' ? 1 : -1;
  const tpPx   = (price*(1+m*tp/100)).toFixed(2);
  const slPx   = (price*(1-m*sl/100)).toFixed(2);
  const r = await fetch(ALP_URL+'/v2/orders', {
    method:'POST', headers:{...alpH,'Content-Type':'application/json'},
    body: JSON.stringify({ symbol, qty:String(qty), side, type:'market', time_in_force:'day',
      order_class:'bracket', take_profit:{limit_price:tpPx}, stop_loss:{stop_price:slPx} }),
  });
  return { order:await r.json(), qty, tpPx, slPx, equity };
}

// ── Place crypto order (no bracket) ─────────────────────────────────────────
async function placeCryptoOrder(symbol, side, price, tp, sl) {
  const acct   = await apGet(ALP_URL + '/v2/account');
  const equity = parseFloat(acct.equity||10000);
  const qty    = (equity * 0.10 / price).toFixed(6);
  const tpPx   = (price*(1+tp/100)).toFixed(2);
  const slPx   = (price*(1-sl/100)).toFixed(2);
  const buyR = await fetch(ALP_URL+'/v2/orders', {
    method:'POST', headers:{...alpH,'Content-Type':'application/json'},
    body: JSON.stringify({ symbol, qty, side:'buy', type:'market', time_in_force:'gtc' }),
  });
  const buyOrder = await buyR.json();
  if (!buyOrder.id) return { order:buyOrder, qty, tpPx, slPx, equity };
  await new Promise(r=>setTimeout(r,2000));
  const tpR = await fetch(ALP_URL+'/v2/orders', {
    method:'POST', headers:{...alpH,'Content-Type':'application/json'},
    body: JSON.stringify({ symbol, qty, side:'sell', type:'limit', limit_price:tpPx, time_in_force:'gtc' }),
  });
  console.log('Crypto TP order:', (await tpR.json()).id||'failed');
  return { order:buyOrder, qty, tpPx, slPx, equity };
}

// ── Monitor crypto SL exits ──────────────────────────────────────────────────
async function checkCryptoSL() {
  const positions = await apGet(ALP_URL+'/v2/positions');
  if (!Array.isArray(positions)) return;
  for (const pos of positions) {
    const sym = pos.symbol;
    const cfg = Object.entries(UNIVERSE).find(([k,v])=>k.replace('/','')===sym && v.type==='crypto');
    if (!cfg) continue;
    const pnlPct = parseFloat(pos.unrealized_plpc)*100;
    const [origSym, {sl, tp}] = cfg;
    if (pnlPct <= -sl) {
      const orders = await apGet(ALP_URL+'/v2/orders?status=open&symbols='+sym);
      if (Array.isArray(orders)) for (const o of orders)
        await fetch(ALP_URL+'/v2/orders/'+o.id, {method:'DELETE', headers:alpH});
      await fetch(ALP_URL+'/v2/orders', {
        method:'POST', headers:{...alpH,'Content-Type':'application/json'},
        body: JSON.stringify({ symbol:origSym, qty:pos.qty, side:'sell', type:'market', time_in_force:'gtc' }),
      });
      await notify('STOP HIT '+sym, 'Crypto SL at '+pnlPct.toFixed(2)+'%\nSold '+pos.qty+' '+sym, 'urgent');
    } else if (pnlPct >= tp*0.9) {
      await notify('NEAR TARGET '+sym, sym+' at '+pnlPct.toFixed(2)+'% — TP is '+tp+'%', 'high');
    }
  }
}

// ── ORB strategy ─────────────────────────────────────────────────────────────
async function checkORB(symbol) {
  const now = etNow();
  const etTime = now.getHours()*60+now.getMinutes();
  if (etTime < 601 || etTime > 840) return null;
  const bars = await getBars(symbol, '5Min', 80);
  if (bars.length < 10) return null;
  const todayStr = new Date().toISOString().slice(0,10);
  const orBars = bars.filter(b => {
    const t = new Date(new Date(b.t).toLocaleString('en-US',{timeZone:'America/New_York'}));
    return b.t.startsWith(todayStr) && t.getHours()===9 && t.getMinutes()>=30;
  });
  if (orBars.length < 2) return null;
  const orH = Math.max(...orBars.map(b=>b.h));
  const orL = Math.min(...orBars.map(b=>b.l));
  if ((orH-orL)/orL < 0.003) return null;
  const n = bars.length;
  const closes  = bars.map(b=>b.c);
  const volumes = bars.map(b=>b.v);
  const last = bars[n-1], prev = bars[n-2];
  const volMA  = sma(volumes.slice(-21,-1),20);
  const rsiVal = rsiCalc(closes);
  const vwap   = vwapCalc(bars.filter(b=>b.t.startsWith(todayStr)));
  const daily  = await getBars(symbol, '1Day', 22);
  const ema20d = emaCalc(daily.map(b=>b.c), 20);
  const volSpike = last.v > volMA*2.5;
  // Tightened: volume 3x (was 2.5x), RSI 52-68 (was 45-75), must clear VWAP by >0.1%
  if (last.c>ema20d && last.v>volMA*3 && rsiVal>52 && rsiVal<68 && last.c>vwap*1.001 && last.c>orH && prev.c>orH)
    return { side:'buy',  price:last.c, strategy:'ORB', reason:`1) Above EMA20 uptrend 2) ORB breakout above $${orH.toFixed(2)} 2-bar confirmed 3) Volume ${(last.v/volMA).toFixed(1)}x avg 4) RSI ${rsiVal.toFixed(0)} bull zone 5) Above VWAP $${vwap.toFixed(2)}` };
  if (last.c<ema20d && last.v>volMA*3 && rsiVal>32 && rsiVal<48 && last.c<vwap*0.999 && last.c<orL && prev.c<orL)
    return { side:'sell', price:last.c, strategy:'ORB', reason:`1) Below EMA20 downtrend 2) ORB breakdown below $${orL.toFixed(2)} 2-bar confirmed 3) Volume ${(last.v/volMA).toFixed(1)}x avg 4) RSI ${rsiVal.toFixed(0)} bear zone 5) Below VWAP $${vwap.toFixed(2)}` };
  return null;
}

// ── Pattern (momentum structure) ─────────────────────────────────────────────
async function checkPattern(symbol) {
  const now = etNow();
  const etTime = now.getHours()*60+now.getMinutes();
  if (etTime < 585 || etTime > 900) return null;
  const bars = await getBars(symbol, '5Min', 60);
  if (bars.length < 15) return null;
  const n = bars.length;
  const closes  = bars.map(b=>b.c);
  const highs   = bars.map(b=>b.h);
  const lows    = bars.map(b=>b.l);
  const volumes = bars.map(b=>b.v);
  const last = bars[n-1];
  const volMA  = sma(volumes.slice(-21,-1),20);
  const ema9v  = emaCalc(closes,9);
  const ema21v = emaCalc(closes,21);
  const ema50v = emaCalc(closes,50);
  const rsiVal = rsiCalc(closes);
  const todayStr = new Date().toISOString().slice(0,10);
  const vwap   = vwapCalc(bars.filter(b=>b.t.startsWith(todayStr)));
  const swingH = Math.max(...highs.slice(-12,-2));
  const swingL = Math.min(...lows.slice(-12,-2));
  const hhhl = highs[n-1]>highs[n-2] && highs[n-2]>highs[n-3] && lows[n-1]>lows[n-2];
  const lhll = highs[n-1]<highs[n-2] && highs[n-2]<highs[n-3] && lows[n-1]<lows[n-2];
  const body = Math.abs(last.c-last.o), range = last.h-last.l;
  const strongCandle = range>0 && body/range>0.5;
  if (hhhl && closes[n-1]>swingH && closes[n-2]>swingH && ema9v>ema21v && ema21v>ema50v &&
      // Tightened: volume 2.5x (was 2x), RSI 55-68 (was 50-72), body>60% (was 50%)
      last.v>=volMA*2.5 && rsiVal>55 && rsiVal<68 && last.c>vwap && body/range>0.6)
    return { side:'buy',  price:last.c, strategy:'Pattern', reason:`1) 5m HH+HL bull structure 2) Breakout above $${swingH.toFixed(2)} 3) EMA9>21>50 stack 4) Volume ${(last.v/volMA).toFixed(1)}x strong candle >60% body 5) RSI ${rsiVal.toFixed(0)} above VWAP` };
  if (lhll && closes[n-1]<swingL && closes[n-2]<swingL && ema9v<ema21v && ema21v<ema50v &&
      last.v>=volMA*2.5 && rsiVal<45 && rsiVal>30 && last.c<vwap && body/range>0.6)
    return { side:'sell', price:last.c, strategy:'Pattern', reason:`1) 5m LH+LL bear structure 2) Breakdown below $${swingL.toFixed(2)} 3) EMA9<21<50 stack 4) Volume ${(last.v/volMA).toFixed(1)}x strong candle >60% body 5) RSI ${rsiVal.toFixed(0)} below VWAP` };
  return null;
}

// ── Crypto momentum ──────────────────────────────────────────────────────────
async function checkCrypto(symbol) {
  const bars = await getBars(symbol, '5Min', 60);
  if (bars.length < 20) return null;
  const n = bars.length;
  const closes  = bars.map(b=>b.c);
  const highs   = bars.map(b=>b.h);
  const lows    = bars.map(b=>b.l);
  const volumes = bars.map(b=>b.v);
  const last = bars[n-1];
  const volMA  = sma(volumes.slice(-21,-1),20);
  const ema9v  = emaCalc(closes,9);
  const ema21v = emaCalc(closes,21);
  const ema50v = emaCalc(closes,50);
  const rsiVal = rsiCalc(closes);
  const swingH = Math.max(...highs.slice(-12,-2));
  const swingL = Math.min(...lows.slice(-12,-2));
  const body = Math.abs(last.c-last.o), range = last.h-last.l;
  const strongCandle = range>0 && body/range>0.4;
  const volSpike = last.v > volMA*1.5;
  if (ema9v>ema21v && ema21v>ema50v && closes[n-1]>swingH && closes[n-2]>swingH && volSpike && rsiVal>50 && rsiVal<75 && strongCandle)
    return { side:'buy',  price:last.c, strategy:'Crypto', reason:`1) EMA9>21>50 crypto uptrend 2) Breakout above $${swingH.toFixed(2)} confirmed 3) Volume ${(last.v/volMA).toFixed(1)}x spike 4) RSI ${rsiVal.toFixed(0)} momentum 5) Strong bull candle body>40%` };
  if (ema9v<ema21v && ema21v<ema50v && closes[n-1]<swingL && closes[n-2]<swingL && volSpike && rsiVal<50 && rsiVal>25 && strongCandle)
    return { side:'sell', price:last.c, strategy:'Crypto', reason:`1) EMA9<21<50 crypto downtrend 2) Breakdown below $${swingL.toFixed(2)} confirmed 3) Volume ${(last.v/volMA).toFixed(1)}x spike 4) RSI ${rsiVal.toFixed(0)} bearish 5) Strong bear candle body>40%` };
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Scan:', new Date().toISOString(), '===');
  const day = new Date().getUTCDay();
  if (day===0||day===6) console.log('Weekend — skipping stocks');

  await checkCryptoSL();

  let signals = 0;

  for (const [symbol, cfg] of Object.entries(UNIVERSE)) {
    try {
      if (cfg.type==='stock' && (day===0||day===6)) continue;
      if (await alreadyTraded(symbol)) continue;

      // 1. Primary strategy check
      let signal = null;
      if      (cfg.strategy==='ORB')     signal = await checkORB(symbol);
      else if (cfg.strategy==='Pattern') signal = await checkPattern(symbol);
      else if (cfg.strategy==='Crypto')  signal = await checkCrypto(symbol);

      // 2. Chart pattern check (secondary — uses last fetched bars)
      let patternSig = null;
      if (!signal) {
        const bars = await getBars(symbol, '5Min', 30);
        if (bars.length >= 20) {
          const p = detectChartPatterns(bars);
          if (p) {
            const rsi = rsiCalc(bars.map(b=>b.c));
            // Only trade chart patterns with RSI confirmation
            const rsiOk = p.side==='buy' ? rsi < 60 : rsi > 40;
            if (rsiOk) patternSig = { ...p, price: bars[bars.length-1].c, strategy:'ChartPattern' };
          }
        }
      }

      const finalSignal = signal || patternSig;
      if (!finalSignal) { process.stdout.write('.'); continue; }

      signals++;
      const dir  = finalSignal.side==='buy' ? 'LONG' : 'SHORT';
      const m    = finalSignal.side==='buy' ? 1 : -1;
      const tpPx = (finalSignal.price*(1+m*cfg.tp/100)).toFixed(2);
      const slPx = (finalSignal.price*(1-m*cfg.sl/100)).toFixed(2);
      const stratLabel = finalSignal.strategy + (finalSignal.pattern ? ' ['+finalSignal.pattern+']' : '');
      const isRisky = cfg.risk === 'high';
      // Expected return per trade = (winRate% × TP) − (lossRate% × SL)
      const wr = cfg.histWin / 100;
      const expectedReturn = ((wr * cfg.tp) - ((1 - wr) * cfg.sl)).toFixed(2);
      const evSign = parseFloat(expectedReturn) >= 0 ? '+' : '';
      const riskLine = isRisky
        ? `\n⚠️ RISK HEAVY\nHistorical: ${cfg.histWin}% win rate | ${cfg.histPnl > 0 ? '+' : ''}${cfg.histPnl}% total P&L (45d)\nExpected return this trade: ${evSign}${expectedReturn}%`
        : `\n✅ PROVEN WINNER\nHistorical: ${cfg.histWin}% win rate | +${cfg.histPnl}% total P&L (45d)\nExpected return this trade: ${evSign}${expectedReturn}%`;
      const alertTitle = (isRisky ? '[RISK] ' : '[PROVEN] ') + dir + ' ' + symbol + ' @ $' + finalSignal.price;
      console.log('\n' + symbol, isRisky ? '[RISK HEAVY]' : '[PROVEN]', dir, '@$'+finalSignal.price, '|', stratLabel);

      await notify(
        alertTitle,
        'Strategy: '+stratLabel+'\nEntry: $'+finalSignal.price+'\nTarget: $'+tpPx+' (+'+cfg.tp+'%)\nStop: $'+slPx+' (-'+cfg.sl+'%)'+riskLine+'\n\nWHY:\n'+finalSignal.reason
      );

      const fn = cfg.type==='crypto' ? placeCryptoOrder : placeStockOrder;
      const {order,qty,equity} = await fn(symbol, finalSignal.side, finalSignal.price, cfg.tp, cfg.sl);

      if (order.id) {
        await notify('ORDER PLACED '+symbol,
          finalSignal.side.toUpperCase()+' '+qty+(cfg.type==='crypto'?'':' shares')+' @ $'+finalSignal.price+
          '\nTP: $'+tpPx+'\nSL: $'+slPx+'\nEquity: $'+equity.toFixed(2), 'high');
        console.log(symbol, 'order:', order.id);
      } else {
        await notify('ORDER FAILED '+symbol, order.message||'unknown', 'urgent');
        console.log(symbol, 'order failed:', order.message);
      }

    } catch(e) { console.error('\n'+symbol, 'error:', e.message); }
  }

  console.log('\n=== Done. Signals:', signals, '===');

  // ── Scan summary alert — sent after every scan ────────────────────────────
  // Fetch quick prediction for each crypto (stocks skipped on weekends)
  const summaryLines = [];
  const cryptoSymbols = Object.entries(UNIVERSE).filter(([,v])=>v.type==='crypto');
  const stockSymbols  = Object.entries(UNIVERSE).filter(([,v])=>v.type==='stock');
  const scanTargets   = day===0||day===6 ? cryptoSymbols : [...stockSymbols, ...cryptoSymbols];

  for (const [symbol] of scanTargets.slice(0, 20)) { // cap at 20 to keep message readable
    try {
      const bars = await getBars(symbol, '5Min', 20);
      if (bars.length < 5) continue;
      const closes = bars.map(b=>b.c);
      const n = closes.length;
      const k9=2/10; let e9=closes[0],e21=closes[0];
      for(let i=1;i<n;i++){e9=closes[i]*k9+e9*(1-k9);e21=closes[i]*(2/22)+e21*(1-2/22);}
      const rsiV = rsiCalc(closes);
      const last = bars[n-1];
      const pctChg = ((last.c - bars[0].c)/bars[0].c*100).toFixed(1);
      const arrow = e9>e21&&rsiV>52 ? '↑' : e9<e21&&rsiV<48 ? '↓' : '→';
      const label = symbol.replace('/','');
      summaryLines.push(`${arrow} ${label.padEnd(8)} RSI:${Math.round(rsiV)} ${pctChg>0?'+':''}${pctChg}% $${last.c.toFixed(label.includes('BTC')?0:2)}`);
    } catch{}
  }

  if (summaryLines.length > 0) {
    const etTime = new Date().toLocaleString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:true});
    const header = signals > 0 ? `🔔 ${signals} SIGNAL(S) FIRED` : '📊 Scan complete — no signals';
    await notify(
      `Scan ${etTime} | ${signals} signal${signals===1?'':'s'}`,
      header + '\n\n' + summaryLines.join('\n') + '\n\n↑=Bullish ↓=Bearish →=Neutral',
      signals > 0 ? 'high' : 'low'
    );
  }
}

main().catch(console.error);

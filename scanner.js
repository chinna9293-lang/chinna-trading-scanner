// Chinna Trading Scanner — Top 25 SPY + Crypto + Chart Patterns
// GitHub Actions every 5 min weekdays 9:30–4PM ET, crypto 24/7
const NTFY    = process.env.NTFY_TOPIC      || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY;
const ALP_SEC = process.env.ALPACA_SECRET;
const ALP_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const DATA    = 'https://data.alpaca.markets';

// ── Universe ──────────────────────────────────────────────────────────────────
// Each ticker runs its primary strategy PLUS chart pattern detection
const UNIVERSE = {
  MSFT:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  NVDA:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  GOOGL: { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  META:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  AVGO:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  JPM:   { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  LLY:   { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  V:     { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  UNH:   { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  XOM:   { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  MA:    { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  COST:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  HD:    { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  PG:    { strategy:'ORB',     tp:1.5, sl:1.0, type:'stock' },
  WMT:   { strategy:'ORB',     tp:1.5, sl:1.0, type:'stock' },
  BAC:   { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  ORCL:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  CRM:   { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  AAPL:  { strategy:'ORB',     tp:1.5, sl:1.0, type:'stock' },
  ABBV:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  KO:    { strategy:'ORB',     tp:1.5, sl:1.0, type:'stock' },
  NFLX:  { strategy:'Pattern', tp:3.0, sl:1.5, type:'stock' },
  AMD:   { strategy:'Pattern', tp:3.0, sl:1.5, type:'stock' },
  TSLA:  { strategy:'Pattern', tp:5.0, sl:2.0, type:'stock' },
  AMZN:  { strategy:'Pattern', tp:3.0, sl:1.5, type:'stock' },
  'BTC/USD':  { strategy:'Crypto', tp:5.0, sl:2.5, type:'crypto' },
  'ETH/USD':  { strategy:'Crypto', tp:5.0, sl:2.5, type:'crypto' },
  'SOL/USD':  { strategy:'Crypto', tp:8.0, sl:3.0, type:'crypto' },
  'DOGE/USD': { strategy:'Crypto', tp:8.0, sl:3.0, type:'crypto' },
  'LTC/USD':  { strategy:'Crypto', tp:5.0, sl:2.5, type:'crypto' },
  'LINK/USD': { strategy:'Crypto', tp:8.0, sl:3.0, type:'crypto' },
  'BCH/USD':  { strategy:'Crypto', tp:5.0, sl:2.5, type:'crypto' },
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
// CHART PATTERN DETECTION — runs on ALL tickers as secondary signal
// Returns { side, pattern, reason } or null
// ═══════════════════════════════════════════════════════════════════════════════
function detectChartPatterns(bars) {
  if (bars.length < 20) return null;
  const n = bars.length;
  const b = bars; // shorthand

  // Candle helpers
  const isBull = i => b[i].c > b[i].o;
  const isBear = i => b[i].c < b[i].o;
  const body   = i => Math.abs(b[i].c - b[i].o);
  const range  = i => b[i].h - b[i].l;
  const upper  = i => b[i].h - Math.max(b[i].o, b[i].c);
  const lower  = i => Math.min(b[i].o, b[i].c) - b[i].l;
  const mid    = i => (b[i].o + b[i].c) / 2;
  const pct    = (a, base) => Math.abs(a - base) / base;

  const closes  = bars.map(x=>x.c);
  const highs   = bars.map(x=>x.h);
  const lows    = bars.map(x=>x.l);
  const volumes = bars.map(x=>x.v);
  const volMA   = sma(volumes.slice(-21,-1), 20);
  const rsi     = rsiCalc(closes);
  const ema9    = emaCalc(closes, 9);
  const ema21   = emaCalc(closes, 21);

  const found = [];

  // ── BULLISH PATTERNS ───────────────────────────────────────────────────────

  // 1. Bullish Engulfing: prev bar bearish, current bar bull body engulfs prev
  if (isBear(n-2) && isBull(n-1) &&
      b[n-1].o <= b[n-2].c && b[n-1].c >= b[n-2].o &&
      body(n-1) > body(n-2) * 1.1) {
    found.push({ side:'buy', pattern:'Bullish Engulfing',
      r:`Bullish engulfing: current bull candle body engulfs prev bear candle. RSI ${rsi.toFixed(0)}` });
  }

  // 2. Hammer: small body at top, long lower wick > 2x body, tiny upper wick
  if (range(n-1) > 0 && lower(n-1) >= body(n-1)*2 && upper(n-1) <= body(n-1)*0.5 &&
      body(n-1) / range(n-1) < 0.35 && rsi < 45) {
    found.push({ side:'buy', pattern:'Hammer',
      r:`Hammer candle: lower wick ${(lower(n-1)/body(n-1)).toFixed(1)}x body at oversold RSI ${rsi.toFixed(0)}` });
  }

  // 3. Morning Star: bearish → doji/small → bullish
  if (n >= 3 && isBear(n-3) && body(n-2) < body(n-3)*0.3 && isBull(n-1) &&
      b[n-1].c > mid(n-3)) {
    found.push({ side:'buy', pattern:'Morning Star',
      r:`Morning Star 3-candle: bearish → doji → bullish recovery above midpoint` });
  }

  // 4. Piercing Line: bearish prev, bull current opens below prev low and closes above prev midpoint
  if (isBear(n-2) && isBull(n-1) &&
      b[n-1].o < b[n-2].l && b[n-1].c > mid(n-2) && b[n-1].c < b[n-2].o) {
    found.push({ side:'buy', pattern:'Piercing Line',
      r:`Piercing Line: bull candle opens below prev low, closes above prev midpoint` });
  }

  // 5. Three White Soldiers: 3 consecutive strong bull candles with rising closes
  if (n >= 3 && [n-3,n-2,n-1].every(i => isBull(i) && body(i)/range(i) > 0.6) &&
      b[n-1].c > b[n-2].c && b[n-2].c > b[n-3].c &&
      b[n-1].o > b[n-2].o && b[n-2].o > b[n-3].o) {
    found.push({ side:'buy', pattern:'Three White Soldiers',
      r:`3 White Soldiers: 3 consecutive strong bull candles with rising opens & closes` });
  }

  // 6. Inverted Hammer (after downtrend): small body at bottom, long upper wick
  if (isBear(n-3) && isBear(n-4) && range(n-1) > 0 &&
      upper(n-1) >= body(n-1)*2 && lower(n-1) <= body(n-1)*0.5 && rsi < 40) {
    found.push({ side:'buy', pattern:'Inverted Hammer',
      r:`Inverted Hammer after downtrend at RSI ${rsi.toFixed(0)}: upper wick signals buyer push` });
  }

  // 7. Bull Flag: strong up move (pole) then tight consolidation, breakout
  {
    const poleEnd = n - 8;
    const poleMove = (b[poleEnd].c - b[poleEnd-3]?.c) / (b[poleEnd-3]?.c||1) * 100;
    const flagHigh = Math.max(...highs.slice(n-7,n-1));
    const flagLow  = Math.min(...lows.slice(n-7,n-1));
    const flagRange = (flagHigh - flagLow) / flagLow * 100;
    if (poleMove > 1.5 && flagRange < poleMove * 0.5 && b[n-1].c > flagHigh &&
        b[n-1].v > volMA * 1.5) {
      found.push({ side:'buy', pattern:'Bull Flag',
        r:`Bull Flag: +${poleMove.toFixed(1)}% pole, tight ${flagRange.toFixed(1)}% flag, breakout above $${flagHigh.toFixed(2)} on volume` });
    }
  }

  // 8. Double Bottom (W pattern): two lows at similar price, neckline break
  {
    const recentLows = lows.slice(-20);
    const low1Idx = recentLows.indexOf(Math.min(...recentLows.slice(0,10)));
    const low2Idx = 10 + recentLows.slice(10).indexOf(Math.min(...recentLows.slice(10)));
    const low1 = recentLows[low1Idx], low2 = recentLows[low2Idx];
    const neckline = Math.max(...highs.slice(n-20+low1Idx, n-20+low2Idx));
    if (low1Idx < low2Idx - 3 && pct(low1,low2) < 0.02 &&
        b[n-1].c > neckline && b[n-2].c < neckline) {
      found.push({ side:'buy', pattern:'Double Bottom',
        r:`Double Bottom (W): two lows ~$${low1.toFixed(2)}, neckline break above $${neckline.toFixed(2)}` });
    }
  }

  // 9. Ascending Triangle: flat top, higher lows → breakout
  {
    const last15H = highs.slice(-15);
    const last15L = lows.slice(-15);
    const topMax = Math.max(...last15H.slice(0,-2));
    const topMin = Math.min(...last15H.slice(0,-2));
    const isFlat = (topMax - topMin) / topMax < 0.015;
    const lows15 = last15L.slice(0,-2);
    const risingLows = lows15[lows15.length-1] > lows15[0] + (lows15[lows15.length-1]-lows15[0])*0.3;
    if (isFlat && risingLows && b[n-1].c > topMax && b[n-1].v > volMA * 1.5) {
      found.push({ side:'buy', pattern:'Ascending Triangle',
        r:`Ascending Triangle: flat top ~$${topMax.toFixed(2)}, rising lows, breakout on volume ${(b[n-1].v/volMA).toFixed(1)}x` });
    }
  }

  // 10. Cup and Handle: U-shape then shallow pullback then breakout
  {
    if (n >= 30) {
      const cupLeft  = Math.max(...highs.slice(-30,-20));
      const cupBase  = Math.min(...lows.slice(-25,-10));
      const cupRight = Math.max(...highs.slice(-10,-3));
      const handle   = Math.min(...lows.slice(-3));
      const depth    = (cupLeft - cupBase) / cupLeft;
      const handlePb = (cupRight - handle) / cupRight;
      if (depth > 0.05 && depth < 0.35 && pct(cupLeft,cupRight) < 0.03 &&
          handlePb > 0.01 && handlePb < depth*0.6 && b[n-1].c > cupRight) {
        found.push({ side:'buy', pattern:'Cup & Handle',
          r:`Cup & Handle: ${(depth*100).toFixed(1)}% deep cup, ${(handlePb*100).toFixed(1)}% handle pullback, breakout above $${cupRight.toFixed(2)}` });
      }
    }
  }

  // ── BEARISH PATTERNS ───────────────────────────────────────────────────────

  // 11. Bearish Engulfing
  if (isBull(n-2) && isBear(n-1) &&
      b[n-1].o >= b[n-2].c && b[n-1].c <= b[n-2].o &&
      body(n-1) > body(n-2) * 1.1) {
    found.push({ side:'sell', pattern:'Bearish Engulfing',
      r:`Bearish engulfing: bear candle body engulfs prior bull candle. RSI ${rsi.toFixed(0)}` });
  }

  // 12. Shooting Star: small body at bottom, long upper wick > 2x, appears after uptrend
  if (isBull(n-3) && isBull(n-4) && range(n-1) > 0 &&
      upper(n-1) >= body(n-1)*2 && lower(n-1) <= body(n-1)*0.5 &&
      body(n-1)/range(n-1) < 0.35 && rsi > 60) {
    found.push({ side:'sell', pattern:'Shooting Star',
      r:`Shooting Star: upper wick ${(upper(n-1)/body(n-1)).toFixed(1)}x body after uptrend, RSI ${rsi.toFixed(0)} overbought` });
  }

  // 13. Hanging Man: same shape as hammer but after uptrend
  if (isBull(n-3) && isBull(n-4) && range(n-1) > 0 &&
      lower(n-1) >= body(n-1)*2 && upper(n-1) <= body(n-1)*0.5 &&
      body(n-1)/range(n-1) < 0.35 && rsi > 65) {
    found.push({ side:'sell', pattern:'Hanging Man',
      r:`Hanging Man: long lower wick ${(lower(n-1)/body(n-1)).toFixed(1)}x body after uptrend, RSI ${rsi.toFixed(0)}` });
  }

  // 14. Evening Star: bullish → doji/small → bearish
  if (n >= 3 && isBull(n-3) && body(n-2) < body(n-3)*0.3 && isBear(n-1) &&
      b[n-1].c < mid(n-3)) {
    found.push({ side:'sell', pattern:'Evening Star',
      r:`Evening Star 3-candle: bullish → doji → bearish drop below prior midpoint` });
  }

  // 15. Dark Cloud Cover: bull prev, bear current opens above prev high closes below midpoint
  if (isBull(n-2) && isBear(n-1) &&
      b[n-1].o > b[n-2].h && b[n-1].c < mid(n-2) && b[n-1].c > b[n-2].o) {
    found.push({ side:'sell', pattern:'Dark Cloud Cover',
      r:`Dark Cloud Cover: bear candle opens above prev high, closes below prior midpoint` });
  }

  // 16. Three Black Crows: 3 consecutive strong bear candles with falling closes
  if (n >= 3 && [n-3,n-2,n-1].every(i => isBear(i) && body(i)/range(i) > 0.6) &&
      b[n-1].c < b[n-2].c && b[n-2].c < b[n-3].c &&
      b[n-1].o < b[n-2].o && b[n-2].o < b[n-3].o) {
    found.push({ side:'sell', pattern:'Three Black Crows',
      r:`3 Black Crows: 3 consecutive strong bear candles with falling opens & closes` });
  }

  // 17. Bear Flag: strong down move then tight consolidation, breakdown
  {
    const poleEnd = n - 8;
    const poleMove = (b[poleEnd-3]?.c - b[poleEnd].c) / (b[poleEnd-3]?.c||1) * 100;
    const flagHigh = Math.max(...highs.slice(n-7,n-1));
    const flagLow  = Math.min(...lows.slice(n-7,n-1));
    const flagRange = (flagHigh - flagLow) / flagLow * 100;
    if (poleMove > 1.5 && flagRange < poleMove * 0.5 && b[n-1].c < flagLow &&
        b[n-1].v > volMA * 1.5) {
      found.push({ side:'sell', pattern:'Bear Flag',
        r:`Bear Flag: -${poleMove.toFixed(1)}% pole, tight ${flagRange.toFixed(1)}% flag, breakdown below $${flagLow.toFixed(2)} on volume` });
    }
  }

  // 18. Double Top (M pattern): two highs at similar price, neckline break
  {
    const recentHighs = highs.slice(-20);
    const h1Idx = recentHighs.indexOf(Math.max(...recentHighs.slice(0,10)));
    const h2Idx = 10 + recentHighs.slice(10).indexOf(Math.max(...recentHighs.slice(10)));
    const h1 = recentHighs[h1Idx], h2 = recentHighs[h2Idx];
    const neckline = Math.min(...lows.slice(n-20+h1Idx, n-20+h2Idx));
    if (h1Idx < h2Idx - 3 && pct(h1,h2) < 0.02 &&
        b[n-1].c < neckline && b[n-2].c > neckline) {
      found.push({ side:'sell', pattern:'Double Top',
        r:`Double Top (M): two peaks ~$${h1.toFixed(2)}, neckline break below $${neckline.toFixed(2)}` });
    }
  }

  // 19. Head & Shoulders: left shoulder → higher head → lower right shoulder → neckline break
  {
    if (n >= 25) {
      const seg = highs.slice(-25);
      const lsh = Math.max(...seg.slice(0,7));
      const head = Math.max(...seg.slice(7,17));
      const rsh  = Math.max(...seg.slice(17,24));
      const neckline = Math.min(...lows.slice(-12,-3));
      if (head > lsh * 1.01 && head > rsh * 1.01 &&
          pct(lsh, rsh) < 0.04 && b[n-1].c < neckline && b[n-2].c > neckline) {
        found.push({ side:'sell', pattern:'Head & Shoulders',
          r:`H&S top: left shoulder $${lsh.toFixed(2)}, head $${head.toFixed(2)}, right shoulder $${rsh.toFixed(2)}, neckline break $${neckline.toFixed(2)}` });
      }
    }
  }

  // 20. Descending Triangle: flat bottom, lower highs → breakdown
  {
    const last15H = highs.slice(-15);
    const last15L = lows.slice(-15);
    const botMax = Math.max(...last15L.slice(0,-2));
    const botMin = Math.min(...last15L.slice(0,-2));
    const isFlat = (botMax - botMin) / botMin < 0.015;
    const h15 = last15H.slice(0,-2);
    const fallingHighs = h15[h15.length-1] < h15[0] - (h15[0]-h15[h15.length-1])*0.3;
    if (isFlat && fallingHighs && b[n-1].c < botMin && b[n-1].v > volMA * 1.5) {
      found.push({ side:'sell', pattern:'Descending Triangle',
        r:`Descending Triangle: flat bottom ~$${botMin.toFixed(2)}, falling highs, breakdown on volume ${(b[n-1].v/volMA).toFixed(1)}x` });
    }
  }

  // ── Return strongest signal (prefer volume-confirmed) ──────────────────────
  if (found.length === 0) return null;

  // Prefer volume-confirmed patterns; otherwise take first
  const volConf = found.filter(f => f.r.includes('volume') || f.r.includes('breakout'));
  const pick = volConf.length > 0 ? volConf[0] : found[0];
  const allNames = found.map(f=>f.pattern).join(' + ');

  return {
    side: pick.side,
    pattern: allNames,
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
  if (last.c>ema20d && volSpike && rsiVal>45 && rsiVal<75 && last.c>vwap && last.c>orH && prev.c>orH)
    return { side:'buy',  price:last.c, strategy:'ORB', reason:`1) Above EMA20 daily uptrend 2) ORB breakout above $${orH.toFixed(2)} 2-bar confirmed 3) Volume ${(last.v/volMA).toFixed(1)}x avg 4) RSI ${rsiVal.toFixed(0)} bull zone 5) Above VWAP $${vwap.toFixed(2)}` };
  if (last.c<ema20d && volSpike && rsiVal>25 && rsiVal<50 && last.c<vwap && last.c<orL && prev.c<orL)
    return { side:'sell', price:last.c, strategy:'ORB', reason:`1) Below EMA20 daily downtrend 2) ORB breakdown below $${orL.toFixed(2)} 2-bar confirmed 3) Volume ${(last.v/volMA).toFixed(1)}x avg 4) RSI ${rsiVal.toFixed(0)} bear zone 5) Below VWAP $${vwap.toFixed(2)}` };
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
      last.v>=volMA*2 && rsiVal>50 && rsiVal<72 && last.c>vwap && strongCandle)
    return { side:'buy',  price:last.c, strategy:'Pattern', reason:`1) 5m HH+HL bull structure 2) Breakout above $${swingH.toFixed(2)} 3) EMA9>21>50 stack 4) Volume ${(last.v/volMA).toFixed(1)}x + strong candle 5) RSI ${rsiVal.toFixed(0)} above VWAP` };
  if (lhll && closes[n-1]<swingL && closes[n-2]<swingL && ema9v<ema21v && ema21v<ema50v &&
      last.v>=volMA*2 && rsiVal<50 && rsiVal>28 && last.c<vwap && strongCandle)
    return { side:'sell', price:last.c, strategy:'Pattern', reason:`1) 5m LH+LL bear structure 2) Breakdown below $${swingL.toFixed(2)} 3) EMA9<21<50 stack 4) Volume ${(last.v/volMA).toFixed(1)}x + strong candle 5) RSI ${rsiVal.toFixed(0)} below VWAP` };
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
      console.log('\n' + symbol, 'SIGNAL:', dir, '@$'+finalSignal.price, '|', stratLabel);

      await notify(
        dir+' '+symbol+' @ $'+finalSignal.price,
        'Strategy: '+stratLabel+'\nEntry: $'+finalSignal.price+'\nTarget: $'+tpPx+' (+'+cfg.tp+'%)\nStop: $'+slPx+' (-'+cfg.sl+'%)\n\nWHY:\n'+finalSignal.reason
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
}

main().catch(console.error);

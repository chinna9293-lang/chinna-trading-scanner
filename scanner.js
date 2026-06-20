// Chinna Trading Scanner — Top 25 SPY + Crypto, GitHub Actions every 5 min
const NTFY    = process.env.NTFY_TOPIC      || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY;
const ALP_SEC = process.env.ALPACA_SECRET;
const ALP_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const DATA    = 'https://data.alpaca.markets';

// ── Stock universe ────────────────────────────────────────────────────────────
// ORB = Opening Range Breakout (stocks, market hours only)
// Pattern = Momentum structure (stocks, volatile)
// Crypto = 24/7 momentum (BTC, ETH etc — no bracket orders on Alpaca)
const UNIVERSE = {
  // Top 25 SPY stocks — ORB strategy
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
  NFLX:  { strategy:'Pattern', tp:3.0, sl:1.5, type:'stock' },
  AMD:   { strategy:'Pattern', tp:3.0, sl:1.5, type:'stock' },
  TSLA:  { strategy:'Pattern', tp:5.0, sl:2.0, type:'stock' },
  AMZN:  { strategy:'Pattern', tp:3.0, sl:1.5, type:'stock' },
  AAPL:  { strategy:'ORB',     tp:1.5, sl:1.0, type:'stock' },
  ABBV:  { strategy:'ORB',     tp:2.0, sl:1.5, type:'stock' },
  KO:    { strategy:'ORB',     tp:1.5, sl:1.0, type:'stock' },

  // Top Crypto — momentum strategy, 24/7
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
  const k = 2/(n+1);
  let e = arr[0];
  for (let i=1; i<arr.length; i++) e = arr[i]*k + e*(1-k);
  return e;
}

function rsiCalc(closes) {
  let g=0, l=0;
  for (let i=Math.max(1,closes.length-14); i<closes.length; i++) {
    const d = closes[i]-closes[i-1];
    if (d>0) g+=d; else l-=d;
  }
  return 100 - 100/(1+(g/(l||0.001)));
}

function vwapCalc(bars) {
  const tv = bars.reduce((s,b)=>s+(b.h+b.l+b.c)/3*b.v,0);
  const v  = bars.reduce((s,b)=>s+b.v,0);
  return v>0 ? tv/v : bars[bars.length-1].c;
}

function etNow() {
  return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
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
    method:'POST',
    headers:{...alpH,'Content-Type':'application/json'},
    body: JSON.stringify({ symbol, qty:String(qty), side, type:'market', time_in_force:'day',
      order_class:'bracket', take_profit:{limit_price:tpPx}, stop_loss:{stop_price:slPx} }),
  });
  return { order:await r.json(), qty, tpPx, slPx, equity };
}

// ── Place crypto order (no bracket — use limit TP + scanner SL) ─────────────
async function placeCryptoOrder(symbol, side, price, tp, sl) {
  const acct   = await apGet(ALP_URL + '/v2/account');
  const equity = parseFloat(acct.equity||10000);
  // Use 10% of equity per crypto trade (diversified)
  const tradeAmt = equity * 0.10;
  const qty    = (tradeAmt / price).toFixed(6);
  const tpPx   = (price*(1+tp/100)).toFixed(2);
  const slPx   = (price*(1-sl/100)).toFixed(2);

  // Market buy
  const buyR = await fetch(ALP_URL+'/v2/orders', {
    method:'POST',
    headers:{...alpH,'Content-Type':'application/json'},
    body: JSON.stringify({ symbol, qty, side:'buy', type:'market', time_in_force:'gtc' }),
  });
  const buyOrder = await buyR.json();
  if (!buyOrder.id) return { order:buyOrder, qty, tpPx, slPx, equity };

  // Wait for fill then place TP limit
  await new Promise(r=>setTimeout(r,2000));
  const tpR = await fetch(ALP_URL+'/v2/orders', {
    method:'POST',
    headers:{...alpH,'Content-Type':'application/json'},
    body: JSON.stringify({ symbol, qty, side:'sell', type:'limit', limit_price:tpPx, time_in_force:'gtc' }),
  });
  const tpOrder = await tpR.json();
  console.log('Crypto TP order:', tpOrder.id||tpOrder.message);
  return { order:buyOrder, qty, tpPx, slPx, equity };
}

// ── Monitor crypto SL (called every scan) ───────────────────────────────────
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
      console.log(sym, 'SL hit at', pnlPct.toFixed(2)+'% — closing');
      // Cancel open TP order first
      const orders = await apGet(ALP_URL+'/v2/orders?status=open&symbols='+sym);
      if (Array.isArray(orders)) {
        for (const o of orders) {
          await fetch(ALP_URL+'/v2/orders/'+o.id, {method:'DELETE', headers:alpH});
        }
      }
      // Market sell
      await fetch(ALP_URL+'/v2/orders', {
        method:'POST', headers:{...alpH,'Content-Type':'application/json'},
        body: JSON.stringify({ symbol:origSym, qty:pos.qty, side:'sell', type:'market', time_in_force:'gtc' }),
      });
      await notify('STOP HIT '+sym, 'Crypto SL triggered at '+pnlPct.toFixed(2)+'%\nSold '+pos.qty+' '+sym, 'urgent');
    } else if (pnlPct >= tp*0.9) {
      await notify('NEAR TARGET '+sym, 'Crypto at '+pnlPct.toFixed(2)+'% — TP is '+tp+'%', 'high');
    }
  }
}

// ── ORB strategy ─────────────────────────────────────────────────────────────
async function checkORB(symbol, cfg) {
  const now = etNow();
  const etTime = now.getHours()*60+now.getMinutes();
  if (etTime < 601 || etTime > 840) return null; // 10:01–14:00 ET only

  const bars = await getBars(symbol, '5Min', 80);
  if (bars.length < 10) return null;

  const todayStr = now.toISOString().slice(0,10);
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

  const volMA    = sma(volumes.slice(-21,-1), 20);
  const volSpike = last.v > volMA*2.5;
  const rsiVal   = rsiCalc(closes);

  const todayBars = bars.filter(b=>b.t.startsWith(todayStr));
  const vwap = vwapCalc(todayBars);

  const daily = await getBars(symbol, '1Day', 22);
  const ema20d = emaCalc(daily.map(b=>b.c), 20);

  const longOk  = last.c>ema20d && volSpike && rsiVal>45 && rsiVal<75 && last.c>vwap && last.c>orH && prev.c>orH;
  const shortOk = last.c<ema20d && volSpike && rsiVal>25 && rsiVal<50 && last.c<vwap && last.c<orL && prev.c<orL;

  if (longOk)  return { side:'buy',  price:last.c, reason:`1) Uptrend above EMA20 2) ORB breakout above $${orH.toFixed(2)} 2-bar confirmed 3) Volume ${(last.v/volMA).toFixed(1)}x avg 4) RSI ${rsiVal.toFixed(0)} bull zone 5) Price above VWAP $${vwap.toFixed(2)}` };
  if (shortOk) return { side:'sell', price:last.c, reason:`1) Downtrend below EMA20 2) ORB breakdown below $${orL.toFixed(2)} 2-bar confirmed 3) Volume ${(last.v/volMA).toFixed(1)}x avg 4) RSI ${rsiVal.toFixed(0)} bear zone 5) Price below VWAP $${vwap.toFixed(2)}` };
  return null;
}

// ── Pattern strategy ─────────────────────────────────────────────────────────
async function checkPattern(symbol, cfg) {
  const now = etNow();
  const etTime = now.getHours()*60+now.getMinutes();
  if (etTime < 585 || etTime > 900) return null; // 9:45–15:00 ET only

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

  const todayStr  = now.toISOString().slice(0,10);
  const vwap = vwapCalc(bars.filter(b=>b.t.startsWith(todayStr)));
  const swingH = Math.max(...highs.slice(-12,-2));
  const swingL = Math.min(...lows.slice(-12,-2));

  const hhhl = highs[n-1]>highs[n-2] && highs[n-2]>highs[n-3] && lows[n-1]>lows[n-2];
  const lhll = highs[n-1]<highs[n-2] && highs[n-2]<highs[n-3] && lows[n-1]<lows[n-2];
  const breakUp   = closes[n-1]>swingH && closes[n-2]>swingH;
  const breakDown = closes[n-1]<swingL && closes[n-2]<swingL;
  const body = Math.abs(last.c-last.o), range = last.h-last.l;
  const strongCandle = range>0 && body/range>0.5;
  const ema9bull = ema9v>ema21v && ema21v>ema50v;
  const ema9bear = ema9v<ema21v && ema21v<ema50v;

  const longOk  = hhhl && breakUp   && ema9bull && last.v>=volMA*2 && rsiVal>50 && rsiVal<72 && last.c>vwap && strongCandle;
  const shortOk = lhll && breakDown && ema9bear && last.v>=volMA*2 && rsiVal<50 && rsiVal>28 && last.c<vwap && strongCandle;

  if (longOk)  return { side:'buy',  price:last.c, reason:`1) 5m HH+HL bull structure 2) Breakout above $${swingH.toFixed(2)} 3) EMA9>21>50 stack 4) Volume ${(last.v/volMA).toFixed(1)}x + strong candle 5) RSI ${rsiVal.toFixed(0)} above VWAP` };
  if (shortOk) return { side:'sell', price:last.c, reason:`1) 5m LH+LL bear structure 2) Breakdown below $${swingL.toFixed(2)} 3) EMA9<21<50 stack 4) Volume ${(last.v/volMA).toFixed(1)}x + strong candle 5) RSI ${rsiVal.toFixed(0)} below VWAP` };
  return null;
}

// ── Crypto momentum strategy (24/7) ─────────────────────────────────────────
async function checkCrypto(symbol, cfg) {
  const bars = await getBars(symbol, '5Min', 60);
  if (bars.length < 20) return null;

  const n = bars.length;
  const closes  = bars.map(b=>b.c);
  const volumes = bars.map(b=>b.v);
  const last = bars[n-1];

  const ema9v  = emaCalc(closes,9);
  const ema21v = emaCalc(closes,21);
  const ema50v = emaCalc(closes,50);
  const rsiVal = rsiCalc(closes);
  const volMA  = sma(volumes.slice(-21,-1),20);

  const highs = bars.map(b=>b.h);
  const lows  = bars.map(b=>b.l);
  const swingH = Math.max(...highs.slice(-12,-2));
  const swingL = Math.min(...lows.slice(-12,-2));

  const body = Math.abs(last.c-last.o), range = last.h-last.l;
  const strongCandle = range>0 && body/range>0.4;

  const breakUp   = closes[n-1]>swingH && closes[n-2]>swingH;
  const breakDown = closes[n-1]<swingL && closes[n-2]<swingL;
  const ema9bull  = ema9v>ema21v && ema21v>ema50v;
  const ema9bear  = ema9v<ema21v && ema21v<ema50v;
  const volSpike  = last.v > volMA*1.5;

  const longOk  = ema9bull && breakUp   && volSpike && rsiVal>50 && rsiVal<75 && strongCandle;
  const shortOk = ema9bear && breakDown && volSpike && rsiVal<50 && rsiVal>25 && strongCandle;

  if (longOk)  return { side:'buy',  price:last.c, reason:`1) EMA9>21>50 crypto uptrend 2) Breakout above $${swingH.toFixed(2)} 2-bar confirmed 3) Volume ${(last.v/volMA).toFixed(1)}x spike 4) RSI ${rsiVal.toFixed(0)} momentum 5) Strong bull candle body>40%` };
  if (shortOk) return { side:'sell', price:last.c, reason:`1) EMA9<21<50 crypto downtrend 2) Breakdown below $${swingL.toFixed(2)} 2-bar confirmed 3) Volume ${(last.v/volMA).toFixed(1)}x spike 4) RSI ${rsiVal.toFixed(0)} bearish 5) Strong bear candle body>40%` };
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Scan:', new Date().toISOString(), '===');
  const day = new Date().getUTCDay();
  if (day===0||day===6) { console.log('Weekend — skipping stocks'); }

  // Always check crypto SL exits first (24/7)
  await checkCryptoSL();

  let signals = 0;

  for (const [symbol, cfg] of Object.entries(UNIVERSE)) {
    try {
      // Skip stocks on weekends
      if (cfg.type==='stock' && (day===0||day===6)) continue;

      if (await alreadyTraded(symbol)) continue;

      let signal = null;
      if      (cfg.strategy==='ORB')     signal = await checkORB(symbol, cfg);
      else if (cfg.strategy==='Pattern') signal = await checkPattern(symbol, cfg);
      else if (cfg.strategy==='Crypto')  signal = await checkCrypto(symbol, cfg);

      if (!signal) { process.stdout.write('.'); continue; }

      signals++;
      const dir  = signal.side==='buy' ? 'LONG' : 'SHORT';
      const m    = signal.side==='buy' ? 1 : -1;
      const tpPx = (signal.price*(1+m*cfg.tp/100)).toFixed(2);
      const slPx = (signal.price*(1-m*cfg.sl/100)).toFixed(2);
      console.log('\n' + symbol, 'SIGNAL:', dir, '@$'+signal.price);

      // Phone alert
      await notify(
        dir+' '+symbol+' @ $'+signal.price,
        'Strategy: '+cfg.strategy+'\nEntry: $'+signal.price+'\nTarget: $'+tpPx+' (+'+cfg.tp+'%)\nStop: $'+slPx+' (-'+cfg.sl+'%)\n\nWHY:\n'+signal.reason
      );

      // Place order
      const fn = cfg.type==='crypto' ? placeCryptoOrder : placeStockOrder;
      const {order,qty,equity} = await fn(symbol, signal.side, signal.price, cfg.tp, cfg.sl);

      if (order.id) {
        await notify('ORDER PLACED '+symbol,
          signal.side.toUpperCase()+' '+qty+(cfg.type==='crypto' ? '' : ' shares')+' @ $'+signal.price+
          '\nTP: $'+tpPx+'\nSL: $'+slPx+'\nEquity: $'+equity.toFixed(2), 'high');
        console.log(symbol, 'order:', order.id);
      } else {
        await notify('ORDER FAILED '+symbol, order.message||'unknown', 'urgent');
        console.log(symbol, 'order failed:', order.message);
      }

    } catch(e) {
      console.error('\n'+symbol, 'error:', e.message);
    }
  }

  console.log('\n=== Done. Signals:', signals, '===');
}

main().catch(console.error);

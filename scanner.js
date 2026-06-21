// Chinna Trading Scanner — 1H chart, simplified 3-condition signals
// Strategy: EMA trend + RSI zone + price action. Quick in/out scalps.
// Stocks: 9 proven winners | Crypto: DOGE, LTC, LINK
const NTFY    = process.env.NTFY_TOPIC      || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY      || 'PK7T6WNU6ANNWQXMWFFFSYLKR7';
const ALP_SEC = process.env.ALPACA_SECRET   || 'EDBn6MnYgP1eVkwnkSGpCByUTSLi9t4qHGoMBtNKDoz6';
const ALP_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const DATA    = 'https://data.alpaca.markets';

// ── UNIVERSE — tighter TP/SL for 1H quick scalps ──────────────────────────────
const UNIVERSE = {
  // ── PROVEN WINNERS ────────────────────────────────────────────────────────
  LLY:  { tp:1.5, sl:0.8, type:'stock',  risk:'low',  histWin:55, histPnl:+14.7 },
  COST: { tp:1.5, sl:0.8, type:'stock',  risk:'low',  histWin:58, histPnl:+13.3 },
  TSLA: { tp:2.0, sl:1.0, type:'stock',  risk:'low',  histWin:58, histPnl:+10.4 },
  AMD:  { tp:2.0, sl:1.0, type:'stock',  risk:'low',  histWin:52, histPnl:+14.9 },
  XOM:  { tp:1.5, sl:0.8, type:'stock',  risk:'low',  histWin:58, histPnl:+6.8  },
  CRM:  { tp:1.5, sl:0.8, type:'stock',  risk:'low',  histWin:48, histPnl:+6.2  },
  V:    { tp:1.2, sl:0.6, type:'stock',  risk:'low',  histWin:52, histPnl:+5.5  },
  WMT:  { tp:1.2, sl:0.6, type:'stock',  risk:'low',  histWin:52, histPnl:+3.6  },
  MA:   { tp:1.5, sl:0.8, type:'stock',  risk:'low',  histWin:48, histPnl:+2.0  },
  NVDA: { tp:2.0, sl:1.0, type:'stock',  risk:'high', histWin:45, histPnl:-1.3  },
  AAPL: { tp:1.2, sl:0.6, type:'stock',  risk:'high', histWin:42, histPnl:-0.9  },
  META: { tp:1.5, sl:0.8, type:'stock',  risk:'high', histWin:42, histPnl:-5.4  },
  GOOGL:{ tp:1.5, sl:0.8, type:'stock',  risk:'high', histWin:45, histPnl:-6.7  },
  MSFT: { tp:1.5, sl:0.8, type:'stock',  risk:'high', histWin:35, histPnl:-12.4 },
  'DOGE/USD': { tp:4.0, sl:2.0, type:'crypto', risk:'low',  histWin:57, histPnl:+12.0 },
  'LTC/USD':  { tp:3.0, sl:1.5, type:'crypto', risk:'low',  histWin:52, histPnl:+9.5  },
  'LINK/USD': { tp:4.0, sl:2.0, type:'crypto', risk:'low',  histWin:50, histPnl:+3.6  },
  'BTC/USD':  { tp:2.5, sl:1.5, type:'crypto', risk:'high', histWin:52, histPnl:-1.4  },
  'ETH/USD':  { tp:2.5, sl:1.5, type:'crypto', risk:'high', histWin:45, histPnl:-2.4  },
  'SOL/USD':  { tp:3.0, sl:1.5, type:'crypto', risk:'high', histWin:48, histPnl:+2.0  },
};

const alpH = { 'APCA-API-KEY-ID': ALP_KEY, 'APCA-API-SECRET-KEY': ALP_SEC };

async function apGet(url) {
  const r = await fetch(url, { headers: alpH });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} — ${url}`);
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

// ── Fetch 1H bars ─────────────────────────────────────────────────────────────
async function getBars(symbol, limit) {
  const sym = symbol.replace('/', '%2F');
  const isCrypto = symbol.includes('/');
  const tf = '1Hour';
  const url = isCrypto
    ? `${DATA}/v1beta3/crypto/us/bars?symbols=${sym}&timeframe=${tf}&limit=${limit}`
    : `${DATA}/v2/stocks/${sym}/bars?timeframe=${tf}&limit=${limit}&feed=iex`;
  const d = await apGet(url);
  if (isCrypto) return (d.bars && d.bars[symbol]) ? d.bars[symbol] : [];
  return d.bars || [];
}

// ── Indicators ────────────────────────────────────────────────────────────────
function ema(arr, n) {
  const k = 2/(n+1); let e = arr[0];
  for (let i=1;i<arr.length;i++) e = arr[i]*k+e*(1-k);
  return e;
}
function rsi(closes) {
  let g=0, l=0;
  const slice = closes.slice(-15);
  for (let i=1;i<slice.length;i++) {
    const d = slice[i]-slice[i-1];
    if (d>0) g+=d; else l-=d;
  }
  return 100-100/(1+(g/(l||0.001)));
}
function sma(arr, n) {
  const s = arr.slice(-n);
  return s.reduce((a,b)=>a+b,0)/s.length;
}
function etNow() {
  return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
}

// ── Core 1H signal — 3 conditions only ───────────────────────────────────────
// 1. EMA9 vs EMA21 trend direction
// 2. RSI in the right zone (not overbought for buys, not oversold for sells)
// 3. Price closes above/below recent swing high/low (breakout)
function check1H(bars) {
  if (bars.length < 25) return null;
  const n       = bars.length;
  const closes  = bars.map(b=>b.c);
  const highs   = bars.map(b=>b.h);
  const lows    = bars.map(b=>b.l);
  const last    = bars[n-1];
  const prev    = bars[n-2];

  const e9  = ema(closes, 9);
  const e21 = ema(closes, 21);
  const r   = rsi(closes);

  // swing high/low over last 10 bars (excluding last)
  const swingH = Math.max(...highs.slice(n-12, n-1));
  const swingL = Math.min(...lows.slice(n-12, n-1));

  // BUY: EMA9 > EMA21 (uptrend) + RSI 45-65 (momentum, not overbought) + close above swing high
  if (e9 > e21 && r > 45 && r < 65 && last.c > swingH && prev.c <= swingH) {
    return {
      side: 'buy',
      price: last.c,
      reason: `1) EMA9(${e9.toFixed(2)}) > EMA21(${e21.toFixed(2)}) uptrend  2) RSI ${r.toFixed(0)} bullish zone  3) Broke above swing high $${swingH.toFixed(2)}`
    };
  }

  // SELL: EMA9 < EMA21 (downtrend) + RSI 35-55 (momentum, not oversold) + close below swing low
  if (e9 < e21 && r > 35 && r < 55 && last.c < swingL && prev.c >= swingL) {
    return {
      side: 'sell',
      price: last.c,
      reason: `1) EMA9(${e9.toFixed(2)}) < EMA21(${e21.toFixed(2)}) downtrend  2) RSI ${r.toFixed(0)} bearish zone  3) Broke below swing low $${swingL.toFixed(2)}`
    };
  }

  return null;
}

// ── Already traded today? ─────────────────────────────────────────────────────
async function alreadyTraded(symbol) {
  const alpacaSym = symbol.replace('/','');
  const pos = await apGet(ALP_URL + '/v2/positions');
  if (Array.isArray(pos) && pos.find(p=>p.symbol===alpacaSym||p.symbol===symbol)) return true;
  const today = new Date().toISOString().slice(0,10);
  const orders = await apGet(ALP_URL + '/v2/orders?status=all&after='+today+'T00:00:00Z&limit=100');
  if (Array.isArray(orders) && orders.find(o=>o.symbol===alpacaSym||o.symbol===symbol)) return true;
  return false;
}

// ── Place stock bracket order ─────────────────────────────────────────────────
async function placeStockOrder(symbol, side, price, tp, sl) {
  const acct   = await apGet(ALP_URL + '/v2/account');
  const equity = parseFloat(acct.equity||10000);
  const qty    = Math.max(1, Math.floor(equity * 0.1 / price)); // 10% of equity per trade
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

// ── Place crypto order ────────────────────────────────────────────────────────
async function placeCryptoOrder(symbol, side, price, tp, sl) {
  const acct   = await apGet(ALP_URL + '/v2/account');
  const equity = parseFloat(acct.equity||10000);
  const qty    = (equity * 0.10 / price).toFixed(6);
  const m      = side==='buy' ? 1 : -1;
  const tpPx   = (price*(1+m*tp/100)).toFixed(2);
  const slPx   = (price*(1-m*sl/100)).toFixed(2);
  const buyR = await fetch(ALP_URL+'/v2/orders', {
    method:'POST', headers:{...alpH,'Content-Type':'application/json'},
    body: JSON.stringify({ symbol, qty, side:'buy', type:'market', time_in_force:'gtc' }),
  });
  const buyOrder = await buyR.json();
  if (!buyOrder.id) return { order:buyOrder, qty, tpPx, slPx, equity };
  await new Promise(r=>setTimeout(r,2000));
  await fetch(ALP_URL+'/v2/orders', {
    method:'POST', headers:{...alpH,'Content-Type':'application/json'},
    body: JSON.stringify({ symbol, qty, side:'sell', type:'limit', limit_price:tpPx, time_in_force:'gtc' }),
  });
  return { order:buyOrder, qty, tpPx, slPx, equity };
}

// ── Monitor crypto SL exits ───────────────────────────────────────────────────
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
      await notify('STOP HIT '+sym, `Crypto SL at ${pnlPct.toFixed(2)}%\nSold ${pos.qty} ${sym}`, 'urgent');
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Scan:', new Date().toISOString(), '===');
  const day = new Date().getUTCDay();
  if (day===0||day===6) console.log('Weekend — crypto only');

  await checkCryptoSL();

  let signals = 0;
  const summaryLines = [];

  for (const [symbol, cfg] of Object.entries(UNIVERSE)) {
    try {
      if (cfg.type==='stock' && (day===0||day===6)) continue;
      if (await alreadyTraded(symbol)) { process.stdout.write('_'); continue; }

      const bars = await getBars(symbol, 50);
      if (bars.length < 25) { process.stdout.write('?'); continue; }

      const signal = check1H(bars);

      // summary line for ntfy
      const closes = bars.map(b=>b.c);
      const r = rsi(closes);
      const last = bars[bars.length-1];
      const e9  = ema(closes,9);
      const e21 = ema(closes,21);
      const arrow = signal ? (signal.side==='buy' ? '🟢' : '🔴') : (e9>e21 && r>50 ? '↑' : e9<e21 && r<50 ? '↓' : '→');
      summaryLines.push(`${arrow} ${symbol.replace('/','').padEnd(8)} RSI:${Math.round(r)} $${last.c.toFixed(symbol.includes('BTC')||symbol.includes('ETH')?0:2)}`);

      if (!signal) { process.stdout.write('.'); continue; }

      signals++;
      const dir  = signal.side==='buy' ? 'LONG' : 'SHORT';
      const m    = signal.side==='buy' ? 1 : -1;
      const tpPx = (signal.price*(1+m*cfg.tp/100)).toFixed(2);
      const slPx = (signal.price*(1-m*cfg.sl/100)).toFixed(2);
      const tag  = cfg.risk==='high' ? '⚠️ RISK' : '✅ PROVEN';
      const wr   = cfg.histWin/100;
      const ev   = ((wr*cfg.tp)-((1-wr)*cfg.sl)).toFixed(2);

      console.log('\n'+symbol, dir, '@$'+signal.price, tag);

      await notify(
        `${tag} ${dir} ${symbol} @ $${signal.price}`,
        `Entry: $${signal.price}\nTarget: $${tpPx} (+${cfg.tp}%)\nStop:   $${slPx} (-${cfg.sl}%)\nEV: ${ev>0?'+':''}${ev}% | Win rate: ${cfg.histWin}%\n\nWHY:\n${signal.reason}`
      );

      const fn = cfg.type==='crypto' ? placeCryptoOrder : placeStockOrder;
      const {order,qty,equity} = await fn(symbol, signal.side, signal.price, cfg.tp, cfg.sl);

      if (order.id) {
        await notify('ORDER PLACED '+symbol,
          `${signal.side.toUpperCase()} ${qty}${cfg.type==='crypto'?'':' shares'} @ $${signal.price}\nTP: $${tpPx}\nSL: $${slPx}\nEquity: $${equity.toFixed(2)}`, 'high');
        console.log(symbol, 'order:', order.id);
      } else {
        await notify('ORDER FAILED '+symbol, order.message||'unknown error', 'urgent');
        console.log(symbol, 'order failed:', order.message);
      }

    } catch(e) { console.error('\n'+symbol, 'error:', e.message); }
  }

  console.log('\n=== Done. Signals:', signals, '===');

  if (summaryLines.length > 0) {
    const etTime = new Date().toLocaleString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:true});
    const header = signals > 0 ? `🔔 ${signals} SIGNAL(S) FIRED` : '📊 No signals — 1H scan';
    await notify(
      `Scan ${etTime} | ${signals} signal${signals===1?'':'s'}`,
      header + '\n\n' + summaryLines.join('\n') + '\n\n🟢=BUY fired  🔴=SELL fired  ↑↓→=bias only',
      signals > 0 ? 'high' : 'low'
    );
  }
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException',  (err) => console.error('[uncaughtException]',  err));

async function loop() {
  while (true) {
    try { await main(); } catch(e) { console.error('[loop error]', e.message); }
    await new Promise(r => setTimeout(r, 60 * 60 * 1000)); // scan every 1 hour (matches 1H bars)
  }
}

loop();

// ORB + Pattern Scanner — runs on GitHub Actions every 5 min, no TradingView needed
const NTFY    = process.env.NTFY_TOPIC      || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY;
const ALP_SEC = process.env.ALPACA_SECRET;
const ALP_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

const STOCKS = {
  MSFT: { strategy: 'ORB',     tp: 2.0, sl: 1.5 },
  NVDA: { strategy: 'ORB',     tp: 2.0, sl: 1.5 },
  V:    { strategy: 'ORB',     tp: 2.0, sl: 1.5 },
  UNH:  { strategy: 'ORB',     tp: 2.0, sl: 1.5 },
  TSLA: { strategy: 'Pattern', tp: 5.0, sl: 2.0 },
  AMZN: { strategy: 'Pattern', tp: 3.0, sl: 1.5 },
};

const alpHeaders = { 'APCA-API-KEY-ID': ALP_KEY, 'APCA-API-SECRET-KEY': ALP_SEC };

async function apGet(url) {
  const r = await fetch(url, { headers: alpHeaders });
  return r.json();
}

async function notify(title, body, priority) {
  await fetch('https://ntfy.sh/' + NTFY, {
    method: 'POST',
    headers: { 'Title': title, 'Priority': priority || 'high', 'Tags': 'chart_with_upwards_trend' },
    body: body,
  });
  console.log('[ntfy]', title);
}

async function getBars(symbol, timeframe, limit) {
  const d = await apGet(DATA_URL + '/v2/stocks/' + symbol + '/bars?timeframe=' + timeframe + '&limit=' + limit + '&feed=iex');
  return d.bars || [];
}

function sma(arr, n) {
  if (arr.length < n) return arr.reduce((a,b)=>a+b,0)/arr.length;
  return arr.slice(-n).reduce((a,b)=>a+b,0)/n;
}

function emaCalc(arr, n) {
  const k = 2/(n+1);
  let e = arr[0];
  for (let i=1; i<arr.length; i++) e = arr[i]*k + e*(1-k);
  return e;
}

function rsiCalc(closes, n) {
  n = n || 14;
  let gains=0, losses=0;
  const start = Math.max(1, closes.length-n);
  for (let i=start; i<closes.length; i++) {
    const d = closes[i]-closes[i-1];
    if (d>0) gains+=d; else losses-=d;
  }
  return 100 - 100/(1+(gains/(losses||0.0001)));
}

async function placeOrder(ticker, side, price, tp, sl) {
  const acct   = await apGet(ALP_URL + '/v2/account');
  const equity = parseFloat(acct.equity || 10000);
  const qty    = Math.floor(equity / price);
  const mult   = side === 'buy' ? 1 : -1;
  const tpPx   = (price*(1+mult*tp/100)).toFixed(2);
  const slPx   = (price*(1-mult*sl/100)).toFixed(2);

  const r = await fetch(ALP_URL + '/v2/orders', {
    method: 'POST',
    headers: { ...alpHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: ticker, qty: String(qty), side, type: 'market', time_in_force: 'day', order_class: 'bracket', take_profit: { limit_price: tpPx }, stop_loss: { stop_price: slPx } }),
  });
  const order = await r.json();
  return { order, qty, tpPx, slPx, equity };
}

function vwapCalc(bars) {
  const tv = bars.reduce((s,b) => s+(b.h+b.l+b.c)/3*b.v, 0);
  const v  = bars.reduce((s,b) => s+b.v, 0);
  return tv/v;
}

async function checkORB(symbol, cfg) {
  const bars = await getBars(symbol, '5Min', 80);
  if (bars.length < 10) return null;

  const nowET = new Date(new Date().toLocaleString('en-US', {timeZone:'America/New_York'}));
  const etTime = nowET.getHours()*60 + nowET.getMinutes();
  if (etTime < 601 || etTime > 840) return null;

  const todayStr = nowET.toISOString().slice(0,10);
  const orBars = bars.filter(b => {
    const t = new Date(new Date(b.t).toLocaleString('en-US', {timeZone:'America/New_York'}));
    return b.t.startsWith(todayStr) && t.getHours()===9 && t.getMinutes()>=30;
  });
  if (orBars.length < 2) return null;

  const orH = Math.max(...orBars.map(b=>b.h));
  const orL = Math.min(...orBars.map(b=>b.l));
  if ((orH-orL)/orL < 0.003) return null;

  const n  = bars.length;
  const closes  = bars.map(b=>b.c);
  const volumes = bars.map(b=>b.v);
  const last = bars[n-1], prev = bars[n-2];

  const volMA    = sma(volumes.slice(-21,-1), 20);
  const volSpike = last.v > volMA*2.5;
  const rsiVal   = rsiCalc(closes);

  const todayBars = bars.filter(b=>b.t.startsWith(todayStr));
  const vwap = vwapCalc(todayBars);

  const daily = await getBars(symbol, '1Day', 22);
  const dCloses = daily.map(b=>b.c);
  const ema20d  = emaCalc(dCloses, 20);
  const bullTrend = last.c > ema20d;
  const bearTrend = last.c < ema20d;

  const longOk  = bullTrend && volSpike && rsiVal>45 && rsiVal<75 && last.c>vwap && last.c>orH && prev.c>orH;
  const shortOk = bearTrend && volSpike && rsiVal>25 && rsiVal<50 && last.c<vwap && last.c<orL && prev.c<orL;

  if (longOk)  return { side:'buy',  price:last.c, reason:'1) Uptrend above EMA20 2) ORB breakout above $'+orH.toFixed(2)+' 2-bar confirmed 3) Volume '+( last.v/volMA).toFixed(1)+'x avg 4) RSI '+rsiVal.toFixed(0)+' bull zone 5) Price above VWAP $'+vwap.toFixed(2) };
  if (shortOk) return { side:'sell', price:last.c, reason:'1) Downtrend below EMA20 2) ORB breakdown below $'+orL.toFixed(2)+' 2-bar confirmed 3) Volume '+(last.v/volMA).toFixed(1)+'x avg 4) RSI '+rsiVal.toFixed(0)+' bear zone 5) Price below VWAP $'+vwap.toFixed(2) };
  return null;
}

async function checkPattern(symbol, cfg) {
  const bars = await getBars(symbol, '5Min', 60);
  if (bars.length < 15) return null;

  const nowET  = new Date(new Date().toLocaleString('en-US', {timeZone:'America/New_York'}));
  const etTime = nowET.getHours()*60 + nowET.getMinutes();
  if (etTime < 585 || etTime > 900) return null;

  const n = bars.length;
  const closes  = bars.map(b=>b.c);
  const highs   = bars.map(b=>b.h);
  const lows    = bars.map(b=>b.l);
  const volumes = bars.map(b=>b.v);
  const last = bars[n-1];

  const volMA  = sma(volumes.slice(-21,-1), 20);
  const ema9v  = emaCalc(closes, 9);
  const ema21v = emaCalc(closes, 21);
  const ema50v = emaCalc(closes, 50);
  const rsiVal = rsiCalc(closes);

  const todayStr  = nowET.toISOString().slice(0,10);
  const todayBars = bars.filter(b=>b.t.startsWith(todayStr));
  const vwap = vwapCalc(todayBars);

  const swingH = Math.max(...highs.slice(-12,-2));
  const swingL = Math.min(...lows.slice(-12,-2));

  const hhhl = highs[n-1]>highs[n-2] && highs[n-2]>highs[n-3] && lows[n-1]>lows[n-2] && lows[n-2]>lows[n-3];
  const lhll = highs[n-1]<highs[n-2] && highs[n-2]<highs[n-3] && lows[n-1]<lows[n-2] && lows[n-2]<lows[n-3];

  const breakUp   = closes[n-1]>swingH && closes[n-2]>swingH;
  const breakDown = closes[n-1]<swingL && closes[n-2]<swingL;

  const body  = Math.abs(last.c-last.o);
  const range = last.h-last.l;
  const strongCandle = range>0 && body/range>0.5;

  const ema9bull = ema9v>ema21v && ema21v>ema50v;
  const ema9bear = ema9v<ema21v && ema21v<ema50v;
  const volConfirm = last.v >= volMA*2.0;

  const longOk  = hhhl && breakUp   && ema9bull && volConfirm && rsiVal>50 && rsiVal<72 && last.c>vwap && strongCandle;
  const shortOk = lhll && breakDown && ema9bear && volConfirm && rsiVal<50 && rsiVal>28 && last.c<vwap && strongCandle;

  if (longOk)  return { side:'buy',  price:last.c, reason:'1) 5m HH+HL bull structure 2) Breakout above $'+swingH.toFixed(2)+' confirmed 3) EMA9>21>50 stack 4) Volume '+(last.v/volMA).toFixed(1)+'x strong candle 5) RSI '+rsiVal.toFixed(0)+' above VWAP $'+vwap.toFixed(2) };
  if (shortOk) return { side:'sell', price:last.c, reason:'1) 5m LH+LL bear structure 2) Breakdown below $'+swingL.toFixed(2)+' confirmed 3) EMA9<21<50 stack 4) Volume '+(last.v/volMA).toFixed(1)+'x strong candle 5) RSI '+rsiVal.toFixed(0)+' below VWAP $'+vwap.toFixed(2) };
  return null;
}

async function alreadyTradedToday(symbol) {
  // Check open positions
  const positions = await apGet(ALP_URL + '/v2/positions');
  if (Array.isArray(positions) && positions.find(p => p.symbol === symbol)) {
    console.log(symbol, 'already has open position — skip');
    return true;
  }

  // Check today's orders
  const today = new Date().toISOString().slice(0, 10);
  const orders = await apGet(ALP_URL + '/v2/orders?status=all&after=' + today + 'T00:00:00Z&symbols=' + symbol);
  if (Array.isArray(orders) && orders.length > 0) {
    console.log(symbol, 'already has order today — skip');
    return true;
  }

  return false;
}

async function main() {
  console.log('Scan:', new Date().toISOString());
  const day = new Date().getUTCDay();
  if (day===0||day===6) { console.log('Weekend'); return; }

  for (const [symbol, cfg] of Object.entries(STOCKS)) {
    try {
      // GUARD: skip if already traded today (prevents duplicates)
      if (await alreadyTradedToday(symbol)) continue;

      console.log('Checking', symbol);
      const signal = cfg.strategy==='ORB' ? await checkORB(symbol,cfg) : await checkPattern(symbol,cfg);
      if (!signal) { console.log(symbol,'no signal'); continue; }

      const dir  = signal.side==='buy' ? 'LONG' : 'SHORT';
      const mult = signal.side==='buy' ? 1 : -1;
      const tpPx = (signal.price*(1+mult*cfg.tp/100)).toFixed(2);
      const slPx = (signal.price*(1-mult*cfg.sl/100)).toFixed(2);
      console.log(symbol,'SIGNAL',dir,'@$'+signal.price);

      await notify(dir+' '+symbol+' @ $'+signal.price,
        'Strategy: '+cfg.strategy+'\nEntry: $'+signal.price+'\nTarget: $'+tpPx+' (+'+cfg.tp+'%)\nStop: $'+slPx+' (-'+cfg.sl+'%)\n\nWHY:\n'+signal.reason);

      const {order,qty,equity} = await placeOrder(symbol,signal.side,signal.price,cfg.tp,cfg.sl);
      if (order.id) {
        await notify('ORDER PLACED '+symbol, signal.side.toUpperCase()+' '+qty+' shares @ $'+signal.price+'\nTP: $'+tpPx+'\nSL: $'+slPx+'\nEquity: $'+equity.toFixed(2),'high');
        console.log(symbol,'order placed:',order.id);
      } else {
        await notify('ORDER FAILED '+symbol, order.message||'unknown error','urgent');
      }
    } catch(e) {
      console.error(symbol,'error:',e.message);
    }
  }
  console.log('Done');
}

main().catch(console.error);

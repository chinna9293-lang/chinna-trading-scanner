// Standalone backtest runner — fetches real 1H bars, walks forward, sends ntfy
const NTFY    = process.env.NTFY_TOPIC      || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY      || 'PK7T6WNU6ANNWQXMWFFFSYLKR7';
const ALP_SEC = process.env.ALPACA_SECRET   || 'EDBn6MnYgP1eVkwnkSGpCByUTSLi9t4qHGoMBtNKDoz6';
const DATA    = 'https://data.alpaca.markets';

const UNIVERSE = {
  LLY:'stock', COST:'stock', TSLA:'stock', AMD:'stock', XOM:'stock',
  CRM:'stock', V:'stock', WMT:'stock', MA:'stock',
  NVDA:'stock', AAPL:'stock', META:'stock', GOOGL:'stock', MSFT:'stock',
  JPM:'stock', NFLX:'stock',
  'DOGE/USD':'crypto','LTC/USD':'crypto','LINK/USD':'crypto',
  'BTC/USD':'crypto','ETH/USD':'crypto','SOL/USD':'crypto',
};

const alpH = { 'APCA-API-KEY-ID': ALP_KEY, 'APCA-API-SECRET-KEY': ALP_SEC };
const ATR_TP = 2.0, ATR_SL = 1.0, TIME_STOP = 12;

async function getBars(symbol, limit) {
  const sym = symbol.replace('/', '%2F');
  const isCrypto = symbol.includes('/');

  if (isCrypto) {
    // Crypto: free API, go back 90 days
    const start = new Date(Date.now() - 90*86400000).toISOString().slice(0,10);
    const url = `${DATA}/v1beta3/crypto/us/bars?symbols=${sym}&timeframe=1Hour&limit=${limit}&start=${start}`;
    const d = await (await fetch(url, { headers: alpH })).json();
    return (d.bars && d.bars[symbol]) || [];
  }

  // Stocks: IEX free feed only has ~15 days; use limit only (no start date, no extended hours)
  try {
    const url = `${DATA}/v2/stocks/${symbol}/bars?timeframe=1Hour&limit=${limit}&feed=iex&adjustment=raw`;
    const d = await (await fetch(url, { headers: alpH })).json();
    if ((d.bars||[]).length >= 5) return d.bars;
  } catch(e) { console.log(`    iex error: ${e.message}`); }

  return [];
}

function ema(arr, n) {
  const k = 2/(n+1); let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i]*k + e*(1-k);
  return e;
}
function rsiCalc(closes) {
  const s = closes.slice(-15); let g=0,l=0;
  for (let i=1;i<s.length;i++){const d=s[i]-s[i-1];d>0?g+=d:l-=d;}
  return 100-100/(1+(g/(l||0.001)));
}
function atrCalc(bars, n=14) {
  const sl = bars.slice(-n-1); let sum=0;
  for (let i=1;i<sl.length;i++){const b=sl[i],p=sl[i-1];sum+=Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c));}
  return sum/Math.min(n,sl.length-1);
}
function check(bars) {
  if (bars.length < 25) return null;
  const n=bars.length, cls=bars.map(b=>b.c), hs=bars.map(b=>b.h), ls=bars.map(b=>b.l);
  const e9=ema(cls,9), e21=ema(cls,21), r=rsiCalc(cls), atr=atrCalc(bars);
  const sH=Math.max(...hs.slice(n-12,n-1)), sL=Math.min(...ls.slice(n-12,n-1));
  const last=bars[n-1], prev=bars[n-2];
  if (e9>e21 && r>45 && r<65 && last.c>sH && prev.c<=sH) return {side:'buy',  atr, e9, e21, rsi:r};
  if (e9<e21 && r>35 && r<55 && last.c<sL && prev.c>=sL) return {side:'sell', atr, e9, e21, rsi:r};
  return null;
}

function backtest(bars) {
  const results=[]; const n=bars.length;
  let i=25;
  while (i < n-2) {
    const sig = check(bars.slice(0,i+1));
    if (!sig) { i++; continue; }
    const entry = bars[i+1]?.o || bars[i].c;
    const atr = sig.atr;
    const tp = sig.side==='buy' ? entry+ATR_TP*atr : entry-ATR_TP*atr;
    const sl = sig.side==='buy' ? entry-ATR_SL*atr : entry+ATR_SL*atr;
    const tpPct = +(ATR_TP*atr/entry*100).toFixed(2);
    const slPct = +(ATR_SL*atr/entry*100).toFixed(2);
    let out=null;
    for (let j=i+1; j<Math.min(i+1+TIME_STOP,n); j++) {
      const b=bars[j];
      if (sig.side==='buy')  { if(b.h>=tp){out={win:true, pct:+tpPct,how:'TP'};break;} if(b.l<=sl){out={win:false,pct:-slPct,how:'SL'};break;} }
      else                   { if(b.l<=tp){out={win:true, pct:+tpPct,how:'TP'};break;} if(b.h>=sl){out={win:false,pct:-slPct,how:'SL'};break;} }
    }
    if (!out) {
      const ex=bars[Math.min(i+1+TIME_STOP,n-1)];
      const raw = sig.side==='buy' ? (ex.c-entry)/entry*100 : (entry-ex.c)/entry*100;
      out={win:raw>0, pct:+raw.toFixed(2), how:'TIME'};
    }
    results.push({date:bars[i].t.slice(0,10), side:sig.side, entry:+entry.toFixed(2), atr:+atr.toFixed(3), ...out});
    i += Math.max(3, TIME_STOP);
  }
  return results;
}

async function notify(title, body, priority, tags) {
  await fetch('https://ntfy.sh/'+NTFY, {
    method:'POST',
    headers:{'Title':title.replace(/[^\x00-\x7F]/g,''),'Priority':priority||'default','Tags':tags||'bar_chart'},
    body,
  });
}

async function main() {
  console.log('=== BACKTEST RUN:', new Date().toISOString(), '===\n');
  const rows=[], allResults=[];
  let totalWins=0, totalTrades=0, totalPnl=0;

  for (const [symbol, type] of Object.entries(UNIVERSE)) {
    process.stdout.write(`  ${symbol}... `);
    try {
      const bars = await getBars(symbol, 500);
      if (bars.length < 30) { console.log(`skip (${bars.length} bars)`); continue; }
      const results = backtest(bars);
      if (!results.length) { console.log('no signals'); continue; }

      const wins = results.filter(r=>r.win);
      const wr   = +(wins.length/results.length*100).toFixed(1);
      const pnl  = +results.reduce((s,r)=>s+r.pct,0).toFixed(2);
      const avg  = +(pnl/results.length).toFixed(2);
      const tpH  = results.filter(r=>r.how==='TP').length;
      const slH  = results.filter(r=>r.how==='SL').length;
      const tmH  = results.filter(r=>r.how==='TIME').length;

      const icon = wr>=55?'✅':wr>=45?'📊':'❌';
      const row  = `${icon} ${symbol.padEnd(10)} ${String(results.length).padStart(2)}T  ${wr}%WR  ${pnl>=0?'+':''}${pnl}%PnL  avg${avg>=0?'+':''}${avg}%  [TP:${tpH} SL:${slH} T:${tmH}]`;
      rows.push(row);
      allResults.push({symbol, trades:results.length, wins:wins.length, wr, pnl, tpH, slH, tmH});
      totalWins+=wins.length; totalTrades+=results.length; totalPnl+=pnl;
      console.log(`${results.length}T  ${wr}%WR  ${pnl>=0?'+':''}${pnl}%`);
    } catch(e) { console.log('ERROR:', e.message); }
  }

  if (!rows.length) { console.log('No results.'); return; }

  const overallWR  = +(totalWins/totalTrades*100).toFixed(1);
  const bestSyms   = [...allResults].sort((a,b)=>b.pnl-a.pnl).slice(0,3).map(s=>`${s.symbol}(+${s.pnl}%)`).join(', ');
  const worstSyms  = [...allResults].sort((a,b)=>a.pnl-b.pnl).slice(0,3).map(s=>`${s.symbol}(${s.pnl}%)`).join(', ');
  const strongBuys = allResults.filter(s=>s.wr>=55).length;

  console.log('\n── SUMMARY ──');
  console.log(`Symbols: ${allResults.length}  |  Trades: ${totalTrades}  |  Win rate: ${overallWR}%  |  Total PnL: ${totalPnl>=0?'+':''}${totalPnl.toFixed(1)}%`);
  console.log(`Best:  ${bestSyms}`);
  console.log(`Worst: ${worstSyms}`);

  const msg =
    `📊 BACKTEST — ATR exits (2:1 R:R)\n` +
    `TP=2×ATR  SL=1×ATR  TimeStop=${TIME_STOP}bars\n` +
    `1H bars · last 90 days · walk-forward\n\n` +
    rows.join('\n') +
    `\n\n${'─'.repeat(38)}\n` +
    `TOTAL: ${totalTrades} trades across ${allResults.length} symbols\n` +
    `WIN RATE: ${overallWR}% (${strongBuys} symbols ≥55%)\n` +
    `TOTAL PnL: ${totalPnl>=0?'+':''}${totalPnl.toFixed(1)}%\n` +
    `BEST: ${bestSyms}\n` +
    `WORST: ${worstSyms}`;

  console.log('\nSending ntfy...');
  await notify(`Backtest ${overallWR}% WR | ${totalPnl>=0?'+':''}${totalPnl.toFixed(1)}% PnL`, msg, 'default', 'bar_chart');
  console.log('Done — check ntfy: chinna-trading-alerts');
}

main().catch(console.error);

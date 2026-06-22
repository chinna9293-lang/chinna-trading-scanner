import https from 'https';

const AK = 'PK7T6WNU6ANNWQXMWFFFSYLKR7';
const AS = 'EDBn6MnYgP1eVkwnkSGpCByUTSLi9t4qHGoMBtNKDoz6';
const NTFY_TOPIC = 'chinna-trading-alerts';
const TP = 0.025, SL = 0.015, MAX_HOLD = 20;
const TRADE_SIZE = 500; // USD per trade

function httpGet(url, headers = {}) {
  return new Promise((res, rej) => {
    const opts = new URL(url);
    const req = https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch(e){ rej(e); } });
    });
    req.on('error', rej);
    req.setTimeout(12000, () => { req.destroy(); rej(new Error('timeout')); });
  });
}

function ntfyPost(title, body, priority = 'default', tags = '') {
  return new Promise((res) => {
    const data = Buffer.from(body);
    const req = https.request({
      hostname: 'ntfy.sh', path: '/' + NTFY_TOPIC, method: 'POST',
      headers: { 'Title': title, 'Priority': priority, ...(tags ? { 'Tags': tags } : {}), 'Content-Length': data.length }
    }, r => { r.resume(); r.on('end', res); });
    req.on('error', res);
    req.write(data); req.end();
  });
}

async function fetchYahoo(sym) {
  try {
    const end = Math.floor(Date.now()/1000), start = end - 86400*180;
    const d = await httpGet(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${start}&period2=${end}&interval=1d`);
    const r = d.chart?.result?.[0]; if (!r) return [];
    const q = r.indicators.quote[0];
    return r.timestamp.map((t,i) => ({ t: new Date(t*1000).toISOString().slice(0,10), o:q.open[i], h:q.high[i], l:q.low[i], c:q.close[i], v:q.volume[i] })).filter(b=>b.o&&b.c);
  } catch { return []; }
}

async function fetchCrypto(sym) {
  try {
    const d = await httpGet(`https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(sym)}&timeframe=1Hour&limit=1000`, { 'APCA-API-KEY-ID':AK,'APCA-API-SECRET-KEY':AS });
    return (d.bars?.[sym]) || [];
  } catch { return []; }
}

// ── Analyse (new 12/8 system) ─────────────────────────────────────────────────
function analyse(bars) {
  if (bars.length < 5) return null;
  const cls=bars.map(b=>b.c),vols=bars.map(b=>b.v),hs=bars.map(b=>b.h),ls=bars.map(b=>b.l);
  const n=cls.length;
  let e9=cls[0],e21=cls[0],e50=cls[0],e12=cls[0],e26=cls[0];
  for (let i=1;i<n;i++){e9=cls[i]*(2/10)+e9*(1-2/10);e21=cls[i]*(2/22)+e21*(1-2/22);e50=cls[i]*(2/51)+e50*(1-2/51);e12=cls[i]*(2/13)+e12*(1-2/13);e26=cls[i]*(2/27)+e26*(1-2/27);}
  let me12=cls[0],me26=cls[0];const macdArr=[];
  for (let i=1;i<n;i++){me12=cls[i]*(2/13)+me12*(1-2/13);me26=cls[i]*(2/27)+me26*(1-2/27);macdArr.push(me12-me26);}
  const macdLine=macdArr.at(-1)||0;let macdSig=macdArr[0]||0;
  for (let i=1;i<macdArr.length;i++) macdSig=macdArr[i]*(2/10)+macdSig*(1-2/10);
  const macdHist=macdLine-macdSig,macdHistPrev=macdArr.length>=2?macdArr.at(-2)-macdSig:0;
  let g2=0,l2=0;const rW=Math.min(14,n-1);
  for (let i=n-rW;i<n;i++){const d=cls[i]-cls[i-1];d>0?g2+=d:l2-=d;}
  const rsi=Math.round(100-100/(1+(g2/(l2||0.001))));
  const bbLen=Math.min(20,n),bbSlice=cls.slice(-bbLen),bbMid=bbSlice.reduce((a,b)=>a+b,0)/bbLen;
  const bbStd=Math.sqrt(bbSlice.reduce((s,v)=>s+(v-bbMid)**2,0)/bbLen);
  let obv=0;const obvArr=[0];
  for (let i=1;i<n;i++){obv+=cls[i]>cls[i-1]?vols[i]:cls[i]<cls[i-1]?-vols[i]:0;obvArr.push(obv);}
  const stLen=Math.min(14,n),stH=Math.max(...hs.slice(-stLen)),stL=Math.min(...ls.slice(-stLen));
  const stochK=Math.round(((cls[n-1]-stL)/(stH-stL||0.0001))*100);
  let dSum=0,dCnt=Math.min(3,n);
  for (let i=n-dCnt;i<n;i++){const sh=Math.max(...hs.slice(Math.max(0,i-stLen+1),i+1));const sl2=Math.min(...ls.slice(Math.max(0,i-stLen+1),i+1));dSum+=((cls[i]-sl2)/(sh-sl2||0.0001))*100;}
  const stochD=Math.round(dSum/dCnt);
  const vs=vols.slice(-Math.min(11,n),-1),vAvg=vs.reduce((a,b)=>a+b,0)/(vs.length||1)||1,vRat=+(vols[n-1]/vAvg).toFixed(1);
  const last=bars[n-1],range=last.h-last.l||0.0001,body=Math.abs(last.c-last.o)/range;
  const sH=Math.max(...hs.slice(-Math.min(12,n),-1));
  const tv=bars.reduce((s,b)=>s+(b.h+b.l+b.c)/3*b.v,0),tv2=bars.reduce((s,b)=>s+b.v,0);
  const vwap=tv2>0?tv/tv2:cls[n-1];
  // Count conditions
  const aboveVwap=last.c>vwap,priceUp=n>=4&&cls[n-1]>cls[n-4],vSpike=vRat>=2.5;
  const macdBull=macdLine>macdSig&&macdHist>macdHistPrev,macdBear=macdLine<macdSig&&macdHist<macdHistPrev;
  const aboveBbMid=cls[n-1]>bbMid,obvRising=n>=5&&obvArr[n-1]>obvArr[Math.max(0,n-6)];
  const obvFalling=n>=5&&obvArr[n-1]<obvArr[Math.max(0,n-6)];
  const stochBull=stochK>stochD&&stochK<80,stochBear=stochK<stochD&&stochK>20;
  const hhhl=n>=4&&hs[n-1]>hs[n-2]&&hs[n-2]>hs[n-3]&&ls[n-1]>ls[n-2];
  const breakUp=n>=2&&cls[n-1]>sH&&cls[n-2]>sH,strongC=body>0.6;
  const bs=(e9>e21?1:0)+(e21>e50?1:0)+(rsi>52&&rsi<70?1:0)+(aboveVwap?1:0)+(priceUp?1:0)+(vSpike?1:0)+(hhhl?1:0)+(breakUp?1:0)+(macdBull?1:0)+(aboveBbMid?1:0)+(obvRising?1:0)+(stochBull?1:0);
  const ds=(e9<e21?1:0)+(e21<e50?1:0)+(rsi<48?1:0)+(!aboveVwap?1:0)+(!priceUp?1:0)+(macdBear?1:0)+(!aboveBbMid?1:0)+(obvFalling?1:0);
  const dir=bs>=7&&e9>e21&&e21>e50?'bull':ds>=5&&e9<e21?'bear':'neutral';
  // Which flags triggered
  const flags=[];
  if(e9>e21) flags.push('EMA9>21');if(e21>e50) flags.push('EMA21>50');if(rsi>52&&rsi<70) flags.push('RSI✓');
  if(macdBull) flags.push('MACD↑');if(aboveVwap) flags.push('VWAP✓');if(aboveBbMid) flags.push('BB✓');
  if(obvRising) flags.push('OBV↑');if(stochBull) flags.push('Stoch✓');if(vSpike) flags.push('Vol✓');
  if(hhhl) flags.push('HH+HL');if(breakUp) flags.push('Breakout');if(strongC) flags.push('Candle✓');
  return { e9:+e9.toFixed(2),e21:+e21.toFixed(2),e50:+e50.toFixed(2),rsi,vRat,vwap:+vwap.toFixed(2),
    macdLine:+macdLine.toFixed(4),macdSig:+macdSig.toFixed(4),bbMid:+bbMid.toFixed(2),
    stochK,stochD,bs,ds,dir,flags };
}

// ── Walk-forward with trade log ───────────────────────────────────────────────
function backtest(sym, bars, tf) {
  const trades=[]; let inTrade=false,entryPrice=0,entryBar=0,entryDate='',entryFlags=[],entryA=null,prevDir='neutral';
  for (let i=30;i<bars.length-1;i++) {
    const a=analyse(bars.slice(0,i+1));
    if (!a) continue;
    const {dir}=a;
    if (!inTrade) {
      if (dir==='bull'&&prevDir!=='bull') {
        inTrade=true; entryPrice=bars[i+1].o||bars[i].c;
        entryBar=i+1; entryDate=bars[i].t||String(i);
        entryFlags=[...a.flags]; entryA={bs:a.bs,rsi:a.rsi,macd:a.macdLine.toFixed(4),vwap:a.vwap,stochK:a.stochK};
      }
    } else {
      const bar=bars[i];
      const tpP=+(entryPrice*(1+TP)).toFixed(4),slP=+(entryPrice*(1-SL)).toFixed(4);
      let exitPrice=null,exitReason='';
      if (bar.h>=tpP) { exitPrice=tpP; exitReason='TP HIT'; }
      else if (bar.l<=slP) { exitPrice=slP; exitReason='SL HIT'; }
      else if (i-entryBar>=MAX_HOLD) { exitPrice=bar.c; exitReason='TIME EXIT ('+MAX_HOLD+' bars)'; }
      else if (dir==='bear') { exitPrice=bar.c; exitReason='SIGNAL REVERSED'; }
      if (exitPrice!==null) {
        const pct=+((exitPrice-entryPrice)/entryPrice*100).toFixed(2);
        const pnlUSD=+(TRADE_SIZE*(pct/100)).toFixed(2);
        const win=pct>=0;
        const exitDate=bar.t||String(i);
        const holdBars=i-entryBar;
        trades.push({ sym,tf,entryDate,exitDate,entryPrice:+entryPrice.toFixed(4),exitPrice:+exitPrice.toFixed(4),
          pct,pnlUSD,win,exitReason,holdBars,flags:entryFlags,bs:entryA.bs,
          rsi:entryA.rsi,macd:entryA.macd,vwap:entryA.vwap,stochK:entryA.stochK });
        inTrade=false;
      }
    }
    prevDir=dir;
  }
  return trades;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const STOCKS=[{sym:'TSLA',yf:'TSLA'},{sym:'AAPL',yf:'AAPL'},{sym:'NVDA',yf:'NVDA'},{sym:'AMD',yf:'AMD'},{sym:'MSFT',yf:'MSFT'},{sym:'META',yf:'META'},{sym:'SPY',yf:'SPY'},{sym:'QQQ',yf:'QQQ'}];
const CRYPTO=['BTC/USD','ETH/USD','SOL/USD'];

console.log('\n📊 Running backtest with NEW system (12 bull / 8 bear)...\n');

let allTrades=[];

// Stocks
for (const {sym,yf} of STOCKS) {
  process.stdout.write(`  Fetching ${sym} (Yahoo 6mo daily)...\r`);
  const bars=await fetchYahoo(yf);
  if (bars.length<40){console.log(`  ${sym}: no data`);continue;}
  const trades=backtest(sym,bars,'1D');
  allTrades.push(...trades);
  console.log(`  ${sym}: ${bars.length} bars → ${trades.length} trades`);
}

// Crypto
for (const sym of CRYPTO) {
  process.stdout.write(`  Fetching ${sym} (Alpaca 1H)...\r`);
  const bars=await fetchCrypto(sym);
  if (bars.length<40){console.log(`  ${sym}: no data`);continue;}
  const trades=backtest(sym,bars,'1H');
  allTrades.push(...trades);
  console.log(`  ${sym}: ${bars.length} bars → ${trades.length} trades`);
}

if (!allTrades.length){console.log('No trades generated.');process.exit(0);}

// Sort by entry date
allTrades.sort((a,b)=>a.entryDate.localeCompare(b.entryDate));

const wins=allTrades.filter(t=>t.win);
const losses=allTrades.filter(t=>!t.win);
const totalPnl=allTrades.reduce((s,t)=>s+t.pnlUSD,0);
const winRate=((wins.length/allTrades.length)*100).toFixed(1);
const avgWin=wins.length?(wins.reduce((s,t)=>s+t.pct,0)/wins.length).toFixed(2):0;
const avgLoss=losses.length?(losses.reduce((s,t)=>s+t.pct,0)/losses.length).toFixed(2):0;

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  ${allTrades.length} trades found — sending to ntfy in batches...\n`);

// Send entry + exit for each trade
let tradeNum=0;
for (const t of allTrades) {
  tradeNum++;
  const dec=t.entryPrice<10?4:2;
  const tpPrice=(t.entryPrice*(1+TP)).toFixed(dec);
  const slPrice=(t.entryPrice*(1-SL)).toFixed(dec);

  // ENTRY notification
  const entryTitle=`BUY ENTRY #${tradeNum} - ${t.sym}`;
  const entryBody=
    `Date: ${t.entryDate}\n`+
    `Entry: $${t.entryPrice.toFixed(dec)}\n`+
    `TP: $${tpPrice} (+${(TP*100).toFixed(1)}%) | SL: $${slPrice} (-${(SL*100).toFixed(1)}%)\n`+
    `Signals (${t.bs}/12): ${t.flags.join(', ')}\n`+
    `RSI: ${t.rsi} | MACD: ${t.macd} | VWAP: $${t.vwap} | Stoch: ${t.stochK}`;
  await ntfyPost(entryTitle, entryBody, 'high', 'arrow_up');
  console.log(`  ✉ Sent ENTRY #${tradeNum}: ${t.sym} @ $${t.entryPrice.toFixed(dec)} [${t.entryDate}]`);
  await new Promise(r=>setTimeout(r,400)); // rate limit

  // EXIT notification
  const exitTitle=t.win
    ? `EXIT WIN #${tradeNum} - ${t.sym} +${t.pct}%`
    : `EXIT LOSS #${tradeNum} - ${t.sym} ${t.pct}%`;
  const exitBody=
    `Exit: ${t.exitDate} (held ${t.holdBars} bars)\n`+
    `Entry: $${t.entryPrice.toFixed(dec)} -> Exit: $${t.exitPrice.toFixed(dec)}\n`+
    `PnL: ${t.pct>=0?'+':''}${t.pct}% ($${t.pnlUSD>=0?'+':''}${t.pnlUSD} on $${TRADE_SIZE})\n`+
    `Reason: ${t.exitReason}`;
  await ntfyPost(exitTitle, exitBody, t.win?'default':'high', t.win?'white_check_mark':'x');
  console.log(`  ✉ Sent EXIT  #${tradeNum}: ${t.win?'WIN':'LOSS'} ${t.pct>=0?'+':''}${t.pct}% via ${t.exitReason}`);
  await new Promise(r=>setTimeout(r,400));
}

// ── Print full table ──────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  TRADE LOG');
console.log('══════════════════════════════════════════════════════════════════════');
console.log('#'.padEnd(4)+'Sym'.padEnd(8)+'Entry Date'.padEnd(13)+'Entry$'.padEnd(10)+'Exit$'.padEnd(10)+'PnL%'.padEnd(8)+'PnL$'.padEnd(8)+'Bars'.padEnd(6)+'Reason');
console.log('─'.repeat(80));
allTrades.forEach((t,i)=>{
  const dec=t.entryPrice<10?4:2;
  const flag=t.win?'✓':'✗';
  console.log(
    String(i+1).padEnd(4)+t.sym.padEnd(8)+t.entryDate.slice(0,10).padEnd(13)+
    ('$'+t.entryPrice.toFixed(dec)).padEnd(10)+('$'+t.exitPrice.toFixed(dec)).padEnd(10)+
    ((t.pct>=0?'+':'')+t.pct+'%').padEnd(8)+('$'+(t.pnlUSD>=0?'+':'')+t.pnlUSD).padEnd(8)+
    String(t.holdBars).padEnd(6)+flag+' '+t.exitReason
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
const bySymbol={};
allTrades.forEach(t=>{
  if(!bySymbol[t.sym]) bySymbol[t.sym]={trades:0,wins:0,pnl:0};
  bySymbol[t.sym].trades++; if(t.win) bySymbol[t.sym].wins++;
  bySymbol[t.sym].pnl+=t.pnlUSD;
});

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  SUMMARY BY SYMBOL');
console.log('─'.repeat(50));
Object.entries(bySymbol).sort((a,b)=>b[1].pnl-a[1].pnl).forEach(([s,v])=>{
  const wr=((v.wins/v.trades)*100).toFixed(0);
  console.log(`  ${s.padEnd(10)} ${String(v.trades+' trades').padEnd(12)} ${wr}% win   $${v.pnl>=0?'+':''}${v.pnl.toFixed(2)}`);
});

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  OVERALL RESULTS — NEW SYSTEM (12 bull / 8 bear + MACD/BB/OBV/Stoch)`);
console.log('══════════════════════════════════════════════════════════════════════');
console.log(`  Total trades : ${allTrades.length}`);
console.log(`  Win rate     : ${winRate}% (${wins.length}W / ${losses.length}L)`);
console.log(`  Avg win      : +${avgWin}%`);
console.log(`  Avg loss     : ${avgLoss}%`);
console.log(`  Total PnL    : $${totalPnl>=0?'+':''}${totalPnl.toFixed(2)} on $${TRADE_SIZE}/trade`);
console.log(`  Best trade   : ${allTrades.reduce((b,t)=>t.pct>b.pct?t:b,allTrades[0]).sym} +${allTrades.reduce((b,t)=>t.pct>b.pct?t:b,allTrades[0]).pct}%`);
console.log(`  Worst trade  : ${allTrades.reduce((b,t)=>t.pct<b.pct?t:b,allTrades[0]).sym} ${allTrades.reduce((b,t)=>t.pct<b.pct?t:b,allTrades[0]).pct}%`);
console.log(`  TP exits     : ${allTrades.filter(t=>t.exitReason==='TP HIT').length}`);
console.log(`  SL exits     : ${allTrades.filter(t=>t.exitReason==='SL HIT').length}`);
console.log(`  Signal rev.  : ${allTrades.filter(t=>t.exitReason==='SIGNAL REVERSED').length}`);
console.log(`  Time exits   : ${allTrades.filter(t=>t.exitReason.includes('TIME')).length}`);

// Send summary to ntfy
const summaryTitle=`Backtest Complete - ${winRate}% Win Rate`;
const summaryBody=
  `Total trades: ${allTrades.length} | Win: ${wins.length} | Loss: ${losses.length}\n`+
  `Win rate: ${winRate}%\n`+
  `Total PnL: $${totalPnl>=0?'+':''}${totalPnl.toFixed(2)} (${TRADE_SIZE}/trade)\n`+
  `Avg win: +${avgWin}% | Avg loss: ${avgLoss}%\n`+
  `TP hits: ${allTrades.filter(t=>t.exitReason==='TP HIT').length} | SL hits: ${allTrades.filter(t=>t.exitReason==='SL HIT').length} | Reversals: ${allTrades.filter(t=>t.exitReason==='SIGNAL REVERSED').length}\n`+
  `Best: ${allTrades.reduce((b,t)=>t.pct>b.pct?t:b,allTrades[0]).sym} +${allTrades.reduce((b,t)=>t.pct>b.pct?t:b,allTrades[0]).pct}% | Worst: ${allTrades.reduce((b,t)=>t.pct<b.pct?t:b,allTrades[0]).sym} ${allTrades.reduce((b,t)=>t.pct<b.pct?t:b,allTrades[0]).pct}%\n`+
  `System: 12 bull / 8 bear | MACD + BB + OBV + Stoch + HTF`;

await ntfyPost(summaryTitle, summaryBody, 'high', 'bar_chart');
console.log('\n  ✉ Summary sent to ntfy!\n');

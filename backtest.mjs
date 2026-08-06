import https from 'https';

const AK = 'PK7T6WNU6ANNWQXMWFFFSYLKR7';
const AS = 'EDBn6MnYgP1eVkwnkSGpCByUTSLi9t4qHGoMBtNKDoz6';
const TP = 0.025, SL = 0.015, MAX_HOLD = 20;

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

// Yahoo Finance — 6 months of daily OHLCV, no auth needed from Node
async function fetchYahoo(sym) {
  try {
    const end = Math.floor(Date.now()/1000);
    const start = end - 86400 * 180; // 6 months
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${start}&period2=${end}&interval=1d&events=history`;
    const d = await httpGet(url);
    const r = d.chart && d.chart.result && d.chart.result[0];
    if (!r) return [];
    const ts = r.timestamp, q = r.indicators.quote[0];
    return ts.map((t, i) => ({
      t: new Date(t*1000).toISOString(),
      o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i]
    })).filter(b => b.o && b.h && b.l && b.c);
  } catch { return []; }
}

// Alpaca crypto bars
async function fetchCrypto(sym) {
  try {
    const enc = encodeURIComponent(sym);
    const d = await httpGet(
      `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${enc}&timeframe=1Hour&limit=1000`,
      { 'APCA-API-KEY-ID': AK, 'APCA-API-SECRET-KEY': AS }
    );
    return (d.bars && d.bars[sym]) || [];
  } catch { return []; }
}

// ── OLD system (8 bull / 5 bear) ─────────────────────────────────────────────
function analyseOld(bars) {
  if (bars.length < 5) return null;
  const cls = bars.map(b => b.c), vols = bars.map(b => b.v);
  const hs = bars.map(b => b.h), ls = bars.map(b => b.l);
  const n = cls.length;
  let e9=cls[0],e21=cls[0],e50=cls[0];
  for (let i=1;i<n;i++){e9=cls[i]*(2/10)+e9*(1-2/10);e21=cls[i]*(2/22)+e21*(1-2/22);e50=cls[i]*(2/51)+e50*(1-2/51);}
  let g2=0,l2=0;const rW=Math.min(14,n-1);
  for (let i=n-rW;i<n;i++){const d=cls[i]-cls[i-1];if(d>0)g2+=d;else l2-=d;}
  const rsi=Math.round(100-100/(1+(g2/(l2||0.001))));
  const vs=vols.slice(-Math.min(11,n),-1);const vAvg=vs.reduce((a,b)=>a+b,0)/(vs.length||1)||1;
  const vRat=vols[n-1]/vAvg;const last=bars[n-1];
  const range=last.h-last.l||0.0001;const body=Math.abs(last.c-last.o)/range;
  const sH=Math.max(...hs.slice(-Math.min(12,n),-1));
  const tv=bars.reduce((s,b)=>s+(b.h+b.l+b.c)/3*b.v,0);const tv2=bars.reduce((s,b)=>s+b.v,0);
  const vwap=tv2>0?tv/tv2:cls[n-1];
  return { e9,e21,e50,rsi,vRat,vSpike:vRat>=2.5,strongC:body>0.6,
    breakUp:n>=2&&cls[n-1]>sH&&cls[n-2]>sH,
    hhhl:n>=4&&hs[n-1]>hs[n-2]&&hs[n-2]>hs[n-3]&&ls[n-1]>ls[n-2],
    aboveVwap:last.c>vwap,priceUp:n>=4&&cls[n-1]>cls[n-4] };
}
function getDirOld(a) {
  const bs=(a.e9>a.e21?1:0)+(a.e21>a.e50?1:0)+(a.rsi>52&&a.rsi<70?1:0)+(a.aboveVwap?1:0)+(a.priceUp?1:0)+(a.vSpike?1:0)+(a.hhhl?1:0)+(a.breakUp?1:0);
  const ds=(a.e9<a.e21?1:0)+(a.e21<a.e50?1:0)+(a.rsi<48?1:0)+(!a.aboveVwap?1:0)+(!a.priceUp?1:0);
  if (bs>=5&&a.e9>a.e21&&a.e21>a.e50) return 'bull';
  if (ds>=4&&a.e9<a.e21) return 'bear';
  return 'neutral';
}

// ── NEW system (12 bull / 8 bear) ────────────────────────────────────────────
function analyseNew(bars) {
  if (bars.length < 5) return null;
  const cls=bars.map(b=>b.c),vols=bars.map(b=>b.v),hs=bars.map(b=>b.h),ls=bars.map(b=>b.l);
  const n=cls.length;
  let e9=cls[0],e21=cls[0],e50=cls[0],e12=cls[0],e26=cls[0];
  for (let i=1;i<n;i++){e9=cls[i]*(2/10)+e9*(1-2/10);e21=cls[i]*(2/22)+e21*(1-2/22);e50=cls[i]*(2/51)+e50*(1-2/51);e12=cls[i]*(2/13)+e12*(1-2/13);e26=cls[i]*(2/27)+e26*(1-2/27);}
  let me12=cls[0],me26=cls[0];const macdArr=[];
  for (let i=1;i<n;i++){me12=cls[i]*(2/13)+me12*(1-2/13);me26=cls[i]*(2/27)+me26*(1-2/27);macdArr.push(me12-me26);}
  const macdLine=macdArr[macdArr.length-1]||0;let macdSig=macdArr[0]||0;
  for (let i=1;i<macdArr.length;i++) macdSig=macdArr[i]*(2/10)+macdSig*(1-2/10);
  const macdHist=macdLine-macdSig,macdHistPrev=macdArr.length>=2?macdArr[macdArr.length-2]-macdSig:0;
  let g2=0,l2=0;const rW=Math.min(14,n-1);
  for (let i=n-rW;i<n;i++){const d=cls[i]-cls[i-1];if(d>0)g2+=d;else l2-=d;}
  const rsi=Math.round(100-100/(1+(g2/(l2||0.001))));
  const bbLen=Math.min(20,n),bbSlice=cls.slice(-bbLen);
  const bbMid=bbSlice.reduce((a,b)=>a+b,0)/bbLen;
  const bbStd=Math.sqrt(bbSlice.reduce((s,v)=>s+(v-bbMid)**2,0)/bbLen);
  const aboveBbMid=cls[n-1]>bbMid;
  let obv=0;const obvArr=[0];
  for (let i=1;i<n;i++){obv+=cls[i]>cls[i-1]?vols[i]:cls[i]<cls[i-1]?-vols[i]:0;obvArr.push(obv);}
  const obvRising=n>=5&&obvArr[n-1]>obvArr[Math.max(0,n-6)];
  const obvFalling=n>=5&&obvArr[n-1]<obvArr[Math.max(0,n-6)];
  const stLen=Math.min(14,n),stH=Math.max(...hs.slice(-stLen)),stL=Math.min(...ls.slice(-stLen));
  const stochK=Math.round(((cls[n-1]-stL)/(stH-stL||0.0001))*100);
  let dSum=0,dCnt=Math.min(3,n);
  for (let i=n-dCnt;i<n;i++){const sh=Math.max(...hs.slice(Math.max(0,i-stLen+1),i+1));const sl2=Math.min(...ls.slice(Math.max(0,i-stLen+1),i+1));dSum+=((cls[i]-sl2)/(sh-sl2||0.0001))*100;}
  const stochD=Math.round(dSum/dCnt);
  const vs=vols.slice(-Math.min(11,n),-1),vAvg=vs.reduce((a,b)=>a+b,0)/(vs.length||1)||1,vRat=vols[n-1]/vAvg;
  const last=bars[n-1],range=last.h-last.l||0.0001,body=Math.abs(last.c-last.o)/range;
  const sH=Math.max(...hs.slice(-Math.min(12,n),-1));
  const tv=bars.reduce((s,b)=>s+(b.h+b.l+b.c)/3*b.v,0),tv2=bars.reduce((s,b)=>s+b.v,0);
  const vwap=tv2>0?tv/tv2:cls[n-1];
  return { e9,e21,e50,rsi,vRat,vSpike:vRat>=2.5,strongC:body>0.6,
    breakUp:n>=2&&cls[n-1]>sH&&cls[n-2]>sH,
    hhhl:n>=4&&hs[n-1]>hs[n-2]&&hs[n-2]>hs[n-3]&&ls[n-1]>ls[n-2],
    aboveVwap:last.c>vwap,priceUp:n>=4&&cls[n-1]>cls[n-4],
    macdBull:macdLine>macdSig&&macdHist>macdHistPrev,macdBear:macdLine<macdSig&&macdHist<macdHistPrev,
    aboveBbMid,obvRising,obvFalling,
    stochBull:stochK>stochD&&stochK<80,stochBear:stochK<stochD&&stochK>20 };
}
function getDirNew(a) {
  const bs=(a.e9>a.e21?1:0)+(a.e21>a.e50?1:0)+(a.rsi>52&&a.rsi<70?1:0)+(a.aboveVwap?1:0)+(a.priceUp?1:0)+(a.vSpike?1:0)+(a.hhhl?1:0)+(a.breakUp?1:0)+(a.macdBull?1:0)+(a.aboveBbMid?1:0)+(a.obvRising?1:0)+(a.stochBull?1:0);
  const ds=(a.e9<a.e21?1:0)+(a.e21<a.e50?1:0)+(a.rsi<48?1:0)+(!a.aboveVwap?1:0)+(!a.priceUp?1:0)+(a.macdBear?1:0)+(!a.aboveBbMid?1:0)+(a.obvFalling?1:0);
  if (bs>=7&&a.e9>a.e21&&a.e21>a.e50) return 'bull';
  if (ds>=5&&a.e9<a.e21) return 'bear';
  return 'neutral';
}

// ── Walk-forward simulate ────────────────────────────────────────────────────
function simulate(bars, getDirFn, analyseFn) {
  const results=[]; let inTrade=false,entryPrice=0,entryBar=0,prevDir='neutral';
  for (let i=30;i<bars.length-1;i++) {
    const a=analyseFn(bars.slice(0,i+1));
    if (!a) continue;
    const dir=getDirFn(a);
    if (!inTrade) {
      if (dir==='bull'&&prevDir!=='bull') {
        inTrade=true; entryPrice=bars[i+1].o||bars[i].c; entryBar=i+1;
      }
    } else {
      const bar=bars[i],tpP=entryPrice*(1+TP),slP=entryPrice*(1-SL);
      if (bar.h>=tpP) { results.push({pct:TP*100,result:'win',bars:i-entryBar}); inTrade=false; }
      else if (bar.l<=slP) { results.push({pct:-SL*100,result:'loss',bars:i-entryBar}); inTrade=false; }
      else if (i-entryBar>=MAX_HOLD||dir==='bear') {
        const ep=((bar.c-entryPrice)/entryPrice)*100;
        results.push({pct:+ep.toFixed(2),result:ep>=0?'win':'loss',bars:i-entryBar});
        inTrade=false;
      }
    }
    prevDir=dir;
  }
  if (!results.length) return null;
  const wins=results.filter(r=>r.result==='win').length;
  const totalPnl=results.reduce((s,r)=>s+r.pct,0);
  return { trades:results.length, wins, losses:results.length-wins,
    winRate:+((wins/results.length)*100).toFixed(1),
    totalPnl:+totalPnl.toFixed(2), avgPnl:+(totalPnl/results.length).toFixed(2) };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const STOCKS = ['TSLA','AAPL','NVDA','AMD','MSFT','META','SPY','QQQ'];
const CRYPTO = ['BTC/USD','ETH/USD','SOL/USD','LINK/USD'];

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  BACKTEST — OLD (8 bull/5 bear) vs NEW (12 bull/8 bear + MACD/BB/OBV/Stoch)');
console.log('  Stocks: 6mo daily bars (Yahoo) · Crypto: 1000x 1H bars (Alpaca)');
console.log('  TP +2.5% · SL -1.5% · Exit on reversal or 20-bar timeout');
console.log('══════════════════════════════════════════════════════════════════════\n');

const hdr = 'Symbol'.padEnd(10)+'OLD Tr'.padEnd(8)+'OLD Win%'.padEnd(10)+'OLD PnL'.padEnd(10)+'NEW Tr'.padEnd(8)+'NEW Win%'.padEnd(10)+'NEW PnL'.padEnd(10)+'Verdict';
console.log(hdr);
console.log('─'.repeat(75));

let totO={t:0,w:0,p:0}, totN={t:0,w:0,p:0};

for (const sym of STOCKS) {
  process.stdout.write(`  Loading ${sym}...\r`);
  const bars = await fetchYahoo(sym);
  if (bars.length < 40) { console.log(sym.padEnd(10)+'No data'); continue; }
  const old=simulate(bars,getDirOld,analyseOld);
  const nw =simulate(bars,getDirNew,analyseNew);
  if (!old||!nw) { console.log(sym.padEnd(10)+'Insufficient signals'); continue; }
  totO.t+=old.trades;totO.w+=old.wins;totO.p+=old.totalPnl;
  totN.t+=nw.trades; totN.w+=nw.wins; totN.p+=nw.totalPnl;
  const wΔ=(nw.winRate-old.winRate).toFixed(1);
  const v=nw.winRate>old.winRate?'✓ Better':nw.winRate<old.winRate?'✗ Worse ':'= Same';
  console.log(sym.padEnd(10)+String(old.trades).padEnd(8)+String(old.winRate+'%').padEnd(10)+String(old.totalPnl+'%').padEnd(10)+String(nw.trades).padEnd(8)+String(nw.winRate+'%').padEnd(10)+String(nw.totalPnl+'%').padEnd(10)+v+' (win '+(wΔ>0?'+':'')+wΔ+'%)');
}

console.log('─'.repeat(75));
for (const sym of CRYPTO) {
  process.stdout.write(`  Loading ${sym}...\r`);
  const bars = await fetchCrypto(sym);
  if (bars.length < 40) { console.log(sym.padEnd(10)+'No data'); continue; }
  const old=simulate(bars,getDirOld,analyseOld);
  const nw =simulate(bars,getDirNew,analyseNew);
  if (!old||!nw) { console.log(sym.padEnd(10)+'Insufficient signals'); continue; }
  totO.t+=old.trades;totO.w+=old.wins;totO.p+=old.totalPnl;
  totN.t+=nw.trades; totN.w+=nw.wins; totN.p+=nw.totalPnl;
  const wΔ=(nw.winRate-old.winRate).toFixed(1);
  const v=nw.winRate>old.winRate?'✓ Better':nw.winRate<old.winRate?'✗ Worse ':'= Same';
  console.log(sym.padEnd(10)+String(old.trades).padEnd(8)+String(old.winRate+'%').padEnd(10)+String(old.totalPnl+'%').padEnd(10)+String(nw.trades).padEnd(8)+String(nw.winRate+'%').padEnd(10)+String(nw.totalPnl+'%').padEnd(10)+v+' (win '+(wΔ>0?'+':'')+wΔ+'%)');
}

console.log('═'.repeat(75));
const oWR=totO.t?((totO.w/totO.t)*100).toFixed(1):0;
const nWR=totN.t?((totN.w/totN.t)*100).toFixed(1):0;
console.log('TOTAL'.padEnd(10)+String(totO.t).padEnd(8)+String(oWR+'%').padEnd(10)+String(totO.p.toFixed(2)+'%').padEnd(10)+String(totN.t).padEnd(8)+String(nWR+'%').padEnd(10)+String(totN.p.toFixed(2)+'%').padEnd(10)+(nWR>oWR?'✓ NEW WINS':'✗ OLD WINS'));
console.log('\n  OLD: '+totO.t+' trades · '+oWR+'% win rate · '+totO.p.toFixed(2)+'% cumulative PnL');
console.log('  NEW: '+totN.t+' trades · '+nWR+'% win rate · '+totN.p.toFixed(2)+'% cumulative PnL');
const tradeDiff=totO.t-totN.t;
console.log('  NEW takes '+(tradeDiff>0?tradeDiff+' fewer trades (more selective)':Math.abs(tradeDiff)+' more trades')+'\n');

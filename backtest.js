// Backtest — runs all strategies on 30 days of historical 5-min data
// Usage: node backtest.js
import { readFileSync } from 'fs';

// Load .env
try {
  readFileSync('../.env','utf8').split('\n').forEach(l=>{
    const [k,...v]=l.split('='); if(k&&v.length) process.env[k.trim()]=v.join('=').trim();
  });
} catch{}

const ALP_KEY = process.env.ALPACA_KEY;
const ALP_SEC = process.env.ALPACA_SECRET;
const ALP_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const DATA    = 'https://data.alpaca.markets';
const alpH    = { 'APCA-API-KEY-ID': ALP_KEY, 'APCA-API-SECRET-KEY': ALP_SEC };

// Backtest-filtered universe + updated TP/SL from scanner
const UNIVERSE = {
  LLY:'stock', COST:'stock', XOM:'stock', V:'stock', WMT:'stock',
  MA:'stock', CRM:'stock', TSLA:'stock', AMD:'stock',
  'DOGE/USD':'crypto','LTC/USD':'crypto','LINK/USD':'crypto',
};
const TP_SL = {
  LLY:{tp:2.5,sl:1.5}, COST:{tp:2.5,sl:1.0}, XOM:{tp:2.5,sl:1.2},
  V:{tp:2.0,sl:1.0},   WMT:{tp:2.0,sl:1.0},  MA:{tp:2.5,sl:1.2},
  CRM:{tp:2.5,sl:1.5}, TSLA:{tp:6.0,sl:2.0}, AMD:{tp:4.0,sl:1.5},
  'DOGE/USD':{tp:10.0,sl:3.0},'LTC/USD':{tp:6.0,sl:2.0},'LINK/USD':{tp:10.0,sl:3.0},
};

async function apGet(url) {
  const r = await fetch(url, { headers: alpH });
  return r.json();
}

async function fetchAllBars(symbol) {
  const isCrypto = symbol.includes('/');
  const sym = symbol.replace('/','%2F');
  // Go back 45 calendar days
  const start = new Date(Date.now() - 45*24*60*60*1000).toISOString().slice(0,10);
  const end   = new Date(Date.now() -  1*24*60*60*1000).toISOString().slice(0,10);
  let url, bars=[], pageToken=null;

  do {
    if (isCrypto)
      url = `${DATA}/v1beta3/crypto/us/bars?symbols=${sym}&timeframe=5Min&start=${start}&end=${end}&limit=10000`+(pageToken?'&page_token='+pageToken:'');
    else
      url = `${DATA}/v2/stocks/${sym}/bars?timeframe=5Min&start=${start}&end=${end}&limit=10000&feed=iex`+(pageToken?'&page_token='+pageToken:'');

    const d = await apGet(url);
    const chunk = isCrypto ? (d.bars&&d.bars[symbol]||[]) : (d.bars||[]);
    bars = bars.concat(chunk);
    pageToken = d.next_page_token || null;
  } while (pageToken);

  return bars;
}

// ── Indicator helpers ────────────────────────────────────────────────────────
function sma(arr,n){const s=arr.slice(-n);return s.reduce((a,b)=>a+b,0)/s.length;}
function ema(arr,n){const k=2/(n+1);let e=arr[0];for(let i=1;i<arr.length;i++)e=arr[i]*k+e*(1-k);return e;}
function rsi(cls){let g=0,l=0;for(let i=Math.max(1,cls.length-14);i<cls.length;i++){const d=cls[i]-cls[i-1];if(d>0)g+=d;else l-=d;}return 100-100/(1+(g/(l||0.001)));}
function vwap(bars){const tv=bars.reduce((s,b)=>s+(b.h+b.l+b.c)/3*b.v,0);const v=bars.reduce((s,b)=>s+b.v,0);return v>0?tv/v:bars[bars.length-1].c;}
function etHour(isoStr){return new Date(new Date(isoStr).toLocaleString('en-US',{timeZone:'America/New_York'})).getHours();}
function etMin(isoStr){return new Date(new Date(isoStr).toLocaleString('en-US',{timeZone:'America/New_York'})).getMinutes();}
function etTime(isoStr){const d=new Date(new Date(isoStr).toLocaleString('en-US',{timeZone:'America/New_York'}));return d.getHours()*60+d.getMinutes();}

// ── Signal detectors (windowed, same logic as scanner) ───────────────────────
function orbSignal(bars, dailyBars, todayStart) {
  const n=bars.length; if(n<10) return null;
  const et=etTime(bars[n-1].t);
  if(et<601||et>840) return null;
  const orBars=bars.filter(b=>etHour(b.t)===9&&etMin(b.t)>=30);
  if(orBars.length<2) return null;
  const orH=Math.max(...orBars.map(b=>b.h)),orL=Math.min(...orBars.map(b=>b.l));
  if((orH-orL)/orL<0.003) return null;
  const cls=bars.map(b=>b.c),vols=bars.map(b=>b.v),last=bars[n-1],prev=bars[n-2];
  const volMA=sma(vols.slice(-21,-1),20),rsiV=rsi(cls),vw=vwap(bars.slice(todayStart));
  const ema20=dailyBars.length>=20?ema(dailyBars.map(b=>b.c),20):last.c;
  if(last.c>ema20&&last.v>volMA*3&&rsiV>52&&rsiV<68&&last.c>vw*1.001&&last.c>orH&&prev.c>orH) return {side:'buy',price:last.c,strat:'ORB'};
  if(last.c<ema20&&last.v>volMA*3&&rsiV>32&&rsiV<48&&last.c<vw*0.999&&last.c<orL&&prev.c<orL) return {side:'sell',price:last.c,strat:'ORB'};
  return null;
}

function patternSignal(bars, todayStart) {
  const n=bars.length; if(n<15) return null;
  const et=etTime(bars[n-1].t);
  if(et<585||et>900) return null;
  const cls=bars.map(b=>b.c),hs=bars.map(b=>b.h),ls=bars.map(b=>b.l),vols=bars.map(b=>b.v),last=bars[n-1];
  const volMA=sma(vols.slice(-21,-1),20);
  const e9=ema(cls,9),e21=ema(cls,21),e50=ema(cls,50),rsiV=rsi(cls),vw=vwap(bars.slice(todayStart));
  const swH=Math.max(...hs.slice(-12,-2)),swL=Math.min(...ls.slice(-12,-2));
  const hhhl=hs[n-1]>hs[n-2]&&hs[n-2]>hs[n-3]&&ls[n-1]>ls[n-2];
  const lhll=hs[n-1]<hs[n-2]&&hs[n-2]<hs[n-3]&&ls[n-1]<ls[n-2];
  const bd=Math.abs(last.c-last.o),rn=last.h-last.l,sc=rn>0&&bd/rn>0.6;
  if(hhhl&&cls[n-1]>swH&&cls[n-2]>swH&&e9>e21&&e21>e50&&last.v>=volMA*2.5&&rsiV>55&&rsiV<68&&last.c>vw&&sc) return {side:'buy',price:last.c,strat:'Pattern'};
  if(lhll&&cls[n-1]<swL&&cls[n-2]<swL&&e9<e21&&e21<e50&&last.v>=volMA*2.5&&rsiV<45&&rsiV>30&&last.c<vw&&sc) return {side:'sell',price:last.c,strat:'Pattern'};
  return null;
}

function cryptoSignal(bars) {
  const n=bars.length; if(n<20) return null;
  const cls=bars.map(b=>b.c),hs=bars.map(b=>b.h),ls=bars.map(b=>b.l),vols=bars.map(b=>b.v),last=bars[n-1];
  const volMA=sma(vols.slice(-21,-1),20);
  const e9=ema(cls,9),e21=ema(cls,21),e50=ema(cls,50),rsiV=rsi(cls);
  const swH=Math.max(...hs.slice(-12,-2)),swL=Math.min(...ls.slice(-12,-2));
  const bd=Math.abs(last.c-last.o),rn=last.h-last.l,sc=rn>0&&bd/rn>0.4,vs=last.v>volMA*1.5;
  if(e9>e21&&e21>e50&&cls[n-1]>swH&&cls[n-2]>swH&&vs&&rsiV>50&&rsiV<75&&sc) return {side:'buy',price:last.c,strat:'Crypto'};
  if(e9<e21&&e21<e50&&cls[n-1]<swL&&cls[n-2]<swL&&vs&&rsiV<50&&rsiV>25&&sc) return {side:'sell',price:last.c,strat:'Crypto'};
  return null;
}

function chartPatternSignal(bars) {
  if(bars.length<20) return null;
  const n=bars.length,b=bars;
  const isBull=i=>b[i].c>b[i].o,isBear=i=>b[i].c<b[i].o;
  const body=i=>Math.abs(b[i].c-b[i].o),range=i=>b[i].h-b[i].l;
  const upper=i=>b[i].h-Math.max(b[i].o,b[i].c),lower=i=>Math.min(b[i].o,b[i].c)-b[i].l;
  const mid=i=>(b[i].o+b[i].c)/2,pct=(a,x)=>Math.abs(a-x)/x;
  const cls=bars.map(x=>x.c),hs=bars.map(x=>x.h),ls=bars.map(x=>x.l),vols=bars.map(x=>x.v);
  const volMA=sma(vols.slice(-21,-1),20),rsiV=rsi(cls);
  const found=[];

  // Bullish
  if(isBear(n-2)&&isBull(n-1)&&b[n-1].o<=b[n-2].c&&b[n-1].c>=b[n-2].o&&body(n-1)>body(n-2)*1.1)
    found.push({side:'buy',p:'Bullish Engulfing'});
  if(range(n-1)>0&&lower(n-1)>=body(n-1)*2&&upper(n-1)<=body(n-1)*0.5&&body(n-1)/range(n-1)<0.35&&rsiV<45)
    found.push({side:'buy',p:'Hammer'});
  if(n>=3&&isBear(n-3)&&body(n-2)<body(n-3)*0.3&&isBull(n-1)&&b[n-1].c>mid(n-3))
    found.push({side:'buy',p:'Morning Star'});
  if(isBear(n-2)&&isBull(n-1)&&b[n-1].o<b[n-2].l&&b[n-1].c>mid(n-2)&&b[n-1].c<b[n-2].o)
    found.push({side:'buy',p:'Piercing Line'});
  if(n>=3&&[n-3,n-2,n-1].every(i=>isBull(i)&&body(i)/range(i)>0.6)&&b[n-1].c>b[n-2].c&&b[n-2].c>b[n-3].c)
    found.push({side:'buy',p:'Three White Soldiers'});
  if(isBear(n-3)&&isBear(n-4)&&range(n-1)>0&&upper(n-1)>=body(n-1)*2&&lower(n-1)<=body(n-1)*0.5&&rsiV<40)
    found.push({side:'buy',p:'Inverted Hammer'});
  {const pe=n-8,pm=(b[pe]&&b[pe-3])?(b[pe].c-b[pe-3].c)/b[pe-3].c*100:0;
   const fH=Math.max(...hs.slice(n-7,n-1)),fL=Math.min(...ls.slice(n-7,n-1)),fr=(fH-fL)/fL*100;
   if(pm>1.5&&fr<pm*0.5&&b[n-1].c>fH&&b[n-1].v>volMA*1.5) found.push({side:'buy',p:'Bull Flag'});}
  {const rl=ls.slice(-20),l1i=rl.slice(0,10).indexOf(Math.min(...rl.slice(0,10)));
   const l2i=10+rl.slice(10).indexOf(Math.min(...rl.slice(10)));
   const l1=rl[l1i],l2=rl[l2i],nk=Math.max(...hs.slice(n-20+l1i,n-20+l2i));
   if(l1i<l2i-3&&pct(l1,l2)<0.02&&b[n-1].c>nk&&b[n-2].c<nk) found.push({side:'buy',p:'Double Bottom'});}
  {const l15H=hs.slice(-15),l15L=ls.slice(-15),tM=Math.max(...l15H.slice(0,-2)),tm=Math.min(...l15H.slice(0,-2));
   const flat=(tM-tm)/tM<0.015,ll=l15L.slice(0,-2),rl2=ll[ll.length-1]>ll[0]+(ll[ll.length-1]-ll[0])*0.3;
   if(flat&&rl2&&b[n-1].c>tM&&b[n-1].v>volMA*1.5) found.push({side:'buy',p:'Ascending Triangle'});}

  // Bearish
  if(isBull(n-2)&&isBear(n-1)&&b[n-1].o>=b[n-2].c&&b[n-1].c<=b[n-2].o&&body(n-1)>body(n-2)*1.1)
    found.push({side:'sell',p:'Bearish Engulfing'});
  if(isBull(n-3)&&isBull(n-4)&&range(n-1)>0&&upper(n-1)>=body(n-1)*2&&lower(n-1)<=body(n-1)*0.5&&body(n-1)/range(n-1)<0.35&&rsiV>60)
    found.push({side:'sell',p:'Shooting Star'});
  if(isBull(n-3)&&isBull(n-4)&&range(n-1)>0&&lower(n-1)>=body(n-1)*2&&upper(n-1)<=body(n-1)*0.5&&body(n-1)/range(n-1)<0.35&&rsiV>65)
    found.push({side:'sell',p:'Hanging Man'});
  if(n>=3&&isBull(n-3)&&body(n-2)<body(n-3)*0.3&&isBear(n-1)&&b[n-1].c<mid(n-3))
    found.push({side:'sell',p:'Evening Star'});
  if(isBull(n-2)&&isBear(n-1)&&b[n-1].o>b[n-2].h&&b[n-1].c<mid(n-2)&&b[n-1].c>b[n-2].o)
    found.push({side:'sell',p:'Dark Cloud Cover'});
  if(n>=3&&[n-3,n-2,n-1].every(i=>isBear(i)&&body(i)/range(i)>0.6)&&b[n-1].c<b[n-2].c&&b[n-2].c<b[n-3].c)
    found.push({side:'sell',p:'Three Black Crows'});
  {const pe=n-8,pm=(b[pe]&&b[pe-3])?(b[pe-3].c-b[pe].c)/b[pe-3].c*100:0;
   const fH=Math.max(...hs.slice(n-7,n-1)),fL=Math.min(...ls.slice(n-7,n-1)),fr=(fH-fL)/fL*100;
   if(pm>1.5&&fr<pm*0.5&&b[n-1].c<fL&&b[n-1].v>volMA*1.5) found.push({side:'sell',p:'Bear Flag'});}
  {const rh=hs.slice(-20),h1i=rh.slice(0,10).indexOf(Math.max(...rh.slice(0,10)));
   const h2i=10+rh.slice(10).indexOf(Math.max(...rh.slice(10)));
   const h1=rh[h1i],h2=rh[h2i],nk=Math.min(...ls.slice(n-20+h1i,n-20+h2i));
   if(h1i<h2i-3&&pct(h1,h2)<0.02&&b[n-1].c<nk&&b[n-2].c>nk) found.push({side:'sell',p:'Double Top'});}
  if(n>=25){const sg=hs.slice(-25),lsh=Math.max(...sg.slice(0,7)),hd=Math.max(...sg.slice(7,17)),rsh=Math.max(...sg.slice(17,24));
   const nk=Math.min(...ls.slice(-12,-3));
   if(hd>lsh*1.01&&hd>rsh*1.01&&pct(lsh,rsh)<0.04&&b[n-1].c<nk&&b[n-2].c>nk) found.push({side:'sell',p:'Head & Shoulders'});}
  {const l15H=hs.slice(-15),l15L=ls.slice(-15),bM=Math.max(...l15L.slice(0,-2)),bm=Math.min(...l15L.slice(0,-2));
   const flat=(bM-bm)/bm<0.015,hh=l15H.slice(0,-2),fh=hh[hh.length-1]<hh[0]-(hh[0]-hh[hh.length-1])*0.3;
   if(flat&&fh&&b[n-1].c<bm&&b[n-1].v>volMA*1.5) found.push({side:'sell',p:'Descending Triangle'});}

  if(found.length===0) return null;
  const pick=found[0];
  return {side:pick.side,price:bars[n-1].c,strat:'ChartPattern',p:pick.p};
}

// ── Simulate a trade: scan forward bars until TP or SL hit ──────────────────
function simulateTrade(allBars, entryIdx, side, entryPrice, tpPct, slPct) {
  const m = side==='buy' ? 1 : -1;
  const tp = entryPrice*(1+m*tpPct/100);
  const sl = entryPrice*(1-m*slPct/100);
  // Max hold: 78 bars = ~6.5 hours (full trading day)
  for (let i=entryIdx+1; i<Math.min(allBars.length, entryIdx+78); i++) {
    const b = allBars[i];
    // Check if new day (don't hold overnight for stocks)
    if (i > entryIdx+1) {
      const prevDate = allBars[i-1].t.slice(0,10);
      const curDate  = b.t.slice(0,10);
      if (prevDate !== curDate) {
        // Close at open of new day
        const exitPrice = b.o;
        return { exit:'EOD', exitPrice, pnlPct:(exitPrice-entryPrice)/entryPrice*100*m };
      }
    }
    if (side==='buy') {
      if (b.h >= tp) return { exit:'TP', exitPrice:tp, pnlPct:tpPct };
      if (b.l <= sl) return { exit:'SL', exitPrice:sl, pnlPct:-slPct };
    } else {
      if (b.l <= tp) return { exit:'TP', exitPrice:tp, pnlPct:tpPct };
      if (b.h >= sl) return { exit:'SL', exitPrice:sl, pnlPct:-slPct };
    }
  }
  const last = allBars[Math.min(allBars.length-1, entryIdx+77)];
  const exitPrice = last.c;
  return { exit:'Time', exitPrice, pnlPct:(exitPrice-entryPrice)/entryPrice*100*m };
}

// ── Backtest one symbol ──────────────────────────────────────────────────────
async function backtestSymbol(symbol, type) {
  const cfg = TP_SL[symbol];
  const bars = await fetchAllBars(symbol);
  if (bars.length < 30) return null;

  const trades = [];
  const WIN = 30; // sliding window size
  const tradedDays = new Set(); // one trade per day per symbol

  // For daily bars (needed by ORB)
  let dailyBars = [];
  try {
    const sym=symbol.replace('/','%2F'),isCrypto=symbol.includes('/');
    const start=new Date(Date.now()-90*24*60*60*1000).toISOString().slice(0,10);
    const url=isCrypto
      ?`${DATA}/v1beta3/crypto/us/bars?symbols=${sym}&timeframe=1Day&start=${start}&limit=100`
      :`${DATA}/v2/stocks/${sym}/bars?timeframe=1Day&start=${start}&limit=100&feed=iex`;
    const d=await apGet(url);
    dailyBars=isCrypto?(d.bars&&d.bars[symbol]||[]):(d.bars||[]);
  } catch{}

  for (let i = WIN; i < bars.length - 2; i++) {
    const window = bars.slice(i-WIN, i+1);
    const barDate = bars[i].t.slice(0,10);
    if (tradedDays.has(barDate)) continue;

    // Find today's start index in window
    const todayStart = window.findIndex(b=>b.t.startsWith(barDate));

    let sig = null;
    const strats = type==='crypto' ? ['Crypto','ChartPattern'] : ['ORB','Pattern','ChartPattern'];

    for (const strat of strats) {
      if (strat==='ORB')          sig = orbSignal(window, dailyBars.slice(0, dailyBars.findIndex(d=>d.t.startsWith(barDate))+1)||dailyBars, todayStart>=0?todayStart:0);
      else if (strat==='Pattern') sig = patternSignal(window, todayStart>=0?todayStart:0);
      else if (strat==='Crypto')  sig = cryptoSignal(window);
      else if (strat==='ChartPattern') sig = chartPatternSignal(window);
      if (sig) break;
    }

    if (!sig) continue;

    const result = simulateTrade(bars, i, sig.side, sig.price, cfg.tp, cfg.sl);
    trades.push({
      date: barDate,
      strategy: sig.strat + (sig.p?` [${sig.p}]`:''),
      side: sig.side,
      entry: sig.price,
      exit: result.exit,
      exitPrice: result.exitPrice,
      pnl: result.pnlPct,
    });
    tradedDays.add(barDate);
  }
  return trades;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         CHINNA TRADING SYSTEM — BACKTEST (45 days)      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const allResults = [];
  const patternCount = {};

  for (const [symbol, type] of Object.entries(UNIVERSE)) {
    process.stdout.write(`Backtesting ${symbol.padEnd(10)}...`);
    try {
      const trades = await backtestSymbol(symbol, type);
      if (!trades || trades.length === 0) { console.log(' no trades'); continue; }

      const wins   = trades.filter(t=>t.pnl>0);
      const losses = trades.filter(t=>t.pnl<=0);
      const winRate= (wins.length/trades.length*100).toFixed(0);
      const totalPnl = trades.reduce((s,t)=>s+t.pnl,0);
      const avgWin  = wins.length>0 ? wins.reduce((s,t)=>s+t.pnl,0)/wins.length : 0;
      const avgLoss = losses.length>0 ? losses.reduce((s,t)=>s+t.pnl,0)/losses.length : 0;

      console.log(` ${trades.length} trades | Win: ${winRate}% | Total P&L: ${totalPnl.toFixed(1)}% | Avg W: +${avgWin.toFixed(1)}% L: ${avgLoss.toFixed(1)}%`);
      allResults.push({ symbol, type, trades, wins:wins.length, losses:losses.length, winRate:parseFloat(winRate), totalPnl, avgWin, avgLoss });

      trades.forEach(t => {
        const strat = t.strategy;
        if (!patternCount[strat]) patternCount[strat]={wins:0,losses:0};
        if (t.pnl>0) patternCount[strat].wins++; else patternCount[strat].losses++;
      });
    } catch(e) { console.log(' ERROR:', e.message); }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  RESULTS BY SYMBOL');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Symbol     | Trades | W% | Total P&L | Avg Win | Avg Loss');
  console.log('───────────|--------|----|-----------|---------|---------');
  allResults.sort((a,b)=>b.totalPnl-a.totalPnl).forEach(r=>{
    console.log(
      r.symbol.padEnd(10)+' | '+
      String(r.trades.length).padStart(6)+' | '+
      String(r.winRate+'%').padStart(4)+' | '+
      (r.totalPnl>=0?'+':'')+r.totalPnl.toFixed(1)+'%'.padEnd(8)+' | '+
      '+'+r.avgWin.toFixed(1)+'%   | '+
      r.avgLoss.toFixed(1)+'%'
    );
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RESULTS BY STRATEGY / PATTERN');
  console.log('═══════════════════════════════════════════════════════════');
  Object.entries(patternCount)
    .sort((a,b)=>(b[1].wins/(b[1].wins+b[1].losses))-(a[1].wins/(a[1].wins+a[1].losses)))
    .forEach(([strat,{wins,losses}])=>{
      const tot=wins+losses;
      console.log(`${strat.padEnd(35)} ${wins}W/${losses}L  ${(wins/tot*100).toFixed(0)}% win`);
    });

  // ── Overall ─────────────────────────────────────────────────────────────────
  const allTrades = allResults.flatMap(r=>r.trades);
  const totalW = allTrades.filter(t=>t.pnl>0).length;
  const totalL = allTrades.filter(t=>t.pnl<=0).length;
  const totalPnl = allTrades.reduce((s,t)=>s+t.pnl,0);

  // Compound $10k
  let equity = 10000;
  allTrades.forEach(t=>{ equity = equity*(1+t.pnl/100); });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  OVERALL SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Total Trades : ${allTrades.length}`);
  console.log(`Win Rate     : ${(totalW/allTrades.length*100).toFixed(1)}%  (${totalW}W / ${totalL}L)`);
  console.log(`Total P&L    : ${totalPnl.toFixed(1)}%`);
  console.log(`$10,000 → $${equity.toFixed(2)}  (${((equity-10000)/100).toFixed(0)}% gain)`);
  console.log('');
}

main().catch(console.error);

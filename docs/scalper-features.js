// 🚀 SCALPER FEATURES MODULE

// 1. BID/ASK DATA
let bidAsk = {};

// 2. PLAY ALERT SOUND
function playAlert(type = 'signal') {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  if (type === 'buy') { osc.frequency.value = 800; gain.gain.setValueAtTime(0.1, audioCtx.currentTime); }
  else if (type === 'sell') { osc.frequency.value = 400; gain.gain.setValueAtTime(0.1, audioCtx.currentTime); }
  else { osc.frequency.value = 600; gain.gain.setValueAtTime(0.05, audioCtx.currentTime); }
  
  osc.start(audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
  osc.stop(audioCtx.currentTime + 0.3);
}

// 3. FETCH BID/ASK (Alpaca)
async function fetchBidAsk(sym) {
  try {
    const res = await fetch(`https://paper-api.alpaca.markets/v2/last/trades?symbols=${sym}`, { headers: AH });
    const data = await res.json();
    if (data.trades && data.trades[sym]) {
      const t = data.trades[sym];
      bidAsk[sym] = { bid: t.p - 0.01, ask: t.p + 0.01, spread: 0.02, price: t.p };
    }
  } catch (e) { console.warn('Bid/ask fetch failed:', e.message); }
}

// 4. EXECUTE TRADE (Market Order)
async function executeOrder(sym, side, qty) {
  if (!LP[sym]) { alert('No price data'); return; }
  
  const price = LP[sym].price;
  const orderData = {
    symbol: sym,
    qty: qty,
    side: side,
    type: 'market',
    time_in_force: 'day'
  };
  
  try {
    const res = await fetch('https://paper-api.alpaca.markets/v2/orders', {
      method: 'POST',
      headers: AH,
      body: JSON.stringify(orderData)
    });
    const order = await res.json();
    
    if (order.id) {
      playAlert(side === 'buy' ? 'buy' : 'sell');
      alert(`✅ ${side.toUpperCase()} ${qty} ${sym} @ $${price.toFixed(2)}\nOrder ID: ${order.id}`);
      return order;
    } else {
      alert(`❌ Order failed: ${order.message}`);
    }
  } catch (e) {
    alert(`❌ Error: ${e.message}`);
  }
}

// 5. HEAT MAP - SORT BY PERFORMANCE
function getSortedTickers() {
  return STOCKS.map(sym => {
    const curr = LP[sym]?.price || 0;
    const prev = LP[sym]?.prev || curr;
    const change = prev ? ((curr - prev) / prev * 100).toFixed(2) : 0;
    return { sym, price: curr, change: parseFloat(change), vol: Math.random() * 5 };
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

// 6. ALERT ON SIGNAL
function checkScalpSignal(sym, a) {
  if (!a) return false;
  
  const rsiOverbought = a.rsi > 63;
  const rsiOversold = a.rsi < 37;
  const emaCross = a.ema9 > a.ema21 ? 'bullish' : 'bearish';
  const volumeSpike = (LP[sym]?.volume || 0) > (UNI[sym]?.avgVol || 1000000) * 1.5;
  
  if ((rsiOversold || emaCross === 'bullish') && volumeSpike) {
    playAlert('buy');
    return { signal: 'BUY', strength: 'HIGH', entry: LP[sym].price, tp: LP[sym].price * 1.02, sl: LP[sym].price * 0.98 };
  }
  
  if ((rsiOverbought || emaCross === 'bearish') && volumeSpike) {
    playAlert('sell');
    return { signal: 'SELL', strength: 'HIGH', entry: LP[sym].price, tp: LP[sym].price * 0.98, sl: LP[sym].price * 1.02 };
  }
  
  return false;
}

console.log('✅ Scalper Features Loaded');

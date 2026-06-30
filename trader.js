// Continuous Trader — Scan & Monitor every 30 seconds, 24/7
// One unified service: Check positions OR scan for signals

const NTFY    = process.env.NTFY_TOPIC      || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY      || 'PK3VYJM2GDKUMCAICARZNBDBDX';
const ALP_SEC = process.env.ALPACA_SECRET   || '6tRAaKznU9XXKVpMNP1FrKBi228FeSbTdbLD8HGk9Zx2';
const ALP_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
const DATA    = 'https://data.alpaca.markets';

const UNIVERSE = {
  SPY:  { type:'stock',  risk:'low'  },
  QQQ:  { type:'stock',  risk:'low'  },
  GLD:  { type:'stock',  risk:'low'  },
  MSFT: { type:'stock',  risk:'low'  },
  NVDA: { type:'stock',  risk:'low'  },
  LLY:  { type:'stock',  risk:'low'  },
  COST: { type:'stock',  risk:'low'  },
  TSLA: { type:'stock',  risk:'low'  },
  AMD:  { type:'stock',  risk:'low'  },
  CRM:  { type:'stock',  risk:'low'  },
  WMT:  { type:'stock',  risk:'low'  },
  META: { type:'stock',  risk:'high' },
  GOOGL:{ type:'stock',  risk:'high' },
  NFLX: { type:'stock',  risk:'high' },
  'DOGE/USD': { type:'crypto', risk:'low'  },
  'LTC/USD':  { type:'crypto', risk:'low'  },
  'LINK/USD': { type:'crypto', risk:'low'  },
  'BTC/USD':  { type:'crypto', risk:'high' },
  'ETH/USD':  { type:'crypto', risk:'high' },
  'SOL/USD':  { type:'crypto', risk:'high' },
};

const ATR_TP = 2.0;
const ATR_SL = 1.0;
const alpH = { 'APCA-API-KEY-ID': ALP_KEY, 'APCA-API-SECRET-KEY': ALP_SEC };

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function apGet(url) {
  const r = await fetch(url, { headers: alpH });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function apPost(path, body) {
  const r = await fetch(ALP_URL + path, {
    method: 'POST',
    headers: { ...alpH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function notify(title, body, priority = 'default', emoji = '') {
  try {
    await fetch(`https://ntfy.sh/${NTFY}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': priority,
        'Tags': emoji,
        'Content-Type': 'text/plain'
      },
      body
    });
  } catch(e) { console.error('Notify error:', e.message); }
}

function ema(closes, len) {
  if (closes.length < len) return closes[closes.length - 1];
  const k = 2 / (len + 1);
  let e = closes[0];
  for (let i = 1; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}

function atrCalc(bars) {
  let tr_sum = 0, cnt = 0;
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    tr_sum += tr; cnt++;
  }
  return tr_sum / cnt;
}

function rsiCalc(closes, len = 14) {
  if (closes.length < len + 1) return 50;
  let up = 0, dn = 0;
  for (let i = closes.length - len; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) up += delta;
    else dn -= delta;
  }
  const rs = up / (dn || 1);
  return 100 - (100 / (1 + rs));
}

// ─────────────────────────────────────────────────────────────────────────────
// MONITOR OPEN POSITIONS
// ─────────────────────────────────────────────────────────────────────────────

async function monitorPositions() {
  try {
    const positions = await apGet(`${ALP_URL}/v2/positions`);
    if (!Array.isArray(positions) || positions.length === 0) return null;

    // Monitor each position
    for (const pos of positions) {
      const pnl = parseFloat(pos.unrealized_pl);
      const pnlPct = (parseFloat(pos.unrealized_plpc) * 100).toFixed(2);
      const sym = pos.symbol;

      process.stdout.write(pnl > 0 ? '📈' : pnl < 0 ? '📉' : '➡️');

      // Alert on significant moves
      if (Math.abs(pnl) > 200) {
        await notify(
          `${pnl > 0 ? '📈 PROFIT' : '📉 LOSS'} ${sym}`,
          `P&L: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct}%)\nCurrent: $${pos.current_price}`,
          pnl > 0 ? 'high' : 'urgent',
          pnl > 0 ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend'
        );
      }
    }

    return positions.length > 0;
  } catch(e) {
    console.error('Monitor error:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN FOR SIGNALS (simplified)
// ─────────────────────────────────────────────────────────────────────────────

async function getBars(symbol, limit = 60) {
  try {
    const isCrypto = symbol.includes('/');
    const tf = '5m';
    const url = isCrypto
      ? `${DATA}/v1beta3/crypto/us/bars?symbols=${symbol}&timeframe=${tf}&limit=${limit}`
      : `https://paper-api.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=${tf}&limit=${limit}`;

    const r = await fetch(url, { headers: alpH, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];

    const data = await r.json();
    const bars = data.bars?.[symbol] || data.bars || [];
    return Array.isArray(bars) ? bars : [];
  } catch {
    return [];
  }
}

function checkSignal(bars) {
  if (bars.length < 25) return null;

  const closes = bars.map(b => b.c);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const r = rsiCalc(closes);
  const atr = atrCalc(bars);
  const last = bars[bars.length - 1];

  // Simple: EMA9 > EMA21 + RSI in zone
  if (e9 > e21 && r > 45 && r < 65) {
    return { side: 'buy', price: last.c, atr, e9, e21, rsi: r };
  }

  return null;
}

async function scanForSignal() {
  try {
    const day = new Date().getUTCDay();

    for (const [symbol, cfg] of Object.entries(UNIVERSE)) {
      try {
        if (cfg.type === 'stock' && (day === 0 || day === 6)) continue;

        // Check if already traded
        const pos = await apGet(ALP_URL + '/v2/positions');
        const alpSym = symbol.replace('/', '');
        if (Array.isArray(pos) && pos.find(p => p.symbol === alpSym)) {
          process.stdout.write('_');
          continue;
        }

        // Get bars and check signal
        const bars = await getBars(symbol);
        if (bars.length < 25) { process.stdout.write('?'); continue; }

        const sig = checkSignal(bars);
        if (!sig) { process.stdout.write('.'); continue; }

        // Signal found! Place trade
        process.stdout.write('🟢');

        const m = 1;
        const tpPx = (sig.price + m * ATR_TP * sig.atr).toFixed(2);
        const slPx = (sig.price - m * ATR_SL * sig.atr).toFixed(2);

        const acct = await apGet(ALP_URL + '/v2/account');
        const equity = parseFloat(acct.equity || 100000);
        const qty = Math.max(1, Math.floor(equity * 0.10 / sig.price));

        const order = await apPost('/v2/orders', {
          symbol,
          qty: String(qty),
          side: 'buy',
          type: 'market',
          time_in_force: 'day',
          order_class: 'bracket',
          take_profit: { limit_price: tpPx },
          stop_loss: { stop_price: slPx },
        });

        if (order.id) {
          await notify(
            `🟢 BUY SIGNAL ${symbol}`,
            `Entry: $${sig.price}\nTP: $${tpPx}\nSL: $${slPx}\nQty: ${qty}`,
            'high',
            'rocket'
          );
        }

        return true; // Only one trade per cycle
      } catch(e) {
        // Skip errors, continue scanning
      }
    }

    return false;
  } catch(e) {
    console.error('Scan error:', e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: RUN EVERY 30 SECONDS
// ─────────────────────────────────────────────────────────────────────────────

async function cycle() {
  const time = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
  process.stdout.write(`\n[${time}] `);

  // Check if position is open
  const hasPosition = await monitorPositions();

  // If no open position, scan for signals
  if (!hasPosition) {
    await scanForSignal();
  }

  // Send heartbeat notification (confirm bot is alive)
  try {
    const mode = hasPosition ? 'MONITORING' : 'SCANNING';
    await fetch(`https://ntfy.sh/${NTFY}`, {
      method: 'POST',
      headers: {
        'Title': `BOT ALIVE - ${mode}`,
        'Priority': 'min',
        'Tags': 'robot'
      },
      body: `🤖 Cycle: ${time}\n${hasPosition ? '📊' : '🔍'} ${mode}\n${hasPosition ? 'Monitoring position' : 'Scanning for signals'}`
    });
  } catch(e) {
    // Silent fail on notification
  }
}

async function main() {
  console.log('=== Continuous Trader Started (every 30s) ===\n');

  while (true) {
    try {
      await cycle();
    } catch(e) {
      console.error('\nCycle error:', e.message);
    }

    // Wait 30 seconds before next cycle
    await new Promise(r => setTimeout(r, 30000));
  }
}

main().catch(console.error);
// Schedule reactivation - Mon Jun 29 19:37:07 CDT 2026

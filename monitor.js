// 24/7 Trade Monitor — Checks positions every 30 seconds, 24/7
// Independent of hourly scanner

const NTFY    = process.env.NTFY_TOPIC      || 'chinna-trading-alerts';
const ALP_KEY = process.env.ALPACA_KEY      || 'PK3VYJM2GDKUMCAICARZNBDBDX';
const ALP_SEC = process.env.ALPACA_SECRET   || '6tRAaKznU9XXKVpMNP1FrKBi228FeSbTdbLD8HGk9Zx2';
const ALP_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

const alpH = { 'APCA-API-KEY-ID': ALP_KEY, 'APCA-API-SECRET-KEY': ALP_SEC };

async function apGet(url) {
  const r = await fetch(url, { headers: alpH });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
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

async function monitorPositions() {
  try {
    const positions = await apGet(`${ALP_URL}/v2/positions`);
    if (!Array.isArray(positions) || positions.length === 0) {
      process.stdout.write('.');
      return;
    }

    for (const pos of positions) {
      const sym = pos.symbol;
      const currentPrice = parseFloat(pos.current_price);
      const pnl = parseFloat(pos.unrealized_pl);
      const pnlPct = (parseFloat(pos.unrealized_plpc) * 100).toFixed(2);
      const side = pos.side.toUpperCase();
      const qty = parseFloat(pos.qty);
      const entry = parseFloat(pos.avg_entry_price);

      // Check if trade is in profit
      if (pnl > 0) {
        process.stdout.write('📈'); // Green - profit
      } else if (pnl < 0) {
        process.stdout.write('📉'); // Red - loss
      } else {
        process.stdout.write('➡️'); // Neutral
      }

      // Alert on significant profit
      if (pnl > 0 && pnl > (entry * 0.02)) {
        await notify(
          `📈 PROFIT BUILDING ${sym}`,
          `${side} ${qty} @ $${entry}\nCurrent: $${currentPrice}\nP&L: +$${pnl.toFixed(2)} (+${pnlPct}%)`,
          'high',
          'chart_with_upwards_trend'
        );
      }

      // Alert on significant loss
      if (pnl < 0 && pnl < -(entry * 0.015)) {
        await notify(
          `📉 LOSS BUILDING ${sym}`,
          `${side} ${qty} @ $${entry}\nCurrent: $${currentPrice}\nP&L: $${pnl.toFixed(2)} (${pnlPct}%)`,
          'urgent',
          'chart_with_downwards_trend'
        );
      }
    }

  } catch(e) {
    console.error('Monitor error:', e.message);
  }
}

async function main() {
  console.log('=== 24/7 Trade Monitor Started ===');
  console.log(`Checking positions every 30 seconds`);

  // Monitor continuously
  while (true) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
    process.stdout.write(`\n[${timeStr}] `);

    await monitorPositions();

    // Wait 30 seconds
    await new Promise(r => setTimeout(r, 30000));
  }
}

main().catch(console.error);

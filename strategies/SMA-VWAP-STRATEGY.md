# SMA Stack + VWAP + DTR/ATR + Volume — Textbook Strategy

A standalone, classic trend/range strategy. Kept separate from the "Luxy UT GOD"
confluence engine (`strategy.js`) used by the live bots — nothing in this repo
wires this one up automatically. Implementation: `strategies/sma-vwap-strategy.js`.

This is a rules framework, not a guarantee. Every rule below can and does fail,
especially in choppy or news-driven markets. Not financial advice.

## 1. Trend filter — SMA stack (5 / 10 / 50 / 100 / 200)

Check the order of price and the five simple moving averages.

- **Bullish stack:** `price > SMA5 > SMA10 > SMA50 > SMA100 > SMA200`, all sloping up.
  This is the only environment where textbook long entries are taken.
- **Bearish stack:** the mirror image, all sloping down. Only environment for shorts.
- **Tangled/crossing MAs, no clear order:** stand aside regardless of what VWAP or
  volume are doing. This is the single most important filter — it overrides
  everything else below.

## 2. Range context — Daily Trading Range (DTR) vs ATR(14)

`DTR` = today's high − today's low. `ATR(14)` = 14-day average true range,
computed from the days *before* today.

- **Compressed** (`DTR / ATR < 0.7`): today's range is unusually tight. This is
  the classic pre-breakout coil — the setups with the best risk:reward tend to
  come right after compression resolves in the direction of the SMA stack.
- **Exhausted** (`DTR / ATR >= 1.5`): today's range has already run 1.5x+ a
  normal day. Textbook rule: do not initiate new entries once a session is
  already exhausted — you're buying/selling into a move that's largely over,
  not the start of one. If you're already in a position, this is a signal to
  tighten stops or take partial profit.

## 3. Intraday trigger — VWAP

VWAP (volume-weighted average price, session-to-date) is the fair-value line
for the day, not a signal by itself.

- **Above VWAP and holding:** buyers in control. Pullbacks into VWAP are the
  textbook long entry zone.
- **Below VWAP and holding:** sellers in control. Rallies into VWAP are the
  textbook short entry zone.
- **VWAP reclaim** (price closes back above VWAP after being below it) or
  **VWAP loss** (closes back below after being above) are the flip triggers —
  but only trust a *close* through VWAP, not an intrabar wick.

## 4. Confirmation — Relative Volume (RVOL)

`RVOL` = current bar's volume ÷ average volume of the prior 20 bars.

- **RVOL ≥ 1.5:** the move has real participation behind it — required to
  validate an entry.
- **RVOL < 0.7 while price makes a new high/low:** classic exhaustion /
  divergence tell. Volume drying up into a new extreme is a textbook signal
  to tighten stops even if price hasn't hit target.

## Entry rules (as implemented in `checkEntry`)

**Long:**
1. Bullish SMA stack (daily)
2. Price holding above VWAP, or just reclaiming it
3. RVOL ≥ 1.5 on the trigger bar
4. Today's range is not already exhausted (`DTR/ATR < 1.5`)

**Short:** mirror image — bearish stack, below/losing VWAP, RVOL ≥ 1.5, range not exhausted.

**Stop:** the tighter of SMA10 or VWAP.
**Target:** 2× ATR(14) from entry (textbook 2:1 reward:risk against the SMA10/VWAP stop, which typically runs close to 1× ATR).

## Exit rules (as implemented in `checkExit`), any one is enough to act on

1. Close back through SMA10 against your position — short-term trend broken.
2. Close back through VWAP against your position — session control lost.
3. Today's range already exhausted (`DTR/ATR ≥ 1.5`) — tighten or trail.
4. RVOL drops below 0.7 while the position is open — momentum fading.

Two or more of these together is a stronger signal to be flat than any single one alone.

## Usage

```js
import { checkEntry, checkExit } from './strategies/sma-vwap-strategy.js';

// dailyBars: 200+ days of { o, h, l, c, v }, oldest first
// intradayBars: today's session bars (e.g. 5-min), oldest first
const signal = checkEntry(dailyBars, intradayBars);
if (signal) {
  console.log(signal.side, signal.rule, signal.stop, signal.target);
}

// Later, with an open position:
const exit = checkExit({ side: 'BUY' }, dailyBars, intradayBars);
if (exit.exit) console.log('Exit reasons:', exit.reasons);
```

This module is read-only logic — it does not fetch data or place orders. Wire
it up to a data feed (e.g. Alpaca bars, like the other bots in this repo use)
yourself if/when you want to run it live or backtest it.

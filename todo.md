# CHINNA PRO — Trading Scanner Overhaul + Congressional Trades

## Tasks

### 1. Setup Scanner — Filter & Validation Engine
- [x] Add `setupValid(sym)` function: combines trend + momentum + volume + volatility to validate setups
- [x] Define: clear trend (|trend|≥15), acceptable risk (RR≥1.2 & slPct within sane bounds), supporting volume (volR≥0.9)
- [x] Add a "Valid Setups Only" filter toggle in screener

### 2. Enhanced Detail Panel — Full Trade Setup
- [x] When ticker clicked, show: Ticker, Direction, Exact entry zone (range), Stop-loss, Profit target, R:R, Market potential score, Congressional trade signal, Reason setup is valid
- [x] Add `setupReason(sym)` that generates a human-readable explanation of WHY the setup is valid
- [x] Add entry zone (low/high) based on ATR + current price

### 3. 24/7 Trading with Crypto
- [x] Make crypto tickers always live regardless of market session (always fetch)
- [x] Update SESSION/tick logic: crypto pairs always update; stocks follow session rules
- [x] Add more crypto pairs to UNI for 24/7 feel

### 4. Ranking
- [x] All results ranked strongest to weakest (by power score — already done, verify)
- [x] X Trend tab sorted by popularity (trending score tr), not by score

### 5. Congressional Trades Dashboard
- [x] Research & embed real recent congressional trade data
- [x] Build CONGRESS object with embedded trades for tickers in our universe
- [x] Add congressional trades panel in the sidebar (right column)
- [x] Show: politician, party, ticker, type (buy/sell), amount, date, and impact analysis
- [x] Add `congSignal(sym)` that returns congressional trade signal for a given ticker
- [x] Show congressional signal in detail panel for each ticker

### 6. Build, Validate, Push, Verify
- [x] Validate JS syntax with node --check
- [x] Copy dashboard-pro.html → index.html
- [ ] Push to GitHub
- [ ] Verify live on GitHub Pages with cache-busting

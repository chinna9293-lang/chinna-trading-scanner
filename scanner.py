"""
Chinna Trading Scanner — FastAPI Backend
Pine Script v5 logic: EMA200 + EMA9/21 + daily-anchored VWAP + RSI<55 + EMA9 candle test
Uses iloc[-2] for confirmed candle, ET timezone via pytz

Run:  uvicorn scanner:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd
import pandas_ta as ta
import pytz
import yfinance as yf
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Chinna Trading Scanner", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

ET = pytz.timezone("America/New_York")

UNIVERSE: list[str] = [
    "AAPL", "TSLA", "NVDA", "GOOGL", "MSFT", "META", "AMZN",
    "AMD",  "NFLX", "JPM",  "LLY",   "COST", "XOM",  "AVGO",
    "V",    "MA",   "WMT",  "CRM",   "ORCL", "BAC",  "KO",
    "PLTR", "SOFI", "MSTR", "COIN",  "HOOD", "IONQ", "SMCI",
]


# ── helpers ──────────────────────────────────────────────────────────────────

def _flatten(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten MultiIndex columns produced by yfinance ≥0.2.38."""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def _avwap(df: pd.DataFrame) -> pd.Series:
    """Daily-anchored VWAP: resets at the start of each calendar day (ET)."""
    idx = df.index
    if idx.tzinfo is None:
        idx = idx.tz_localize("UTC")
    idx_et = idx.tz_convert(ET)
    day_key = idx_et.normalize()

    typical = (df["High"] + df["Low"] + df["Close"]) / 3
    tpv = typical * df["Volume"]

    result = pd.Series(np.nan, index=df.index, dtype=float)
    for day, grp in df.groupby(day_key):
        mask = day_key == day
        cum_vol = df.loc[mask, "Volume"].cumsum().replace(0, np.nan)
        result.loc[mask] = tpv.loc[mask].cumsum() / cum_vol

    return result


def _ema(series: pd.Series, length: int) -> pd.Series:
    return ta.ema(series, length=length)


# ── per-ticker scan ───────────────────────────────────────────────────────────

def _scan_ticker(ticker: str) -> dict[str, Any] | None:
    try:
        raw = yf.download(
            ticker, period="10d", interval="5m",
            progress=False, auto_adjust=True,
        )
        df = _flatten(raw)
        if df is None or len(df) < 60:
            return None

        df["ema9"]   = _ema(df["Close"], 9)
        df["ema21"]  = _ema(df["Close"], 21)
        df["ema200"] = _ema(df["Close"], 200)
        df["rsi"]    = ta.rsi(df["Close"], length=14)
        df["atr"]    = ta.atr(df["High"], df["Low"], df["Close"], length=14)
        df["avwap"]  = _avwap(df)

        df = df.dropna(subset=["ema9", "ema21", "rsi", "atr", "avwap"])
        if len(df) < 2:
            return None

        # Use confirmed (fully-closed) candle at iloc[-2]
        bar = df.iloc[-2]

        price = float(bar["Close"])
        e9    = float(bar["ema9"])
        e21   = float(bar["ema21"])
        e200  = float(bar["ema200"]) if not pd.isna(bar["ema200"]) else price
        rsi   = float(bar["rsi"])
        atr   = float(bar["atr"])
        avwap = float(bar["avwap"])
        low   = float(bar["Low"])
        vol   = float(bar["Volume"])

        # Average volume over last 20 confirmed bars
        avg_vol = float(df["Volume"].iloc[-21:-1].mean())

        # Pine Script v5 conditions
        c1 = price > e200                         # macro uptrend
        c2 = e9 > e21                             # micro momentum
        c3 = price > avwap                        # above AVWAP
        c4 = rsi < 55                             # pullback zone
        c5 = abs(low - e9) <= atr * 0.5          # candle tests EMA9

        passed = int(c1) + int(c2) + int(c3) + int(c4) + int(c5)
        sl     = round(price - 1.5 * atr, 2)
        tp     = round(price + 2.0 * atr, 2)
        rr     = round((tp - price) / (price - sl), 2) if price > sl else 0.0

        if passed < 3:
            return None

        return {
            "ticker":     ticker,
            "signal":     "BUY" if passed == 5 else f"WATCH ({passed}/5)",
            "entry":      round(price, 2),
            "sl":         sl,
            "tp":         tp,
            "rsi":        round(rsi, 1),
            "atr":        round(atr, 2),
            "e9":         round(e9, 2),
            "e21":        round(e21, 2),
            "e200":       round(e200, 2),
            "avwap":      round(avwap, 2),
            "volume":     int(vol),
            "avg_volume": int(avg_vol),
            "vol_spike":  round(vol / avg_vol, 2) if avg_vol else 0.0,
            "rr_ratio":   rr,
            "passed":     passed,
            "conditions": {"c1": c1, "c2": c2, "c3": c3, "c4": c4, "c5": c5},
            "scanned_at": datetime.now(ET).isoformat(),
        }
    except Exception as exc:
        print(f"[{ticker}] error: {exc}")
        return None


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/api/scan")
async def scan_stocks(
    min_passed: int = Query(default=3, ge=1, le=5),
    signal: str    = Query(default="all", description="all | BUY | WATCH"),
):
    """
    Scan the universe for intraday setups.

    Returns:
        {
          "signals": [...],
          "count": N,
          "scanned_at": "ISO-8601 ET"
        }
    """
    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(None, _scan_ticker, t)
        for t in UNIVERSE
    ]
    raw_results = await asyncio.gather(*tasks)

    results = [r for r in raw_results if r is not None and r["passed"] >= min_passed]

    if signal.upper() == "BUY":
        results = [r for r in results if r["signal"] == "BUY"]
    elif signal.upper() == "WATCH":
        results = [r for r in results if r["signal"].startswith("WATCH")]

    results.sort(key=lambda x: (x["passed"], x["rr_ratio"]), reverse=True)

    return {
        "signals":    results,
        "count":      len(results),
        "scanned_at": datetime.now(ET).isoformat(),
    }


@app.get("/api/ticker/{ticker}")
async def get_ticker(ticker: str):
    """Scan a single ticker."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _scan_ticker, ticker.upper())
    if result is None:
        return {"ticker": ticker.upper(), "signal": "NO_SETUP", "passed": 0}
    return result


@app.get("/api/health")
async def health():
    return {
        "status":    "ok",
        "version":   "2.0.0",
        "universe":  len(UNIVERSE),
        "time_et":   datetime.now(ET).isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)

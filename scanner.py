"""
Chinna Trading Scanner — FastAPI backend
Strategy: EMA200 macro + EMA9/21 micro + AVWAP + RSI<55 pullback + EMA9 candle test
Run:  uvicorn scanner:app --reload --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import pandas_ta as ta
import numpy as np
from datetime import datetime

app = FastAPI(title="Chinna Trading Scanner")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

UNIVERSE = [
    "AAPL", "TSLA", "NVDA", "GOOGL", "MSFT", "META", "AMZN",
    "AMD",  "NFLX", "JPM",  "LLY",   "COST", "XOM",  "AVGO",
    "V",    "MA",   "WMT",  "CRM",   "ORCL", "BAC",  "KO",
]


def _avwap(df: pd.DataFrame) -> pd.Series:
    """Session VWAP (proxy for AVWAP)."""
    typical = (df["High"] + df["Low"] + df["Close"]) / 3
    cum_vol = df["Volume"].cumsum().replace(0, np.nan)
    return (typical * df["Volume"]).cumsum() / cum_vol


def _flatten(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten MultiIndex columns returned by yfinance."""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


@app.get("/api/scan")
async def scan_stocks():
    results = []

    for ticker in UNIVERSE:
        try:
            raw = yf.download(ticker, period="5d", interval="5m",
                              progress=False, auto_adjust=True)
            df = _flatten(raw)
            if df is None or len(df) < 60:
                continue

            df["ema9"]   = ta.ema(df["Close"], length=9)
            df["ema21"]  = ta.ema(df["Close"], length=21)
            df["ema200"] = ta.ema(df["Close"], length=200)
            df["rsi"]    = ta.rsi(df["Close"], length=14)
            df["atr"]    = ta.atr(df["High"], df["Low"], df["Close"], length=14)
            df["avwap"]  = _avwap(df)

            df = df.dropna(subset=["ema9", "ema21", "rsi", "atr", "avwap"])
            if len(df) < 2:
                continue

            last  = df.iloc[-1]
            price = float(last["Close"])
            e9    = float(last["ema9"])
            e21   = float(last["ema21"])
            e200  = float(last["ema200"]) if not pd.isna(last["ema200"]) else price
            rsi   = float(last["rsi"])
            atr   = float(last["atr"])
            avwap = float(last["avwap"])
            low   = float(last["Low"])

            c1 = price > e200                    # Macro uptrend
            c2 = e9 > e21                        # Micro momentum
            c3 = price > avwap                   # Above AVWAP
            c4 = rsi < 55                        # Pullback zone
            c5 = abs(low - e9) <= atr * 0.5     # Candle tests EMA9

            passed = int(c1) + int(c2) + int(c3) + int(c4) + int(c5)
            sl = round(price - 1.5 * atr, 2)
            tp = round(price + 2.0 * atr, 2)

            if passed >= 3:
                results.append({
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
                    "conditions": {"c1": c1, "c2": c2, "c3": c3, "c4": c4, "c5": c5},
                    "passed":     passed,
                    "scanned_at": datetime.utcnow().isoformat() + "Z",
                })
        except Exception as exc:
            print(f"[{ticker}] error: {exc}")

    results.sort(key=lambda x: x["passed"], reverse=True)
    return results


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat() + "Z"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)

"""先物・為替コネクタ（yfinance）。

Yahoo Finance の日次データを月次終値（その月の最終営業日の終値）に集約し、
``date``(月初) / ``value`` の DataFrame と出典メタ ``Source`` を返す。

ティッカー: 小麦 ZW=F / 大豆 ZS=F / 砂糖 SB=F / 綿 CT=F / USDJPY JPY=X。

``downloader`` を渡すと ``downloader(ticker) -> 日次 DataFrame`` を使う（テストでモック）。
渡さない場合は実行時に ``yfinance.download`` を使う。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

import pandas as pd

from etl.provenance import Source

_CLOSE_CANDIDATES = ("Close", "Adj Close", "close", "adjclose")


def _close_series(daily: pd.DataFrame) -> pd.Series:
    """日次 DataFrame から終値 Series を取り出す（列名の揺れに対応）。"""
    for col in _CLOSE_CANDIDATES:
        if col in daily.columns:
            return daily[col]
    # yfinance の MultiIndex 列（('Close','ZW=F')）に対応。
    if isinstance(daily.columns, pd.MultiIndex):
        for col in _CLOSE_CANDIDATES:
            if col in daily.columns.get_level_values(0):
                sub = daily[col]
                return sub.iloc[:, 0] if isinstance(sub, pd.DataFrame) else sub
    raise ValueError(f"No close column found in columns: {list(daily.columns)}")


def aggregate_monthly_close(daily: pd.DataFrame) -> pd.DataFrame:
    """日次 OHLC から月次終値（月初日付）の ``date``/``value`` 表を作る。"""
    close = _close_series(daily).astype(float)
    index = pd.to_datetime(close.index)
    close = pd.Series(close.to_numpy(), index=index).sort_index()
    monthly = close.resample("MS").last().dropna()
    df = pd.DataFrame({"date": monthly.index, "value": monthly.to_numpy()})
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = df["value"].astype(float)
    return df.reset_index(drop=True)


def fetch_futures(
    ticker: str,
    *,
    series_id: str,
    name: str,
    url: str,
    license: str,
    unit: str,
    frequency: str = "monthly",
    downloader: Callable[[str], pd.DataFrame] | None = None,
    retrieved_at: datetime | None = None,
) -> tuple[pd.DataFrame, Source]:
    """yfinance から 1 銘柄を取得し月次集約した ``(DataFrame, Source)`` を返す。"""
    if downloader is None:
        downloader = _default_downloader

    daily = downloader(ticker)
    if daily is None or len(daily) == 0:
        raise ValueError(f"No price data returned for ticker '{ticker}'.")

    df = aggregate_monthly_close(daily)
    source = Source(
        series_id=series_id,
        name=name,
        url=url,
        retrieved_at=retrieved_at or datetime.now(timezone.utc),
        license=license,
        unit=unit,
        frequency=frequency,
    )
    return df, source


def _default_downloader(ticker: str) -> pd.DataFrame:  # pragma: no cover - network
    import yfinance as yf

    return yf.download(ticker, period="max", interval="1d", auto_adjust=False, progress=False)

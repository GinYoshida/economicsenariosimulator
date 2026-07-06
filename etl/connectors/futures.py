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

import numpy as np
import pandas as pd

from etl.provenance import Source

_CLOSE_CANDIDATES = ("Close", "Adj Close", "close", "adjclose")


def _close_series(daily: pd.DataFrame) -> pd.Series:
    """日次 DataFrame から終値を 1 次元 Series で取り出す（列名の揺れに対応）。

    新しめの yfinance は単一銘柄でも MultiIndex 列（('Close','ZW=F')）を返す。
    ``daily["Close"]`` が 1 列 DataFrame になり得るため、常に Series に落とす。
    """
    columns = daily.columns
    picked: Any = None
    if isinstance(columns, pd.MultiIndex):
        level0 = columns.get_level_values(0)
        for col in _CLOSE_CANDIDATES:
            if col in level0:
                picked = daily.xs(col, axis=1, level=0)
                break
    else:
        for col in _CLOSE_CANDIDATES:
            if col in columns:
                picked = daily[col]
                break
    if picked is None:
        raise ValueError(f"No close column found in columns: {list(columns)}")
    if isinstance(picked, pd.DataFrame):
        picked = picked.iloc[:, 0]  # 1 列 DataFrame -> Series
    return picked


def aggregate_monthly_close(daily: pd.DataFrame) -> pd.DataFrame:
    """日次 OHLC から月次終値（月初日付）の ``date``/``value`` 表を作る。"""
    series = _close_series(daily)
    values = np.asarray(series, dtype=float).reshape(-1)  # (n,1) でも 1 次元化
    index = pd.to_datetime(pd.Index(series.index))
    close = pd.Series(values, index=index).sort_index()
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

"""バックテスト指標とナイーブ比較。

- ``mae`` / ``rmse``: 平均絶対誤差・二乗平均平方根誤差（NaN 対を除外）。
- ``direction_hit``: 符号一致率（予測と実測の符号が一致した割合）。
- ``naive_persistence``: 前年比 persistence（直前の観測値をそのまま予測）。
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _valid_pairs(y_true, y_pred) -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(y_true, dtype=float)
    b = np.asarray(y_pred, dtype=float)
    mask = ~np.isnan(a) & ~np.isnan(b)
    return a[mask], b[mask]


def mae(y_true, y_pred) -> float:
    a, b = _valid_pairs(y_true, y_pred)
    if len(a) == 0:
        return float("nan")
    return float(np.mean(np.abs(a - b)))


def rmse(y_true, y_pred) -> float:
    a, b = _valid_pairs(y_true, y_pred)
    if len(a) == 0:
        return float("nan")
    return float(np.sqrt(np.mean((a - b) ** 2)))


def direction_hit(y_true, y_pred) -> float:
    a, b = _valid_pairs(y_true, y_pred)
    if len(a) == 0:
        return float("nan")
    return float(np.mean(np.sign(a) == np.sign(b)))


def naive_persistence(y: pd.Series) -> pd.Series:
    """直前値を予測とするナイーブ系列（先頭は NaN）。"""
    return y.shift(1)

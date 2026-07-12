"""説明変数（ドライバー）の状態空間モデルによる先行き予測。

各ドライバー系列にローカル線形トレンド（statsmodels UnobservedComponents）を当て、
horizon か月先の平均と標準偏差（信頼帯の幅）を得る。数値が不安定な場合は
ランダムウォーク＋ドリフトにフォールバックする。

出力は日付キーの ``DriverForecast``（観測済み月は実績・std=0、将来月は予測・std>0）。
フロントはこの平均と分散を線形モデルへ伝播して目的変数の信頼帯を作る。
"""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from models.schema import DriverForecast, DriverForecastPoint

MIN_OBS = 24  # 状態空間を当てる最小観測数（不足時はフォールバック）


def _months_between(a: pd.Timestamp, b: pd.Timestamp) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def _fallback(y: pd.Series, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """ランダムウォーク＋ドリフト。信頼幅は時間の平方根で拡大。"""
    y = y.dropna().astype(float)
    last = float(y.iloc[-1]) if len(y) else 0.0
    diffs = y.diff().dropna()
    drift = float(diffs.mean()) if len(diffs) else 0.0
    sigma = float(diffs.std(ddof=1)) if len(diffs) > 1 else 0.0
    steps = np.arange(1, horizon + 1)
    mean = last + drift * steps
    se = sigma * np.sqrt(steps)
    return mean, se


def forecast_driver(y: pd.Series, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """``horizon`` か月先の (平均, 標準偏差) を返す。"""
    y = y.dropna().astype(float)
    if len(y) < MIN_OBS:
        return _fallback(y, horizon)
    try:
        from statsmodels.tsa.statespace.structural import UnobservedComponents

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            res = UnobservedComponents(
                y.to_numpy(), level="local linear trend"
            ).fit(disp=False, maxiter=50)
            fc = res.get_forecast(horizon)
            mean = np.asarray(fc.predicted_mean, dtype=float)
            se = np.asarray(fc.se_mean, dtype=float)
        if np.all(np.isfinite(mean)) and np.all(np.isfinite(se)):
            return mean, np.abs(se)
    except Exception:
        pass
    return _fallback(y, horizon)


def build_driver_forecasts(
    panel: pd.DataFrame,
    drivers: list[str],
    *,
    last_target_date: pd.Timestamp,
    horizon: int,
    max_lag: int,
    label_of: dict[str, str],
    unit_of: dict[str, str],
) -> list[DriverForecast]:
    """各ドライバーの日付キー予測（観測実績＋将来予測）を作る。

    対象日付は ``last_target_date - max_lag`` 〜 ``last_target_date + horizon``。
    目的変数月 t に対しドライバーは t-lag を参照するため、この範囲を用意する。
    """
    start = (last_target_date - pd.DateOffset(months=max_lag)).normalize()
    end = (last_target_date + pd.DateOffset(months=horizon)).normalize()
    dates = pd.date_range(start, end, freq="MS")

    out: list[DriverForecast] = []
    for col in drivers:
        if col not in panel.columns:
            continue
        s = panel[col].dropna().sort_index()
        if s.empty:
            continue
        last_obs = s.index.max()
        steps = max(1, _months_between(last_obs, end))
        mean, se = forecast_driver(s, steps)

        points: list[DriverForecastPoint] = []
        for d in dates:
            if d in s.index:
                points.append(
                    DriverForecastPoint(date=d.date().isoformat(),
                                        mean=float(s[d]), std=0.0)
                )
            elif d > last_obs:
                k = _months_between(last_obs, d)  # 1-based ステップ
                if 1 <= k <= len(mean):
                    points.append(
                        DriverForecastPoint(
                            date=d.date().isoformat(),
                            mean=float(mean[k - 1]),
                            std=float(se[k - 1]),
                        )
                    )
        if points:
            out.append(
                DriverForecast(
                    driver=col,
                    label_ja=label_of.get(col, col),
                    unit=unit_of.get(col, ""),
                    points=points,
                )
            )
    return out

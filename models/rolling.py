"""ローリング h か月先予測（拡張窓・後ろ向き＝前向き同条件）。

各起点 O（月次）について、O までのデータだけで
  1. カテゴリ別 OLS を再推定（拡張窓）
  2. 状態空間でドライバーを O から horizon か月先まで予測
し、対象 T=O+h（h=1..horizon）の予測平均と標準偏差を得る。
過去の起点も未来の起点（O=最新月）も**まったく同じ条件**で計算するため、
「h か月先予測が過去→未来に連続する」帯を、実績と重ねて検証できる。

出力は各 (category, h, target date) の {mean, sd, actual}。フロントは選択した h で
中心線＋信頼度別の帯を描き、実績（actual）と重ねる。

計算量に注意（起点×ドライバーの状態空間フィット）。表示対象月数を絞る。
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from models.driver_forecast import build_driver_forecasts
from models.features import TARGET_BY_CATEGORY, make_features
from models.ols import fit_ols, predict


def _iso(ts: pd.Timestamp) -> str:
    return ts.date().isoformat()


def _resid_sigma(fit, X: pd.DataFrame, y: pd.Series) -> float:
    resid = y.to_numpy(dtype=float) - predict(fit, X)
    return float(np.sqrt(np.mean(resid**2))) if len(resid) else 0.0


def build_rolling_forecasts(
    panel: pd.DataFrame,
    categories: list[str],
    category_drivers: dict[str, dict[str, int]],
    *,
    driver_labels: dict[str, str],
    unit_of: dict[str, str],
    horizon: int = 12,
    target_months: int = 48,
    min_train: int = 36,
) -> list[dict]:
    """各 (category, h, target) の {mean, sd, actual} のリストを返す。

    起点 O は「対象を直近 ``target_months`` か月分カバーできる範囲」を月次で走査する。
    """
    if panel.empty:
        return []
    index = panel.index
    last = index.max()
    origin_start = (last - pd.DateOffset(months=target_months + horizon)).normalize()
    origins = [d for d in index if origin_start <= d <= last]

    driver_union = sorted(
        {c for cat in categories for c in category_drivers.get(cat, {})}
    )
    max_lag = max(
        (lag for cat in categories for lag in category_drivers.get(cat, {}).values()),
        default=0,
    )

    points: list[dict] = []
    for origin in origins:
        ptrunc = panel[panel.index <= origin]
        # O 時点までのデータで各ドライバーを horizon か月先まで状態空間予測。
        dfs = build_driver_forecasts(
            ptrunc,
            driver_union,
            last_target_date=origin,
            horizon=horizon,
            max_lag=max_lag,
            label_of=driver_labels,
            unit_of=unit_of,
        )
        lookup: dict[str, dict[str, tuple[float, float]]] = {}
        for df in dfs:
            m: dict[str, tuple[float, float]] = {}
            for p in df.points:
                v = p.mean if p.mean is not None else p.actual
                if v is None:
                    continue
                m[p.date] = (float(v), float(p.std or 0.0))
            lookup[df.driver] = m

        for cat in categories:
            lags = {
                col: lag
                for col, lag in category_drivers.get(cat, {}).items()
                if col in ptrunc.columns
            }
            if not lags:
                continue
            X, y = make_features(ptrunc, cat, lags=lags)
            if len(y) < min_train:
                continue
            fit = fit_ols(X, y)
            resid = _resid_sigma(fit, X, y)
            coefs = {col: fit.coefs[f"{col}__lag{lag}"] for col, lag in lags.items()}
            tcol = TARGET_BY_CATEGORY[cat]

            for h in range(1, horizon + 1):
                target = (origin + pd.DateOffset(months=h)).normalize()
                mean = fit.intercept
                var = resid * resid
                for col, lag in lags.items():
                    ddate = _iso((target - pd.DateOffset(months=lag)).normalize())
                    fv = lookup.get(col, {}).get(ddate)
                    if fv is not None:
                        mean += coefs[col] * fv[0]
                        var += coefs[col] ** 2 * fv[1] ** 2
                actual = None
                if tcol in panel.columns and target in panel.index:
                    av = panel.loc[target, tcol]
                    actual = None if pd.isna(av) else float(av)
                points.append(
                    {
                        "category": cat,
                        "h": h,
                        "date": _iso(target),
                        "mean": float(mean),
                        "sd": float(np.sqrt(max(var, 0.0))),
                        "actual": actual,
                    }
                )
    return points

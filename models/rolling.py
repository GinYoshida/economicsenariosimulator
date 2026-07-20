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
from models.ols import fit_ols


def _iso(ts: pd.Timestamp) -> str:
    return ts.date().isoformat()


def _direction_metrics(fit_rows: list[dict]) -> dict:
    """生モデルの方向予測を評価。DA / MCC / Balanced Acc / Pesaran–Timmermann。

    「向き」は起点値(naive)からの変化の符号: 予測 sign(model−naive) vs 実測 sign(actual−naive)。
    """
    import math

    n = len(fit_rows)
    base = {"n": n, "n_up": 0, "da": 0.0, "mcc": 0.0,
            "balanced_acc": 0.0, "pt_stat": 0.0, "pt_p": 1.0}
    if n == 0:
        return base
    a_up = [1 if (r["actual"] - r["naive"]) > 0 else 0 for r in fit_rows]
    m_up = [1 if (r["model"] - r["naive"]) > 0 else 0 for r in fit_rows]
    da = sum(1 for i in range(n) if a_up[i] == m_up[i]) / n
    tp = sum(1 for i in range(n) if a_up[i] == 1 and m_up[i] == 1)
    tn = sum(1 for i in range(n) if a_up[i] == 0 and m_up[i] == 0)
    fp = sum(1 for i in range(n) if a_up[i] == 0 and m_up[i] == 1)
    fn = sum(1 for i in range(n) if a_up[i] == 1 and m_up[i] == 0)
    denom = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    mcc = ((tp * tn - fp * fn) / denom) if denom > 0 else 0.0
    sens = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    spec = tn / (tn + fp) if (tn + fp) > 0 else 0.0
    bacc = 0.5 * (sens + spec)
    # Pesaran–Timmermann
    px = sum(a_up) / n
    py = sum(m_up) / n
    p_star = px * py + (1 - px) * (1 - py)
    var_p = p_star * (1 - p_star) / n
    var_pstar = (
        ((2 * py - 1) ** 2) * px * (1 - px) / n
        + ((2 * px - 1) ** 2) * py * (1 - py) / n
        + 4 * px * py * (1 - px) * (1 - py) / (n * n)
    )
    dv = var_p - var_pstar
    pt = ((da - p_star) / math.sqrt(dv)) if dv > 1e-12 else 0.0
    pt_p = 0.5 * math.erfc(pt / math.sqrt(2))  # 片側 P(Z>pt)
    return {"n": n, "n_up": int(sum(a_up)), "da": float(da), "mcc": float(mcc),
            "balanced_acc": float(bacc), "pt_stat": float(pt), "pt_p": float(pt_p)}


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
) -> tuple[list[dict], list[dict]]:
    """``(points, blend)`` を返す。

    points: 各 (category, h, target) の {mean, sd, actual}。mean は
      ``w·モデル + (1−w)·ナイーブ`` のブレンド、sd はブレンド後のOOS誤差std。
    blend: 各 (category, h) の {w, sd}（フロントの未来予測でも同じ縮約を使う）。

    起点 O は「対象を直近 ``target_months`` か月分カバーできる範囲」を月次で走査する。
    ナイーブ＝起点 O 時点で既知の直近実測値（h先 persistence）。
    """
    if panel.empty:
        return [], []
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

    raw: list[dict] = []  # {category, h, date, model, naive, actual}
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
            coefs = {col: fit.coefs[f"{col}__lag{lag}"] for col, lag in lags.items()}
            tcol = TARGET_BY_CATEGORY[cat]
            tser = ptrunc[tcol].dropna()
            if tser.empty:
                continue
            naive = float(tser.iloc[-1])  # 起点で既知の直近実測（h先ナイーブ）

            for h in range(1, horizon + 1):
                target = (origin + pd.DateOffset(months=h)).normalize()
                model = fit.intercept
                for col, lag in lags.items():
                    ddate = _iso((target - pd.DateOffset(months=lag)).normalize())
                    fv = lookup.get(col, {}).get(ddate)
                    if fv is not None:
                        model += coefs[col] * fv[0]
                actual = None
                if tcol in panel.columns and target in panel.index:
                    av = panel.loc[target, tcol]
                    actual = None if pd.isna(av) else float(av)
                raw.append(
                    {
                        "category": cat,
                        "h": h,
                        "date": _iso(target),
                        "model": float(model),
                        "naive": naive,
                        "actual": actual,
                    }
                )

    # (category, h) ごとにナイーブへの縮約重み w をOOSで最適化（L2閉形式）。
    from collections import defaultdict

    groups: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for r in raw:
        groups[(r["category"], r["h"])].append(r)

    points: list[dict] = []
    blend: list[dict] = []
    for (cat, h), rs in sorted(groups.items()):
        fit_rows = [r for r in rs if r["actual"] is not None]
        num = den = 0.0
        for r in fit_rows:
            d = r["model"] - r["naive"]
            num += d * (r["actual"] - r["naive"])
            den += d * d
        w = (num / den) if den > 1e-12 else 0.0
        w = min(1.0, max(0.0, w))
        errs = [w * r["model"] + (1.0 - w) * r["naive"] - r["actual"] for r in fit_rows]
        sd = float(np.sqrt(np.mean(np.square(errs)))) if errs else 0.0
        blend.append(
            {"category": cat, "h": h, "w": float(w), "sd": sd,
             **_direction_metrics(fit_rows)}
        )
        for r in rs:
            mean = w * r["model"] + (1.0 - w) * r["naive"]
            points.append(
                {
                    "category": cat,
                    "h": h,
                    "date": r["date"],
                    "mean": float(mean),
                    "sd": sd,
                    "actual": r["actual"],
                }
            )
    return points, blend

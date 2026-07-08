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


def medae(y_true, y_pred) -> float:
    """中央絶対誤差（ハズレ値に頑健な当てはまり指標）。"""
    a, b = _valid_pairs(y_true, y_pred)
    if len(a) == 0:
        return float("nan")
    return float(np.median(np.abs(a - b)))


def naive_persistence(y: pd.Series) -> pd.Series:
    """直前値を予測とするナイーブ系列（先頭は NaN）。"""
    return y.shift(1)


def run_backtest(
    panel: "pd.DataFrame",
    category: str,
    *,
    lags: dict[str, int],
    horizon: int = 3,
    min_train: int = 24,
    return_points: bool = False,
):
    """拡張窓 OOS バックテスト。各原点で学習→horizon先を予測し指標を集計。

    予測は実現したドライバー（外生入力）を条件とする条件付き評価。
    ナイーブは persistence（原点の実測値を horizon 先の予測とする）。
    ``beats_naive = mae < naive_mae``。

    ``return_points=True`` のとき ``(BacktestMetric, points)`` を返す。
    ``points`` は ``{"date","actual","predicted"}`` の list（実績×予測の散布図用）。
    """
    from models.features import TARGET_BY_CATEGORY, build_design, make_features
    from models.ols import fit_ols, predict
    from models.schema import BacktestMetric

    target_col = TARGET_BY_CATEGORY[category]
    y = panel[target_col]
    dates = panel.index

    preds: list[float] = []
    actuals: list[float] = []
    naive: list[float] = []
    points: list[dict] = []

    for i in range(min_train, len(dates) - horizon):
        origin = dates[i]
        target_date = dates[i + horizon]

        actual = y.loc[target_date]
        origin_value = y.loc[origin]
        if pd.isna(actual) or pd.isna(origin_value):
            continue

        train_panel = panel.loc[:origin]
        X_tr, y_tr = make_features(train_panel, category, lags=lags)
        if len(X_tr) < min_train:
            continue
        fit = fit_ols(X_tr, y_tr)

        design = build_design(panel, lags=lags)
        if target_date not in design.index:
            continue
        xrow = design.loc[[target_date]].reindex(
            columns=fit.feature_names, fill_value=0.0
        )
        if xrow.isna().any(axis=1).iloc[0]:
            continue

        yhat = float(predict(fit, xrow)[0])
        preds.append(yhat)
        actuals.append(float(actual))
        naive.append(float(origin_value))
        points.append(
            {
                "date": pd.Timestamp(target_date).date().isoformat(),
                "actual": float(actual),
                "predicted": yhat,
            }
        )

    actuals_arr = np.asarray(actuals)
    preds_arr = np.asarray(preds)
    naive_arr = np.asarray(naive)
    model_mae = mae(actuals_arr, preds_arr)
    naive_mae = mae(actuals_arr, naive_arr)
    dir_hit = direction_hit(actuals_arr, preds_arr)
    beats = bool(model_mae < naive_mae)
    # 実質的な合格基準: MAE でナイーブを上回り、かつ方向当たりが五分を超える。
    passes = bool(beats and (dir_hit == dir_hit) and dir_hit > 0.5)

    metric = BacktestMetric(
        category=category,
        mae=model_mae,
        rmse=rmse(actuals_arr, preds_arr),
        medae=medae(actuals_arr, preds_arr),
        direction_hit=dir_hit,
        naive_mae=naive_mae,
        naive_rmse=rmse(actuals_arr, naive_arr),
        naive_medae=medae(actuals_arr, naive_arr),
        naive_direction_hit=direction_hit(actuals_arr, naive_arr),
        beats_naive=beats,
        passes_gate=passes,
    )
    if return_points:
        return metric, points
    return metric

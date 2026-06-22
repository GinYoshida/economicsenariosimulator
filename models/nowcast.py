"""ナウキャスト（目的変数の未公表月補完）。

家計調査の未公表直近月（公表ラグでパネル端が NaN）を、公表の早い説明変数
（先物・日銀・DI）から学習済みモデルで補完し、3か月先予測の起点を作る。

学習時の特徴量（ラグ・季節ダミー）は ``FitResult.feature_names`` から復元するため、
``fit`` と同じパネル列があれば追加引数なしで再構築できる。
"""

from __future__ import annotations

import pandas as pd

from models.features import TARGET_BY_CATEGORY
from models.ols import FitResult, predict


def _lags_from_features(feature_names: list[str]) -> dict[str, int]:
    lags: dict[str, int] = {}
    for name in feature_names:
        if "__lag" in name:
            col, lag = name.rsplit("__lag", 1)
            lags[col] = int(lag)
    return lags


def _rebuild_features(panel: pd.DataFrame, fit: FitResult) -> pd.DataFrame:
    """学習と同じ特徴量を全行（target が NaN の行も含む）について作る。"""
    X = pd.DataFrame(index=panel.index)
    for col, lag in _lags_from_features(fit.feature_names).items():
        X[f"{col}__lag{lag}"] = panel[col].shift(lag)

    season_cols = [c for c in fit.feature_names if c.startswith("month_")]
    if season_cols:
        dummies = pd.get_dummies(
            pd.Categorical(panel.index.month, categories=list(range(1, 13))),
            prefix="month",
            drop_first=(len(season_cols) == 11),
        ).astype(float)
        dummies.index = panel.index
        X = pd.concat([X, dummies], axis=1)

    X = X.reindex(columns=fit.feature_names)
    if season_cols:  # 当月ダミーは常に定義済み。欠けた月の列は 0 で埋める。
        X[season_cols] = X[season_cols].fillna(0.0)
    return X


def nowcast_target(panel: pd.DataFrame, category: str, fit: FitResult) -> pd.Series:
    """目的変数の未公表（NaN）月をモデル予測で補完した Series を返す。"""
    target_col = TARGET_BY_CATEGORY[category]
    out = panel[target_col].copy()

    X = _rebuild_features(panel, fit)
    fillable = out.isna() & X.notna().all(axis=1)
    if fillable.any():
        out.loc[fillable] = predict(fit, X.loc[fillable])
    return out

"""特徴量・ラグ生成。

月次パネルから、カテゴリ別の目的変数 ``y`` と説明変数行列 ``X`` を作る。
説明変数は「公表の早い系列を優先しラグを付与」した各ドライバーに、
季節（月）ダミーを加えたもの。NaN を含む行（ラグ生成・目的変数欠測）は落とす。
"""

from __future__ import annotations

import pandas as pd

TARGET_BY_CATEGORY: dict[str, str] = {
    "food": "household.food.real_yoy",
    "clothing": "household.clothing.real_yoy",
}


def _seasonal_dummies(index: pd.DatetimeIndex, drop_first: bool) -> pd.DataFrame:
    dummies = pd.get_dummies(
        pd.Categorical(index.month, categories=list(range(1, 13))),
        prefix="month",
        drop_first=drop_first,
    ).astype(float)
    dummies.index = index
    return dummies


def make_features(
    panel: pd.DataFrame,
    category: str,
    *,
    lags: dict[str, int],
    add_seasonal: bool = True,
    drop_first_season: bool = True,
) -> tuple[pd.DataFrame, pd.Series]:
    """``(X, y)`` を返す。``lags`` は ``{パネル列名: ラグ月数}``。"""
    if category not in TARGET_BY_CATEGORY:
        raise KeyError(f"unknown category: {category}")
    target_col = TARGET_BY_CATEGORY[category]
    if target_col not in panel.columns:
        raise KeyError(f"target column missing from panel: {target_col}")

    y = panel[target_col].rename("y")

    X = pd.DataFrame(index=panel.index)
    for col, lag in lags.items():
        if col not in panel.columns:
            raise KeyError(f"driver column missing from panel: {col}")
        X[f"{col}__lag{lag}"] = panel[col].shift(lag)

    if add_seasonal:
        X = pd.concat([X, _seasonal_dummies(panel.index, drop_first_season)], axis=1)

    data = pd.concat([y, X], axis=1).dropna()
    return data.drop(columns=["y"]), data["y"]

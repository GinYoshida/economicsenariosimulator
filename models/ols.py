"""OLS 学習・予測・要因分解（statsmodels ラップ）。

線形モデル ``y = intercept + Σ coef_i * x_i`` を学習し、予測と
ドライバー別寄与（``coef_i * value_i``）への分解を提供する。
要因分解の合計 ``Σ寄与 + intercept`` は予測値に一致する。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np
import pandas as pd
import statsmodels.api as sm


@dataclass
class FitResult:
    intercept: float
    coefs: dict[str, float]      # 特徴量名 -> 係数（切片を除く）
    r2: float
    feature_names: list[str]


def fit_ols(X: pd.DataFrame, y: pd.Series) -> FitResult:
    """切片付き OLS を学習して ``FitResult`` を返す。"""
    feature_names = list(X.columns)
    Xc = sm.add_constant(X.astype(float), has_constant="add")
    res = sm.OLS(np.asarray(y, dtype=float), Xc).fit()
    params = res.params  # pandas Series indexed by column name ("const", *features)
    intercept = float(params.get("const", 0.0))
    coefs = {name: float(params[name]) for name in feature_names}
    return FitResult(
        intercept=intercept,
        coefs=coefs,
        r2=float(res.rsquared),
        feature_names=feature_names,
    )


def predict(fit: FitResult, X: pd.DataFrame) -> np.ndarray:
    """``FitResult`` で ``X`` を予測する（列順は feature_names に整列）。"""
    arr = X[fit.feature_names].to_numpy(dtype=float)
    coef_vec = np.array([fit.coefs[name] for name in fit.feature_names])
    return fit.intercept + arr @ coef_vec


def decompose(fit: FitResult, x_row: Mapping[str, float]) -> dict[str, float]:
    """1 時点の各ドライバー寄与 ``coef * value`` を返す（切片は含めない）。"""
    return {name: fit.coefs[name] * float(x_row[name]) for name in fit.feature_names}

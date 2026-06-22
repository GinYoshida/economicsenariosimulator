"""成果物JSONスキーマ（フロントエンド契約）。

バッチが ``public/data/{coefficients,baseline,backtest}.json`` に書き出す形を
pydantic で定義する。フロント(TypeScript, M5)の型はこれと一致させる。
"""

from __future__ import annotations

from pydantic import BaseModel


class DriverCoef(BaseModel):
    driver: str            # 例 "cao.cci.attitude"
    label_ja: str          # 例 "消費者態度指数"
    coef: float            # 弾力性/係数
    lag_months: int


class CategoryModel(BaseModel):
    category: str          # "food" | "clothing"
    intercept: float
    drivers: list[DriverCoef]
    r2: float
    model_version: str
    data_vintage: str      # ISO 日付


class Coefficients(BaseModel):
    generated_at: str
    categories: list[CategoryModel]


class BaselinePoint(BaseModel):
    date: str
    food_yoy: float
    clothing_yoy: float
    food_low: float
    food_high: float
    clothing_low: float
    clothing_high: float


class Baseline(BaseModel):
    history: list[BaselinePoint]
    forecast: list[BaselinePoint]   # 3か月（モデル主導）＋3年（解釈レベル）
    horizon_note: str


class BacktestMetric(BaseModel):
    category: str
    mae: float
    rmse: float
    direction_hit: float
    naive_mae: float
    naive_rmse: float
    naive_direction_hit: float
    beats_naive: bool


class Backtest(BaseModel):
    metrics: list[BacktestMetric]
    window: str

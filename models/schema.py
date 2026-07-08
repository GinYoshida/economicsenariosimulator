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
    medae: float          # 中央絶対誤差（ハズレ値に頑健）
    direction_hit: float
    naive_mae: float
    naive_rmse: float
    naive_medae: float
    naive_direction_hit: float
    beats_naive: bool     # mae < naive_mae（MAE 単独）
    passes_gate: bool     # beats_naive かつ 方向一致>50%（合格の実質基準）


class BacktestPoint(BaseModel):
    category: str
    date: str          # 予測対象月（ISO）
    actual: float      # 実績 YoY
    predicted: float   # OOS 予測 YoY


class Backtest(BaseModel):
    metrics: list[BacktestMetric]
    window: str
    predictions: list[BacktestPoint] = []  # 実績×予測の散布図用


class SeriesPoint(BaseModel):
    date: str
    value: float | None    # 欠測は null


class SeriesData(BaseModel):
    series_id: str
    name: str              # 出典名
    url: str
    unit: str
    frequency: str
    points: list[SeriesPoint]


class SeriesFile(BaseModel):
    """series.json（入力系列の実績）のルート。"""

    generated_at: str
    series: list[SeriesData]

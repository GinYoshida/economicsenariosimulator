"""成果物ビルダー（JSON出力）。

DuckDB → 月次パネル → カテゴリ別 OLS 学習 → ナウキャスト → ベースライン生成 →
``public/data/{coefficients,baseline,sources}.json`` を書き出す。
出力は M3-1 スキーマで検証してから書く。

CLI: ``uv run python -m models.build_artifacts [--db PATH] [--out DIR]``
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from etl.panel import build_panel
from etl.store import list_series, read_series
from models.features import TARGET_BY_CATEGORY, make_features
from models.nowcast import nowcast_target
from models.ols import FitResult, fit_ols, predict
from etl.registry import REGISTRY
from models.backtest import run_backtest
from models.driver_forecast import build_driver_forecasts
from models.schema import (
    Backtest,
    BacktestPoint,
    Baseline,
    BaselinePoint,
    CategoryModel,
    Coefficients,
    DriverCoef,
    DriverForecastFile,
    SeriesData,
    SeriesFile,
    SeriesPoint,
)

BACKTEST_HORIZON = 3
BACKTEST_MIN_TRAIN = 24
SERIES_TAIL = 120  # series.json に載せる直近月数（約10年）
FORECAST_HORIZON = 12  # ドライバー予測・ファンチャートのホライズン（1年）
FORECAST_Z = 1.2816  # 80% 信頼帯

MODEL_VERSION = "v1"
FORECAST_MONTHS = 3
_Z = 1.96  # ~95% band

# ドライバーの日本語ラベル（要因分解UIの表示名）。
DRIVER_LABELS: dict[str, str] = {
    "cpi.food": "食料価格(CPI)",
    "cpi.clothing": "被服価格(CPI)",
    "cao.cci.attitude": "消費者態度指数",
    "cao.cci.livelihood": "暮らし向きDI",
    "cao.cci.income": "収入の増え方DI",
    "cao.cci.employment": "雇用環境DI",
    "cao.cci.durables": "耐久財買い時DI",
    "cao.watcher.current": "景気ウォッチャー現状DI",
    "cao.watcher.outlook": "景気ウォッチャー先行きDI",
    "boj.policy_rate": "政策金利",
    "boj.usdjpy": "ドル円",
    "fut.wheat": "小麦先物",
    "fut.soybean": "大豆先物",
    "fut.sugar": "砂糖先物",
    "fut.cotton": "綿先物",
    "fut.usdjpy": "ドル円先物",
}

# カテゴリ別の説明変数（列 -> ラグ月数）。公表の早い系列を優先。
CATEGORY_DRIVERS: dict[str, dict[str, int]] = {
    "food": {
        "cpi.food": 1,
        "cao.cci.attitude": 1,
        "cao.watcher.outlook": 1,
        "fut.wheat": 2,
        "fut.soybean": 2,
        "boj.usdjpy": 1,
    },
    "clothing": {
        "cpi.clothing": 1,
        "cao.cci.attitude": 1,
        "cao.watcher.outlook": 1,
        "fut.cotton": 2,
        "boj.usdjpy": 1,
    },
}


def _residual_sigma(fit: FitResult, X: pd.DataFrame, y: pd.Series) -> float:
    resid = y.to_numpy(dtype=float) - predict(fit, X)
    if len(resid) == 0:
        return 0.0
    return float(np.sqrt(np.mean(resid**2)))


def _fit_category(panel: pd.DataFrame, category: str):
    """利用可能なドライバーだけで OLS を学習。``(fit, lags, sigma)`` を返す。"""
    lags = {
        col: lag
        for col, lag in CATEGORY_DRIVERS[category].items()
        if col in panel.columns
    }
    X, y = make_features(panel, category, lags=lags)
    fit = fit_ols(X, y)
    sigma = _residual_sigma(fit, X, y)
    return fit, lags, sigma


def _category_model(category: str, fit: FitResult, lags: dict[str, int],
                    data_vintage: str, resid_std: float) -> CategoryModel:
    drivers = [
        DriverCoef(
            driver=col,
            label_ja=DRIVER_LABELS.get(col, col),
            coef=fit.coefs[f"{col}__lag{lag}"],
            lag_months=lag,
        )
        for col, lag in lags.items()
    ]
    return CategoryModel(
        category=category,
        intercept=fit.intercept,
        drivers=drivers,
        r2=fit.r2,
        resid_std=resid_std,
        model_version=MODEL_VERSION,
        data_vintage=data_vintage,
    )


def _forecast_row(panel: pd.DataFrame, fit: FitResult, lags: dict[str, int],
                  month: int) -> pd.DataFrame:
    """将来1か月の特徴量行（ドライバーは最終観測値で横ばい）を作る。"""
    row: dict[str, float] = {}
    for col, lag in lags.items():
        last = panel[col].dropna()
        row[f"{col}__lag{lag}"] = float(last.iloc[-1]) if len(last) else 0.0
    for name in fit.feature_names:
        if name.startswith("month_"):
            row[name] = 1.0 if name == f"month_{month}" else 0.0
    frame = pd.DataFrame([row]).reindex(columns=fit.feature_names, fill_value=0.0)
    return frame


def build_artifacts(con: duckdb.DuckDBPyConnection, out_dir) -> dict[str, Path]:
    """成果物 JSON を ``out_dir`` に書き出し、書いたパスの dict を返す。"""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    panel = build_panel(con)

    categories = ["food", "clothing"]
    fits: dict[str, tuple[FitResult, dict[str, int], float]] = {}
    nowcasts: dict[str, pd.Series] = {}
    for cat in categories:
        fit, lags, sigma = _fit_category(panel, cat)
        fits[cat] = (fit, lags, sigma)
        nowcasts[cat] = nowcast_target(panel, cat, fit)

    # data vintage = 目的変数（ナウキャスト後）が揃う最終月。
    vintage_dates = [s.dropna().index.max() for s in nowcasts.values()]
    data_vintage = min(vintage_dates).date().isoformat()

    # --- coefficients.json ---
    coeffs = Coefficients(
        generated_at=datetime.now(timezone.utc).isoformat(),
        categories=[
            _category_model(cat, fits[cat][0], fits[cat][1], data_vintage,
                            fits[cat][2])
            for cat in categories
        ],
    )

    # --- baseline.json ---
    food_y = nowcasts["food"]
    cloth_y = nowcasts["clothing"]
    sig_f = fits["food"][2]
    sig_c = fits["clothing"][2]

    history: list[BaselinePoint] = []
    common = food_y.dropna().index.intersection(cloth_y.dropna().index)
    for date in common:
        f = float(food_y.loc[date])
        c = float(cloth_y.loc[date])
        history.append(
            BaselinePoint(
                date=date.date().isoformat(),
                food_yoy=f, clothing_yoy=c,
                food_low=f - _Z * sig_f, food_high=f + _Z * sig_f,
                clothing_low=c - _Z * sig_c, clothing_high=c + _Z * sig_c,
            )
        )

    forecast: list[BaselinePoint] = []
    last_date = common.max()
    for h in range(1, FORECAST_MONTHS + 1):
        fdate = (last_date + pd.DateOffset(months=h)).normalize()
        widen = math.sqrt(h)
        f = float(predict(fits["food"][0], _forecast_row(panel, fits["food"][0], fits["food"][1], fdate.month))[0])
        c = float(predict(fits["clothing"][0], _forecast_row(panel, fits["clothing"][0], fits["clothing"][1], fdate.month))[0])
        forecast.append(
            BaselinePoint(
                date=fdate.date().isoformat(),
                food_yoy=f, clothing_yoy=c,
                food_low=f - _Z * sig_f * widen, food_high=f + _Z * sig_f * widen,
                clothing_low=c - _Z * sig_c * widen, clothing_high=c + _Z * sig_c * widen,
            )
        )

    baseline = Baseline(
        history=history,
        forecast=forecast,
        horizon_note=(
            "forecast は3か月先までモデル主導。3年の長期は解釈レベルとしてフロントで"
            "横ばい延長帯を描画する（ドライバー横ばい仮定）。"
        ),
    )

    # --- backtest.json（指標＋実績×予測ペア） ---
    metrics = []
    predictions: list[BacktestPoint] = []
    for cat in categories:
        metric, points = run_backtest(
            panel,
            cat,
            lags=fits[cat][1],
            horizon=BACKTEST_HORIZON,
            min_train=BACKTEST_MIN_TRAIN,
            return_points=True,
        )
        metrics.append(metric)
        predictions.extend(
            BacktestPoint(category=cat, date=p["date"], actual=p["actual"],
                          predicted=p["predicted"])
            for p in points
        )
    backtest = Backtest(
        metrics=metrics,
        window=f"expanding, horizon={BACKTEST_HORIZON}, min_train={BACKTEST_MIN_TRAIN}",
        predictions=predictions,
    )

    # --- series.json（入力系列の月次実績。ソース別テーブル・実績グラフ用） ---
    series_list: list[SeriesData] = []
    sources = []
    for sid in list_series(con):
        df, src = read_series(con, sid)
        tail = df.sort_values("date").tail(SERIES_TAIL)
        pts = [
            SeriesPoint(
                date=pd.Timestamp(row.date).date().isoformat(),
                value=None if pd.isna(row.value) else float(row.value),
            )
            for row in tail.itertuples(index=False)
        ]
        series_list.append(
            SeriesData(
                series_id=src.series_id,
                name=src.name,
                url=str(src.url),
                unit=src.unit,
                frequency=src.frequency,
                points=pts,
            )
        )
        sources.append(
            {
                "series_id": src.series_id,
                "name": src.name,
                "url": str(src.url),
                "retrieved_at": src.retrieved_at.isoformat(),
                "license": src.license,
                "unit": src.unit,
                "frequency": src.frequency,
            }
        )
    series_file = SeriesFile(
        generated_at=coeffs.generated_at, series=series_list
    )

    # --- driver_forecasts.json（状態空間によるドライバー先行き＋信頼幅） ---
    driver_union = sorted({col for v in fits.values() for col in v[1]})
    max_lag = max((lag for v in fits.values() for lag in v[1].values()),
                  default=0)
    unit_of = {sid: spec.unit for sid, spec in REGISTRY.items()}
    driver_forecasts = build_driver_forecasts(
        panel,
        driver_union,
        last_target_date=last_date,
        horizon=FORECAST_HORIZON,
        max_lag=max_lag,
        label_of=DRIVER_LABELS,
        unit_of=unit_of,
    )
    driver_file = DriverForecastFile(
        generated_at=coeffs.generated_at,
        horizon=FORECAST_HORIZON,
        z=FORECAST_Z,
        drivers=driver_forecasts,
    )

    paths = {
        "coefficients": out_dir / "coefficients.json",
        "baseline": out_dir / "baseline.json",
        "backtest": out_dir / "backtest.json",
        "series": out_dir / "series.json",
        "driver_forecasts": out_dir / "driver_forecasts.json",
        "sources": out_dir / "sources.json",
    }
    paths["coefficients"].write_text(
        coeffs.model_dump_json(indent=2), encoding="utf-8"
    )
    paths["baseline"].write_text(baseline.model_dump_json(indent=2), encoding="utf-8")
    paths["backtest"].write_text(backtest.model_dump_json(indent=2), encoding="utf-8")
    paths["series"].write_text(series_file.model_dump_json(indent=2), encoding="utf-8")
    paths["driver_forecasts"].write_text(
        driver_file.model_dump_json(indent=2), encoding="utf-8"
    )
    paths["sources"].write_text(
        json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description="Build public/data artifact JSON")
    parser.add_argument("--db", default="data/warehouse.duckdb")
    parser.add_argument("--out", default="public/data")
    args = parser.parse_args()
    con = duckdb.connect(args.db)
    try:
        paths = build_artifacts(con, args.out)
    finally:
        con.close()
    for name, path in paths.items():
        print(f"wrote {name}: {path}")


if __name__ == "__main__":
    main()

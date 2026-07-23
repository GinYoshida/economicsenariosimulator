import json
from datetime import datetime, timezone

import duckdb
import numpy as np
import pandas as pd

from models.build_artifacts import build_artifacts
from models.schema import (
    Backtest,
    Baseline,
    Coefficients,
    DriverForecastFile,
    SeriesFile,
)
from etl.provenance import Source
from etl.store import init_db, write_series


def _src(series_id, unit="level"):
    return Source(
        series_id=series_id,
        name=f"src::{series_id}",
        url="https://example.com/",
        retrieved_at=datetime(2026, 6, 22, tzinfo=timezone.utc),
        license="test",
        unit=unit,
        frequency="monthly",
    )


def _populate(con, n=48, seed=7):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2020-01-01", periods=n, freq="MS")

    def level(base, scale):
        # positive, drifting levels so YoY is well-defined
        return base + np.cumsum(rng.normal(scale=scale, size=n)) + rng.normal(size=n)

    cols = {
        "household.food.real_yoy": level(100, 0.5),
        "household.clothing.real_yoy": level(80, 0.5),
        "cpi.food": level(100, 0.3),
        "cpi.clothing": level(100, 0.3),
        "cao.cci.attitude": 38 + rng.normal(size=n),
        "fut.wheat": level(600, 5),
        "fut.cotton": level(80, 1),
        "boj.usdjpy": level(140, 1),
    }
    for sid, vals in cols.items():
        write_series(con, sid, pd.DataFrame({"date": idx, "value": vals}), _src(sid))


def test_build_artifacts_writes_valid_schema_files(tmp_path):
    con = duckdb.connect(":memory:")
    init_db(con)
    _populate(con)

    paths = build_artifacts(con, tmp_path)

    coef_path = tmp_path / "coefficients.json"
    base_path = tmp_path / "baseline.json"
    src_path = tmp_path / "sources.json"
    assert coef_path.exists() and base_path.exists() and src_path.exists()
    assert set(paths.values()) >= {coef_path, base_path, src_path}

    coeffs = Coefficients(**json.loads(coef_path.read_text(encoding="utf-8")))
    cats = {c.category for c in coeffs.categories}
    assert {"food", "clothing"} <= cats
    # each category has at least one driver with a label
    for c in coeffs.categories:
        assert c.drivers
        assert all(d.label_ja for d in c.drivers)

    baseline = Baseline(**json.loads(base_path.read_text(encoding="utf-8")))
    assert baseline.history  # non-empty history
    assert len(baseline.forecast) == 3  # 3-month model-driven horizon

    bt_path = tmp_path / "backtest.json"
    assert bt_path.exists()
    backtest = Backtest(**json.loads(bt_path.read_text(encoding="utf-8")))
    assert {m.category for m in backtest.metrics} == {"food", "clothing"}
    # predictions (actual vs predicted pairs) are present for the scatter
    assert backtest.predictions
    assert {p.category for p in backtest.predictions} <= {"food", "clothing"}

    series_path = tmp_path / "series.json"
    assert series_path.exists()
    series_file = SeriesFile(**json.loads(series_path.read_text(encoding="utf-8")))
    ids = {s.series_id for s in series_file.series}
    assert "household.food.real_yoy" in ids
    assert all(s.points for s in series_file.series)

    # coefficients carry residual std for band propagation
    assert all(c.resid_std >= 0 for c in coeffs.categories)

    df_path = tmp_path / "driver_forecasts.json"
    assert df_path.exists()
    dff = DriverForecastFile(**json.loads(df_path.read_text(encoding="utf-8")))
    assert dff.horizon == 12
    assert dff.drivers
    # each driver has history (actual) and future (mean+std>0) points
    for d in dff.drivers:
        assert any(p.actual is not None for p in d.points)
        assert any(p.mean is not None and (p.std or 0) > 0.0 for p in d.points)


def test_minlag_model_json_valid(tmp_path):
    con = duckdb.connect(":memory:")
    init_db(con)
    _populate(con)
    build_artifacts(con, tmp_path)

    from models.schema import MinlagModelFile

    path = tmp_path / "minlag_model.json"
    assert path.exists()
    mm = MinlagModelFile(**json.loads(path.read_text(encoding="utf-8")))
    cats = {c.category: c for c in mm.categories}
    assert {"food", "clothing"} <= set(cats)
    food = cats["food"]
    # 季節性は12か月ぶんの月別切片に畳み込む。
    assert len(food.intercept_by_month) == 12
    # AR 項は目的変数自身、外生ドライバーは lag0（AR は drivers に含めない）。
    assert food.ar_driver == "household.food.real_yoy"
    assert all(d.driver != food.ar_driver for d in food.drivers)
    # 散布用の当てはめ点が両カテゴリに存在。
    assert any(p.category == "food" for p in mm.fit)
    assert any(p.category == "clothing" for p in mm.fit)


def test_sources_json_lists_provenance(tmp_path):
    con = duckdb.connect(":memory:")
    init_db(con)
    _populate(con)
    build_artifacts(con, tmp_path)

    sources = json.loads((tmp_path / "sources.json").read_text(encoding="utf-8"))
    assert isinstance(sources, list)
    by_id = {s["series_id"]: s for s in sources}
    assert "household.food.real_yoy" in by_id
    entry = by_id["household.food.real_yoy"]
    for key in ("name", "url", "retrieved_at", "license", "unit", "frequency"):
        assert key in entry

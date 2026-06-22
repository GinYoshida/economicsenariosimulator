import json
from datetime import datetime, timezone

import duckdb
import numpy as np
import pandas as pd

from models.build_artifacts import build_artifacts
from models.schema import Baseline, Coefficients
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

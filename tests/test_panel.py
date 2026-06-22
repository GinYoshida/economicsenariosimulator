from datetime import datetime, timezone

import duckdb
import numpy as np
import pandas as pd
import pytest

from etl.panel import build_panel, to_yoy
from etl.provenance import Source
from etl.store import init_db, write_series


def _src(series_id, unit="level"):
    return Source(
        series_id=series_id,
        name="test",
        url="https://example.com/",
        retrieved_at=datetime(2026, 6, 22, tzinfo=timezone.utc),
        license="test",
        unit=unit,
        frequency="monthly",
    )


def _series(start, n, values):
    dates = pd.date_range(start, periods=n, freq="MS")
    return pd.DataFrame({"date": dates, "value": values})


# ---- to_yoy ----

def test_to_yoy_formula_and_leading_nan():
    idx = pd.date_range("2020-01-01", periods=24, freq="MS")
    s = pd.Series(np.arange(1, 25, dtype=float), index=idx)
    yoy = to_yoy(s)
    # first 12 are NaN (no prior-year value)
    assert yoy.iloc[:12].isna().all()
    # yoy = s/s.shift(12) - 1
    assert yoy.iloc[12] == pytest.approx(13 / 1 - 1)
    assert yoy.iloc[23] == pytest.approx(24 / 12 - 1)


# ---- build_panel ----

def test_panel_columns_are_all_series_and_index_monthly():
    con = duckdb.connect(":memory:")
    init_db(con)
    write_series(con, "a", _series("2024-01-01", 6, [1, 2, 3, 4, 5, 6]), _src("a"))
    write_series(con, "b", _series("2024-01-01", 6, [10, 20, 30, 40, 50, 60]), _src("b"))

    panel = build_panel(con, yoy_series=set())
    assert set(panel.columns) == {"a", "b"}
    assert isinstance(panel.index, pd.DatetimeIndex)
    assert (panel.index.day == 1).all()
    assert panel.index.is_monotonic_increasing
    # continuous monthly index
    expected = pd.date_range("2024-01-01", "2024-06-01", freq="MS")
    assert list(panel.index) == list(expected)


def test_vintage_alignment_trailing_nan_for_late_series():
    con = duckdb.connect(":memory:")
    init_db(con)
    # "target" ends 2 months earlier than the fast series (publication lag)
    write_series(con, "target", _series("2024-01-01", 4, [1, 2, 3, 4]), _src("target"))
    write_series(con, "fast", _series("2024-01-01", 6, [1, 2, 3, 4, 5, 6]), _src("fast"))

    panel = build_panel(con, yoy_series=set())
    assert list(panel.index[-1:]) == [pd.Timestamp("2024-06-01")]
    # target's most recent 2 months are NaN (not published yet)
    assert pd.isna(panel.loc["2024-05-01", "target"])
    assert pd.isna(panel.loc["2024-06-01", "target"])
    assert panel.loc["2024-04-01", "target"] == pytest.approx(4.0)
    # fast series is present at the edge
    assert panel.loc["2024-06-01", "fast"] == pytest.approx(6.0)


def test_no_forward_fill_keeps_internal_gaps():
    con = duckdb.connect(":memory:")
    init_db(con)
    write_series(
        con, "g", _series("2024-01-01", 5, [1.0, float("nan"), 3.0, 4.0, 5.0]), _src("g")
    )
    panel = build_panel(con, yoy_series=set())
    assert pd.isna(panel.loc["2024-02-01", "g"])
    assert panel.loc["2024-03-01", "g"] == pytest.approx(3.0)


def test_build_panel_applies_yoy_to_selected_series():
    con = duckdb.connect(":memory:")
    init_db(con)
    vals = list(np.arange(1, 26, dtype=float))  # 25 months
    write_series(con, "lvl", _series("2022-01-01", 25, vals), _src("lvl"))

    panel = build_panel(con, yoy_series={"lvl"})
    # month 13 (2023-01) = 13/1 - 1
    assert panel.loc["2023-01-01", "lvl"] == pytest.approx(13 / 1 - 1)
    assert pd.isna(panel.loc["2022-06-01", "lvl"])  # within first 12 -> NaN

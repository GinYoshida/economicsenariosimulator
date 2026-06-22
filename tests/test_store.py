from datetime import datetime, timezone

import duckdb
import pandas as pd
import pytest

from etl.provenance import Source
from etl.store import init_db, read_series, write_series


def _df():
    return pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-01", "2024-02-01", "2024-03-01"]),
            "value": [1.5, 2.0, float("nan")],
        }
    )


def _source(series_id="household.food.real_yoy"):
    return Source(
        series_id=series_id,
        name="総務省 家計調査",
        url="https://www.stat.go.jp/data/kakei/sokuhou/tsuki/index.html",
        retrieved_at=datetime(2026, 6, 22, 0, 0, tzinfo=timezone.utc),
        license="政府統計（出典明示で利用可）",
        unit="yoy_pct",
        frequency="monthly",
    )


def test_roundtrip_values_and_source():
    con = duckdb.connect(":memory:")
    init_db(con)
    write_series(con, "household.food.real_yoy", _df(), _source())

    df, source = read_series(con, "household.food.real_yoy")
    assert list(df.columns) == ["date", "value"]
    assert len(df) == 3
    assert df["date"].iloc[0] == pd.Timestamp("2024-01-01")
    assert df["value"].iloc[0] == pytest.approx(1.5)
    assert pd.isna(df["value"].iloc[2])  # NaN preserved

    assert source.series_id == "household.food.real_yoy"
    assert source.name == "総務省 家計調査"
    assert source.unit == "yoy_pct"
    assert source.frequency == "monthly"
    assert source.retrieved_at == _source().retrieved_at


def test_rewrite_replaces_existing_series():
    con = duckdb.connect(":memory:")
    init_db(con)
    write_series(con, "x", _df(), _source("x"))
    # second write with fewer rows must replace, not append
    smaller = pd.DataFrame({"date": pd.to_datetime(["2024-05-01"]), "value": [9.0]})
    write_series(con, "x", smaller, _source("x"))

    df, _ = read_series(con, "x")
    assert len(df) == 1
    assert df["value"].iloc[0] == pytest.approx(9.0)


def test_read_missing_series_raises():
    con = duckdb.connect(":memory:")
    init_db(con)
    with pytest.raises(KeyError):
        read_series(con, "does.not.exist")


def test_write_series_is_idempotent_on_init():
    con = duckdb.connect(":memory:")
    init_db(con)
    init_db(con)  # calling twice must not raise or wipe data
    write_series(con, "x", _df(), _source("x"))
    df, _ = read_series(con, "x")
    assert len(df) == 3

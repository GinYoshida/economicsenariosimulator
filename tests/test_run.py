from datetime import datetime, timezone

import duckdb
import pandas as pd

from etl.provenance import Source
from etl.registry import REGISTRY
from etl.run import run_etl
from etl.store import list_series, read_series


def _frame():
    return pd.DataFrame(
        {"date": pd.date_range("2024-01-01", periods=3, freq="MS"), "value": [1.0, 2.0, 3.0]}
    )


def _src(spec):
    return Source(
        series_id=spec.series_id,
        name=spec.name,
        url=spec.url,
        retrieved_at=datetime(2026, 6, 22, tzinfo=timezone.utc),
        license=spec.license,
        unit=spec.unit,
        frequency=spec.frequency,
    )


def test_run_etl_skips_unconfirmed_and_writes_confirmed():
    con = duckdb.connect(":memory:")

    # futures is fully parameterized in the registry -> use a fake fetcher (no network)
    def fake_futures(spec, _app_id):
        return _frame(), _src(spec)

    summary = run_etl(
        con,
        dispatchers={"futures": fake_futures},
        # estat/boj have no dispatcher here -> recorded as skipped, not crashing
    )

    written = set(summary["written"])
    fut_ids = {sid for sid, s in REGISTRY.items() if s.connector == "futures"}
    assert fut_ids <= written
    # confirmed series are actually persisted and round-trip
    df, _ = read_series(con, "fut.wheat")
    assert len(df) == 3
    assert set(list_series(con)) >= fut_ids

    skipped_ids = {sid for sid, _ in summary["skipped"]}
    # e-Stat (stats_data_id None) and CAO (no provider) are pending, not failures
    assert "household.food.real_yoy" in skipped_ids
    assert "cao.cci.attitude" in skipped_ids
    assert summary["failed"] == []


def test_run_etl_classifies_value_error_as_skip_and_other_as_failed():
    con = duckdb.connect(":memory:")

    def raises_value_error(spec, _app_id):
        raise ValueError("unconfirmed param")

    def raises_runtime(spec, _app_id):
        raise RuntimeError("network down")

    summary = run_etl(
        con,
        dispatchers={"estat": raises_value_error, "futures": raises_runtime},
    )
    skipped_ids = {sid for sid, _ in summary["skipped"]}
    failed_ids = {sid for sid, _ in summary["failed"]}
    # ValueError -> skipped (pending), other exceptions -> failed (loud)
    assert {"household.food.real_yoy", "cpi.food"} <= skipped_ids
    assert {"fut.wheat", "fut.usdjpy"} <= failed_ids


def test_run_etl_cao_provider_writes_series():
    con = duckdb.connect(":memory:")

    def cao_provider():
        out = []
        for sid in ("cao.cci.attitude", "cao.watcher.outlook"):
            spec = REGISTRY[sid]
            out.append((_frame(), _src(spec)))
        return out

    summary = run_etl(con, dispatchers={}, cao_provider=cao_provider)
    assert "cao.cci.attitude" in summary["written"]
    assert "cao.watcher.outlook" in summary["written"]
    df, _ = read_series(con, "cao.watcher.outlook")
    assert len(df) == 3

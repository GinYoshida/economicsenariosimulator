import math
from pathlib import Path

import pandas as pd
import pytest

from etl.connectors.cao import (
    CCI_COLUMN_MAP,
    WATCHER_COLUMN_MAP,
    fetch_cao_cci,
    fetch_cao_watcher,
    parse_cao_excel,
)

CCI_FIXTURE = Path("data/fixtures/cao_cci.xlsx")
WATCHER_FIXTURE = Path("data/fixtures/cao_watcher.xlsx")


def _bytes(p: Path) -> bytes:
    return p.read_bytes()


def test_parse_cci_extracts_all_indicators():
    series = parse_cao_excel(_bytes(CCI_FIXTURE), CCI_COLUMN_MAP)
    assert set(series.keys()) == set(CCI_COLUMN_MAP.values())
    # 態度指数は e-Stat 経由に移したため Excel マップ対象外。
    assert "cao.cci.attitude" not in series
    df = series["cao.cci.livelihood"]
    assert list(df.columns) == ["date", "value"]
    assert len(df) == 5
    assert df["date"].iloc[0] == pd.Timestamp("2024-01-01")
    assert (df["date"].dt.day == 1).all()
    assert df["date"].is_monotonic_increasing
    assert df.set_index("date")["value"].loc["2024-01-01"] == pytest.approx(36.0)


def test_parse_cci_missing_cell_is_nan():
    series = parse_cao_excel(_bytes(CCI_FIXTURE), CCI_COLUMN_MAP)
    durables = series["cao.cci.durables"].set_index("date")["value"]
    assert math.isnan(durables.loc["2024-04-01"])
    assert durables.loc["2024-05-01"] == pytest.approx(36.0)


def test_parse_watcher_extracts_current_and_outlook():
    series = parse_cao_excel(_bytes(WATCHER_FIXTURE), WATCHER_COLUMN_MAP)
    assert set(series.keys()) == set(WATCHER_COLUMN_MAP.values())
    cur = series["cao.watcher.current"].set_index("date")["value"]
    out = series["cao.watcher.outlook"].set_index("date")["value"]
    assert cur.loc["2024-01-01"] == pytest.approx(50.2)
    assert out.loc["2024-03-01"] == pytest.approx(51.2)


def test_fetch_cao_cci_returns_df_source_pairs():
    pairs = fetch_cao_cci(_bytes(CCI_FIXTURE))
    assert len(pairs) == len(CCI_COLUMN_MAP)
    by_id = {src.series_id: (df, src) for df, src in pairs}
    assert "cao.cci.livelihood" in by_id
    df, src = by_id["cao.cci.livelihood"]
    assert len(df) == 5
    assert src.name == "内閣府 消費動向調査"
    assert src.unit == "di"
    assert src.frequency == "monthly"
    assert src.retrieved_at.tzinfo is not None
    assert str(src.url).startswith("http")


def test_fetch_cao_watcher_returns_df_source_pairs():
    pairs = fetch_cao_watcher(_bytes(WATCHER_FIXTURE))
    by_id = {src.series_id: (df, src) for df, src in pairs}
    assert set(by_id.keys()) == set(WATCHER_COLUMN_MAP.values())
    _, src = by_id["cao.watcher.outlook"]
    assert src.name == "内閣府 景気ウォッチャー調査"
    assert src.unit == "di"


def test_parse_raises_when_header_not_found():
    with pytest.raises(ValueError):
        parse_cao_excel(_bytes(CCI_FIXTURE), {"存在しない列": "x.y"})

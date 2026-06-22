import math
from pathlib import Path

import pandas as pd
import pytest

from etl.connectors.boj import fetch_boj, parse_boj_csv

FIXTURE = Path("data/fixtures/boj_policy_rate.csv")


def _text() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def test_parse_returns_date_value_frame():
    df = parse_boj_csv(_text())
    assert list(df.columns) == ["date", "value"]
    assert len(df) == 6  # metadata header rows are skipped
    assert pd.api.types.is_datetime64_any_dtype(df["date"])
    assert pd.api.types.is_float_dtype(df["value"])


def test_parse_dates_month_start_and_sorted():
    df = parse_boj_csv(_text())
    assert df["date"].is_monotonic_increasing
    assert df["date"].iloc[0] == pd.Timestamp("2024-01-01")
    assert df["date"].iloc[-1] == pd.Timestamp("2024-06-01")
    assert (df["date"].dt.day == 1).all()


def test_parse_values_and_nd_token_to_nan():
    s = parse_boj_csv(_text()).set_index("date")["value"]
    assert s.loc["2024-01-01"] == pytest.approx(-0.001)
    assert s.loc["2024-04-01"] == pytest.approx(0.078)
    # BOJ uses "ND" (no data) -> NaN, must not raise
    assert math.isnan(s.loc["2024-05-01"])


def test_parse_skips_header_label_row():
    # The literal "Date","Value" header row must not become a data row.
    df = parse_boj_csv(_text())
    assert "Date" not in df["date"].astype(str).tolist()


class _FakeResponse:
    def __init__(self, content: bytes):
        self.content = content

    def raise_for_status(self):
        return None


class _FakeClient:
    def __init__(self, content: bytes):
        self._content = content
        self.calls: list[tuple[str, dict]] = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params or {}))
        return _FakeResponse(self._content)


def test_fetch_boj_decodes_and_builds_source():
    client = _FakeClient(_text().encode("utf-8"))
    df, source = fetch_boj(
        series_code="IR01'STRDCLUCON",
        csv_url="https://www.stat-search.boj.or.jp/csv/example.csv",
        series_id="boj.policy_rate",
        name="日本銀行",
        url="https://www.stat-search.boj.or.jp/",
        license="日本銀行（出典明示で利用可）",
        unit="pct",
        client=client,
    )
    assert len(client.calls) == 1
    assert len(df) == 6
    assert source.series_id == "boj.policy_rate"
    assert source.unit == "pct"
    assert source.frequency == "monthly"
    assert source.retrieved_at.tzinfo is not None


def test_fetch_boj_falls_back_to_cp932():
    # Real BOJ exports are often Shift_JIS; the connector must decode them.
    content = _text().encode("cp932")
    client = _FakeClient(content)
    df, _ = fetch_boj(
        series_code="IR01'STRDCLUCON",
        csv_url="https://www.stat-search.boj.or.jp/csv/example.csv",
        series_id="boj.policy_rate",
        name="日本銀行",
        url="https://www.stat-search.boj.or.jp/",
        license="日本銀行（出典明示で利用可）",
        unit="pct",
        client=client,
    )
    assert len(df) == 6


def test_fetch_boj_requires_csv_url():
    client = _FakeClient(_text().encode("utf-8"))
    with pytest.raises(ValueError):
        fetch_boj(
            series_code="IR01'STRDCLUCON",
            csv_url=None,
            series_id="boj.policy_rate",
            name="日本銀行",
            url="https://www.stat-search.boj.or.jp/",
            license="l",
            unit="pct",
            client=client,
        )

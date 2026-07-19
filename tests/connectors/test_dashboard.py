import json
import math
from pathlib import Path

import pandas as pd
import pytest

from etl.connectors.dashboard import (
    DASHBOARD_ENDPOINT,
    DashboardApiError,
    fetch_dashboard,
    parse_dashboard_response,
)
from etl.registry import REGISTRY

FIXTURE = Path("data/fixtures/dashboard_wage.json")


def _payload() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_parse_returns_date_value_frame():
    df = parse_dashboard_response(_payload())
    assert list(df.columns) == ["date", "value"]
    # 5 monthly rows (the 6th is an annual "20250000" row that is skipped)
    assert len(df) == 5
    assert pd.api.types.is_datetime64_any_dtype(df["date"])
    assert pd.api.types.is_float_dtype(df["value"])


def test_parse_dates_are_month_starts_and_sorted():
    df = parse_dashboard_response(_payload())
    assert df["date"].is_monotonic_increasing
    assert df["date"].iloc[0] == pd.Timestamp("2026-01-01")
    assert df["date"].iloc[-1] == pd.Timestamp("2026-05-01")
    assert (df["date"].dt.day == 1).all()


def test_parse_values_and_missing_token_becomes_nan():
    s = parse_dashboard_response(_payload()).set_index("date")["value"]
    assert s.loc["2026-01-01"] == pytest.approx(289456.0)
    assert s.loc["2026-04-01"] == pytest.approx(298034.0)
    # the "-" token must become NaN, not raise
    assert math.isnan(s.loc["2026-05-01"])


def test_parse_skips_annual_rows():
    # "20250000" (month code 00) is an annual aggregate and must be dropped.
    df = parse_dashboard_response(_payload())
    assert pd.Timestamp("2025-01-01") not in set(df["date"])


def test_parse_raises_on_api_error_status():
    payload = _payload()
    payload["GET_STATS"]["RESULT"]["status"] = "1"
    payload["GET_STATS"]["RESULT"]["errorMsg"] = "該当データはありません。"
    with pytest.raises(DashboardApiError) as exc:
        parse_dashboard_response(payload)
    assert "該当データはありません" in str(exc.value)


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload
        self.calls: list[tuple[str, dict]] = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params or {}))
        return _FakeResponse(self._payload)


def test_fetch_dashboard_calls_endpoint_with_indicator_code():
    client = _FakeClient(_payload())
    df, source = fetch_dashboard(
        indicator_code="0302020000000010000",
        series_id="wage.cash_earnings",
        name="厚生労働省 毎月勤労統計調査（統計ダッシュボード）",
        url="https://dashboard.e-stat.go.jp/",
        license="政府統計（出典明示で利用可）",
        unit="yen",
        client=client,
    )
    assert len(client.calls) == 1
    called_url, params = client.calls[0]
    assert called_url == DASHBOARD_ENDPOINT
    assert params["IndicatorCode"] == "0302020000000010000"
    assert params["RegionCode"] == "00000"
    assert len(df) == 5
    assert source.series_id == "wage.cash_earnings"
    assert source.unit == "yen"
    assert source.frequency == "monthly"
    assert source.retrieved_at.tzinfo is not None


def test_fetch_dashboard_requires_indicator_code():
    client = _FakeClient(_payload())
    with pytest.raises(ValueError):
        fetch_dashboard(
            indicator_code=None,
            series_id="x",
            name="n",
            url="https://example.com/",
            license="l",
            unit="u",
            client=client,
        )


def test_registry_dashboard_specs_have_indicator_code():
    dash = [s for s in REGISTRY.values() if s.connector == "dashboard"]
    assert dash
    for spec in dash:
        assert spec.fetch.get("indicator_code")

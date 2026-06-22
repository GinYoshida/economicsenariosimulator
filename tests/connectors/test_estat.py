import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pytest

from etl.connectors.estat import (
    ESTAT_ENDPOINT,
    EstatApiError,
    fetch_estat,
    parse_estat_response,
)
from etl.registry import REGISTRY

FIXTURE = Path("data/fixtures/estat_household_food.json")


def _payload() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_parse_returns_date_value_frame():
    df = parse_estat_response(_payload())
    assert list(df.columns) == ["date", "value"]
    # 6 monthly rows in the fixture
    assert len(df) == 6
    assert pd.api.types.is_datetime64_any_dtype(df["date"])
    assert pd.api.types.is_float_dtype(df["value"])


def test_parse_dates_are_month_starts_and_sorted():
    df = parse_estat_response(_payload())
    assert df["date"].is_monotonic_increasing
    assert df["date"].iloc[0] == pd.Timestamp("2024-01-01")
    assert df["date"].iloc[-1] == pd.Timestamp("2024-06-01")
    # all day components are the first of the month
    assert (df["date"].dt.day == 1).all()


def test_parse_values_and_missing_token_becomes_nan():
    df = parse_estat_response(_payload()).set_index("date")["value"]
    assert df.loc["2024-01-01"] == pytest.approx(82531.0)
    assert df.loc["2024-06-01"] == pytest.approx(83215.0)
    # the "***" token (数値が得られない場合) must become NaN, not raise
    assert math.isnan(df.loc["2024-05-01"])


def test_parse_handles_single_value_object():
    # e-Stat returns a bare object (not a list) when only one cell is returned.
    payload = _payload()
    values = payload["GET_STATS_DATA"]["STATISTICAL_DATA"]["DATA_INF"]["VALUE"]
    payload["GET_STATS_DATA"]["STATISTICAL_DATA"]["DATA_INF"]["VALUE"] = values[0]
    df = parse_estat_response(payload)
    assert len(df) == 1
    assert df["value"].iloc[0] == pytest.approx(82531.0)


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    """Minimal httpx.Client stand-in that records the request."""

    def __init__(self, payload):
        self._payload = payload
        self.calls: list[tuple[str, dict]] = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params or {}))
        return _FakeResponse(self._payload)


def test_fetch_estat_calls_endpoint_with_credentials_and_id():
    client = _FakeClient(_payload())
    df, source = fetch_estat(
        stats_data_id="0002070001",
        app_id="SECRET_APP_ID",
        series_id="household.food.real_yoy",
        name="総務省 家計調査",
        url="https://www.stat.go.jp/data/kakei/sokuhou/tsuki/index.html",
        license="政府統計（出典明示で利用可）",
        unit="yoy_pct",
        client=client,
    )
    assert len(client.calls) == 1
    called_url, params = client.calls[0]
    assert called_url == ESTAT_ENDPOINT
    assert params["appId"] == "SECRET_APP_ID"
    assert params["statsDataId"] == "0002070001"
    assert len(df) == 6
    assert source.series_id == "household.food.real_yoy"
    assert source.unit == "yoy_pct"
    assert source.frequency == "monthly"
    assert str(source.url).startswith("https://www.stat.go.jp")
    # retrieved_at defaults to an aware UTC timestamp
    assert source.retrieved_at.tzinfo is not None


def test_fetch_estat_passes_extra_category_params():
    client = _FakeClient(_payload())
    fetch_estat(
        stats_data_id="0002070001",
        app_id="K",
        series_id="cpi.food",
        name="総務省 消費者物価指数",
        url="https://www.stat.go.jp/data/cpi/",
        license="政府統計（出典明示で利用可）",
        unit="index",
        client=client,
        extra_params={"cdCat01": "010"},
    )
    _, params = client.calls[0]
    assert params["cdCat01"] == "010"


def test_fetch_estat_raises_on_api_error_status():
    payload = _payload()
    payload["GET_STATS_DATA"]["RESULT"]["STATUS"] = 100
    payload["GET_STATS_DATA"]["RESULT"]["ERROR_MSG"] = "該当データはありません。"
    client = _FakeClient(payload)
    with pytest.raises(EstatApiError) as exc:
        fetch_estat(
            stats_data_id="bad",
            app_id="K",
            series_id="x",
            name="n",
            url="https://example.com/",
            license="l",
            unit="u",
            client=client,
        )
    assert "該当データはありません" in str(exc.value)


def test_fetch_estat_requires_stats_data_id():
    # Until M1-3 confirms the statsDataId via getStatsList, registry holds None.
    # Live fetches must fail loudly rather than silently hit a bad endpoint.
    client = _FakeClient(_payload())
    with pytest.raises(ValueError):
        fetch_estat(
            stats_data_id=None,
            app_id="K",
            series_id="x",
            name="n",
            url="https://example.com/",
            license="l",
            unit="u",
            client=client,
        )


def test_registry_estat_specs_have_search_word_for_discovery():
    # statsDataId is intentionally None now; the search_word drives M1-3 discovery.
    estat = [s for s in REGISTRY.values() if s.connector == "estat"]
    assert estat
    for spec in estat:
        assert spec.fetch.get("search_word")
        assert "stats_data_id" in spec.fetch

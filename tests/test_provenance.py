from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from etl.provenance import Source


def _valid_kwargs():
    return {
        "series_id": "household.food.real_yoy",
        "name": "総務省 家計調査",
        "url": "https://www.stat.go.jp/data/kakei/",
        "retrieved_at": datetime(2026, 6, 21, 0, 0, tzinfo=timezone.utc),
        "license": "政府標準利用規約",
        "unit": "yoy_pct",
        "frequency": "monthly",
    }


def test_valid_source_round_trips():
    src = Source(**_valid_kwargs())

    assert src.series_id == "household.food.real_yoy"
    assert src.name == "総務省 家計調査"
    # HttpUrl is not a plain str in pydantic v2; compare via str().
    assert str(src.url) == "https://www.stat.go.jp/data/kakei/"
    assert isinstance(src.retrieved_at, datetime)
    assert src.retrieved_at == datetime(2026, 6, 21, 0, 0, tzinfo=timezone.utc)
    assert src.license == "政府標準利用規約"
    assert src.unit == "yoy_pct"
    assert src.frequency == "monthly"


@pytest.mark.parametrize(
    "missing",
    ["series_id", "name", "url", "retrieved_at", "license", "unit", "frequency"],
)
def test_missing_required_field_raises(missing):
    kwargs = _valid_kwargs()
    del kwargs[missing]
    with pytest.raises(ValidationError):
        Source(**kwargs)


def test_invalid_url_raises():
    kwargs = _valid_kwargs()
    kwargs["url"] = "not-a-url"
    with pytest.raises(ValidationError):
        Source(**kwargs)

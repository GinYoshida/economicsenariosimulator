from pathlib import Path

import pandas as pd
import pytest

from etl.connectors.futures import aggregate_monthly_close, fetch_futures

FIXTURE = Path("data/fixtures/futures_wheat.csv")


def _daily() -> pd.DataFrame:
    return pd.read_csv(FIXTURE, parse_dates=["Date"], index_col="Date")


def test_aggregate_to_month_start_last_close():
    df = aggregate_monthly_close(_daily())
    assert list(df.columns) == ["date", "value"]
    # three calendar months in the fixture
    assert len(df) == 3
    assert (df["date"].dt.day == 1).all()
    assert df["date"].tolist() == [
        pd.Timestamp("2024-01-01"),
        pd.Timestamp("2024-02-01"),
        pd.Timestamp("2024-03-01"),
    ]
    # month value is the last trading day's close of that month
    s = df.set_index("date")["value"]
    assert s.loc["2024-01-01"] == pytest.approx(598.50)
    assert s.loc["2024-02-01"] == pytest.approx(590.00)
    assert s.loc["2024-03-01"] == pytest.approx(624.50)


def test_aggregate_sorted_and_float():
    df = aggregate_monthly_close(_daily())
    assert df["date"].is_monotonic_increasing
    assert pd.api.types.is_float_dtype(df["value"])


def test_fetch_futures_uses_downloader_and_builds_source():
    captured = {}

    def fake_downloader(ticker):
        captured["ticker"] = ticker
        return _daily()

    df, source = fetch_futures(
        ticker="ZW=F",
        series_id="fut.wheat",
        name="Yahoo Finance (futures/FX)",
        url="https://finance.yahoo.com/",
        license="Yahoo Finance terms of use",
        unit="usd",
        downloader=fake_downloader,
    )
    assert captured["ticker"] == "ZW=F"
    assert len(df) == 3
    assert source.series_id == "fut.wheat"
    assert source.unit == "usd"
    assert source.frequency == "monthly"
    assert source.retrieved_at.tzinfo is not None


def test_fetch_futures_raises_on_empty_download():
    def empty_downloader(ticker):
        return pd.DataFrame()

    with pytest.raises(ValueError):
        fetch_futures(
            ticker="ZW=F",
            series_id="fut.wheat",
            name="Yahoo Finance (futures/FX)",
            url="https://finance.yahoo.com/",
            license="Yahoo Finance terms of use",
            unit="usd",
            downloader=empty_downloader,
        )

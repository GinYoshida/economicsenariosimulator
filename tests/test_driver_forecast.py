import numpy as np
import pandas as pd

from models.driver_forecast import build_driver_forecasts, forecast_driver
from models.schema import DriverForecast


def _trend_series(n=60, slope=0.5, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2019-01-01", periods=n, freq="MS")
    vals = 10 + slope * np.arange(n) + rng.normal(scale=0.3, size=n)
    return pd.Series(vals, index=idx)


def test_forecast_driver_returns_mean_and_growing_se():
    y = _trend_series()
    mean, se = forecast_driver(y, 12)
    assert len(mean) == 12 and len(se) == 12
    assert np.all(np.isfinite(mean)) and np.all(se >= 0)
    # uncertainty widens with horizon
    assert se[-1] >= se[0]
    # an upward trend keeps rising
    assert mean[-1] > mean[0]


def test_forecast_driver_fallback_on_short_series():
    # varying diffs (1,2,3) -> positive drift and non-zero step sigma
    y = pd.Series(
        [1.0, 2.0, 4.0, 7.0], index=pd.date_range("2024-01-01", periods=4, freq="MS")
    )
    mean, se = forecast_driver(y, 6)  # < MIN_OBS -> random-walk+drift fallback
    assert len(mean) == 6
    assert mean[0] > 7.0  # positive drift continues
    assert se[-1] > se[0]  # widening band


def test_build_driver_forecasts_observed_then_future():
    idx = pd.date_range("2019-01-01", periods=60, freq="MS")
    panel = pd.DataFrame({"cpi.food": np.linspace(100, 130, 60)}, index=idx)
    last_target = pd.Timestamp("2023-10-01")  # target lags the driver by 2 months
    out = build_driver_forecasts(
        panel,
        ["cpi.food"],
        last_target_date=last_target,
        horizon=12,
        max_lag=2,
        label_of={"cpi.food": "食料価格(CPI)"},
        unit_of={"cpi.food": "index"},
    )
    assert len(out) == 1
    df = out[0]
    assert isinstance(df, DriverForecast)
    by_date = {p.date: p for p in df.points}
    # an observed month has std 0
    assert by_date["2023-10-01"].std == 0.0
    # a future month (beyond the driver's last obs 2023-12) has std > 0
    assert by_date["2024-06-01"].std > 0.0
    # covers last_target - max_lag .. last_target + horizon
    assert "2023-08-01" in by_date
    assert "2024-10-01" in by_date


def test_build_driver_forecasts_skips_missing_columns():
    idx = pd.date_range("2019-01-01", periods=30, freq="MS")
    panel = pd.DataFrame({"cpi.food": np.arange(30.0)}, index=idx)
    out = build_driver_forecasts(
        panel, ["cpi.food", "not.there"], last_target_date=idx[-1],
        horizon=6, max_lag=1, label_of={}, unit_of={},
    )
    assert {d.driver for d in out} == {"cpi.food"}

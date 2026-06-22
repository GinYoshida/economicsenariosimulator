import numpy as np
import pandas as pd
import pytest

from models.features import TARGET_BY_CATEGORY, make_features


def _panel(n=36, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2021-01-01", periods=n, freq="MS")
    return pd.DataFrame(
        {
            "household.food.real_yoy": rng.normal(size=n),
            "household.clothing.real_yoy": rng.normal(size=n),
            "cpi.food": rng.normal(size=n),
            "cao.cci.attitude": rng.normal(size=n),
            "fut.wheat": rng.normal(size=n),
        },
        index=idx,
    )


def test_target_selection_by_category():
    assert TARGET_BY_CATEGORY["food"] == "household.food.real_yoy"
    assert TARGET_BY_CATEGORY["clothing"] == "household.clothing.real_yoy"


def test_lagged_columns_are_named_and_shifted():
    panel = _panel()
    lags = {"cpi.food": 1, "cao.cci.attitude": 2}
    X, y = make_features(panel, "food", lags=lags)
    assert "cpi.food__lag1" in X.columns
    assert "cao.cci.attitude__lag2" in X.columns
    # value at row t equals raw driver at t-lag
    t = X.index[5]
    assert X.loc[t, "cpi.food__lag1"] == pytest.approx(
        panel["cpi.food"].shift(1).loc[t]
    )


def test_seasonal_dummies_drop_first_gives_11():
    panel = _panel()
    X, _ = make_features(panel, "food", lags={"cpi.food": 1}, add_seasonal=True)
    season_cols = [c for c in X.columns if c.startswith("month_")]
    assert len(season_cols) == 11  # drop_first avoids the dummy trap


def test_seasonal_dummies_full_gives_12():
    panel = _panel()
    X, _ = make_features(
        panel, "food", lags={"cpi.food": 1}, add_seasonal=True, drop_first_season=False
    )
    season_cols = [c for c in X.columns if c.startswith("month_")]
    assert len(season_cols) == 12


def test_nan_rows_dropped_and_x_y_aligned():
    panel = _panel()
    X, y = make_features(panel, "food", lags={"cpi.food": 1, "cao.cci.attitude": 3})
    # max lag is 3 -> first 3 rows dropped
    assert X.index.equals(y.index)
    assert not X.isna().any().any()
    assert not y.isna().any()
    assert X.index[0] == panel.index[3]


def test_missing_target_in_panel_raises():
    panel = _panel().drop(columns=["household.food.real_yoy"])
    with pytest.raises(KeyError):
        make_features(panel, "food", lags={"cpi.food": 1})

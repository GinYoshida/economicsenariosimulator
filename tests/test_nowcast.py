import numpy as np
import pandas as pd
import pytest

from models.features import make_features
from models.nowcast import nowcast_target
from models.ols import fit_ols


def _panel_with_unpublished_tail(n=48, seed=2):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2021-01-01", periods=n, freq="MS")
    driver = rng.normal(size=n)
    # target depends on the previous month's driver (early-published cost signal)
    target = 2.0 + 3.0 * pd.Series(driver, index=idx).shift(1) + rng.normal(
        scale=1e-3, size=n
    )
    panel = pd.DataFrame(
        {
            "household.food.real_yoy": target.to_numpy(),
            "household.clothing.real_yoy": rng.normal(size=n),
            "fut.wheat": driver,
        },
        index=idx,
    )
    true_tail = panel["household.food.real_yoy"].iloc[-2:].copy()
    # simulate publication lag: last 2 target months not yet released
    panel.loc[panel.index[-2:], "household.food.real_yoy"] = np.nan
    return panel, true_tail


def test_nowcast_fills_unpublished_tail_close_to_truth():
    panel, true_tail = _panel_with_unpublished_tail()
    lags = {"fut.wheat": 1}
    X, y = make_features(panel, "food", lags=lags)
    fit = fit_ols(X, y)

    filled = nowcast_target(panel, "food", fit)
    # the two previously-NaN months are now filled
    assert filled.iloc[-2:].notna().all()
    assert filled.iloc[-1] == pytest.approx(true_tail.iloc[-1], abs=0.1)
    assert filled.iloc[-2] == pytest.approx(true_tail.iloc[-2], abs=0.1)


def test_nowcast_leaves_published_values_unchanged():
    panel, _ = _panel_with_unpublished_tail()
    lags = {"fut.wheat": 1}
    X, y = make_features(panel, "food", lags=lags)
    fit = fit_ols(X, y)

    filled = nowcast_target(panel, "food", fit)
    original = panel["household.food.real_yoy"]
    published = original.dropna().index
    pd.testing.assert_series_equal(
        filled.loc[published], original.loc[published], check_names=False
    )


def test_nowcast_returns_series_indexed_like_panel():
    panel, _ = _panel_with_unpublished_tail()
    X, y = make_features(panel, "food", lags={"fut.wheat": 1})
    fit = fit_ols(X, y)
    filled = nowcast_target(panel, "food", fit)
    assert filled.index.equals(panel.index)

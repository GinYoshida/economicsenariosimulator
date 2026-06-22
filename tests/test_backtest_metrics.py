import numpy as np
import pandas as pd
import pytest

from models.backtest import direction_hit, mae, naive_persistence, rmse


def test_mae_and_rmse_known_values():
    y_true = np.array([1.0, 2.0, 3.0])
    y_pred = np.array([1.5, 1.0, 3.0])  # errors: 0.5, 1.0, 0.0
    assert mae(y_true, y_pred) == pytest.approx((0.5 + 1.0 + 0.0) / 3)
    assert rmse(y_true, y_pred) == pytest.approx(
        np.sqrt((0.25 + 1.0 + 0.0) / 3)
    )


def test_direction_hit_sign_agreement():
    y_true = np.array([1.0, -2.0, 3.0, -1.0])
    y_pred = np.array([0.5, -0.1, -2.0, -5.0])  # signs match on 1st,2nd,4th
    assert direction_hit(y_true, y_pred) == pytest.approx(3 / 4)


def test_metrics_ignore_nan_pairs():
    y_true = np.array([1.0, np.nan, 3.0])
    y_pred = np.array([1.0, 2.0, np.nan])
    # only the first pair is valid -> error 0
    assert mae(y_true, y_pred) == pytest.approx(0.0)


def test_naive_persistence_is_previous_value():
    y = pd.Series([1.0, 2.0, 3.0, 4.0])
    yhat = naive_persistence(y)
    assert np.isnan(yhat.iloc[0])
    assert yhat.iloc[1] == pytest.approx(1.0)
    assert yhat.iloc[3] == pytest.approx(3.0)

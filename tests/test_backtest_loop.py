import numpy as np
import pandas as pd

from models.backtest import run_backtest
from models.schema import BacktestMetric


def _panel(n=90, signal=True, seed=3):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2016-01-01", periods=n, freq="MS")
    driver = rng.normal(size=n)
    if signal:
        # target driven by lagged driver -> model should beat persistence
        target = 3.0 * pd.Series(driver, index=idx).shift(1) + rng.normal(
            scale=0.2, size=n
        )
        target = target.to_numpy()
    else:
        # random walk -> persistence is near-optimal; an unrelated driver
        # cannot beat it (no exploitable structural signal)
        target = np.cumsum(rng.normal(size=n))
    return pd.DataFrame(
        {
            "household.food.real_yoy": target,
            "household.clothing.real_yoy": rng.normal(size=n),
            "fut.wheat": driver,
        },
        index=idx,
    )


def test_backtest_returns_metric_for_category():
    panel = _panel(signal=True)
    m = run_backtest(panel, "food", lags={"fut.wheat": 1}, horizon=3, min_train=30)
    assert isinstance(m, BacktestMetric)
    assert m.category == "food"
    assert m.mae >= 0 and m.rmse >= 0
    assert 0.0 <= m.direction_hit <= 1.0


def test_model_beats_naive_on_predictable_series():
    panel = _panel(signal=True)
    m = run_backtest(panel, "food", lags={"fut.wheat": 1}, horizon=3, min_train=30)
    assert m.beats_naive is True
    assert m.mae < m.naive_mae


def test_model_does_not_beat_naive_on_pure_noise():
    panel = _panel(signal=False)
    m = run_backtest(panel, "food", lags={"fut.wheat": 1}, horizon=3, min_train=30)
    # on noise the structural model should not reliably beat persistence
    assert m.beats_naive is False

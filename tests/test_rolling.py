import numpy as np
import pandas as pd

from models.rolling import build_rolling_forecasts


def _panel(n: int = 120) -> pd.DataFrame:
    idx = pd.date_range("2016-01-01", periods=n, freq="MS")
    rng = np.random.default_rng(0)
    drv = np.cumsum(rng.normal(0, 0.01, n)) + 0.02
    food = 0.1 - 0.4 * drv + rng.normal(0, 0.005, n)
    cloth = -0.02 - 1.0 * drv + rng.normal(0, 0.02, n)
    return pd.DataFrame(
        {
            "household.food.real_yoy": food,
            "household.clothing.real_yoy": cloth,
            "cpi.food": drv,
            "cpi.clothing": drv,
        },
        index=idx,
    )


CATEGORY_DRIVERS = {
    "food": {"cpi.food": 1},
    "clothing": {"cpi.clothing": 1},
}
LABELS = {"cpi.food": "食料価格(CPI)", "cpi.clothing": "被服価格(CPI)"}
UNITS = {"cpi.food": "index", "cpi.clothing": "index"}


def test_rolling_returns_points_for_each_category_and_horizon():
    panel = _panel()
    pts, _blend = build_rolling_forecasts(
        panel,
        ["food", "clothing"],
        CATEGORY_DRIVERS,
        driver_labels=LABELS,
        unit_of=UNITS,
        horizon=6,
        target_months=12,
        min_train=24,
    )
    assert pts, "expected rolling points"
    cats = {p["category"] for p in pts}
    assert cats == {"food", "clothing"}
    hs = {p["h"] for p in pts}
    assert hs == set(range(1, 7))
    # each point has mean/sd; sd non-negative and finite
    for p in pts:
        assert np.isfinite(p["mean"]) and np.isfinite(p["sd"]) and p["sd"] >= 0
        assert set(p) == {"category", "h", "date", "mean", "sd", "actual"}


def test_rolling_band_widens_with_horizon():
    # For a fixed origin, sd at h=6 should exceed sd at h=1 (drivers extrapolated).
    panel = _panel()
    pts, _blend = build_rolling_forecasts(
        panel,
        ["food"],
        CATEGORY_DRIVERS,
        driver_labels=LABELS,
        unit_of=UNITS,
        horizon=6,
        target_months=6,
        min_train=24,
    )
    # group by origin = date - h months; compare within the latest origin
    by_origin: dict[str, dict[int, float]] = {}
    for p in pts:
        if p["category"] != "food":
            continue
        target = pd.Timestamp(p["date"])
        origin = (target - pd.DateOffset(months=p["h"])).date().isoformat()
        by_origin.setdefault(origin, {})[p["h"]] = p["sd"]
    full = [d for d in by_origin.values() if 1 in d and 6 in d]
    assert full, "need an origin covering h=1..6"
    assert any(d[6] > d[1] for d in full)


def test_rolling_actual_present_for_past_targets():
    panel = _panel()
    pts, _blend = build_rolling_forecasts(
        panel,
        ["food"],
        CATEGORY_DRIVERS,
        driver_labels=LABELS,
        unit_of=UNITS,
        horizon=6,
        target_months=12,
        min_train=24,
    )
    # targets within the panel range must carry an actual; beyond it must be None
    last = panel.index.max()
    for p in pts:
        t = pd.Timestamp(p["date"])
        if t <= last:
            assert p["actual"] is not None
        else:
            assert p["actual"] is None

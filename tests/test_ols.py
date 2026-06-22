import numpy as np
import pandas as pd
import pytest

from models.ols import decompose, fit_ols, predict


def _synth(n=200, seed=1):
    rng = np.random.default_rng(seed)
    x1 = rng.normal(size=n)
    x2 = rng.normal(size=n)
    y = 2.0 + 3.0 * x1 - 1.5 * x2 + rng.normal(scale=1e-3, size=n)
    X = pd.DataFrame({"x1": x1, "x2": x2})
    return X, pd.Series(y, name="y")


def test_fit_recovers_known_coefficients():
    X, y = _synth()
    fit = fit_ols(X, y)
    assert fit.intercept == pytest.approx(2.0, abs=1e-2)
    assert fit.coefs["x1"] == pytest.approx(3.0, abs=1e-2)
    assert fit.coefs["x2"] == pytest.approx(-1.5, abs=1e-2)
    assert fit.r2 > 0.999


def test_predict_matches_manual_linear_combo():
    X, y = _synth()
    fit = fit_ols(X, y)
    yhat = predict(fit, X)
    manual = fit.intercept + 3.0 * X["x1"].to_numpy() - 1.5 * X["x2"].to_numpy()
    assert np.allclose(yhat, manual, atol=1e-2)


def test_decompose_sums_to_prediction():
    X, y = _synth()
    fit = fit_ols(X, y)
    row = X.iloc[10]
    contrib = decompose(fit, row)
    assert set(contrib.keys()) == {"x1", "x2"}
    total = sum(contrib.values()) + fit.intercept
    yhat = predict(fit, X.iloc[[10]])[0]
    assert total == pytest.approx(yhat, abs=1e-6)


def test_decompose_contribution_is_coef_times_value():
    X, y = _synth()
    fit = fit_ols(X, y)
    row = X.iloc[3]
    contrib = decompose(fit, row)
    assert contrib["x1"] == pytest.approx(fit.coefs["x1"] * row["x1"])


def test_predict_respects_feature_order():
    X, y = _synth()
    fit = fit_ols(X, y)
    shuffled = X[["x2", "x1"]]  # different column order
    yhat = predict(fit, shuffled)
    assert np.allclose(yhat, predict(fit, X), atol=1e-9)

import json

import pytest
from pydantic import ValidationError

from models.schema import (
    Backtest,
    BacktestMetric,
    Baseline,
    BaselinePoint,
    CategoryModel,
    Coefficients,
    DriverCoef,
)


def _coefficients_dict():
    return {
        "generated_at": "2026-06-22T00:00:00Z",
        "categories": [
            {
                "category": "food",
                "intercept": 0.5,
                "drivers": [
                    {
                        "driver": "cao.cci.attitude",
                        "label_ja": "消費者態度指数",
                        "coef": 0.12,
                        "lag_months": 1,
                    }
                ],
                "r2": 0.61,
                "model_version": "v1",
                "data_vintage": "2024-05-01",
            }
        ],
    }


def _baseline_point():
    return {
        "date": "2024-05-01",
        "food_yoy": 1.2,
        "clothing_yoy": -0.4,
        "food_low": 0.8,
        "food_high": 1.6,
        "clothing_low": -0.9,
        "clothing_high": 0.1,
    }


def test_coefficients_roundtrip():
    data = _coefficients_dict()
    model = Coefficients(**data)
    assert model.categories[0].category == "food"
    assert model.categories[0].drivers[0].driver == "cao.cci.attitude"
    # dict -> model -> json -> dict round trip
    reparsed = Coefficients(**json.loads(model.model_dump_json()))
    assert reparsed == model


def test_driver_coef_requires_all_fields():
    with pytest.raises(ValidationError):
        DriverCoef(driver="x", label_ja="y", coef=0.1)  # missing lag_months


def test_category_model_requires_fields():
    with pytest.raises(ValidationError):
        CategoryModel(category="food", intercept=0.0, drivers=[], r2=0.5)


def test_baseline_roundtrip():
    data = {
        "history": [_baseline_point()],
        "forecast": [_baseline_point()],
        "horizon_note": "3 months model-driven + 3 years interpretive",
    }
    model = Baseline(**data)
    assert len(model.history) == 1
    assert isinstance(model.history[0], BaselinePoint)
    reparsed = Baseline(**json.loads(model.model_dump_json()))
    assert reparsed == model


def test_baseline_point_requires_bands():
    bad = _baseline_point()
    del bad["food_low"]
    with pytest.raises(ValidationError):
        BaselinePoint(**bad)


def test_backtest_roundtrip():
    data = {
        "metrics": [
            {
                "category": "food",
                "mae": 0.5,
                "rmse": 0.7,
                "direction_hit": 0.66,
                "naive_mae": 0.8,
                "naive_rmse": 1.0,
                "naive_direction_hit": 0.5,
                "beats_naive": True,
            }
        ],
        "window": "expanding, horizon=3",
    }
    model = Backtest(**data)
    assert model.metrics[0].beats_naive is True
    reparsed = Backtest(**json.loads(model.model_dump_json()))
    assert reparsed == model


def test_backtest_metric_requires_naive_fields():
    with pytest.raises(ValidationError):
        BacktestMetric(
            category="food", mae=0.5, rmse=0.7, direction_hit=0.6, beats_naive=False
        )

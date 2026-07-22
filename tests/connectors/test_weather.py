"""天候コネクタの集計ロジック（ネットワーク非依存）テスト。"""

from datetime import datetime, timezone

import pandas as pd

from etl.connectors import weather
from etl.connectors.weather import (
    METRICS,
    daily_to_monthly_ratios,
    fetch_weather,
    national_to_frames,
    weighted_national,
)


def _daily_jan_feb():
    # 1月=31日: うち5日が真夏日相当(>=30)・2日が豪雨(>=50)。2月=28日: 0日。
    dates, tmax, prcp = [], [], []
    for d in range(1, 32):
        dates.append(f"2024-01-{d:02d}")
        tmax.append(31.0 if d <= 5 else 10.0)
        prcp.append(60.0 if d <= 2 else 0.0)
    for d in range(1, 29):
        dates.append(f"2024-02-{d:02d}")
        tmax.append(8.0)
        prcp.append(1.0)
    return dates, tmax, prcp


def test_daily_to_monthly_ratios_counts_thresholds():
    dates, tmax, prcp = _daily_jan_feb()
    mr = daily_to_monthly_ratios(dates, tmax, prcp)
    assert set(mr.keys()) == {"2024-01", "2024-02"}
    assert mr["2024-01"]["weather.summer_days"] == 5 / 31
    assert mr["2024-01"]["weather.heavy_rain_days"] == 2 / 31
    assert mr["2024-02"]["weather.summer_days"] == 0.0


def test_short_month_is_dropped():
    # 15日しかない月は _MIN_DAYS_IN_MONTH 未満で捨てる。
    dates = [f"2024-03-{d:02d}" for d in range(1, 16)]
    mr = daily_to_monthly_ratios(dates, [31.0] * 15, [0.0] * 15)
    assert "2024-03" not in mr


def test_weighted_national_population_weights():
    a = {"2024-01": {name: (1.0 if name == "weather.summer_days" else 0.0) for name in METRICS}}
    b = {"2024-01": {name: 0.0 for name in METRICS}}
    nat = weighted_national([(3.0, a), (1.0, b)])
    # 加重平均 = (3*1 + 1*0)/(3+1) = 0.75
    assert nat["2024-01"]["weather.summer_days"] == 0.75


def test_national_to_frames_shape():
    nat = {"2024-01": {name: 0.1 for name in METRICS},
           "2024-02": {name: 0.2 for name in METRICS}}
    frames = national_to_frames(nat)
    df = frames["weather.summer_days"]
    assert list(df.columns) == ["date", "value"]
    assert len(df) == 2
    assert df["date"].iloc[0] == pd.Timestamp("2024-01-01")
    assert df["value"].iloc[1] == 0.2


class _FakeResp:
    status_code = 200

    def __init__(self, payload):
        self._p = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._p


class _FakeClient:
    """全都市に同一の日別ペイロードを返すダミー。"""

    def __init__(self):
        d, tx, pr = _daily_jan_feb()
        self._payload = {"daily": {"time": d, "temperature_2m_max": tx,
                                   "precipitation_sum": pr}}

    def get(self, url, params=None, timeout=None):
        return _FakeResp(self._payload)


def test_fetch_weather_returns_series_and_source(monkeypatch):
    weather._CACHE.clear()
    # sleep を無効化して即時に。
    monkeypatch.setattr(weather.time, "sleep", lambda *_a, **_k: None)
    df, src = fetch_weather(
        "weather.summer_days",
        series_id="weather.summer_days",
        name="Open-Meteo（真夏日割合）",
        url="https://open-meteo.com/",
        license="CC-BY",
        unit="ratio",
        client=_FakeClient(),
        end_date="2024-02-28",
        retrieved_at=datetime(2024, 3, 1, tzinfo=timezone.utc),
    )
    assert list(df.columns) == ["date", "value"]
    # 全都市同値なので 1月 = 5/31。
    jan = df.set_index("date")["value"].loc["2024-01-01"]
    assert abs(jan - 5 / 31) < 1e-9
    assert src.series_id == "weather.summer_days"
    assert src.unit == "ratio"
    assert src.retrieved_at.tzinfo is not None

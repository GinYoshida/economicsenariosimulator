"""天候コネクタ（Open-Meteo アーカイブAPI・ERA5再解析）。

主要都市の日別「最高気温・降水量」を取得し、月次の
「経済活動を阻害し得る日の割合」（真夏日・猛暑日・豪雨日 等）を
人口加重で全国系列にして返す。API キー不要（CC-BY・出典明示で利用可）。

食料消費は天候（酷暑・豪雨）の供給・行動ショックに左右されるため、
センチメントでは説明できない前月差の方向を補完する外生ドライバーとして使う。

設計上の約束（他コネクタと同様）:
- 集計ロジック（``daily_to_monthly_ratios`` / ``weighted_national``）は
  ネットワーク非依存で単体テストする。
- 1プロセス内では都市取得を一度だけ行い、派生系列間でキャッシュ共有する。
- 一部都市の取得失敗は許容（残りで全国系列を作る）。全滅時のみ例外。
"""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from etl.provenance import Source

ARCHIVE_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive"

# (都市名, 緯度, 経度, おおよその人口[万]=加重). 全国の消費を代表する大都市。
CITIES: list[tuple[str, float, float, float]] = [
    ("東京", 35.69, 139.69, 1350),
    ("横浜", 35.44, 139.64, 370),
    ("大阪", 34.69, 135.50, 275),
    ("名古屋", 35.18, 136.91, 230),
    ("札幌", 43.06, 141.35, 195),
    ("福岡", 33.59, 130.40, 160),
    ("神戸", 34.69, 135.20, 150),
    ("京都", 35.01, 135.77, 145),
    ("川崎", 35.53, 139.70, 155),
    ("さいたま", 35.86, 139.65, 135),
    ("広島", 34.39, 132.46, 120),
    ("仙台", 38.27, 140.87, 110),
]

# 系列名 -> (判定種別, 閾値)。tmax_ge=最高気温以上, tmax_lt=最高気温未満, prcp_ge=降水量以上。
METRICS: dict[str, tuple[str, float]] = {
    "weather.summer_days": ("tmax_ge", 30.0),      # 真夏日割合(>=30℃)
    "weather.hot_days": ("tmax_ge", 35.0),         # 猛暑日割合(>=35℃)
    "weather.heavy_rain_days": ("prcp_ge", 50.0),  # 豪雨日割合(>=50mm)
    "weather.rain_days": ("prcp_ge", 30.0),        # 大雨日割合(>=30mm)
    "weather.cold_days": ("tmax_lt", 5.0),         # 厳寒日割合(<5℃)
}

_DEFAULT_START = "2015-01-01"
_MIN_DAYS_IN_MONTH = 20  # 端月の欠損対策（この日数未満の月は捨てる）

# プロセス内キャッシュ: {(start, end): {metric: DataFrame[date,value]}}
_CACHE: dict[tuple[str, str], dict[str, pd.DataFrame]] = {}


def daily_to_monthly_ratios(
    dates: list[str], tmax: list, prcp: list
) -> dict[str, dict[str, float]]:
    """日別配列から {month 'YYYY-MM': {metric: 割合}} を作る。"""
    cnt: dict[str, int] = defaultdict(int)
    hit: dict[tuple[str, str], int] = defaultdict(int)
    for i, ds in enumerate(dates):
        ym = str(ds)[:7]
        cnt[ym] += 1
        tx = tmax[i] if i < len(tmax) else None
        pr = prcp[i] if i < len(prcp) else None
        for name, (kind, thr) in METRICS.items():
            ok = False
            if kind == "tmax_ge" and tx is not None:
                ok = tx >= thr
            elif kind == "tmax_lt" and tx is not None:
                ok = tx < thr
            elif kind == "prcp_ge" and pr is not None:
                ok = pr >= thr
            if ok:
                hit[(ym, name)] += 1
    out: dict[str, dict[str, float]] = {}
    for ym, n in cnt.items():
        if n < _MIN_DAYS_IN_MONTH:
            continue
        out[ym] = {name: hit[(ym, name)] / n for name in METRICS}
    return out


def weighted_national(
    per_city: list[tuple[float, dict[str, dict[str, float]]]]
) -> dict[str, dict[str, float]]:
    """人口加重で全国月次系列を作る。per_city=[(weight, monthly_ratios), ...]。"""
    acc: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    wsum: dict[str, float] = defaultdict(float)
    for w, mr in per_city:
        for ym, ratios in mr.items():
            for name, v in ratios.items():
                acc[ym][name] += w * v
            wsum[ym] += w
    return {
        ym: {name: acc[ym][name] / wsum[ym] for name in METRICS}
        for ym in acc
        if wsum[ym] > 0
    }


def national_to_frames(national: dict[str, dict[str, float]]) -> dict[str, pd.DataFrame]:
    """{month: {metric: v}} を {metric: DataFrame[date,value]} に変換。"""
    frames: dict[str, pd.DataFrame] = {}
    months = sorted(national)
    for name in METRICS:
        rows = [
            (pd.Timestamp(f"{ym}-01"), national[ym][name]) for ym in months
        ]
        df = pd.DataFrame(rows, columns=["date", "value"])
        if not df.empty:
            df["date"] = pd.to_datetime(df["date"])
            df["value"] = df["value"].astype(float)
        frames[name] = df
    return frames


def _fetch_city_daily(client: Any, lat: float, lon: float, end: str, timeout: float):
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": _DEFAULT_START,
        "end_date": end,
        "daily": "temperature_2m_max,precipitation_sum",
        "timezone": "Asia/Tokyo",
    }
    # 429/5xx はバックオフ再試行（Open-Meteo は無料枠でレート制限あり）。
    last_exc: Exception | None = None
    for attempt in range(4):
        try:
            r = client.get(ARCHIVE_ENDPOINT, params=params, timeout=timeout)
            if r.status_code == 429 or r.status_code >= 500:
                raise RuntimeError(f"HTTP {r.status_code}")
            r.raise_for_status()
            d = r.json().get("daily", {})
            return (
                d.get("time", []),
                d.get("temperature_2m_max", []),
                d.get("precipitation_sum", []),
            )
        except Exception as e:  # noqa: BLE001 - 再試行のため広めに捕捉
            last_exc = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"open-meteo fetch failed for ({lat},{lon}): {last_exc}")


def _build_national(
    client: Any, end: str, timeout: float, pause: float
) -> dict[str, pd.DataFrame]:
    per_city: list[tuple[float, dict]] = []
    errors: list[str] = []
    for _name, lat, lon, pop in CITIES:
        try:
            dates, tmax, prcp = _fetch_city_daily(client, lat, lon, end, timeout)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{_name}: {e}")
            continue
        per_city.append((float(pop), daily_to_monthly_ratios(dates, tmax, prcp)))
        time.sleep(pause)  # レート制限回避のため都市間に間隔を空ける
    if not per_city:
        raise RuntimeError(f"all city fetches failed: {errors}")
    return national_to_frames(weighted_national(per_city))


def fetch_weather(
    metric: str,
    *,
    series_id: str,
    name: str,
    url: str,
    license: str,
    unit: str,
    frequency: str = "monthly",
    client: Any | None = None,
    end_date: str | None = None,
    retrieved_at: datetime | None = None,
    timeout: float = 90.0,
    pause: float = 0.6,
) -> tuple[pd.DataFrame, Source]:
    """天候の派生系列 1 本を ``(DataFrame, Source)`` で返す。

    都市の日別取得は1プロセス内でキャッシュし、派生系列間で共有する。
    ``client`` を渡すとその ``.get(url, params=, timeout=)`` を使う（テストでモック）。
    """
    if metric not in METRICS:
        raise ValueError(f"unknown weather metric '{metric}' for series '{series_id}'")

    end = end_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cache_key = (_DEFAULT_START, end)
    owns_client = client is None
    if cache_key not in _CACHE:
        if owns_client:
            import httpx

            client = httpx.Client()
        try:
            _CACHE[cache_key] = _build_national(client, end, timeout, pause)
        finally:
            if owns_client and client is not None:
                client.close()

    df = _CACHE[cache_key].get(metric, pd.DataFrame(columns=["date", "value"]))
    source = Source(
        series_id=series_id,
        name=name,
        url=url,
        retrieved_at=retrieved_at or datetime.now(timezone.utc),
        license=license,
        unit=unit,
        frequency=frequency,
    )
    return df.copy(), source

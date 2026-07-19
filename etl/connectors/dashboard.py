"""統計ダッシュボード コネクタ（現行の月次指標）。

e-Stat の getStatsData には現行（2016年以降）の月次「毎月勤労統計」賃金系列が
無い（2015年で凍結）。そこで賃金は統計ダッシュボード API
（https://dashboard.e-stat.go.jp/api/1.0/Json/getData）から取得する。
API キーは不要。``date``(月初)/``value`` の縦持ち ``DataFrame`` と ``Source`` を返す。

時間軸コードは "YYYYMMDD"（例 "20260500" = 2026年5月）。日は "00" などになり得る。
値セルは DATA_OBJ[].VALUE の ``$``。応答形状のブレに強いよう再帰探索で拾う。

設計上の約束（estat コネクタと同様）:
- ネットワーク依存テストは ``data/fixtures/dashboard_*.json`` を使い実APIは叩かない。
- 欠測トークン（``-`` ``***`` など）は ``NaN`` に変換する（落とさず保持）。
- ``indicator_code`` 未確定（None/空）の場合は明示的に失敗させる。
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from etl.provenance import Source

DASHBOARD_ENDPOINT = "https://dashboard.e-stat.go.jp/api/1.0/Json/getData"

# 値の代わりに入る非数値トークン。すべて欠測扱い。
_MISSING_TOKENS = {"-", "***", "**", "*", "X", "x", "…", "...", "‐", "", "－"}

# 時間軸コード "YYYYMMDD"（日は 00 を許容）。年4桁＋月2桁を拾う。
_TIME_RE = re.compile(r"^(\d{4})(\d{2})\d{2}$")


class DashboardApiError(RuntimeError):
    """統計ダッシュボード API が status != 0 を返したときに送出する。"""


def _safe_month_start(year: int, month: int) -> pd.Timestamp | None:
    if not 1 <= month <= 12:
        return None
    try:
        return pd.Timestamp(year=year, month=month, day=1)
    except (ValueError, OverflowError):
        return None


def _time_to_date(code: str) -> pd.Timestamp | None:
    """"20260500" → 2026-05-01。月次でない（月00等）行は None。"""
    m = _TIME_RE.match(code or "")
    if not m:
        return None
    return _safe_month_start(int(m.group(1)), int(m.group(2)))


def _value_to_float(raw: Any) -> float:
    if raw is None:
        return float("nan")
    text = str(raw).strip().replace(",", "")
    if text in _MISSING_TOKENS:
        return float("nan")
    try:
        return float(text)
    except ValueError:
        return float("nan")


def _iter_value_cells(node: Any):
    """JSON を再帰探索し、``@time`` を持つ値セル(dict)を列挙する（形状非依存）。"""
    if isinstance(node, dict):
        if "@time" in node:
            yield node
        for v in node.values():
            yield from _iter_value_cells(v)
    elif isinstance(node, list):
        for v in node:
            yield from _iter_value_cells(v)


def _cell_value(cell: dict) -> Any:
    """値セルから数値本体を取り出す（"$" 優先、無ければ @value/value）。"""
    for key in ("$", "@value", "value"):
        if key in cell:
            return cell[key]
    return None


def parse_dashboard_response(payload: dict) -> pd.DataFrame:
    """getData の JSON を ``date``/``value`` の DataFrame に変換する。"""
    root = payload.get("GET_STATS", payload)
    result = root.get("RESULT") or root.get("result") or {}
    status = result.get("status", result.get("STATUS"))
    if status not in (0, "0", None):
        raise DashboardApiError(
            f"dashboard API error (status={status}): "
            f"{result.get('errorMsg', result.get('ERROR_MSG', ''))}"
        )

    rows: list[tuple[pd.Timestamp, float]] = []
    for cell in _iter_value_cells(payload):
        date = _time_to_date(str(cell.get("@time", "")))
        if date is None:
            continue
        rows.append((date, _value_to_float(_cell_value(cell))))

    df = pd.DataFrame(rows, columns=["date", "value"])
    if df.empty:
        return df.astype({"value": float})
    df = df.sort_values("date").drop_duplicates("date").reset_index(drop=True)
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = df["value"].astype(float)
    return df


def fetch_dashboard(
    indicator_code: str | None,
    *,
    series_id: str,
    name: str,
    url: str,
    license: str,
    unit: str,
    frequency: str = "monthly",
    region_code: str = "00000",
    client: Any | None = None,
    retrieved_at: datetime | None = None,
    timeout: float = 30.0,
) -> tuple[pd.DataFrame, Source]:
    """統計ダッシュボードから 1 系列を取得し ``(DataFrame, Source)`` を返す。

    ``client`` を渡すとその ``.get(url, params=, timeout=)`` を使う（テストでモック）。
    """
    if not indicator_code:
        raise ValueError(
            f"indicator_code is not set for series '{series_id}'. "
            "Confirm it via the dashboard getIndicatorInfo probe and record it "
            "in the registry before running a live fetch."
        )

    params = {
        "Lang": "JP",
        "IndicatorCode": indicator_code,
        "RegionCode": region_code,
    }

    owns_client = client is None
    if owns_client:
        import httpx

        client = httpx.Client()
    try:
        response = client.get(DASHBOARD_ENDPOINT, params=params, timeout=timeout)
        response.raise_for_status()
        payload = response.json()
    finally:
        if owns_client:
            client.close()

    df = parse_dashboard_response(payload)

    source = Source(
        series_id=series_id,
        name=name,
        url=url,
        retrieved_at=retrieved_at or datetime.now(timezone.utc),
        license=license,
        unit=unit,
        frequency=frequency,
    )
    return df, source

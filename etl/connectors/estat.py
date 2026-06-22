"""e-Stat コネクタ（家計調査・消費者物価指数）。

e-Stat の getStatsData JSON API を取得し、``date``(月初) / ``value`` の縦持ち
``pandas.DataFrame`` と出典メタ ``Source`` を返す。

設計上の約束:
- ネットワーク依存テストは ``data/fixtures/estat_*.json`` を使い、実APIは叩かない。
  実フィクスチャの取得と statsDataId の確定は GitHub Actions / 手元で行う（M1-3 注記）。
- 欠測トークン（``-`` ``***`` ``X`` など）は ``NaN`` に変換する（落とさず保持）。
- ``statsDataId`` 未確定（None）の場合は静かに不正URLを叩かず、明示的に失敗させる。

参考: GET https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from etl.provenance import Source

ESTAT_ENDPOINT = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData"

# e-Stat が値の代わりに入れる非数値トークン（DATA_INF.NOTE 由来）。すべて欠測扱い。
_MISSING_TOKENS = {"-", "***", "**", "*", "X", "x", "…", "...", "‐", "", "－"}

# 時間軸名 "2024年1月" / コード "2024000101" 双方に対応する正規表現。
_NAME_RE = re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月")
_CODE_RE = re.compile(r"^(\d{4})\d{2}(\d{2})\d{2}$")


class EstatApiError(RuntimeError):
    """e-Stat API が RESULT.STATUS != 0 を返したときに送出する。"""


def _as_list(node: Any) -> list:
    """e-Stat は 1 件のとき配列でなく単一オブジェクトを返すため正規化する。"""
    if node is None:
        return []
    if isinstance(node, list):
        return node
    return [node]


def _time_code_to_date(code: str, name: str | None) -> pd.Timestamp | None:
    """時間軸の名前/コードから月初の Timestamp を作る。"""
    if name:
        m = _NAME_RE.search(name)
        if m:
            return pd.Timestamp(year=int(m.group(1)), month=int(m.group(2)), day=1)
    if code:
        m = _CODE_RE.match(code)
        if m:
            return pd.Timestamp(year=int(m.group(1)), month=int(m.group(2)), day=1)
    return None


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


def parse_estat_response(payload: dict) -> pd.DataFrame:
    """getStatsData の JSON を ``date``/``value`` の DataFrame に変換する。"""
    root = payload.get("GET_STATS_DATA", {})
    result = root.get("RESULT", {})
    status = result.get("STATUS")
    if status not in (0, "0", None):
        raise EstatApiError(
            f"e-Stat API error (STATUS={status}): {result.get('ERROR_MSG', '')}"
        )

    stat_data = root.get("STATISTICAL_DATA", {})
    class_objs = _as_list(stat_data.get("CLASS_INF", {}).get("CLASS_OBJ"))

    # 時間軸コード -> 表示名 のマップを作る（日付解決のため）。
    time_names: dict[str, str] = {}
    for obj in class_objs:
        if obj.get("@id") == "time":
            for cls in _as_list(obj.get("CLASS")):
                time_names[str(cls.get("@code"))] = cls.get("@name", "")

    rows: list[tuple[pd.Timestamp, float]] = []
    for cell in _as_list(stat_data.get("DATA_INF", {}).get("VALUE")):
        code = str(cell.get("@time", ""))
        date = _time_code_to_date(code, time_names.get(code))
        if date is None:
            continue
        rows.append((date, _value_to_float(cell.get("$"))))

    df = pd.DataFrame(rows, columns=["date", "value"])
    df = df.sort_values("date").drop_duplicates("date").reset_index(drop=True)
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = df["value"].astype(float)
    return df


def fetch_estat(
    stats_data_id: str | None,
    app_id: str,
    *,
    series_id: str,
    name: str,
    url: str,
    license: str,
    unit: str,
    frequency: str = "monthly",
    extra_params: dict | None = None,
    client: Any | None = None,
    retrieved_at: datetime | None = None,
    timeout: float = 30.0,
) -> tuple[pd.DataFrame, Source]:
    """e-Stat から 1 系列を取得し ``(DataFrame, Source)`` を返す。

    ``client`` を渡すとその ``.get(url, params=, timeout=)`` を使う（テストでモック）。
    渡さない場合は ``httpx.Client`` を生成する（実行時のみ import）。
    """
    if not stats_data_id:
        raise ValueError(
            f"statsDataId is not set for series '{series_id}'. "
            "Confirm it via getStatsList (M1-3) and record it in the registry "
            "before running a live fetch."
        )

    params = {
        "appId": app_id,
        "statsDataId": stats_data_id,
        "lang": "J",
        "metaGetFlg": "Y",
        "cntGetFlg": "N",
    }
    if extra_params:
        params.update(extra_params)

    owns_client = client is None
    if owns_client:
        import httpx

        client = httpx.Client()
    try:
        response = client.get(ESTAT_ENDPOINT, params=params, timeout=timeout)
        response.raise_for_status()
        payload = response.json()
    finally:
        if owns_client:
            client.close()

    df = parse_estat_response(payload)

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

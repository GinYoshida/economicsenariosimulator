"""日本銀行 時系列統計データ コネクタ（金利・為替）。

日銀「時系列統計データ検索サイト」(stat-search.boj.or.jp) の CSV を取得し、
``date``(月初) / ``value`` の DataFrame と出典メタ ``Source`` を返す。

CSV はメタデータ行（系列コード・名称・単位など）に続いて ``日付,値`` の行が並ぶ。
日付らしき先頭列を持つ行のみをデータ行として抽出する（メタ行数に依存しない）。
実エクスポートは Shift_JIS(cp932) のことが多いため、UTF-8 → cp932 の順に復号する。

NOTE: 実データの CSV ダウンロードURL（series_code から組み立て）は M1-4 で確定する。
未指定（None）の場合は明示的に失敗させ、静かに不正URLを叩かない。
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from etl.provenance import Source

# "2024/01" "2024-01" "2024/1/1" "2024.01" などに対応。
_DATE_RE = re.compile(r"^\s*(\d{4})[/\-.](\d{1,2})(?:[/\-.](\d{1,2}))?\s*$")
_MISSING_TOKENS = {"", "nd", "na", "n.a.", "*", "-", "...", "…", "x"}


def _to_date(cell: str) -> pd.Timestamp | None:
    m = _DATE_RE.match(cell)
    if not m:
        return None
    return pd.Timestamp(year=int(m.group(1)), month=int(m.group(2)), day=1)


def _to_float(cell: str) -> float:
    text = (cell or "").strip().replace(",", "")
    if text.lower() in _MISSING_TOKENS:
        return float("nan")
    try:
        return float(text)
    except ValueError:
        return float("nan")


def parse_boj_csv(text: str) -> pd.DataFrame:
    """BOJ 時系列 CSV テキストを ``date``/``value`` の DataFrame に変換する。"""
    rows: list[tuple[pd.Timestamp, float]] = []
    reader = csv.reader(io.StringIO(text))
    for record in reader:
        if not record:
            continue
        date = _to_date(record[0])
        if date is None:
            continue  # メタデータ行・ヘッダ行はスキップ
        value = _to_float(record[1]) if len(record) > 1 else float("nan")
        rows.append((date, value))

    df = pd.DataFrame(rows, columns=["date", "value"])
    df = df.sort_values("date").drop_duplicates("date").reset_index(drop=True)
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = df["value"].astype(float)
    return df


def _decode(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp932"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def fetch_boj(
    series_code: str,
    *,
    csv_url: str | None,
    series_id: str,
    name: str,
    url: str,
    license: str,
    unit: str,
    frequency: str = "monthly",
    client: Any | None = None,
    retrieved_at: datetime | None = None,
    timeout: float = 30.0,
) -> tuple[pd.DataFrame, Source]:
    """日銀 CSV から 1 系列を取得し ``(DataFrame, Source)`` を返す。"""
    if not csv_url:
        raise ValueError(
            f"csv_url is not set for series '{series_id}' (code={series_code}). "
            "Confirm the BOJ CSV download URL (M1-4) before a live fetch."
        )

    owns_client = client is None
    if owns_client:
        import httpx

        client = httpx.Client()
    try:
        response = client.get(csv_url, timeout=timeout)
        response.raise_for_status()
        text = _decode(response.content)
    finally:
        if owns_client:
            client.close()

    df = parse_boj_csv(text)
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

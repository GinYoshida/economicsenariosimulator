"""DuckDB ストア（系列値＋出典メタの永続化）。

2 テーブル構成:
- ``series_long(series_id, date, value)``  … 縦持ちの月次値
- ``sources(series_id, name, url, retrieved_at, license, unit, frequency)``
  … 系列ごとの出典メタ（1 系列 1 行）

各系列の書き込みは「既存行を削除してから挿入」で冪等にする。
"""

from __future__ import annotations

import duckdb
import pandas as pd

from etl.provenance import Source

_SERIES_TABLE = "series_long"
_SOURCES_TABLE = "sources"


def init_db(con: duckdb.DuckDBPyConnection) -> None:
    """必要なテーブルを作成する（存在すれば何もしない）。"""
    con.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {_SERIES_TABLE} (
            series_id VARCHAR NOT NULL,
            date      DATE    NOT NULL,
            value     DOUBLE
        )
        """
    )
    con.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {_SOURCES_TABLE} (
            series_id    VARCHAR PRIMARY KEY,
            name         VARCHAR NOT NULL,
            url          VARCHAR NOT NULL,
            retrieved_at TIMESTAMPTZ NOT NULL,
            license      VARCHAR NOT NULL,
            unit         VARCHAR NOT NULL,
            frequency    VARCHAR NOT NULL
        )
        """
    )


def write_series(
    con: duckdb.DuckDBPyConnection,
    series_id: str,
    df: pd.DataFrame,
    source: Source,
) -> None:
    """1 系列の値と出典メタを書き込む（既存分は置き換える）。"""
    init_db(con)

    frame = df[["date", "value"]].copy()
    frame.insert(0, "series_id", series_id)
    frame["date"] = pd.to_datetime(frame["date"])

    con.execute(f"DELETE FROM {_SERIES_TABLE} WHERE series_id = ?", [series_id])
    con.register("_incoming_series", frame)
    con.execute(
        f"INSERT INTO {_SERIES_TABLE} SELECT series_id, date, value FROM _incoming_series"
    )
    con.unregister("_incoming_series")

    con.execute(f"DELETE FROM {_SOURCES_TABLE} WHERE series_id = ?", [series_id])
    con.execute(
        f"""
        INSERT INTO {_SOURCES_TABLE}
            (series_id, name, url, retrieved_at, license, unit, frequency)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            source.series_id,
            source.name,
            str(source.url),
            source.retrieved_at,
            source.license,
            source.unit,
            source.frequency,
        ],
    )


def read_series(
    con: duckdb.DuckDBPyConnection,
    series_id: str,
) -> tuple[pd.DataFrame, Source]:
    """1 系列の ``(DataFrame[date,value], Source)`` を返す。未登録なら KeyError。"""
    meta = con.execute(
        f"""
        SELECT series_id, name, url, retrieved_at, license, unit, frequency
        FROM {_SOURCES_TABLE} WHERE series_id = ?
        """,
        [series_id],
    ).fetchone()
    if meta is None:
        raise KeyError(f"series_id not found: {series_id}")

    df = con.execute(
        f"SELECT date, value FROM {_SERIES_TABLE} WHERE series_id = ? ORDER BY date",
        [series_id],
    ).df()
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = df["value"].astype(float)

    source = Source(
        series_id=meta[0],
        name=meta[1],
        url=meta[2],
        retrieved_at=meta[3],
        license=meta[4],
        unit=meta[5],
        frequency=meta[6],
    )
    return df, source

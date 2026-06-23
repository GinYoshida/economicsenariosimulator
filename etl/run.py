"""ETL オーケストレータ（レジストリ駆動で全コネクタを実行し DuckDB に格納）。

定期バッチ（``.github/workflows/batch.yml``）から呼ばれる。各 ``SourceSpec`` の
``connector`` 種別に応じてフェッチ関数へディスパッチし、``write_series`` で保存する。

取得パラメータが未確定（e-Stat ``stats_data_id`` が None、BOJ ``csv_url`` 未設定、
内閣府の Excel ローダ未提供など）の系列は **ハードクラッシュさせず skip** として記録し、
確定済みの系列だけ書き込む。これにより「未確定IDがあるうちは pending を可視化しつつ
確定分から積み増す」運用ができる。

テスト容易性のため、コネクタ呼び出しは ``dispatchers`` / ``cao_provider`` で差し替え可能。
"""

from __future__ import annotations

import os
from typing import Callable

import duckdb
import pandas as pd

from etl.connectors import boj, estat, futures
from etl.provenance import Source
from etl.registry import REGISTRY, SourceSpec
from etl.store import init_db, write_series

# 1 系列を取得する関数の型。
SeriesFetcher = Callable[[SourceSpec, str | None], tuple[pd.DataFrame, Source]]
# 内閣府 Excel から複数系列を返す関数の型。
CaoProvider = Callable[[], list[tuple[pd.DataFrame, Source]]]


def _fetch_estat(spec: SourceSpec, app_id: str | None) -> tuple[pd.DataFrame, Source]:
    f = spec.fetch
    return estat.fetch_estat(
        stats_data_id=f.get("stats_data_id"),
        app_id=app_id or os.environ.get("ESTAT_APP_ID", ""),
        series_id=spec.series_id,
        name=spec.name,
        url=spec.url,
        license=spec.license,
        unit=spec.unit,
        frequency=spec.frequency,
        extra_params=f.get("extra_params"),
    )


def _fetch_boj(spec: SourceSpec, _app_id: str | None) -> tuple[pd.DataFrame, Source]:
    f = spec.fetch
    return boj.fetch_boj(
        series_code=f.get("series_code", ""),
        csv_url=f.get("csv_url"),
        series_id=spec.series_id,
        name=spec.name,
        url=spec.url,
        license=spec.license,
        unit=spec.unit,
        frequency=spec.frequency,
    )


def _fetch_futures(spec: SourceSpec, _app_id: str | None) -> tuple[pd.DataFrame, Source]:
    f = spec.fetch
    return futures.fetch_futures(
        ticker=f["ticker"],
        series_id=spec.series_id,
        name=spec.name,
        url=spec.url,
        license=spec.license,
        unit=spec.unit,
        frequency=spec.frequency,
    )


DEFAULT_DISPATCHERS: dict[str, SeriesFetcher] = {
    "estat": _fetch_estat,
    "boj": _fetch_boj,
    "futures": _fetch_futures,
}


def run_etl(
    con: duckdb.DuckDBPyConnection,
    *,
    app_id: str | None = None,
    dispatchers: dict[str, SeriesFetcher] | None = None,
    cao_provider: CaoProvider | None = None,
) -> dict[str, list]:
    """レジストリの全系列を取得・保存し、結果サマリを返す。

    戻り値: ``{"written": [...], "skipped": [(series_id, reason)], "failed": [...]}``。
    未確定パラメータ由来の ``ValueError`` は skip、その他の例外は failed に記録する。
    """
    init_db(con)
    dispatchers = dispatchers or DEFAULT_DISPATCHERS

    written: list[str] = []
    skipped: list[tuple[str, str]] = []
    failed: list[tuple[str, str]] = []

    for sid, spec in REGISTRY.items():
        if spec.connector == "cao":
            continue  # 内閣府はファイル単位でまとめて処理（下記）。
        fetch = dispatchers.get(spec.connector)
        if fetch is None:
            skipped.append((sid, f"no dispatcher for connector '{spec.connector}'"))
            continue
        try:
            df, source = fetch(spec, app_id)
        except ValueError as e:
            skipped.append((sid, str(e)))
            continue
        except Exception as e:  # noqa: BLE001 - バッチは1系列の失敗で全体を止めない
            failed.append((sid, f"{type(e).__name__}: {e}"))
            continue
        write_series(con, sid, df, source)
        written.append(sid)

    # --- 内閣府 DI（消費動向調査・景気ウォッチャー） ---
    cao_ids = [sid for sid, s in REGISTRY.items() if s.connector == "cao"]
    if cao_provider is None:
        for sid in cao_ids:
            skipped.append((sid, "cao_provider not supplied (Excel URL/layout TBD)"))
    else:
        try:
            for df, source in cao_provider():
                write_series(con, source.series_id, df, source)
                written.append(source.series_id)
        except Exception as e:  # noqa: BLE001
            for sid in cao_ids:
                failed.append((sid, f"{type(e).__name__}: {e}"))

    return {"written": written, "skipped": skipped, "failed": failed}


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Run the ETL into DuckDB")
    parser.add_argument("--db", default="data/warehouse.duckdb")
    args = parser.parse_args()

    con = duckdb.connect(args.db)
    try:
        summary = run_etl(con)
    finally:
        con.close()

    print(f"written: {len(summary['written'])}")
    for sid, reason in summary["skipped"]:
        print(f"  skipped {sid}: {reason}")
    for sid, reason in summary["failed"]:
        print(f"  FAILED  {sid}: {reason}")
    if summary["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

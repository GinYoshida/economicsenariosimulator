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

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Callable

import duckdb
import pandas as pd

from etl.connectors import boj, dashboard, estat, futures, weather
from etl.provenance import Source
from etl.registry import REGISTRY, SourceSpec
from etl.store import init_db, write_series

# 1 系列を取得する関数の型。
SeriesFetcher = Callable[[SourceSpec, str | None], tuple[pd.DataFrame, Source]]
# 内閣府 Excel から複数系列を返す関数の型。
CaoProvider = Callable[[], list[tuple[pd.DataFrame, Source]]]
# 取得に失敗した系列の「前回公開値」を返す関数の型（無ければ None）。
Fallback = Callable[[SourceSpec], "tuple[pd.DataFrame, Source] | None"]


def published_fallback(
    series_path: str | Path = "public/data/series.json",
    sources_path: str | Path = "public/data/sources.json",
) -> Fallback:
    """前回公開した成果物（series.json / sources.json）から系列を復元する fallback。

    公的 API が一時停止しても週次更新全体を止めず、その系列だけ前回値で継続する。
    出典の取得日時は前回の実取得日時（sources.json）を使い、鮮度を偽らない。
    """
    try:
        series = json.loads(Path(series_path).read_text(encoding="utf-8"))["series"]
        sources = json.loads(Path(sources_path).read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError):
        return lambda _spec: None
    pts = {s["series_id"]: s["points"] for s in series}
    fetched = {s["series_id"]: s.get("retrieved_at") for s in sources}

    def load(spec: SourceSpec) -> tuple[pd.DataFrame, Source] | None:
        rows = [p for p in pts.get(spec.series_id, []) if p.get("value") is not None]
        when = fetched.get(spec.series_id)
        if not rows or not when:
            return None
        df = pd.DataFrame(
            {"date": pd.to_datetime([p["date"] for p in rows]),
             "value": [float(p["value"]) for p in rows]}
        )
        src = Source(
            series_id=spec.series_id, name=spec.name, url=spec.url,
            retrieved_at=datetime.fromisoformat(when), license=spec.license,
            unit=spec.unit, frequency=spec.frequency,
        )
        return df, src

    return load


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


def _fetch_dashboard(spec: SourceSpec, _app_id: str | None) -> tuple[pd.DataFrame, Source]:
    f = spec.fetch
    return dashboard.fetch_dashboard(
        indicator_code=f.get("indicator_code"),
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


def _fetch_weather(spec: SourceSpec, _app_id: str | None) -> tuple[pd.DataFrame, Source]:
    f = spec.fetch
    return weather.fetch_weather(
        metric=f["metric"],
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
    "dashboard": _fetch_dashboard,
    "weather": _fetch_weather,
}


def run_etl(
    con: duckdb.DuckDBPyConnection,
    *,
    app_id: str | None = None,
    dispatchers: dict[str, SeriesFetcher] | None = None,
    cao_provider: CaoProvider | None = None,
    fallback: Fallback | None = None,
) -> dict[str, list]:
    """レジストリの全系列を取得・保存し、結果サマリを返す。

    戻り値: ``{"written", "skipped", "failed", "stale"}``。
    未確定パラメータ由来の ``ValueError`` は skip、その他の例外は failed に記録する。
    ``fallback`` を渡すと、取得失敗した系列を前回公開値で補い ``stale`` に記録する
    （failed にはしない）。補えなかった系列だけが failed になる。
    """
    init_db(con)
    # None は「未指定＝既定を使う」。空dict {} は「明示的に空」（テストで使用）。
    dispatchers = DEFAULT_DISPATCHERS if dispatchers is None else dispatchers

    written: list[str] = []
    skipped: list[tuple[str, str]] = []
    failed: list[tuple[str, str]] = []
    stale: list[tuple[str, str]] = []

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
            reason = f"{type(e).__name__}: {e}"
            prev = fallback(spec) if fallback is not None else None
            if prev is None:
                failed.append((sid, reason))
                continue
            df, source = prev
            stale.append((sid, reason))
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

    return {"written": written, "skipped": skipped, "failed": failed, "stale": stale}


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Run the ETL into DuckDB")
    parser.add_argument("--db", default="data/warehouse.duckdb")
    args = parser.parse_args()

    con = duckdb.connect(args.db)
    try:
        summary = run_etl(con, fallback=published_fallback())
    finally:
        con.close()

    print(f"written: {len(summary['written'])}")
    for sid, reason in summary["skipped"]:
        print(f"  skipped {sid}: {reason}")
    for sid, reason in summary["stale"]:
        print(f"  STALE   {sid}: 取得失敗のため前回公開値で継続 ({reason})")
    for sid, reason in summary["failed"]:
        print(f"  FAILED  {sid}: {reason}")
    if summary["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

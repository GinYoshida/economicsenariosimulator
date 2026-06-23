"""e-Stat の statsDataId と品目分類コードを探索する一時スクリプト。

GitHub Actions（egress 制限のない環境）で実行し、家計調査・消費者物価指数の
統計表ID候補と、その cat01（品目分類）コードを標準出力に印字する。
出力は registry（``etl/connectors`` の取得パラメータ）確定の根拠に使う。

重要: appId（秘密情報）は絶対に印字しない。検索語・表ID・コードのみ出力する。

使い方:
    ESTAT_APP_ID=... uv run python scripts/estat_discover.py
"""

from __future__ import annotations

import json
import os
import sys

import httpx

BASE = "https://api.e-stat.go.jp/rest/3.0/app/json"

# 探索したい統計表（検索語）。必要に応じて足す。
SEARCH_WORDS = [
    "家計調査 二人以上の世帯 月次 1世帯当たり",
    "消費者物価指数 中分類 食料",
    "消費者物価指数 中分類 被服及び履物",
]

# メタ情報で抽出したい品目（cat01 の表示名にこの語を含むものを拾う）。
CATEGORY_HINTS = ["食料", "被服", "履物"]


def _get(client: httpx.Client, path: str, params: dict) -> dict:
    r = client.get(f"{BASE}/{path}", params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def _as_list(node):
    if node is None:
        return []
    return node if isinstance(node, list) else [node]


def discover(app_id: str) -> None:
    with httpx.Client() as client:
        for word in SEARCH_WORDS:
            print("\n" + "=" * 72)
            print(f"SEARCH_WORD: {word}")
            data = _get(
                client,
                "getStatsList",
                {"appId": app_id, "searchWord": word, "limit": "8"},
            )
            res = data.get("GET_STATS_LIST", {})
            status = res.get("RESULT", {}).get("STATUS")
            if status not in (0, "0"):
                print(f"  ERROR status={status}: {res.get('RESULT', {}).get('ERROR_MSG')}")
                continue
            tables = _as_list(res.get("DATALIST_INF", {}).get("TABLE_INF"))
            print(f"  candidates: {len(tables)}")
            for t in tables:
                tid = t.get("@id")
                title = t.get("TITLE")
                title = title.get("$") if isinstance(title, dict) else title
                stat = t.get("STAT_NAME")
                stat = stat.get("$") if isinstance(stat, dict) else stat
                cycle = t.get("CYCLE")
                survey = t.get("SURVEY_DATE")
                print(f"  - statsDataId={tid} | {stat} | {title} | cycle={cycle} | {survey}")

            # 先頭候補の cat01 コードを引く（品目分類の確認用）。
            if tables:
                top = tables[0].get("@id")
                print(f"  -- META cat01 for statsDataId={top} --")
                meta = _get(
                    client, "getMetaInfo", {"appId": app_id, "statsDataId": top}
                )
                class_objs = _as_list(
                    meta.get("GET_META_INFO", {})
                    .get("METADATA_INF", {})
                    .get("CLASS_INF", {})
                    .get("CLASS_OBJ")
                )
                for obj in class_objs:
                    if obj.get("@id") != "cat01":
                        continue
                    for cls in _as_list(obj.get("CLASS")):
                        name = cls.get("@name", "")
                        if any(h in name for h in CATEGORY_HINTS):
                            print(
                                f"     cat01 code={cls.get('@code')} name={name} "
                                f"level={cls.get('@level')}"
                            )


def main() -> int:
    app_id = os.environ.get("ESTAT_APP_ID", "").strip()
    if not app_id:
        print("ERROR: ESTAT_APP_ID is not set", file=sys.stderr)
        return 2
    try:
        discover(app_id)
    except httpx.HTTPError as e:
        print(f"HTTP error: {e}", file=sys.stderr)
        return 1
    print("\nDONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

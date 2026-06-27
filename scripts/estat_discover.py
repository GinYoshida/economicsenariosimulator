"""e-Stat の statsDataId と品目分類コードを探索する一時スクリプト。

GitHub Actions（egress 制限のない環境）で実行し、家計調査・消費者物価指数の
統計表ID候補と、その cat01（品目分類）コードを標準出力に印字する。

統計コード（statsCode）で対象統計を絞り、月次・二人以上の世帯・中分類などの
手がかりで候補を表示する。候補のうち見込みの高い表は getMetaInfo で
cat01（食料／被服）コードも併せて印字する。

重要: appId（秘密情報）は絶対に印字しない。検索条件・表ID・コードのみ出力する。
"""

from __future__ import annotations

import os
import sys

import httpx

BASE = "https://api.e-stat.go.jp/rest/3.0/app/json"

# 政府統計コード（統計全体の識別子）。
STATS_CODE_KAKEI = "00200561"  # 家計調査
STATS_CODE_CPI = "00200573"    # 消費者物価指数

CATEGORY_HINTS = ["食料", "被服", "履物"]


def _get(client: httpx.Client, path: str, params: dict) -> dict:
    r = client.get(f"{BASE}/{path}", params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def _as_list(node):
    if node is None:
        return []
    return node if isinstance(node, list) else [node]


def _text(node) -> str:
    if isinstance(node, dict):
        return str(node.get("$", ""))
    return str(node) if node is not None else ""


def _list_tables(client: httpx.Client, app_id: str, stats_code: str,
                 search_word: str = "") -> list[dict]:
    params = {"appId": app_id, "statsCode": stats_code, "limit": "100"}
    if search_word:
        params["searchWord"] = search_word
    data = _get(client, "getStatsList", params)
    res = data.get("GET_STATS_LIST", {})
    status = res.get("RESULT", {}).get("STATUS")
    if status not in (0, "0"):
        print(f"  ERROR status={status}: {res.get('RESULT', {}).get('ERROR_MSG')}")
        return []
    return _as_list(res.get("DATALIST_INF", {}).get("TABLE_INF"))


def _cat01_matches(client: httpx.Client, app_id: str, stats_data_id: str) -> list[str]:
    meta = _get(client, "getMetaInfo", {"appId": app_id, "statsDataId": stats_data_id})
    class_objs = _as_list(
        meta.get("GET_META_INFO", {}).get("METADATA_INF", {})
        .get("CLASS_INF", {}).get("CLASS_OBJ")
    )
    out: list[str] = []
    for obj in class_objs:
        if obj.get("@id") != "cat01":
            continue
        for cls in _as_list(obj.get("CLASS")):
            name = cls.get("@name", "")
            if any(h in name for h in CATEGORY_HINTS):
                out.append(f"cat01 code={cls.get('@code')} name={name} level={cls.get('@level')}")
    return out


def _describe(t: dict) -> tuple[str, str, str, str]:
    tid = str(t.get("@id"))
    title = _text(t.get("TITLE")) or _text(t.get("STATISTICS_NAME"))
    stats_name = _text(t.get("STATISTICS_NAME"))
    cycle = _text(t.get("CYCLE"))
    survey = _text(t.get("SURVEY_DATE"))
    return tid, f"{stats_name} / {title}", cycle, survey


def explore(client: httpx.Client, app_id: str, label: str, stats_code: str,
            title_must_have: list[str], meta_cap: int = 8) -> None:
    print("\n" + "=" * 72)
    print(f"{label} (statsCode={stats_code})")
    tables = _list_tables(client, app_id, stats_code)
    print(f"  total tables: {len(tables)}")

    # 月次かつ手がかり語を含む候補を優先表示。
    def is_monthly(t):
        return "月" in _text(t.get("CYCLE"))

    def hit(t):
        blob = _describe(t)[1]
        return all(w in blob for w in title_must_have)

    candidates = [t for t in tables if is_monthly(t) and hit(t)]
    print(f"  monthly candidates matching {title_must_have}: {len(candidates)}")

    shown = candidates[:meta_cap] if candidates else tables[:meta_cap]
    for t in shown:
        tid, name, cycle, survey = _describe(t)
        print(f"  - statsDataId={tid} | {name} | cycle={cycle} | {survey}")
        try:
            for line in _cat01_matches(client, app_id, tid):
                print(f"      {line}")
        except httpx.HTTPError as e:
            print(f"      (meta error: {e})")


# 確定した統計表の全軸（CLASS_OBJ）を出力して、cdArea/cdTab 等の絞り込み
# コードを確定するための対象。
TABLES_TO_INSPECT = ["0002070001", "0003427113"]


def inspect_table(client: httpx.Client, app_id: str, stats_data_id: str) -> None:
    print("\n" + "#" * 72)
    print(f"INSPECT statsDataId={stats_data_id}")
    meta = _get(client, "getMetaInfo", {"appId": app_id, "statsDataId": stats_data_id})
    info = meta.get("GET_META_INFO", {}).get("METADATA_INF", {})
    title = info.get("TABLE_INF", {})
    print(f"  title: {_text(title.get('STATISTICS_NAME'))} / {_text(title.get('TITLE'))}")
    for obj in _as_list(info.get("CLASS_INF", {}).get("CLASS_OBJ")):
        axis_id = obj.get("@id")
        axis_name = obj.get("@name")
        classes = _as_list(obj.get("CLASS"))
        print(f"  AXIS {axis_id} ({axis_name}) n={len(classes)}")
        if axis_id == "cat01":
            # 品目は多いので食料/被服のみ表示。
            for cls in classes:
                if any(h in cls.get("@name", "") for h in CATEGORY_HINTS):
                    print(f"      code={cls.get('@code')} name={cls.get('@name')} level={cls.get('@level')}")
        else:
            # tab/area/time など軸の先頭数件を表示。
            for cls in classes[:10]:
                print(f"      code={cls.get('@code')} name={cls.get('@name')}")


def main() -> int:
    app_id = os.environ.get("ESTAT_APP_ID", "").strip()
    if not app_id:
        print("ERROR: ESTAT_APP_ID is not set", file=sys.stderr)
        return 2
    try:
        with httpx.Client() as client:
            for sid in TABLES_TO_INSPECT:
                inspect_table(client, app_id, sid)
    except httpx.HTTPError as e:
        print(f"HTTP error: {e}", file=sys.stderr)
        return 1
    print("\nDONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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
                 search_word: str = "", limit: str = "300") -> list[dict]:
    params = {"appId": app_id, "statsCode": stats_code, "limit": limit}
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


# 毎月勤労統計調査 全国調査（賃金）
STATS_CODE_MLS = "00450071"
WAGE_HINTS = ["現金給与総額", "実質賃金", "賃金指数", "給与"]
HEADLINE_HINTS = ["総合"]  # CPI 総合（実質所得デフレータ）


def _time_span(client: httpx.Client, app_id: str, stats_data_id: str):
    """統計表の時間軸 (軸名, 件数, 先頭, 末尾) を返す（順序は表による）。"""
    meta = _get(client, "getMetaInfo", {"appId": app_id, "statsDataId": stats_data_id})
    for obj in _as_list(
        meta.get("GET_META_INFO", {}).get("METADATA_INF", {})
        .get("CLASS_INF", {}).get("CLASS_OBJ")
    ):
        if obj.get("@id") == "time":
            classes = _as_list(obj.get("CLASS"))
            if not classes:
                return obj.get("@name", ""), 0, "", ""
            return (
                obj.get("@name", ""),
                len(classes),
                classes[0].get("@name", ""),
                classes[-1].get("@name", ""),
            )
    return "", 0, "", ""


def inspect_table(client: httpx.Client, app_id: str, stats_data_id: str,
                  cat_hints: list[str]) -> None:
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
        extra = ""
        if axis_id == "time" and classes:
            extra = f" span[{classes[0].get('@name')} .. {classes[-1].get('@name')}]"
        if axis_id in ("cat01", "cat02", "cat03", "cat04") and classes:
            head = "; ".join(
                f"{c.get('@code')}={c.get('@name')}" for c in classes[:6]
            )
            extra = f" e.g. {head}"
        print(f"  AXIS {axis_id} ({axis_name}) n={len(classes)}{extra}")
        if axis_id and axis_id.startswith("cat"):
            for cls in classes:
                if any(h in cls.get("@name", "") for h in cat_hints):
                    print(f"      code={cls.get('@code')} name={cls.get('@name')} level={cls.get('@level')}")
        elif axis_id != "time":
            for cls in classes[:12]:
                print(f"      code={cls.get('@code')} name={cls.get('@name')}")


# 現行表を出すための検索語（2020年基準・実数/指数・給与項目・対前年同月比 等）。
WAGE_SEARCH_WORDS = [
    "現金給与総額",
    "実質賃金指数",
    "実数 現金給与総額",
    "賃金指数 現金給与総額",
    "きまって支給する給与",
    "2020年基準",
    "実数・指数",
    "対前年同月比 現金給与総額",
    "毎月勤労統計調査 全国 賃金",
]


def _list_all_tables(client: httpx.Client, app_id: str, stats_code: str) -> list[dict]:
    """searchWord なしで statsCode 配下の全表をページングで取得する。

    searchWord はインデックス未収録の表を隠すため、現行表の有無を最終判定するには
    素の全件列挙が確実。NEXT_KEY で startPosition を送りながら全ページを集める。
    """
    out: list[dict] = []
    start = None
    for _ in range(30):  # 安全上限（30ページ×100=3000表）
        params = {"appId": app_id, "statsCode": stats_code, "limit": "100"}
        if start is not None:
            params["startPosition"] = str(start)
        res = _get(client, "getStatsList", params).get("GET_STATS_LIST", {})
        status = res.get("RESULT", {}).get("STATUS")
        if status not in (0, "0"):
            print(f"  bare-list ERROR status={status}: {res.get('RESULT', {}).get('ERROR_MSG')}")
            break
        out.extend(_as_list(res.get("DATALIST_INF", {}).get("TABLE_INF")))
        nxt = res.get("DATALIST_INF", {}).get("RESULT_INF", {}).get("NEXT_KEY")
        if not nxt:
            break
        start = nxt
    return out


def _is_legacy_title(name: str) -> bool:
    return any(m in name for m in ("長期時系列", "旧産業分類", "年報", "累積データ"))


def _currentness(t: dict) -> int:
    """現行表らしさのスコア（高いほど現行月次に近い）。"""
    _, name, cycle, survey = _describe(t)
    score = 0
    if _end_year(survey) >= 2016:
        score += 5
    if _is_legacy_title(name):
        score -= 4
    if "月" in cycle:
        score += 1
    if any(w in name for w in ("現金給与", "実質賃金", "賃金指数", "きまって支給")):
        score += 1
    return score


def _end_year(*names: str) -> int:
    """時間軸ラベル群から末尾の西暦4桁（2010〜2099）を拾う。無ければ 0。"""
    best = 0
    for name in names:
        digits = ""
        for ch in name:
            if ch.isdigit():
                digits += ch
            else:
                if len(digits) >= 4:
                    year = int(digits[:4])
                    if 2010 <= year <= 2099 and year > best:
                        best = year
                digits = ""
        if len(digits) >= 4:
            year = int(digits[:4])
            if 2010 <= year <= 2099 and year > best:
                best = year
    return best


def explore_wage(client: httpx.Client, app_id: str) -> list[str]:
    """毎月勤労統計から賃金表の候補を、時間軸(名前・範囲)付きで表示。候補ID を返す。

    目的は 2016〜2026 まで伸びる「月次（年月）」の現行表を特定すること。検索語を広げ、
    各表の時間軸の末尾西暦を評価し、2016年以降まで届く表だけを昇格して表示する。
    """
    print("\n" + "=" * 72)
    print(f"賃金（毎月勤労統計 全国調査 statsCode={STATS_CODE_MLS}）")
    seen: dict[str, dict] = {}
    for word in WAGE_SEARCH_WORDS:
        got = _list_tables(client, app_id, STATS_CODE_MLS, search_word=word)
        print(f"  search '{word}': {len(got)} tables")
        for t in got:
            seen.setdefault(str(t.get("@id")), t)
    print(f"  searchWord unique: {len(seen)}")

    # searchWord では現行表が隠れる場合があるため、素の全件列挙も併用する（最終判定）。
    bare = _list_all_tables(client, app_id, STATS_CODE_MLS)
    added = 0
    for t in bare:
        tid = str(t.get("@id"))
        if tid not in seen:
            added += 1
        seen.setdefault(tid, t)
    print(f"  bare-list total: {len(bare)} tables (+{added} new)")
    print(f"  unique candidates: {len(seen)}")

    # まず getStatsList の SURVEY_DATE（データ対象期間）で末尾年を安価に評価する。
    # CYCLE では絞らない（現行表は CYCLE 表記が異なる場合がある）。
    by_survey = []
    for tid, t in seen.items():
        tid_s, name, cycle, survey = _describe(t)
        end = _end_year(survey)
        by_survey.append((end, tid_s, name, cycle, survey))
    by_survey.sort(key=lambda r: r[0], reverse=True)

    survey_current = [r for r in by_survey if r[0] >= 2016]
    print(f"\n  >>> SURVEY_DATE で末尾>=2016 の表: {len(survey_current)} 件（上位20を time軸で確認）")
    if not survey_current:
        print("  （SURVEY_DATE ベースでも 2016 以降の表は皆無 = この統計コードに現行月次はなし）")

    # SURVEY_DATE が全表 0 の場合に備え、「現行らしさ」スコアでも probe 対象を選ぶ。
    # （SURVEY_DATE 上位20）∪（currentness 上位30）を getMetaInfo で実スパン確認。
    scored = sorted(seen.values(), key=_currentness, reverse=True)
    print("\n  現行らしさスコア上位10（タイトル/周期ベース）:")
    for t in scored[:10]:
        tid_s, name, cycle, survey = _describe(t)
        print(f"    score={_currentness(t)} id={tid_s} cycle={cycle} survey={survey} | {name[:60]}")

    probe_ids: list[str] = []
    for _, tid, *_rest in (survey_current[:20] if survey_current else by_survey[:20]):
        if tid not in probe_ids:
            probe_ids.append(tid)
    for t in scored[:30]:
        tid = str(t.get("@id"))
        if tid not in probe_ids:
            probe_ids.append(tid)

    # 各 probe 表の time 軸の実スパンを確定する。
    ids: list[str] = []
    confirmed = []
    for tid in probe_ids:
        _, name, cycle, survey = _describe(seen[tid])
        axis, n, first, last = _time_span(client, app_id, tid)
        end_t = _end_year(first, last)
        confirmed.append((end_t, tid, name, cycle, survey, axis, n, first, last))

    confirmed.sort(key=lambda r: (r[0], r[6]), reverse=True)
    current = [r for r in confirmed if r[0] >= 2016]
    print(f"\n  >>> time軸で末尾>=2016 を確認できた表: {len(current)} 件")
    if not current:
        print("  （time軸ベースでも 2016 以降まで伸びる表は確認できず）")
    for end_t, tid, name, cycle, survey, axis, n, first, last in confirmed[:20]:
        flag = "★現行" if end_t >= 2016 else "  凍結"
        if end_t >= 2016:
            ids.append(tid)
        print(f"  {flag} statsDataId={tid} endYear={end_t} survey={survey} cycle={cycle}")
        print(f"        {name}")
        print(f"        time軸='{axis}' n={n} span[{first} .. {last}]")

    # 現行表が見つからなければ、軸コード確認用に上位を検査対象へ。
    return ids if ids else [r[1] for r in confirmed[:3]]


def main() -> int:
    app_id = os.environ.get("ESTAT_APP_ID", "").strip()
    if not app_id:
        print("ERROR: ESTAT_APP_ID is not set", file=sys.stderr)
        return 2
    try:
        with httpx.Client() as client:
            # 賃金表の候補と期間（総合CPIは code=0001 で確定済み）
            wage_ids = explore_wage(client, app_id)
            # 上位3候補の軸（産業/規模/就業形態/表章/時間）を確認
            for sid in wage_ids[:3]:
                inspect_table(client, app_id, sid, cat_hints=WAGE_HINTS)
    except httpx.HTTPError as e:
        print(f"HTTP error: {e}", file=sys.stderr)
        return 1
    print("\nDONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

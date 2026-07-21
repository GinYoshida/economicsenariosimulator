"""天候（公知情報）ドライバーの探索スクリプト（Actions 実行・一時）。

egress 制限のない環境で実行し、Open-Meteo アーカイブAPI（ERA5再解析・キー不要・
CC-BY）から主要都市の日別 最高気温・降水量 を取得して、月次の
「経済活動阻害日の割合」候補を算出・印字する。

  - 猛暑日割合   = 最高気温 >= 35℃ の日数 / 当月日数
  - 真夏日割合   = 最高気温 >= 30℃ の日数 / 当月日数
  - 豪雨日割合   = 日降水量 >= 50mm の日数 / 当月日数
  - 大雨日割合   = 日降水量 >= 30mm の日数 / 当月日数
  - 厳寒日割合   = 最高気温 <  5℃ の日数 / 当月日数

都市は人口で加重して全国代表系列にする。さらに、リポジトリに同梱の
public/data/series.json（家計調査YoY）を読み、天候候補が食料/衣料の
「前月差の方向」をどれだけ当てられるか（DA）をオフライン検証する。

出典表示のみ・秘密情報は扱わない。
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

import httpx

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"

# (都市名, 緯度, 経度, おおよその人口[万]) — 人口加重の重みに使う。
CITIES = [
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

START = "2015-01-01"
END = "2026-05-31"

# 閾値（℃・mm）と派生系列名。
THRESHOLDS = {
    "hot35": ("tmax_ge", 35.0),   # 猛暑日
    "hot30": ("tmax_ge", 30.0),   # 真夏日
    "rain50": ("prcp_ge", 50.0),  # 豪雨日
    "rain30": ("prcp_ge", 30.0),  # 大雨日
    "cold05": ("tmax_lt", 5.0),   # 厳寒日
}


def fetch_city_daily(client: httpx.Client, lat: float, lon: float):
    """(dates[list[str]], tmax[list], prcp[list]) を返す。"""
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": START,
        "end_date": END,
        "daily": "temperature_2m_max,precipitation_sum",
        "timezone": "Asia/Tokyo",
    }
    r = client.get(ARCHIVE, params=params, timeout=90)
    r.raise_for_status()
    d = r.json().get("daily", {})
    return d.get("time", []), d.get("temperature_2m_max", []), d.get("precipitation_sum", [])


def monthly_ratios(dates, tmax, prcp) -> dict[str, dict[str, float]]:
    """{month 'YYYY-MM': {series_name: ratio}} を返す。"""
    cnt: dict[str, int] = defaultdict(int)
    hit: dict[tuple[str, str], int] = defaultdict(int)
    for i, ds in enumerate(dates):
        ym = ds[:7]
        cnt[ym] += 1
        tx = tmax[i] if i < len(tmax) else None
        pr = prcp[i] if i < len(prcp) else None
        for name, (kind, thr) in THRESHOLDS.items():
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
        if n < 20:  # 端月の欠損対策
            continue
        out[ym] = {name: hit[(ym, name)] / n for name in THRESHOLDS}
    return out


def weighted_national(per_city: list[tuple[float, dict]]) -> dict[str, dict[str, float]]:
    """人口加重で全国系列を作る。per_city=[(weight, monthly_ratios), ...]。"""
    acc: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    wsum: dict[str, float] = defaultdict(float)
    for w, mr in per_city:
        for ym, ratios in mr.items():
            for name, v in ratios.items():
                acc[ym][name] += w * v
            wsum[ym] += w
    return {
        ym: {name: acc[ym][name] / wsum[ym] for name in THRESHOLDS}
        for ym in acc if wsum[ym] > 0
    }


def _load_targets() -> dict[str, dict[str, float]]:
    """public/data/series.json から家計調査YoY（食料/衣料）を {id: {YYYY-MM: value}}。"""
    p = Path("public/data/series.json")
    if not p.exists():
        print(f"  (targets) {p} が無いためオフライン検証はスキップ")
        return {}
    data = json.loads(p.read_text())
    out: dict[str, dict[str, float]] = {}
    for s in data.get("series", []):
        sid = s.get("series_id", "")
        if sid in ("household.food.real_yoy", "household.clothing.real_yoy"):
            out[sid] = {
                p2["date"][:7]: p2["value"]
                for p2 in s.get("points", [])
                if p2.get("value") is not None
            }
    return out


def _da(feat: dict[str, float], target: dict[str, float], lag: int,
        use_delta: bool) -> tuple[float, int]:
    """特徴量→目的の前月差方向の的中率(DA)を返す。"""
    months = sorted(set(feat) & set(target))
    # 目的の前月差方向。
    tsign: dict[str, int] = {}
    for i in range(1, len(months)):
        a, b = target[months[i - 1]], target[months[i]]
        tsign[months[i]] = 1 if (b - a) > 0 else (-1 if (b - a) < 0 else 0)
    n = hit = 0
    for i in range(1, len(months)):
        m = months[i]
        if m not in tsign or tsign[m] == 0:
            continue
        j = i - lag
        if j < 1:
            continue
        ml = months[j]
        if use_delta:
            fv = feat[months[j]] - feat[months[j - 1]]
        else:
            # 水準は「季節平均からの偏差」で方向を測る（生水準は夏だけ大→情報薄）。
            fv = feat[ml]
        fsign = 1 if fv > 0 else (-1 if fv < 0 else 0)
        if fsign == 0:
            continue
        n += 1
        hit += 1 if fsign == tsign[m] else 0
    return (hit / n if n else float("nan")), n


def main() -> int:
    print("天候ドライバー探索（Open-Meteo ERA5, 主要都市・人口加重）")
    print(f"  期間 {START} .. {END}, 都市数 {len(CITIES)}")
    per_city: list[tuple[float, dict]] = []
    with httpx.Client() as client:
        for name, lat, lon, pop in CITIES:
            try:
                dates, tmax, prcp = fetch_city_daily(client, lat, lon)
            except httpx.HTTPError as e:
                print(f"  [{name}] 取得エラー: {e}")
                continue
            mr = monthly_ratios(dates, tmax, prcp)
            per_city.append((float(pop), mr))
            print(f"  [{name}] 日数={len(dates)} 月数={len(mr)}")

    if not per_city:
        print("  取得ゼロ。終了。")
        return 1

    nat = weighted_national(per_city)
    months = sorted(nat)
    print(f"\n  全国系列 月数={len(months)} span[{months[0]} .. {months[-1]}]")
    print("  直近12か月の猛暑日/豪雨日割合（全国・人口加重）:")
    for ym in months[-12:]:
        r = nat[ym]
        print(f"    {ym} 猛暑35={r['hot35']:.2f} 真夏30={r['hot30']:.2f} "
              f"豪雨50={r['rain50']:.3f} 大雨30={r['rain30']:.3f} 厳寒05={r['cold05']:.2f}")

    # 年間の代表値（夏の酷暑・梅雨豪雨のシグナルが年で出るか）。
    print("\n  年別 猛暑日割合の平均（季節性の妥当性チェック）:")
    by_year: dict[str, list[float]] = defaultdict(list)
    for ym in months:
        by_year[ym[:4]].append(nat[ym]["hot35"])
    for y in sorted(by_year):
        vals = by_year[y]
        print(f"    {y}: 平均猛暑日割合={sum(vals)/len(vals):.3f} (12か月中 夏3-4か月に集中)")

    # オフライン検証: 天候候補 → 食料/衣料の前月差方向 DA。
    targets = _load_targets()
    if targets:
        print("\n  -- オフライン方向検証（天候→前月差方向 DA）--")
        feats = {name: {ym: nat[ym][name] for ym in months} for name in THRESHOLDS}
        for tid, tgt in targets.items():
            short = tid.split(".")[1]
            print(f"  [{short}] n_target={len(tgt)}")
            for name in ("hot35", "rain50", "rain30", "hot30"):
                for lag in (0, 1):
                    for use_delta in (False, True):
                        da, n = _da(feats[name], tgt, lag, use_delta)
                        kind = "Δ" if use_delta else "水準"
                        if not math.isnan(da) and n >= 30:
                            flag = " <<<" if (da >= 0.60 or da <= 0.40) else ""
                            print(f"      {name:6s} {kind} lag{lag}: DA={da:.2f} (n={n}){flag}")
    print("\nDONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

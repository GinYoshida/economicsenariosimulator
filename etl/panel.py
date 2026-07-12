"""月次パネル構築（YoY 変換・vintage 整列）。

DuckDB ストアの全系列を 1 枚の月次ワイド表（index=月初, 列=series_id）に束ねる。

- レベル系列は必要に応じ前年比に変換する（``yoy = s / s.shift(12) - 1``）。
- **vintage 整列**: 全系列を共通の連続月次インデックス（全体min〜max）に外部結合する。
  公表の遅い系列（家計調査は約5–6週ラグ）は実データが直近月まで無いため、
  パネル端で自然に NaN になる（その月時点で利用可能な最新値の表現）。
- 欠測は前方補完しない（NaN を保持し、ナウキャストで扱う）。
"""

from __future__ import annotations

import duckdb
import pandas as pd

from etl.store import list_series, read_series

# 既定で前年比へ変換する系列（消費・物価・商品コスト・為替の水準）。
# DI（di）・政策金利（pct）は水準のまま。実運用に応じて調整可能。
DEFAULT_YOY_SERIES: set[str] = {
    "household.food.real_yoy",
    "household.clothing.real_yoy",
    "cpi.food",
    "cpi.clothing",
    "fut.wheat",
    "fut.soybean",
    "fut.sugar",
    "fut.cotton",
    "fut.usdjpy",
}


# ノイズの大きい目的変数（家計調査の名目YoY）に平滑・ハズレ値処理を適用する。
# 衣料は月次変動が激しく、単月で±数十%の前年比になり得るため。
DENOISE_TARGETS: set[str] = {
    "household.food.real_yoy",
    "household.clothing.real_yoy",
}

# 家計調査は名目（金額）YoYなので、対応CPIでデフレートして実質YoYにする。
# real = (1 + nominal) / (1 + cpi) - 1
DEFLATE_BY: dict[str, str] = {
    "household.food.real_yoy": "cpi.food",
    "household.clothing.real_yoy": "cpi.clothing",
}


def to_yoy(s: pd.Series) -> pd.Series:
    """前年同月比（比率）。先頭 12 か月は NaN。"""
    return s / s.shift(12) - 1.0


def denoise(s: pd.Series, *, winsor_q: float = 0.01, window: int = 3) -> pd.Series:
    """上下 ``winsor_q`` をクリップ（ウィンズライズ）し ``window`` か月移動平均で平滑。"""
    lo = s.quantile(winsor_q)
    hi = s.quantile(1.0 - winsor_q)
    clipped = s.clip(lower=lo, upper=hi)
    return clipped.rolling(window, min_periods=1).mean()


def build_panel(
    con: duckdb.DuckDBPyConnection,
    *,
    yoy_series: set[str] | None = None,
    denoise_targets: set[str] | None = None,
) -> pd.DataFrame:
    """全系列を月次ワイド表に束ね、指定系列を YoY 変換して返す。

    ``denoise_targets`` の系列は YoY 後にウィンズライズ＋移動平均でノイズを抑える。
    """
    if yoy_series is None:
        yoy_series = DEFAULT_YOY_SERIES
    if denoise_targets is None:
        denoise_targets = DENOISE_TARGETS

    series_ids = list_series(con)
    columns: dict[str, pd.Series] = {}
    min_date: pd.Timestamp | None = None
    max_date: pd.Timestamp | None = None

    for sid in series_ids:
        df, _ = read_series(con, sid)
        s = pd.Series(df["value"].to_numpy(), index=pd.to_datetime(df["date"]))
        s = s.sort_index()
        columns[sid] = s
        if len(s):
            lo, hi = s.index.min(), s.index.max()
            min_date = lo if min_date is None else min(min_date, lo)
            max_date = hi if max_date is None else max(max_date, hi)

    if min_date is None:
        return pd.DataFrame()

    index = pd.date_range(min_date, max_date, freq="MS")
    panel = pd.DataFrame(index=index)
    panel.index.name = "date"
    for sid, s in columns.items():
        col = s.reindex(index)  # 外部結合: 端の未公表月は NaN（前方補完なし）
        if sid in yoy_series:
            col = to_yoy(col)
        panel[sid] = col

    # 名目 → 実質（対応CPIでデフレート）。CPI列がある場合のみ。
    for target, cpi in DEFLATE_BY.items():
        if target in panel.columns and cpi in panel.columns:
            panel[target] = (1.0 + panel[target]) / (1.0 + panel[cpi]) - 1.0

    # 目的変数のノイズ低減（デフレート後に適用）。
    for target in denoise_targets:
        if target in panel.columns:
            panel[target] = denoise(panel[target])

    return panel

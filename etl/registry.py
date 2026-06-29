"""データソース登録レジストリ（出典メタの単一の真実）。

各系列の出典名・出典URL・コネクタ種別・取得パラメータをここに集約する。
連携モジュール（コネクタ）はここの ``fetch`` を読んで取得方法を決める。

NOTE: e-Stat 系列の ``fetch["stats_data_id"]`` は現時点では None。
これは意図的な設定であり、タスク M1-3 で getStatsList 探索により統計表ID
（statsDataId）を確定して埋める（プレースホルダのバグではない）。
BOJ の ``series_code`` は M1-4、内閣府の ``dataset`` は M1-5 で最終確認する。
"""

from pydantic import BaseModel

KNOWN_CONNECTORS: set[str] = {"estat", "boj", "cao", "futures"}


class SourceSpec(BaseModel):
    series_id: str
    name: str           # 出典名
    url: str            # 出典URL（一次情報の引用URL）
    connector: str      # KNOWN_CONNECTORS のいずれか
    license: str
    unit: str
    frequency: str      # "monthly"
    fetch: dict         # コネクタ固有の取得パラメータ


_ESTAT_URL_KAKEI = "https://www.stat.go.jp/data/kakei/sokuhou/tsuki/index.html"
_ESTAT_URL_CPI = "https://www.stat.go.jp/data/cpi/"
_BOJ_URL = "https://www.stat-search.boj.or.jp/"
_CAO_CCI_URL = "https://www.esri.cao.go.jp/jp/stat/shouhi/shouhi.html"
_CAO_WATCHER_URL = "https://www5.cao.go.jp/keizai3/watcher/watcher_menu.html"
_FUT_URL = "https://finance.yahoo.com/"

_ESTAT_LICENSE = "政府統計（出典明示で利用可）"
_BOJ_LICENSE = "日本銀行（出典明示で利用可）"
_CAO_LICENSE = "内閣府（出典明示で利用可）"
_FUT_LICENSE = "Yahoo Finance terms of use"


def _spec(**kwargs) -> SourceSpec:
    return SourceSpec(**kwargs)


_SPECS: list[SourceSpec] = [
    # --- e-Stat: 家計調査（実質前年比） ---
    _spec(
        series_id="household.food.real_yoy",
        name="総務省 家計調査",
        url=_ESTAT_URL_KAKEI,
        connector="estat",
        license=_ESTAT_LICENSE,
        unit="yoy_pct",
        frequency="monthly",
        fetch={
            "search_word": "家計調査 二人以上の世帯 月次",
            # 家計調査 家計収支編 二人以上の世帯 用途分類（総数）月次（名目・金額）。
            "stats_data_id": "0002070001",
            "extra_params": {
                "cdCat01": "060",     # 食料
                "cdCat02": "03",      # 二人以上の世帯（2000年～）
                "cdArea": "00000",    # 全国
                "cdTab": "01",        # 金額
            },
        },
    ),
    _spec(
        series_id="household.clothing.real_yoy",
        name="総務省 家計調査",
        url=_ESTAT_URL_KAKEI,
        connector="estat",
        license=_ESTAT_LICENSE,
        unit="yoy_pct",
        frequency="monthly",
        fetch={
            "search_word": "家計調査 二人以上の世帯 月次",
            "stats_data_id": "0002070001",
            "extra_params": {
                "cdCat01": "122",     # 被服及び履物
                "cdCat02": "03",      # 二人以上の世帯（2000年～）
                "cdArea": "00000",    # 全国
                "cdTab": "01",        # 金額
            },
        },
    ),
    # --- e-Stat: 消費者物価指数 ---
    _spec(
        series_id="cpi.food",
        name="総務省 消費者物価指数",
        url=_ESTAT_URL_CPI,
        connector="estat",
        license=_ESTAT_LICENSE,
        unit="index",
        frequency="monthly",
        fetch={
            "search_word": "消費者物価指数 食料",
            # 2020年基準消費者物価指数（全国・指数）。
            "stats_data_id": "0003427113",
            "extra_params": {
                "cdCat01": "0002",    # 食料
                "cdArea": "00000",    # 全国
                "cdTab": "1",         # 指数
            },
        },
    ),
    _spec(
        series_id="cpi.clothing",
        name="総務省 消費者物価指数",
        url=_ESTAT_URL_CPI,
        connector="estat",
        license=_ESTAT_LICENSE,
        unit="index",
        frequency="monthly",
        fetch={
            "search_word": "消費者物価指数 被服及び履物",
            "stats_data_id": "0003427113",
            "extra_params": {
                "cdCat01": "0082",    # 被服及び履物
                "cdArea": "00000",    # 全国
                "cdTab": "1",         # 指数
            },
        },
    ),
    # --- BOJ: 金利・為替 ---
    _spec(
        series_id="boj.policy_rate",
        name="日本銀行",
        url=_BOJ_URL,
        connector="boj",
        license=_BOJ_LICENSE,
        unit="pct",
        frequency="monthly",
        # series_code は M1-4 で確定
        fetch={"series_code": "BOJ_POLICY_RATE"},
    ),
    _spec(
        series_id="boj.usdjpy",
        name="日本銀行",
        url=_BOJ_URL,
        connector="boj",
        license=_BOJ_LICENSE,
        unit="jpy_per_usd",
        frequency="monthly",
        # series_code は M1-4 で確定
        fetch={"series_code": "BOJ_USDJPY_SPOT"},
    ),
    # --- 内閣府: 消費動向調査（消費者態度指数＋構成DI） ---
    _spec(
        series_id="cao.cci.attitude",
        name="内閣府 消費動向調査",
        url=_CAO_CCI_URL,
        connector="cao",
        license=_CAO_LICENSE,
        unit="di",
        frequency="monthly",
        fetch={"dataset": "cci_consumer_attitude"},  # M1-5 で確定
    ),
    _spec(
        series_id="cao.cci.livelihood",
        name="内閣府 消費動向調査",
        url=_CAO_CCI_URL,
        connector="cao",
        license=_CAO_LICENSE,
        unit="di",
        frequency="monthly",
        fetch={"dataset": "cci_livelihood"},  # M1-5 で確定
    ),
    _spec(
        series_id="cao.cci.income",
        name="内閣府 消費動向調査",
        url=_CAO_CCI_URL,
        connector="cao",
        license=_CAO_LICENSE,
        unit="di",
        frequency="monthly",
        fetch={"dataset": "cci_income_growth"},  # M1-5 で確定
    ),
    _spec(
        series_id="cao.cci.employment",
        name="内閣府 消費動向調査",
        url=_CAO_CCI_URL,
        connector="cao",
        license=_CAO_LICENSE,
        unit="di",
        frequency="monthly",
        fetch={"dataset": "cci_employment"},  # M1-5 で確定
    ),
    _spec(
        series_id="cao.cci.durables",
        name="内閣府 消費動向調査",
        url=_CAO_CCI_URL,
        connector="cao",
        license=_CAO_LICENSE,
        unit="di",
        frequency="monthly",
        fetch={"dataset": "cci_durable_goods"},  # M1-5 で確定
    ),
    # --- 内閣府: 景気ウォッチャー調査 ---
    _spec(
        series_id="cao.watcher.current",
        name="内閣府 景気ウォッチャー調査",
        url=_CAO_WATCHER_URL,
        connector="cao",
        license=_CAO_LICENSE,
        unit="di",
        frequency="monthly",
        fetch={"dataset": "watcher_current_di"},  # M1-5 で確定
    ),
    _spec(
        series_id="cao.watcher.outlook",
        name="内閣府 景気ウォッチャー調査",
        url=_CAO_WATCHER_URL,
        connector="cao",
        license=_CAO_LICENSE,
        unit="di",
        frequency="monthly",
        fetch={"dataset": "watcher_outlook_di"},  # M1-5 で確定
    ),
    # --- 先物 / FX (Yahoo Finance) ---
    _spec(
        series_id="fut.wheat",
        name="Yahoo Finance (futures/FX)",
        url=_FUT_URL,
        connector="futures",
        license=_FUT_LICENSE,
        unit="usd",
        frequency="monthly",
        fetch={"ticker": "ZW=F"},
    ),
    _spec(
        series_id="fut.soybean",
        name="Yahoo Finance (futures/FX)",
        url=_FUT_URL,
        connector="futures",
        license=_FUT_LICENSE,
        unit="usd",
        frequency="monthly",
        fetch={"ticker": "ZS=F"},
    ),
    _spec(
        series_id="fut.sugar",
        name="Yahoo Finance (futures/FX)",
        url=_FUT_URL,
        connector="futures",
        license=_FUT_LICENSE,
        unit="usd",
        frequency="monthly",
        fetch={"ticker": "SB=F"},
    ),
    _spec(
        series_id="fut.cotton",
        name="Yahoo Finance (futures/FX)",
        url=_FUT_URL,
        connector="futures",
        license=_FUT_LICENSE,
        unit="usd",
        frequency="monthly",
        fetch={"ticker": "CT=F"},
    ),
    _spec(
        series_id="fut.usdjpy",
        name="Yahoo Finance (futures/FX)",
        url=_FUT_URL,
        connector="futures",
        license=_FUT_LICENSE,
        unit="jpy_per_usd",
        frequency="monthly",
        fetch={"ticker": "JPY=X"},
    ),
]

REGISTRY: dict[str, SourceSpec] = {spec.series_id: spec for spec in _SPECS}

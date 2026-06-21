# 日本消費シナリオシミュレータ 実装計画

- 作成日: 2026-06-21
- 手法: Superpowers writing-plans スキルに基づく実装計画
- 対象設計書: `docs/superpowers/specs/2026-06-20-japan-consumption-scenario-simulator-design.md`
- ステータス: ドラフト（ユーザーレビュー / 実行モード選択待ち）

---

**Goal:** 日本の食品・衣料の消費（前年比%）を、出典明示データと解釈可能な回帰モデルで予測し、
プリセット＋手動上書きのシナリオを携帯から操作できる Next.js ダッシュボードを構築する。

**Architecture:** Python バッチ（GitHub Actions 定期実行）が公的API/先物からデータを取得し、
DuckDB で月次パネルを構築、カテゴリ別 OLS を学習して「係数・ベースライン・要因分解・バックテスト結果」を
`public/data/*.json` に出典メタ込みで出力する。Next.js (App Router) on Vercel がその JSON を読み、
シナリオ計算（線形）はクライアント TypeScript で即時実行する。

**Tech Stack:** Python 3.12（uv / pytest / pandas / duckdb / statsmodels / httpx / pydantic / yfinance / openpyxl）、
Next.js 14+ App Router（TypeScript / Tailwind / Recharts / Vitest）、GitHub Actions、Vercel。

---

## 前提・規約（全タスク共通）

- パッケージ管理: Python は `uv`、フロントは `npm`。
- テスト: Python=`pytest`、フロント=`vitest`。ネットワーク依存は**保存済みフィクスチャ**でテスト（実APIは叩かない）。
- 各タスクは「失敗するテスト→確認→最小実装→確認→コミット」を1サイクルとする。
- コミットは小さく頻繁に。秘密情報（APIキー）はコミットしない（`.env` は gitignore、CI は GitHub Secrets）。
- 出典メタ（source name / url / retrieved_at / license）は全系列に必須。欠けると ETL を失敗させる。

## リポジトリ構成（最終形）

```
pyproject.toml            … uv プロジェクト定義
etl/
  __init__.py
  registry.py             … データソース登録（出典メタの単一の真実）
  provenance.py           … 出典メタの型と検証
  store.py                … DuckDB 読み書き
  connectors/
    estat.py              … e-Stat API（家計調査・CPI）
    boj.py                … 日銀 時系列CSV（金利・為替）
    cao.py                … 内閣府 消費動向調査・景気ウォッチャーDI
    futures.py            … 先物（小麦/大豆/砂糖/綿/USDJPY）yfinance
  panel.py                … 月次パネル構築・YoY変換・vintage整列
models/
  __init__.py
  schema.py               … 出力JSONの pydantic スキーマ
  features.py             … 説明変数セット・ラグ生成
  ols.py                  … OLS 学習・予測・要因分解
  nowcast.py              … 目的変数の未公表月補完
  backtest.py             … 拡張窓OOS・指標・ナイーブ比較・合格ゲート
  build_artifacts.py      … 学習→バックテスト→JSON出力 のエントリポイント
data/
  warehouse.duckdb        … 中間生成物（gitignore、CIで再生成）
  fixtures/               … テスト用の保存済みAPIレスポンス
public/data/              … フロントが読む成果物JSON（コミット対象）
  coefficients.json
  baseline.json
  backtest.json
  sources.json
app/                      … Next.js (App Router)
  lib/scenario.ts         … クライアントのシナリオエンジン（純粋関数）
  lib/scenario.test.ts
  lib/artifacts.ts        … JSON ロード＋型
  components/             … チャート・スライダー・出典パネル
  page.tsx
.github/workflows/
  batch.yml               … 定期バッチ（ETL→学習→出力→コミット）
  ci.yml                  … テスト（py + front）
vercel.json
.env.example
```

---

# マイルストーン M0: リポジトリ雛形とツールチェーン

## タスク M0-1: Python プロジェクト初期化と CI スケルトン

**作成/変更:** `pyproject.toml`, `etl/__init__.py`, `models/__init__.py`, `tests/test_smoke.py`, `.github/workflows/ci.yml`, `.gitignore`, `.env.example`

**手順:**
- [ ] `pyproject.toml` を作成（依存: pandas, duckdb, statsmodels, httpx, pydantic, yfinance, openpyxl, pytest）

```toml
[project]
name = "consumption-simulator"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "pandas>=2.2", "duckdb>=1.0", "statsmodels>=0.14", "httpx>=0.27",
  "pydantic>=2.7", "yfinance>=0.2.40", "openpyxl>=3.1",
]
[dependency-groups]
dev = ["pytest>=8.0"]
[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] 失敗するスモークテスト `tests/test_smoke.py` を書く:

```python
def test_packages_import():
    import etl, models  # noqa: F401
    import pandas, duckdb, statsmodels.api, pydantic  # noqa: F401
```

- [ ] `uv sync` → `uv run pytest tests/test_smoke.py` で失敗を確認（モジュール未作成）
- [ ] `etl/__init__.py`, `models/__init__.py` を空作成 → テスト通過を確認
- [ ] `.gitignore` に `data/warehouse.duckdb`, `.env`, `__pycache__/`, `node_modules/`, `.next/` を追加
- [ ] `.env.example` に `ESTAT_APP_ID=`（取得手順をコメント）を記載
- [ ] `.github/workflows/ci.yml`（push/PRで `uv run pytest` と後述のフロントテスト）
- [ ] コミット: "chore: init python project and CI skeleton"

## タスク M0-2: Next.js 雛形（sme-consult 規約に合わせる）

**作成/変更:** `app/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `app/page.tsx`, `app/lib/__smoke__.test.ts`, `vercel.json`

> 注: 実行前に `sme-consult` の `package.json` / ディレクトリ規約 / `vercel.json` を確認し、Next.jsバージョン・Tailwind設定・lint設定を一致させる（設計§9-4の実体確認）。

**手順:**
- [ ] `npx create-next-app@latest`（TypeScript / App Router / Tailwind / `app/` 採用）で雛形生成
- [ ] `vitest` + `@testing-library` を devDependencies に追加、`vitest.config.ts` を作成
- [ ] 失敗するスモークテスト `app/lib/__smoke__.test.ts`:

```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => { it("runs", () => { expect(1 + 1).toBe(2); }); });
```

- [ ] `npm test` で vitest が動くことを確認（最初は設定不足で失敗 → 設定追加で通過）
- [ ] `app/page.tsx` を最小のプレースホルダUIに（"Loading scenarios…"）
- [ ] `vercel.json`（フレームワーク=nextjs、`public/data` を静的配信）
- [ ] `ci.yml` にフロントジョブ（`npm ci && npm test && npm run build`）を追記
- [ ] コミット: "chore: scaffold Next.js app with vitest"

---

# マイルストーン M1: データ層（出典メタ＋コネクタ）

## タスク M1-1: 出典メタの型と検証

**作成/変更:** `etl/provenance.py`, `tests/test_provenance.py`

**インターフェース（産出物）:**

```python
# etl/provenance.py
from datetime import datetime
from pydantic import BaseModel, HttpUrl

class Source(BaseModel):
    series_id: str          # 内部ID 例 "household.food.real_yoy"
    name: str               # 出典名 例 "総務省 家計調査"
    url: HttpUrl            # 出典URL
    retrieved_at: datetime  # 取得日時(UTC)
    license: str            # 利用条件/ライセンス
    unit: str               # 単位 例 "yoy_pct"
    frequency: str          # "monthly"
```

**手順:**
- [ ] `tests/test_provenance.py`: 必須欄欠落で `ValidationError`、URL不正で失敗、正常値でOK のテストを書く
- [ ] 実行して失敗を確認 → `provenance.py` 実装 → 通過確認
- [ ] コミット: "feat(etl): provenance Source model with validation"

## タスク M1-2: データソース登録レジストリ

**作成/変更:** `etl/registry.py`, `tests/test_registry.py`

**インターフェース:** `REGISTRY: dict[str, SourceSpec]`。各 `SourceSpec` は connector 種別・取得パラメータ・出典メタ雛形を保持。
登録系列（初期セット）:

| series_id | 出典 | コネクタ |
|---|---|---|
| `household.food.real_yoy` | 総務省 家計調査 | estat |
| `household.clothing.real_yoy` | 総務省 家計調査 | estat |
| `cpi.food` / `cpi.clothing` | 総務省 CPI | estat |
| `boj.policy_rate` / `boj.usdjpy` | 日本銀行 | boj |
| `cao.cci.attitude` ほか構成DI | 内閣府 消費動向調査 | cao |
| `cao.watcher.current` / `cao.watcher.outlook` | 内閣府 景気ウォッチャー調査 | cao |
| `fut.wheat` `fut.soybean` `fut.sugar` `fut.cotton` `fut.usdjpy` | 先物 | futures |

出典URL（registry に直書きする一次情報）:
- 家計調査: https://www.stat.go.jp/data/kakei/sokuhou/tsuki/index.html
- e-Stat API: https://www.e-stat.go.jp/api/
- CPI: https://www.stat.go.jp/data/cpi/
- 日銀 時系列: https://www.stat-search.boj.or.jp/
- 消費動向調査: https://www.esri.cao.go.jp/jp/stat/shouhi/shouhi.html
- 景気ウォッチャー調査: https://www5.cao.go.jp/keizai3/watcher/watcher_menu.html

**手順:**
- [ ] `tests/test_registry.py`: 全 series_id が一意・connector種別が既知集合・出典URLが非空、をテスト
- [ ] 失敗確認 → `registry.py` 実装 → 通過確認
- [ ] コミット: "feat(etl): source registry with citations"

## タスク M1-3: e-Stat コネクタ（家計調査・CPI）

**作成/変更:** `etl/connectors/estat.py`, `tests/connectors/test_estat.py`, `data/fixtures/estat_*.json`

**インターフェース:** `fetch_estat(stats_data_id, app_id, params) -> (pd.DataFrame, Source)`。
DataFrame は `date`(月初), `value` の縦持ち。`app_id` は `os.environ["ESTAT_APP_ID"]`。
e-Stat JSON API: `GET https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData`。

> 実装時に統計表ID（statsDataId）と項目コードを確定する：`getStatsList` で「家計調査 二人以上の世帯 月次」「消費者物価指数 中分類(食料/被服)」を検索し、表ID・category code をレジストリに記録する。これは具体的な探索コマンドを伴うタスクであり TBD ではない。

**手順:**
- [ ] 実APIを1回だけ叩いて `data/fixtures/estat_household_food.json` を保存（手動・テスト固定用）
- [ ] `tests/connectors/test_estat.py`: フィクスチャJSONをパースし `date/value` 列・行数・型・返却 `Source` を検証（httpx をモックしフィクスチャを返す）
- [ ] 失敗確認 → `estat.py` 実装（パース＋ `Source` 生成、欠測の扱い）→ 通過確認
- [ ] コミット: "feat(etl): e-Stat connector for household & CPI"

## タスク M1-4: 日銀コネクタ（金利・為替）

**作成/変更:** `etl/connectors/boj.py`, `tests/connectors/test_boj.py`, `data/fixtures/boj_*.csv`

**インターフェース:** `fetch_boj(series_code) -> (pd.DataFrame, Source)`。日銀時系列の CSV を取得しパース。

**手順:**
- [ ] 対象系列の CSV を1回取得し `data/fixtures/boj_policy_rate.csv` 等を保存
- [ ] `tests/connectors/test_boj.py`: CSVパース（ヘッダ行スキップ・日付整形・数値化）と `Source` を検証
- [ ] 失敗確認 → `boj.py` 実装 → 通過確認
- [ ] コミット: "feat(etl): BOJ time-series connector"

## タスク M1-5: 内閣府DIコネクタ（消費動向調査・景気ウォッチャー）

**作成/変更:** `etl/connectors/cao.py`, `tests/connectors/test_cao.py`, `data/fixtures/cao_*.xlsx`

**インターフェース:** `fetch_cao_cci() -> list[(DataFrame, Source)]`（消費者態度指数＋構成DI）、
`fetch_cao_watcher() -> list[(DataFrame, Source)]`（現状・先行きDI。可能なら自由記述コメントも別系列として保持し、将来のNL解釈レイヤ§7.1の入力にする）。
内閣府の Excel を `openpyxl` でパース。

**手順:**
- [ ] 公表 Excel を1回取得しフィクスチャ保存（消費動向調査・景気ウォッチャー各1）
- [ ] `tests/connectors/test_cao.py`: 各DI系列の抽出（季節調整値 or 原数値の選択を明示）・日付整列・`Source` を検証
- [ ] 失敗確認 → `cao.py` 実装 → 通過確認
- [ ] コミット: "feat(etl): Cabinet Office DI connectors (CCI & Watchers)"

## タスク M1-6: 先物コネクタ

**作成/変更:** `etl/connectors/futures.py`, `tests/connectors/test_futures.py`, `data/fixtures/futures_*.csv`

**インターフェース:** `fetch_futures(ticker) -> (pd.DataFrame, Source)`。yfinance で月次終値に集約。
ティッカー: 小麦 `ZW=F`、大豆 `ZS=F`、砂糖 `SB=F`、綿 `CT=F`、USDJPY `JPY=X`。
出典は yfinance のデータ提供元を明記（利用条件に留意）。

**手順:**
- [ ] yfinance 取得結果を1回 CSV 保存しフィクスチャ化
- [ ] `tests/connectors/test_futures.py`: 月次集約・YoY/レベルの整形・`Source` を検証（yfinance をモック）
- [ ] 失敗確認 → `futures.py` 実装 → 通過確認
- [ ] コミット: "feat(etl): futures connector via yfinance"

## タスク M1-7: DuckDB ストア

**作成/変更:** `etl/store.py`, `tests/test_store.py`

**インターフェース:** `write_series(con, series_id, df, source)` / `read_series(con, series_id) -> (df, source)`。
`series_long(series_id, date, value)` と `sources(series_id, name, url, retrieved_at, license, unit, frequency)` の2テーブル。

**手順:**
- [ ] `tests/test_store.py`: インメモリDuckDBに書込→読戻しで値と出典メタが一致、を検証
- [ ] 失敗確認 → `store.py` 実装 → 通過確認
- [ ] コミット: "feat(etl): DuckDB store with provenance table"

---

# マイルストーン M2: パネル構築

## タスク M2-1: 月次パネルと YoY 変換・vintage 整列

**作成/変更:** `etl/panel.py`, `tests/test_panel.py`

**インターフェース:** `build_panel(con) -> pd.DataFrame`（index=月初、列=全series_id）。
- レベル系列→必要に応じ YoY%（`yoy = s/s.shift(12) - 1`）。
- **公表ラグの明示整列**: 各系列の「その月時点で利用可能だった最新値」を表現する `as_of` ロジック（家計調査は約5–6週ラグ→直近2カ月の目的変数は欠測になる）。
- 欠測は前方補完せず NaN を保持（ナウキャストで扱う）。

**手順:**
- [ ] `tests/test_panel.py`: 合成系列で YoY 計算の正しさ、ラグ整列で目的変数の直近2カ月が NaN、列の整合を検証
- [ ] 失敗確認 → `panel.py` 実装 → 通過確認
- [ ] コミット: "feat(etl): monthly panel with YoY and vintage alignment"

---

# マイルストーン M3: モデルと成果物JSON

## タスク M3-1: 成果物JSONスキーマ

**作成/変更:** `models/schema.py`, `tests/test_schema.py`

**インターフェース（フロント契約・最重要）:**

```python
# models/schema.py
from pydantic import BaseModel

class DriverCoef(BaseModel):
    driver: str            # 例 "cao.cci.attitude"
    label_ja: str          # 例 "消費者態度指数"
    coef: float            # 弾力性/係数
    lag_months: int

class CategoryModel(BaseModel):
    category: str          # "food" | "clothing"
    intercept: float
    drivers: list[DriverCoef]
    r2: float
    model_version: str
    data_vintage: str      # ISO日付

class Coefficients(BaseModel):
    generated_at: str
    categories: list[CategoryModel]

class BaselinePoint(BaseModel):
    date: str
    food_yoy: float
    clothing_yoy: float
    food_low: float; food_high: float
    clothing_low: float; clothing_high: float

class Baseline(BaseModel):
    history: list[BaselinePoint]
    forecast: list[BaselinePoint]   # 3カ月（モデル主導）＋3年（解釈レベル）
    horizon_note: str

class BacktestMetric(BaseModel):
    category: str
    mae: float; rmse: float; direction_hit: float
    naive_mae: float; naive_rmse: float; naive_direction_hit: float
    beats_naive: bool

class Backtest(BaseModel):
    metrics: list[BacktestMetric]
    window: str
```

**手順:**
- [ ] `tests/test_schema.py`: 各モデルの round-trip（dict→model→json）と必須欄検証
- [ ] 失敗確認 → `schema.py` 実装 → 通過確認
- [ ] コミット: "feat(models): artifact JSON schemas (frontend contract)"

## タスク M3-2: 特徴量とラグ生成

**作成/変更:** `models/features.py`, `tests/test_features.py`

**インターフェース:** `make_features(panel, category, lags) -> (X, y)`。説明変数: 実質賃金/所得・CPI・金利・
消費者マインドDI（消費動向調査＋景気ウォッチャー）・先物先行コスト・季節ダミー。公表が早い系列を優先しラグ付与。

**手順:**
- [ ] `tests/test_features.py`: 指定ラグでの列生成、季節ダミー12本、NaN行の落とし方を検証
- [ ] 失敗確認 → `features.py` 実装 → 通過確認
- [ ] コミット: "feat(models): feature & lag construction"

## タスク M3-3: OLS 学習・予測・要因分解

**作成/変更:** `models/ols.py`, `tests/test_ols.py`

**インターフェース:** `fit_ols(X, y) -> FitResult`、`predict(fit, X) -> np.ndarray`、
`decompose(fit, x_row) -> dict[str, float]`（各ドライバー寄与 = coef×value、合計＝予測）。

**手順:**
- [ ] `tests/test_ols.py`: 既知係数で生成した合成データを回帰して係数を復元（許容誤差）、要因分解の合計＝予測＋切片、を検証
- [ ] 失敗確認 → `ols.py` 実装（statsmodels OLS ラップ）→ 通過確認
- [ ] コミット: "feat(models): OLS fit/predict/decompose"

## タスク M3-4: ナウキャスト（目的変数の未公表月補完）

**作成/変更:** `models/nowcast.py`, `tests/test_nowcast.py`

**インターフェース:** `nowcast_target(panel, category, fit) -> pd.Series`。家計調査の未公表直近2カ月を、
公表の早い説明変数（先物・日銀・DI）から補完してから3カ月先予測の起点にする。

**手順:**
- [ ] `tests/test_nowcast.py`: 末尾2カ月を人為的にNaNにした合成パネルで、補完値が真値に近い（合成係数前提）ことを検証
- [ ] 失敗確認 → `nowcast.py` 実装 → 通過確認
- [ ] コミット: "feat(models): nowcast for unpublished target months"

## タスク M3-5: 成果物ビルダー（JSON出力）

**作成/変更:** `models/build_artifacts.py`, `tests/test_build_artifacts.py`

**インターフェース:** CLI `uv run python -m models.build_artifacts`。
DuckDB→パネル→学習→ナウキャスト→ベースライン生成→`public/data/{coefficients,baseline,sources}.json` 書出し。
出力は M3-1 スキーマで検証してから書く。

**手順:**
- [ ] `tests/test_build_artifacts.py`: 小さな合成 DuckDB を入力に、出力JSONがスキーマに適合し `food/clothing` 両方を含むことを検証
- [ ] 失敗確認 → `build_artifacts.py` 実装 → 通過確認
- [ ] コミット: "feat(models): artifact builder writing public/data JSON"

---

# マイルストーン M4: バックテスト

## タスク M4-1: 指標とナイーブ比較

**作成/変更:** `models/backtest.py`（指標部）, `tests/test_backtest_metrics.py`

**インターフェース:** `mae`, `rmse`, `direction_hit`（符号一致率）, `naive_persistence(y) -> yhat`（前年比persistence）。

**手順:**
- [ ] `tests/test_backtest_metrics.py`: 既知配列で各指標の値を検証、naive が直前値を返すことを検証
- [ ] 失敗確認 → 実装 → 通過確認
- [ ] コミット: "feat(models): backtest metrics & naive baseline"

## タスク M4-2: 拡張窓OOSと合格ゲート

**作成/変更:** `models/backtest.py`（ループ部）, `tests/test_backtest_loop.py`

**インターフェース:** `run_backtest(panel, category, start, horizon=3) -> BacktestMetric`。
拡張窓で各時点学習→3カ月先予測→指標集計。`beats_naive = mae < naive_mae`。結果を `public/data/backtest.json` に出力。
**合格ゲート定義**: 各カテゴリで `beats_naive == True`（設計の「ナイーブを上回る」を数値化）。

**手順:**
- [ ] `tests/test_backtest_loop.py`: 予測可能な合成系列でモデルが naive を上回る、純ノイズでは上回らない、を検証
- [ ] 失敗確認 → 実装 → 通過確認
- [ ] `build_artifacts.py` にバックテスト出力を統合
- [ ] コミット: "feat(models): expanding-window backtest with naive gate"

---

# マイルストーン M5: フロントエンド（Next.js / モバイル）

## タスク M5-1: クライアント・シナリオエンジン（純粋関数）

**作成/変更:** `app/lib/scenario.ts`, `app/lib/scenario.test.ts`

**インターフェース:**

```ts
export type DriverPath = Record<string, number[]>;   // driver -> 月次パス
export type CategoryCoef = { intercept: number; drivers: { driver: string; coef: number; lagMonths: number }[] };
export function computeForecast(model: CategoryCoef, drivers: DriverPath, months: number): number[];
export function decompose(model: CategoryCoef, driversAt: Record<string, number>): Record<string, number>;
```

線形: `yhat_t = intercept + Σ coef_i * driver_i[t - lag]`。サーバー不要・即時。

**手順:**
- [ ] `app/lib/scenario.test.ts`: 既知係数・既知ドライバーパスで `computeForecast` の手計算一致、`decompose` の寄与合計＝予測、を検証
- [ ] `npm test` で失敗確認 → `scenario.ts` 実装 → 通過確認
- [ ] コミット: "feat(web): client-side linear scenario engine"

## タスク M5-2: 成果物ローダと型

**作成/変更:** `app/lib/artifacts.ts`, `app/lib/artifacts.test.ts`, `public/data/*.json`（M3 出力のコミット版 or サンプル）

**インターフェース:** `loadCoefficients()`, `loadBaseline()`, `loadBacktest()`, `loadSources()`（`public/data` から fetch、TS型は M3-1 と一致）。

**手順:**
- [ ] サンプル `public/data/*.json` を用意（後で実バッチが上書き）
- [ ] `artifacts.test.ts`: サンプルJSONが型に適合しパースできることを検証
- [ ] 失敗確認 → 実装 → 通過確認
- [ ] コミット: "feat(web): artifact loaders and types"

## タスク M5-3: プリセット定義と適用

**作成/変更:** `app/lib/presets.ts`, `app/lib/presets.test.ts`

**インターフェース:** `PRESETS: { optimistic, base, pessimistic }`。各プリセットがドライバーパスを返す（base は先物の期待値を起点）。
`applyOverrides(preset, overrides) -> DriverPath`。

**手順:**
- [ ] `presets.test.ts`: base が先物起点パスを返す、override がそのドライバーのみ上書きする、を検証
- [ ] 失敗確認 → 実装 → 通過確認
- [ ] コミット: "feat(web): scenario presets and manual overrides"

## タスク M5-4: ダッシュボードUI（チャート・スライダー・出典パネル）

**作成/変更:** `app/page.tsx`, `app/components/ForecastChart.tsx`, `app/components/DecompositionChart.tsx`, `app/components/DriverSliders.tsx`, `app/components/BacktestPanel.tsx`, `app/components/SourcePanel.tsx`, 各 `*.test.tsx`

**インターフェース:** プリセット選択＋スライダー → `scenario.ts` で再計算 → Recharts 描画。
モバイル: 単一カラム・タッチ操作。`SourcePanel` は `sources.json` の name/url/retrieved_at を一覧表示（常時）。

**手順:**
- [ ] 各コンポーネントの testing-library テスト（描画・スライダー操作で予測更新・出典の表示）を書く
- [ ] 失敗確認 → 実装（Tailwind でレスポンシブ）→ 通過確認
- [ ] `npm run build` 成功を確認
- [ ] コミット: "feat(web): mobile dashboard with charts, sliders, source panel"

---

# マイルストーン M6: 自然言語解釈レイヤ（枠のみ・フラグ無効）

## タスク M6-1: NL解釈の枠組み（feature flag・デフォルト無効）

**作成/変更:** `app/lib/narrate.ts`, `app/lib/narrate.test.ts`, `.env.example`

**インターフェース:** `narrate(decomposition, diMoves) -> string`。**v1 はテンプレベースの決定論的文章生成**
（例: 「綿先物の上昇が衣料を-X%押下げ、景気ウォッチャー先行きDIの改善が+Y%押上げ」）。
LLM呼び出しは feature flag `NEXT_PUBLIC_ENABLE_LLM_NARRATION`（既定 false）で将来差し替え。
**原則: 数値は必ず成果物JSON由来。LLMは説明文の言い回しのみ**（数値生成はさせない）。生成は最新 Claude モデル想定。

**手順:**
- [ ] `narrate.test.ts`: 既知の要因分解＋DI変化から、寄与の符号・大きさが文章に正しく反映されることを検証
- [ ] 失敗確認 → テンプレ実装 → 通過確認
- [ ] コミット: "feat(web): deterministic narration scaffold (LLM behind flag)"

> LLM 連携の本実装は別計画。導入時は Anthropic SDK と最新 Claude モデルを使用し、
> プロンプトに数値JSONを根拠として渡し、創作的な数値を出さない制約を課す。

---

# マイルストーン M7: 自動化（バッチ・デプロイ）

## タスク M7-1: GitHub Actions 定期バッチ

**作成/変更:** `.github/workflows/batch.yml`

**インターフェース:** スケジュール（例: 家計調査公表後＝毎月上旬＋日次の先物更新）。
ジョブ: `uv sync` → 各コネクタ取得→DuckDB→`uv run python -m models.build_artifacts` → `public/data/*.json` を
**designブランチ or 専用ブランチにコミット**。`ESTAT_APP_ID` は GitHub Secrets。

**手順:**
- [ ] `batch.yml` を作成（cron 2系統、Secrets 参照、生成JSONの差分のみコミット）
- [ ] `workflow_dispatch` 手動実行で1回成功させ、`public/data/*.json` が更新されることを確認
- [ ] 失敗時に出典メタ欠落でジョブが落ちることを確認（M1の検証が効く）
- [ ] コミット: "ci: scheduled batch to refresh artifacts"

## タスク M7-2: Vercel デプロイ確認

**作成/変更:** `vercel.json`（必要なら）, `README.md`（デプロイ手順）

**手順:**
- [ ] Vercel に接続し、`public/data` 配信＋ App Router ビルドが通ることをプレビューデプロイで確認
- [ ] モバイル実機（携帯）で表示・スライダー操作・出典表示を確認
- [ ] `README.md` にローカル開発・バッチ実行・デプロイ手順を記載
- [ ] コミット: "docs: deploy instructions and Vercel config"

---

## 自己レビュー・チェックリスト（writing-plans 準拠）

- [x] 設計§（データ層/モデル/シナリオ/バックテスト/出典/モバイル/DI/NL解釈）が各タスクに対応
- [x] プレースホルダ（TBD/「エラー処理を追加」等の曖昧指示）なし。統計表ID等は「探索コマンドを伴う具体タスク」として明示
- [x] フロント契約（M3-1スキーマ）とクライアント型（M5）の整合
- [x] 各タスクが独立レビュー可能な粒度（隣接タスクを個別に承認/却下できる）
- [x] ネットワーク依存はフィクスチャでテスト（再現性・CIで安定）

## 設計から繰り越した未決事項の解消状況

| 設計§9の未決事項 | 本計画での解消 |
|---|---|
| 統計表ID・系列コード・APIキー手順 | M1-2/M1-3（getStatsList探索＋registry記録、`.env.example`にESTAT_APP_ID手順） |
| 先物銘柄・取得先 | M1-6（ZW/ZS/SB/CT=F, JPY=X, yfinance、出典明記） |
| 説明変数セット・ラグ・ナウキャスト手法 | M3-2/M3-4 |
| バックテスト窓・期間・しきい値 | M4-2（拡張窓・horizon=3・`beats_naive`ゲート） |
| プリセット定義方法 | M5-3（先物起点のbase＋override） |

## 実行モード（次の選択）

writing-plans は2つの実行方式を提示します:

1. **サブエージェント駆動**: タスクごとに新規サブエージェントが実装し、各タスクの完了時にレビューゲート。文脈が綺麗で大規模向き。
2. **インライン実行**: このセッションで順次実装し、マイルストーン境界でチェックポイント。やり取りが速い。

どちらで進めるか、またこの計画への修正があれば教えてください。

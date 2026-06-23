# 日本 消費シナリオ シミュレータ

日本の食品・衣料の消費（前年比%）を、出典明示データと解釈可能な回帰モデルで予測し、
プリセット＋手動上書きのシナリオを携帯から操作できる Next.js ダッシュボード。

- **バックエンド（Python / uv）**: 公的API・先物からデータ取得 → DuckDB で月次パネル →
  カテゴリ別 OLS 学習・バックテスト → `public/data/*.json`（出典メタ込み）を出力。
- **フロント（Next.js / TypeScript）**: その JSON を読み、シナリオ計算（線形）を
  クライアントで即時実行。サーバー不要。
- **自動化**: GitHub Actions の定期バッチが成果物を再生成し、Vercel が配信。

アーキテクチャと計画の詳細は `docs/superpowers/` を参照。

## 構成

```
etl/        データ取得・パネル構築（registry / provenance / connectors / store / panel / run）
models/     特徴量・OLS・ナウキャスト・バックテスト・成果物ビルダー・出力スキーマ
app/        Next.js (App Router)。lib/ にシナリオエンジン・ローダ・プリセット・narrate
public/data 成果物JSON（coefficients / baseline / backtest / sources）。バッチが上書き
data/fixtures テスト用の保存済みAPIレスポンス（実APIは叩かない）
```

## ローカル開発

### 前提
- Python 3.12 + [uv](https://docs.astral.sh/uv/)
- Node.js 22 + npm

### バックエンド（Python）

```bash
uv sync                 # 依存インストール
uv run pytest           # テスト（ネットワーク不要・フィクスチャ使用）
```

### フロント（Next.js）

```bash
npm ci
npm test                # vitest
npm run dev             # http://localhost:3000
npm run build           # 本番ビルド
```

`app/page.tsx` が `public/data/*.json` を fetch して表示する。リポジトリには
スキーマ準拠のサンプルJSONが入っているため、バッチ未実行でも UI を確認できる。

## バッチ（手動実行）

成果物を再生成する手順:

```bash
# 1. 環境変数（コミットしない）
cp .env.example .env
#   .env に e-Stat の appId を設定: ESTAT_APP_ID=...
#   取得: https://www.e-stat.go.jp/api/

# 2. データ取得 → DuckDB
uv run python -m etl.run --db data/warehouse.duckdb

# 3. 成果物JSON生成（スキーマ検証付き）
uv run python -m models.build_artifacts --db data/warehouse.duckdb --out public/data
```

`etl.run` は取得パラメータが未確定の系列を **skip** として一覧し、確定済みの系列だけ
書き込む（出典メタが欠けると保存時に失敗する）。

### 実データを流すための未確定事項

コネクタはスキーマ準拠のフィクスチャで実装・テスト済み。実データ取得には以下の確定が必要:

| 対象 | 確定する値 | 方法 |
|---|---|---|
| e-Stat | `stats_data_id`（家計調査・CPI） | `getStatsList` で表IDを探索し `etl/registry.py` に記録 |
| 日本銀行 | `csv_url`（series_code → CSV DL URL） | 時系列検索サイトでDL URLを確認し registry に記録 |
| 内閣府 | Excel の URL/レイアウト | `etl/run.py` の `cao_provider` を実装（`etl/connectors/cao.py` の列マップを実ファイルに合わせる） |

> 開発コンテナ（Claude Code on the web）は egress 制限で公的API/Yahoo Finance への
> アクセスがブロックされる場合がある。実データ取得は GitHub Actions ランナー
> （通常のインターネット接続あり）または手元PCで行う。

## 定期バッチ（GitHub Actions）

`.github/workflows/batch.yml` が ETL → 成果物生成 → `public/data` 差分コミットを行う。

- 現在のトリガーは **`workflow_dispatch`（手動）のみ**。
- 有効化の条件:
  1. リポジトリ Settings → Secrets に **`ESTAT_APP_ID`** を登録
  2. 上表の未確定パラメータを確定
  3. `batch.yml` の `schedule`（cron 2系統）のコメントを外す

## デプロイ（Vercel）

- `vercel.json`: framework=nextjs / `installCommand=npm ci` / `buildCommand=next build`。
- リポジトリを Vercel に接続するとプレビュー/本番デプロイが走る。`public/data` は
  静的配信され、クライアントが `/data/*.json` を fetch する。
- モバイル実機でプリセット選択・スライダー操作・出典表示を確認する（単一カラム・タッチ対応）。

### 自然言語解釈（任意）
要因分解の説明文は既定で決定論的テンプレート（`app/lib/narrate.ts`）。
`NEXT_PUBLIC_ENABLE_LLM_NARRATION=true` で将来の LLM 言い回し差し替えを有効化する想定
（数値は常に成果物JSON由来で、LLM に数値生成はさせない）。

// 表示ラベルの共通定義（「何の前年比か」を全タブで一貫して示す）。

/** 目的指標の正式な定義（注記ボックス用・1〜2行）。 */
export const TARGET_DEF =
  "この指標＝家計調査（総務省・二人以上の世帯）の「実質消費支出・前年同月比（％）」。" +
  "食料＝用途分類「食料」、衣料＝「被服及び履物」。名目支出を対応CPI（食料/被服）で実質化し、" +
  "直近の未公表月はナウキャストで補完しています。";

/** グラフ縦軸などに添える短い説明。 */
export const TARGET_SHORT = "実質消費支出 前年同月比（％）／家計調査・二人以上世帯";

/** 各説明変数が「モデルに入る値の形（縦軸の意味）」を返す。
 * 単位が変数ごとに異なるため（前年比 / DI水準 / 指数 / 割合）明示する。 */
export function driverAxisLabel(driver: string, unit: string): string {
  if (
    driver.startsWith("cpi.") ||
    driver.startsWith("wage.") ||
    driver.startsWith("fut.")
  )
    return "前年同月比（％）";
  if (driver.startsWith("cao.watcher.")) return "DI（水準・50が横ばい）";
  if (driver.startsWith("cao.cci.")) return "指数（水準）";
  if (driver.startsWith("weather.")) return "割合（0〜1）";
  return unit ? `水準（${unit}）` : "水準";
}

// 末尾（trailing）移動平均。指定窓ぶんの非null値が揃った時だけ平均を出す。
// 揃わない位置は null（グラフで線が途切れる）。

export function movingAverage(
  values: (number | null)[],
  window: number,
): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    let ok = true;
    for (let j = i - window + 1; j <= i; j++) {
      const v = values[j];
      if (v == null || !Number.isFinite(v)) {
        ok = false;
        break;
      }
      sum += v;
    }
    out.push(ok ? sum / window : null);
  }
  return out;
}

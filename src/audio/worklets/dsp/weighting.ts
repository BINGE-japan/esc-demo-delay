// 知覚重み付け（K特性ライク）: 「明るさ＝うるさい」を音量として勘定するための高域強調
// （1-pole ハイシェルフ）。saturation.ts の **Drive 知覚 makeup 表** を作る際、クリップ倍音が
// 足す明るさ（＝ラウドネス増）を測るのに使う（docs/DSP.md §2）。定数とフィルタをここに集約＝音作りの SSoT。

export const WEIGHT_PIVOT_HZ = 1500 // 分割点（これ以上を重く）
export const WEIGHT_HIGH = 2.0 // 高域の重み（≈+6dB）。大きいほど「明るさ」を音量として強く勘定（耳調整）

// 1-pole ハイシェルフ係数（sr から算出）。
export const weightCoef = (sr: number): number =>
  1 - Math.exp((-2 * Math.PI * WEIGHT_PIVOT_HZ) / sr)

// 1-pole ハイシェルフの状態を持つ重み付け器（mono 1 系統）。
// weighted = lp + (x − lp)·WEIGHT_HIGH（lp=分割点以下の低域、(x−lp)=高域を WEIGHT_HIGH 倍）。
export class HighShelfWeight {
  private lp = 0

  constructor(private readonly coef: number) {}

  // 入力 x の知覚重み付き値を返す（状態 lp を更新。lp=分割点以下、(x−lp)=高域を WEIGHT_HIGH 倍）。
  process(x: number): number {
    this.lp += this.coef * (x - this.lp)
    return this.lp + (x - this.lp) * WEIGHT_HIGH
  }

  reset(): void {
    this.lp = 0
  }
}

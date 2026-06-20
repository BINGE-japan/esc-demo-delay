// ラウドネスマッチ（遅い自動トリム）: dry と wet の RMS を遅く測り wet を dry に合わせる。
// 時定数 ~300ms と遅いのでポンピングしない。歪みセクションのフィードフォワード補正の
// 残差（信号レベル依存ぶん）を埋める用途（docs/DSP.md 段6b / DECISIONS 2026-06-20）。

const TIME_CONST_MS = 300
const MIN_GAIN = 0.0625 // -24dB
const MAX_GAIN = 16 // +24dB
const EPS = 1e-9

export class LoudnessMatch {
  private readonly coef: number
  private dryMs = 0 // dry 平均二乗（平滑）
  private wetMs = 0 // wet 平均二乗（平滑）
  private gain = 1 // 適用ゲイン（平滑）

  constructor(sr: number) {
    this.coef = 1 - Math.exp(-1 / ((TIME_CONST_MS / 1000) * sr))
  }

  // wet を in-place で dry のラウドネスへ合わせる。enabled=false なら gain を 1 へ寄せる。
  // モノ合算で測り 1 ゲインを全 ch に適用（ステレオ像を保つ）。
  process(wet: Float32Array[], dry: Float32Array[], enabled: boolean): void {
    const n = wet.length
    if (n === 0) return
    const len = wet[0].length
    for (let i = 0; i < len; i++) {
      let d = 0
      let w = 0
      for (let ch = 0; ch < n; ch++) {
        d += dry[ch][i]
        w += wet[ch][i]
      }
      d /= n
      w /= n
      this.dryMs += this.coef * (d * d - this.dryMs)
      this.wetMs += this.coef * (w * w - this.wetMs)
      const raw = Math.sqrt(this.dryMs / (this.wetMs + EPS))
      const target = enabled ? Math.min(MAX_GAIN, Math.max(MIN_GAIN, raw)) : 1
      this.gain += this.coef * (target - this.gain)
      for (let ch = 0; ch < n; ch++) wet[ch][i] *= this.gain
    }
  }
}

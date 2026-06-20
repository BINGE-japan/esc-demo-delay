// 再現性グリッチ: 自前 frame をグリッド（≈80ms）に割り、シード付き決定論ハッシュで判定。
// 同じ再生なら毎回同じ位置で鳴る＝再現性あり。質感はリピート/ゲートのミックス（シードで選択）。
// 判定は全 ch 共通、スライスバッファは ch 毎（docs/DSP.md 段8）。定数はここで調整。

const SEED = 0x9e3779b9 | 0
const STEP_MS = 80 // グリッチのグリッド
const SLICE_MS = 30 // スタッター取り込み長
const FADE_MS = 3 // ゲートのフェード（クリック回避）
const MAX_PROB = 0.8 // ノブ最大時の発生確率
const FILL_LEVEL = 0.7 // Spectral Fill 差し込み音のレベル

// step index → [0,1) の決定論ハッシュ。k にキー → 再現性。
function rand01(n: number): number {
  let t = (n ^ SEED) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export class Glitch {
  private readonly step: number
  private readonly slice: number
  private readonly fade: number
  private sliceBuf: Float32Array[] = []
  private frame = 0 // 自前サンプルカウンタ（再現性の基準）

  constructor(sr: number) {
    this.step = Math.max(1, Math.round((STEP_MS / 1000) * sr))
    this.slice = Math.max(1, Math.round((SLICE_MS / 1000) * sr))
    this.fade = Math.max(1, Math.round((FADE_MS / 1000) * sr))
  }

  // fill=true: ゲート無音区間に「周波数特性反転音」（(-1)^n 変調で低↔高ミラー）を差し込む。
  process(io: Float32Array[], amount: number, fill: boolean): void {
    const n = io.length
    if (n === 0) return
    const len = io[0].length
    const prob = (amount / 100) * MAX_PROB
    while (this.sliceBuf.length < n) this.sliceBuf.push(new Float32Array(this.slice))

    for (let i = 0; i < len; i++) {
      const k = Math.floor(this.frame / this.step)
      const pos = this.frame - k * this.step
      const on = prob > 0 && rand01(k * 2 + 1) < prob
      const stutter = on && rand01(k * 2 + 2) < 0.5
      const gate = on && !stutter
      let gateGain = 1
      if (gate) {
        if (pos < this.fade) gateGain = 1 - pos / this.fade
        else if (pos > this.step - this.fade) gateGain = (pos - (this.step - this.fade)) / this.fade
        else gateGain = 0
      }

      // gateGain: 1=素通り / 0=ゲート中心。gateMix=1-gateGain で中心ほど差し込む。
      const gateMix = 1 - gateGain
      const sign = (this.frame & 1) === 0 ? 1 : -1 // (-1)^n = スペクトル反転

      for (let ch = 0; ch < n; ch++) {
        const data = io[ch]
        if (stutter) {
          const s = this.sliceBuf[ch]
          if (pos < this.slice)
            s[pos] = data[i] // 取り込みつつ素通り
          else data[i] = s[pos % this.slice] // ループ再生
        } else if (gate) {
          if (fill) {
            // 無音にせず、スペクトル反転音をフェードで差し込む。
            const inv = data[i] * sign * FILL_LEVEL
            data[i] = data[i] * (1 - gateMix) + inv * gateMix
          } else {
            data[i] *= gateGain // 無音
          }
        }
      }
      this.frame++
    }
  }
}

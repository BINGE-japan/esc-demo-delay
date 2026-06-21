// Pitch（Vinyl の Warp 風＝再現性のあるピッチ寄れ/ワウ）。
// 可変ディレイを「決定論カーブ」で揺らし、読み出し速度変化＝ドップラーでピッチを寄れさせる。
// カーブは **値ノイズ**: パターン内位相 glitchPhase(0..1) を K=RATE 区間に分け、各点を seed 付き
// ランダム高さで smoothstep 補間（ループ端で連続＝h[K]=h[0]）。パターンにロック＝毎ループ同形＝再現性。
// depth(Pitch ノブ)=揺れ量。SWING=±変調幅(MAX時)、BASE=中心ディレイ、RATE=揺れの細かさ/速さ、
// SMOOTH=per-sample 平滑。耳で確定した値（2026-06-21）。docs/DSP.md 段「Pitch」。

const SEED = 0x6d2b79f5 | 0
const SWING_MS = 16 // MAX(depth=100%) での±変調幅
const BASE_MS = 20 // 中心ディレイ（≥SWING でディレイが正に保たれる）
const RATE = 4 // 値ノイズの区間数（多い=細かい/速い揺れ）
const SMOOTH_MS = 4 // per-sample 平滑（block/rAF 段差除去）
const BUF_MS = 48 // ディレイバッファ長（BASE+SWING+余裕）

// 点 index → [0,1) 決定論ハッシュ（値ノイズの高さ。seed で再現性）。
function rand01(n: number): number {
  let t = (n ^ SEED) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export class WarpPitch {
  private readonly bufLen: number
  private readonly baseDelay: number
  private readonly swing: number
  private readonly smoothCoef: number
  private buf: Float32Array[] = []
  private writePos = 0
  private curDelay: number

  constructor(sr: number) {
    this.bufLen = Math.max(8, Math.ceil((BUF_MS / 1000) * sr))
    this.baseDelay = Math.min(this.bufLen - 2, Math.max(1, (BASE_MS / 1000) * sr))
    this.swing = Math.max(0, (SWING_MS / 1000) * sr)
    this.smoothCoef = 1 - Math.exp(-1 / ((SMOOTH_MS / 1000) * sr))
    this.curDelay = this.baseDelay
  }

  // 値ノイズ: phase∈[0,1) を RATE 区間、各点 rand01(k) 高さ[-1,1] を smoothstep 補間。ループ端連続。
  private warpCurve(phase: number): number {
    const x = phase * RATE
    const f = x - Math.floor(x)
    const k0 = Math.floor(x) % RATE
    const k1 = (k0 + 1) % RATE
    const h0 = rand01(k0) * 2 - 1
    const h1 = rand01(k1) * 2 - 1
    const s = f * f * (3 - 2 * f) // smoothstep
    return h0 + (h1 - h0) * s
  }

  // io を in-place。depth=揺れ量(0..100), glitchPhase=パターン内位相(0..1)。
  process(io: Float32Array[], depth: number, glitchPhase: number): void {
    const n = io.length
    if (n === 0) return
    const len = io[0].length
    while (this.buf.length < n) this.buf.push(new Float32Array(this.bufLen))
    const L = this.bufLen

    // depth=0 は素通り（中心ディレイの常時レイテンシ/帯域とのコムを避ける）。バッファは更新だけ。
    if (depth <= 0) {
      for (let i = 0; i < len; i++) {
        for (let ch = 0; ch < n; ch++) this.buf[ch][this.writePos] = io[ch][i]
        this.writePos++
        if (this.writePos >= L) this.writePos = 0
      }
      this.curDelay = this.baseDelay // 復帰時に baseDelay から
      return
    }

    const depthLin = Math.min(1, depth / 100)
    const target = this.baseDelay + this.warpCurve(glitchPhase) * depthLin * this.swing

    for (let i = 0; i < len; i++) {
      this.curDelay += this.smoothCoef * (target - this.curDelay)
      let dly = this.curDelay
      if (dly < 1) dly = 1
      else if (dly > L - 2) dly = L - 2
      const readPos = this.writePos - dly
      const r0 = Math.floor(readPos)
      const frac = readPos - r0
      const i0 = ((r0 % L) + L) % L
      const i1 = (i0 + 1) % L
      for (let ch = 0; ch < n; ch++) {
        const b = this.buf[ch]
        b[this.writePos] = io[ch][i] // 入力を書込
        io[ch][i] = b[i0] + (b[i1] - b[i0]) * frac // フラクショナル読み出し（ドップラー）
      }
      this.writePos++
      if (this.writePos >= L) this.writePos = 0
    }
  }
}

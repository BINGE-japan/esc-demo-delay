// Pitch（Vinyl の Warp 風＝再現性のあるピッチ寄れ/ワウ）。
// 可変ディレイを「決定論カーブ」で揺らし、読み出し速度変化＝ドップラーでピッチを寄れさせる。
// カーブは **値ノイズ**: パターン内位相 glitchPhase(0..1) を K=Rate 区間に分け、各点を seed 付き
// ランダム高さで smoothstep 補間（ループ端で連続＝h[K]=h[0]）。パターンにロック＝毎ループ同形＝再現性。
// depth(Pitch ノブ)=揺れ量、Swing(ms)=±変調幅(MAX時)、Base(ms)=中心ディレイ、Rate=揺れの細かさ/速さ、
// Smooth(ms)=per-sample 平滑（block/rAF 段差除去）。Swing/Base/Rate/Smooth は現在 DEBUG param。
// docs/DSP.md 段「Pitch」。

const SEED = 0x6d2b79f5 | 0
const BUF_MS = 96 // ディレイバッファ上限（Base+Swing の最大に対応）

// 点 index → [0,1) 決定論ハッシュ（値ノイズの高さ。seed で再現性）。
function rand01(n: number): number {
  let t = (n ^ SEED) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export class WarpPitch {
  private readonly sr: number
  private readonly bufLen: number
  private buf: Float32Array[] = []
  private writePos = 0
  private curDelay = -1

  constructor(sr: number) {
    this.sr = sr
    this.bufLen = Math.max(8, Math.ceil((BUF_MS / 1000) * sr))
  }

  // 値ノイズ: phase∈[0,1) を K 区間、各点 rand01(k) 高さ[-1,1] を smoothstep 補間。ループ端連続。
  private warpCurve(phase: number, K: number): number {
    const x = phase * K
    const f = x - Math.floor(x)
    const k0 = Math.floor(x) % K
    const k1 = (k0 + 1) % K
    const h0 = rand01(k0) * 2 - 1
    const h1 = rand01(k1) * 2 - 1
    const s = f * f * (3 - 2 * f) // smoothstep
    return h0 + (h1 - h0) * s
  }

  // io を in-place。depth=揺れ量(0..100), glitchPhase=パターン内位相(0..1)。
  // swingMs/baseMs/rate/smoothMs は DEBUG（耳で当てたら定数化）。
  process(
    io: Float32Array[],
    depth: number,
    glitchPhase: number,
    swingMs: number,
    baseMs: number,
    rate: number,
    smoothMs: number,
  ): void {
    const n = io.length
    if (n === 0) return
    const len = io[0].length
    while (this.buf.length < n) this.buf.push(new Float32Array(this.bufLen))
    const L = this.bufLen

    const sr = this.sr
    let baseD = (baseMs / 1000) * sr
    if (baseD < 1) baseD = 1
    else if (baseD > L - 2) baseD = L - 2
    const swingD = Math.max(0, (swingMs / 1000) * sr)
    const K = Math.max(2, Math.round(rate))
    const smoothCoef = 1 - Math.exp(-1 / ((Math.max(0.1, smoothMs) / 1000) * sr))
    const depthLin = depth <= 0 ? 0 : Math.min(1, depth / 100)
    const target = baseD + this.warpCurve(glitchPhase, K) * depthLin * swingD
    if (this.curDelay < 0) this.curDelay = baseD

    for (let i = 0; i < len; i++) {
      this.curDelay += smoothCoef * (target - this.curDelay)
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

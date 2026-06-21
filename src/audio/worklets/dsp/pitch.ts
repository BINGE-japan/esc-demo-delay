// Pitch（Vinyl の Warp 風＝再現性のあるピッチ寄れ/ワウ）。
// 可変ディレイを「滑らかな決定論カーブ」で揺らし、読み出し速度変化＝ドップラーでピッチを寄れさせる。
// カーブは glitchPhase（パターン内位相 0..1）の関数＝**パターンにロック＝毎ループ同じ＝再現性**。
// 複数正弦の和（wow+flutter）でランダムっぽい滑らかな寄れを作る（seed＝固定位相オフセット）。
// depth ノブ=揺れ量。block 毎の glitchPhase 更新は per-sample 平滑でジッタ除去（ザラつき回避）。
// 揺れの速さ/質感（HARMONICS）は耳調整、詳細は今後 debug param で詰める。docs/DSP.md 段「Pitch」。

const BASE_DELAY_MS = 6 // 中心ディレイ（揺れの基準。±DEPTH_MAX を確保できる値）
const DEPTH_MAX_MS = 4 // depth=100% での変調幅（±ms）
const BUF_MS = 14 // ディレイバッファ長（BASE+DEPTH+余裕）
const SMOOTH_MS = 4 // targetDelay の per-sample 平滑（block 段差/ジッタ除去）

// warp カーブ＝Σ amp·sin(2π(freq·phase + ph))。freq はパターンの整数倍（=毎ループ同形）。
// wow(遅い)＋flutter(速い)。amp 和≈1（カーブ範囲 ≈ ±1）。
const HARMONICS: { freq: number; amp: number; phase: number }[] = [
  { freq: 1, amp: 0.55, phase: 0.0 }, // wow
  { freq: 3, amp: 0.3, phase: 0.37 },
  { freq: 7, amp: 0.15, phase: 0.71 }, // flutter
]

export class WarpPitch {
  private readonly sr: number
  private readonly baseDelay: number
  private readonly depthMax: number
  private readonly bufLen: number
  private readonly smoothCoef: number
  private buf: Float32Array[] = []
  private writePos = 0
  private curDelay: number

  constructor(sr: number) {
    this.sr = sr
    this.baseDelay = Math.max(1, (BASE_DELAY_MS / 1000) * sr)
    this.depthMax = (DEPTH_MAX_MS / 1000) * sr
    this.bufLen = Math.max(4, Math.ceil((BUF_MS / 1000) * sr))
    this.smoothCoef = 1 - Math.exp(-1 / ((SMOOTH_MS / 1000) * sr))
    this.curDelay = this.baseDelay
  }

  private warpCurve(phase: number): number {
    let m = 0
    for (let h = 0; h < HARMONICS.length; h++) {
      const { freq, amp, phase: ph } = HARMONICS[h]
      m += amp * Math.sin(2 * Math.PI * (freq * phase + ph))
    }
    return m
  }

  // io を in-place。depth=揺れ量(0..100), glitchPhase=パターン内位相(0..1)。
  process(io: Float32Array[], depth: number, glitchPhase: number): void {
    const n = io.length
    if (n === 0) return
    const len = io[0].length
    while (this.buf.length < n) this.buf.push(new Float32Array(this.bufLen))

    // block 毎: glitchPhase ロックの warp カーブから目標ディレイ。per-sample で平滑。
    const depthLin = depth <= 0 ? 0 : Math.min(1, depth / 100)
    const target = this.baseDelay + this.warpCurve(glitchPhase) * depthLin * this.depthMax
    const L = this.bufLen

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
        io[ch][i] = b[i0] + (b[i1] - b[i0]) * frac // フラクショナル読み出し
      }
      this.writePos++
      if (this.writePos >= L) this.writePos = 0
    }
  }
}

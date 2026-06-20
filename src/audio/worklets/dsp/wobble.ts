// ピッチ Wobble: 可変ディレイ＋ランダム LFO でドップラー的にピッチをヨレさせる（テープのワウフラ風）。
// パラメータ（docs/DSP.md 段7）:
//   Depth = 揺れ幅（ディレイ変調の深さ）
//   Speed = 揺れの速さ（LFO レート）
//   Occur = 頻度（100%=常に / <100%=たまに）。たまには BPM グリッドにシード付き判定＝再現性あり。
// LFO/Occur ゲートは全 ch 共通、ディレイバッファは ch 毎。定数はここで調整。

const MAX_DELAY_MS = 10 // Depth=100% のディレイ変調幅（揺れ幅の上限。耳で調整）
const SPEED_MIN_HZ = 0.5 // Speed=0% の LFO レート
const SPEED_MAX_HZ = 14 // Speed=100% の LFO レート
const OCCUR_SEED = 0x85ebca6b | 0 // Occur 判定のシード（Glitch とは別系列）
const GATE_SMOOTH_MS = 5 // Occur ON/OFF のクロスフェード（クリック回避）

// beat index → [0,1) の決定論ハッシュ。BPM グリッドにキー → 再現性あり。
function rand01(n: number): number {
  let t = (n ^ OCCUR_SEED) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export class Wobble {
  private readonly sr: number
  private readonly maxDelay: number // 揺れ幅の上限[サンプル]
  private readonly base: number // 基準ディレイ[サンプル]
  private readonly bufLen: number
  private readonly gateCoef: number
  private buf: Float32Array[] = []
  private writeIdx = 0
  private cur = 0 // LFO 現在値
  private target = 0 // LFO 目標値
  private counter = 0 // 目標更新カウンタ
  private state = 0x1234abcd // LFO 用 PRNG（自由走行）
  private occGate = 1 // Occur ゲイン（平滑）
  private frame = 0 // 自前サンプルカウンタ（BPM グリッドの基準＝再現性）

  constructor(sr: number) {
    this.sr = sr
    this.maxDelay = Math.max(2, Math.round((MAX_DELAY_MS / 1000) * sr))
    this.base = this.maxDelay + 8
    this.bufLen = this.base + this.maxDelay + 8
    this.gateCoef = 1 - Math.exp(-1 / ((GATE_SMOOTH_MS / 1000) * sr))
  }

  private rand(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // depthPct/speedPct/occurPct は 0..100、bpm はホストテンポ。
  process(
    io: Float32Array[],
    depthPct: number,
    speedPct: number,
    occurPct: number,
    bpm: number,
  ): void {
    const n = io.length
    if (n === 0) return
    const len = io[0].length
    while (this.buf.length < n) this.buf.push(new Float32Array(this.bufLen))

    const depth = (depthPct / 100) * this.maxDelay
    // Speed → LFO レート（指数マップ）。更新間隔と平滑をそこから決める。
    const speedHz = SPEED_MIN_HZ * Math.pow(SPEED_MAX_HZ / SPEED_MIN_HZ, speedPct / 100)
    const interval = Math.max(1, Math.round(this.sr / speedHz))
    const smooth = 1 - Math.exp((-2 * Math.PI * speedHz) / this.sr)
    // Occur → 発生確率。100% で常時 ON。
    const occurProb = occurPct / 100
    const samplesPerBeat = Math.max(1, Math.round((this.sr * 60) / Math.max(20, bpm)))

    for (let i = 0; i < len; i++) {
      // LFO（一定間隔でランダム目標 → 平滑）
      if (this.counter <= 0) {
        this.target = this.rand() * 2 - 1
        this.counter = interval
      }
      this.counter--
      this.cur += smooth * (this.target - this.cur)

      // Occur: BPM ビートごとにシード付き判定。100% は常時 ON、<100% は再現性のある「たまに」。
      const beat = Math.floor(this.frame / samplesPerBeat)
      const active = occurProb >= 1 || rand01(beat) < occurProb
      this.occGate += this.gateCoef * ((active ? 1 : 0) - this.occGate)

      const delay = this.base + depth * this.occGate * this.cur

      for (let ch = 0; ch < n; ch++) {
        const b = this.buf[ch]
        const data = io[ch]
        b[this.writeIdx] = data[i]
        let rp = this.writeIdx - delay
        if (rp < 0) rp += this.bufLen
        const i0 = Math.floor(rp)
        const frac = rp - i0
        const i1 = i0 + 1 >= this.bufLen ? 0 : i0 + 1
        data[i] = b[i0] * (1 - frac) + b[i1] * frac
      }
      this.writeIdx = this.writeIdx + 1 >= this.bufLen ? 0 : this.writeIdx + 1
      this.frame++
    }
  }
}

// 歪みユニット: Drive → Hard Clip → Drive音量補正 → Tone(Tilt EQ) → Tone音量補正。
// すべて knob 由来のフィードフォワード＝信号に追従しない＝ポンピングしない（docs/DSP.md 段1-5）。
// 音作りの定数はここで調整する。

const TILT_PIVOT_HZ = 800 // Tilt の低域/高域 分割点
export const TILT_MAX_DB = 18 // tone ±100% → ±18dB
const TONE_COMP_HIGH_WEIGHT = 0.6 // Tone音量補正の高域寄与（>0.5 で高域を重く＝明るくすると下がる）

const dbToLin = (db: number): number => Math.pow(10, db / 20)

// Drive音量補正: ハードクリップは Drive で RMS が増える。基準サイン波(peak=1)で
// 出力RMSが入力RMSに一致するゲインを driveLin だけから算出（docs/DSP.md 段3b）。
function driveMakeup(g: number): number {
  let ms: number
  if (g <= 1) {
    ms = (g * g) / 2
  } else {
    const tc = Math.asin(1 / g)
    ms = (2 / Math.PI) * (g * g * (tc / 2 - Math.sin(2 * tc) / 4) + (Math.PI / 2 - tc))
  }
  return Math.sqrt(0.5 / ms)
}

// Tone音量補正: Tilt の知覚ラウドネス増分を基準スペクトルで逆算して打ち消す。
// 明るく（高域ブースト）すると知覚音量が上がる分を下げる（docs/DSP.md 段5）。
function toneMakeup(tiltDb: number): number {
  const gLow = dbToLin(-tiltDb)
  const gHigh = dbToLin(tiltDb)
  const pHigh = TONE_COMP_HIGH_WEIGHT
  const pLow = 1 - pHigh
  return 1 / Math.sqrt(pLow * gLow * gLow + pHigh * gHigh * gHigh)
}

export class Saturation {
  private readonly pivotCoef: number
  private lp: number[] = [] // Tilt 分割の 1-pole 状態（ch毎）

  constructor(sr: number) {
    this.pivotCoef = 1 - Math.exp((-2 * Math.PI * TILT_PIVOT_HZ) / sr)
  }

  // io を in-place で歪ませる。driveDb / tonePct は knob の実値。
  process(io: Float32Array[], driveDb: number, tonePct: number): void {
    const driveLin = dbToLin(driveDb)
    const makeup = driveMakeup(driveLin)
    const tiltDb = (tonePct / 100) * TILT_MAX_DB
    const gLow = dbToLin(-tiltDb)
    const gHigh = dbToLin(tiltDb)
    const toneComp = toneMakeup(tiltDb)

    while (this.lp.length < io.length) this.lp.push(0)
    for (let ch = 0; ch < io.length; ch++) {
      const data = io[ch]
      if (!data) continue
      let lp = this.lp[ch]
      for (let i = 0; i < data.length; i++) {
        // 段1 Drive → 段3 Hard Clip → 段3b Drive makeup
        let x = data[i] * driveLin
        if (x > 1) x = 1
        else if (x < -1) x = -1
        x *= makeup
        // 段5 Tone(Tilt EQ) + Tone makeup
        lp += this.pivotCoef * (x - lp)
        data[i] = (lp * gLow + (x - lp) * gHigh) * toneComp
      }
      this.lp[ch] = lp
    }
  }
}

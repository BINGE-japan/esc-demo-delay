// 歪みユニット: Drive → Hard Clip → Drive音量補正 → Tone(Tilt EQ) → Tone音量補正。
// すべて knob＋入力レベル由来のフィードフォワード＝出力を測らない（docs/DSP.md 段1-5）。
// 音作りの定数はここで調整する。
//
// ⭐ Drive 音量補正は **入力レベルを見た** feed-forward（出力は測らない＝ラグ/ムラ/swell-duck なし）:
//   ノブだけだと「入力フルスケール前提」で較正されるため、入力が小さいと Drive がただのゲイン化し
//   音量が上がる（補正が追いつかない）。そこで入力ピーク envelope `a` を見て、**実効クリップドライブ
//   Geff = a·driveLin** で補正を評価する:
//     makeup = a · driveMakeup(Geff) · drivePerceptualMakeup(dB(Geff))
//   - クリップ前 (Geff≤1): makeup = 1/driveLin（ゲインを完全相殺＝音量不変・ダイナミクス保持）
//   - フルスケール (a=1):  従来式に一致
//   `a` は入力（出力でなく）の envelope なので、**Drive を回した瞬間に効く**（入力一定なら遅延ゼロ）。
//   (a) driveMakeup … クリップで増える RMS、(b) drivePerceptualMakeup … クリップ倍音の「明るさ」
//   （dsp/weighting.ts の重み付けで起動時に表化）。

import { HighShelfWeight, weightCoef } from './weighting'

const TILT_PIVOT_HZ = 800 // Tilt の低域/高域 分割点
export const TILT_MAX_DB = 18 // tone ±100% → ±18dB
const TONE_COMP_HIGH_WEIGHT = 0.6 // Tone音量補正の高域寄与（>0.5 で高域を重く＝明るくすると下がる）

// 知覚 Drive makeup 表の構築用（耳調整 / params Drive 範囲と一致させる）
const REF_F0_HZ = 330 // 基準正弦（倍音が 1500Hz weighting pivot を跨ぐ・楽音基音域）
const DRIVE_MIN_DB = 0 // 表の下限（= params Drive min）
const DRIVE_MAX_DB = 48 // 表の上限（= params Drive max）
const DRIVE_TABLE_SIZE = 96 // 0..48dB を 96 点（<1dB 間隔。lerp 補間）
const EPS = 1e-9

// 入力ピーク envelope（feed-forward：信号がどれだけクリッパを叩いているか）。
// Comp で2モード: OFF=速い（トランジェント追従＝ダイナミクス保持）/ ON=遅い（操作点だけ追う＝
// トランジェントがクリップで頭打ち＝自然圧縮。サステイン＝レベル感は makeup で一定）。docs/DSP.md §2。
const ENV_ATK_MS = 5 // 保持(Comp OFF) attack（クリップへの叩き込みを素早く捉える）
const ENV_REL_MS = 150 // 保持(Comp OFF) release（緩やかに戻す）
const ENV_ATK_SLOW_MS = 250 // 圧縮(Comp ON) attack（操作点＝サステインだけ追い、トランジェントは動かさない）
const ENV_REL_SLOW_MS = 400 // 圧縮(Comp ON) release

// Comp ON のレベル補償（ざっくり一律トリム）: 圧縮でピークが潰れ RMS が下がる分を持ち上げて
// Comp OFF/dry にレベルを近づける。クリップ量(操作点 Geff dB)でゲート＝Drive を絞った中立時は効かない
// （bypass 近接を壊さない）。Geff 0dB→0、COMP_TRIM_FULL_DB 以上で最大 COMP_TRIM_DB（耳調整）。
const COMP_TRIM_DB = 7 // 最大トリム（耳調整。試聴で 7 に）
const COMP_TRIM_FULL_DB = 12 // この実効ドライブ(dB)で最大トリムに達する

const dbToLin = (db: number): number => Math.pow(10, db / 20)

// Drive音量補正(RMS): clip(G·sin) の RMS を入力 RMS に一致させるゲインを G だけから算出。
// G≤1（クリップ前）では 1/G（=ゲイン相殺）。基準サイン波 peak=1（docs/DSP.md 段3b）。
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

// 基準正弦1周期を「clip(in·g)（makeup なし）」→ 知覚重み付け し、ウォームアップ後の
// 重み付き平均二乗を返す（dsp/weighting.ts の重み付け）。
function refClipWeightedMs(g: number, wc: number, nPer: number): number {
  const shelf = new HighShelfWeight(wc)
  const warm = 2 // フィルタ過渡を捨てる周期数（残りの 1 周期だけ積算＝定常の重み付き平均二乗）
  let acc = 0
  const total = (warm + 1) * nPer
  for (let k = 0; k < total; k++) {
    const phase = (2 * Math.PI * (k % nPer)) / nPer
    let x = Math.sin(phase) * g
    if (x > 1) x = 1
    else if (x < -1) x = -1
    const wgt = shelf.process(x)
    if (k >= warm * nPer) acc += wgt * wgt
  }
  return acc / nPer
}

// 知覚 Drive makeup 表（driveMakeup に乗せる係数）。実効クリップドライブ G（=a·driveLin）で引く。
//   driveMakeup(G) · table(G) = fullMakeup(G) = sqrt( wms(透過) / wms(G) )
//   ＝その波形（unit sine を G でクリップした形）の重み付きラウドネスを透過時に一致させる総ゲイン。
function buildDriveTable(sr: number): Float32Array {
  const wc = weightCoef(sr)
  const nPer = Math.max(8, Math.round(sr / REF_F0_HZ))
  const refWms = refClipWeightedMs(dbToLin(DRIVE_MIN_DB), wc, nPer) // 基準（透過）
  const span = DRIVE_MAX_DB - DRIVE_MIN_DB
  const table = new Float32Array(DRIVE_TABLE_SIZE)
  for (let j = 0; j < DRIVE_TABLE_SIZE; j++) {
    const db = DRIVE_MIN_DB + (span * j) / (DRIVE_TABLE_SIZE - 1)
    const g = dbToLin(db)
    const wms = refClipWeightedMs(g, wc, nPer)
    const fullMakeup = Math.sqrt(refWms / (wms + EPS))
    table[j] = fullMakeup / driveMakeup(g)
  }
  return table
}

export class Saturation {
  private readonly pivotCoef: number
  private readonly driveTable: Float32Array // 知覚 makeup（実効ドライブ dB→係数）
  private readonly atkCoef: number // 保持(Comp OFF)
  private readonly relCoef: number
  private readonly atkSlowCoef: number // 圧縮(Comp ON)
  private readonly relSlowCoef: number
  private lp: number[] = [] // Tilt 分割の 1-pole 状態（ch毎）
  private inEnv = 0 // 入力ピーク envelope（feed-forward）

  constructor(sr: number) {
    this.pivotCoef = 1 - Math.exp((-2 * Math.PI * TILT_PIVOT_HZ) / sr)
    this.driveTable = buildDriveTable(sr)
    this.atkCoef = 1 - Math.exp(-1 / ((ENV_ATK_MS / 1000) * sr))
    this.relCoef = 1 - Math.exp(-1 / ((ENV_REL_MS / 1000) * sr))
    this.atkSlowCoef = 1 - Math.exp(-1 / ((ENV_ATK_SLOW_MS / 1000) * sr))
    this.relSlowCoef = 1 - Math.exp(-1 / ((ENV_REL_SLOW_MS / 1000) * sr))
  }

  // 実効クリップドライブ dB → 知覚 makeup 係数（表を lerp 補間）。範囲外はクランプ。
  private drivePerceptualMakeup(effDb: number): number {
    const span = DRIVE_MAX_DB - DRIVE_MIN_DB
    const t = ((effDb - DRIVE_MIN_DB) / span) * (DRIVE_TABLE_SIZE - 1)
    if (t <= 0) return this.driveTable[0]
    if (t >= DRIVE_TABLE_SIZE - 1) return this.driveTable[DRIVE_TABLE_SIZE - 1]
    const i = Math.floor(t)
    const frac = t - i
    return this.driveTable[i] * (1 - frac) + this.driveTable[i + 1] * frac
  }

  // io を in-place で歪ませる。driveDb / tonePct は knob の実値。
  // comp: true=自然圧縮（遅い envelope）/ false=ダイナミクス保持（速い envelope）。
  process(io: Float32Array[], driveDb: number, tonePct: number, comp: boolean): void {
    const n = io.length
    if (n === 0) return
    const first = io[0]
    const len = first ? first.length : 0
    if (len === 0) return
    const driveLin = dbToLin(driveDb)

    // --- 入力ピーク envelope（出力でなく入力を見る＝feed-forward） ---
    // Comp ON=遅い（操作点だけ追う＝トランジェントがクリップで潰れ自然圧縮）/ OFF=速い（追従＝保持）
    const atk = comp ? this.atkSlowCoef : this.atkCoef
    const rel = comp ? this.relSlowCoef : this.relCoef
    let env = this.inEnv
    for (let i = 0; i < len; i++) {
      let p = 0
      for (let ch = 0; ch < n; ch++) {
        const d = io[ch]
        const v = d ? (d[i] < 0 ? -d[i] : d[i]) : 0
        if (v > p) p = v
      }
      env += (p > env ? atk : rel) * (p - env)
    }
    this.inEnv = env
    const a = env > 1e-6 ? env : 1e-6

    // 入力レベル a を見た makeup: 実効クリップドライブ Geff=a·driveLin で評価。
    //   クリップ前(Geff≤1)→ 1/driveLin（ゲイン相殺＝音量不変）/ フルスケール(a=1)→ 従来式。
    const geff = a * driveLin
    const geffDb = 20 * Math.log10(geff)
    let makeup = a * driveMakeup(geff) * this.drivePerceptualMakeup(geffDb)
    // Comp ON: 圧縮で失ったレベルをざっくり一律トリムで補う（クリップ量でゲート＝低 Drive は中立）。
    if (comp) {
      const clipF = geffDb <= 0 ? 0 : geffDb >= COMP_TRIM_FULL_DB ? 1 : geffDb / COMP_TRIM_FULL_DB
      makeup *= dbToLin(COMP_TRIM_DB * clipF)
    }

    const tiltDb = (tonePct / 100) * TILT_MAX_DB
    const gLow = dbToLin(-tiltDb)
    const gHigh = dbToLin(tiltDb)
    const toneComp = toneMakeup(tiltDb)

    while (this.lp.length < n) this.lp.push(0)
    for (let ch = 0; ch < n; ch++) {
      const data = io[ch]
      if (!data) continue
      let lp = this.lp[ch]
      for (let i = 0; i < data.length; i++) {
        // 段1 Drive → 段3 Hard Clip → 段3b Drive makeup（入力レベル依存・RMS＋知覚）
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

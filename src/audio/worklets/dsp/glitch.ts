// Glitch ステップシーケンサ: 横=16分ステップ（1小節）、各ステップに type を置く。再生中の拍に
// 当たるステップの処理を適用＝BPM同期・拍ロック・再現性（パターンがループ＝毎回同じ箇所）。
// type: 0=Dry / 1=Repeat(ラチェット) / 2=Freeze / 3=Reverse / 4=Random（既存 stutter/gate）。
// 拍位置は App が positionSamples から算出した glitchPhase(0..1) で供給。worklet は localBarPos を
// サンプル精度で自走し、大ドリフト（シーク/ループ/再生開始）だけスナップ＝rAFジッタを音に入れない。
// Repeat/Freeze/Reverse は履歴リングから読む。境界はフェードでクリック回避。docs/DSP.md §3。

const SEED = 0x9e3779b9 | 0
const STEPS = 16 // 1 小節 / 16 分
const TYPE_DRY = 0
const TYPE_REPEAT = 1
const TYPE_FREEZE = 2
const TYPE_REVERSE = 3
const TYPE_RANDOM = 4

const HISTORY_MS = 2000 // 履歴リング長（Reverse/Freeze 用。最遅BPMの 2×step を確保）
const FREEZE_GRAIN_MS = 70 // Freeze で保持するグレイン長
const SLICE_MS = 30 // Random stutter のスライス長
const REPEAT_SUBDIV = 4 // Repeat: 1 ステップを何分割でラチェットするか
const FADE_MS = 3 // 境界フェード（クリック回避）
const SNAP_TOL_MS = 50 // これ以上ズレたら再同期スナップ（シーク等）
const MAX_PROB = 0.8 // Random の発生確率上限
const FILL_LEVEL = 0.7 // Spectral Fill 差し込み音レベル

// step index → [0,1) 決定論ハッシュ（Random の stutter/gate 選択。シードで再現性）。
function rand01(n: number): number {
  let t = (n ^ SEED) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export class Glitch {
  private readonly sr: number
  private readonly historyLen: number
  private readonly fade: number
  private readonly freezeGrain: number
  private readonly slice: number
  private history: Float32Array[] = [] // ch 毎の履歴リング（全サンプル書込）
  private histWrite = 0 // 現在サンプルの書込位置（全 ch 共通）
  private localBarPos = 0 // 小節内サンプル位置（自走・サンプル精度）
  private prevStepIdx = -1
  private stepStartWrite = 0 // 現ステップ開始時の histWrite（グレイン基準）
  private stepStutter = false // Random ステップの stutter/gate 選択（境界でキャッシュ）
  private resync = 0 // スナップ後のフェードイン残サンプル

  constructor(sr: number) {
    this.sr = sr
    this.historyLen = Math.max(1, Math.round((HISTORY_MS / 1000) * sr))
    this.fade = Math.max(1, Math.round((FADE_MS / 1000) * sr))
    this.freezeGrain = Math.max(1, Math.round((FREEZE_GRAIN_MS / 1000) * sr))
    this.slice = Math.max(1, Math.round((SLICE_MS / 1000) * sr))
  }

  // io を in-place で。amount=全体 wet(0..100), fill=Random gate のスペクトル反転,
  // steps=16 ステップの type, glitchPhase=小節内位相(0..1), bpm。
  process(
    io: Float32Array[],
    amount: number,
    fill: boolean,
    steps: Int32Array,
    glitchPhase: number,
    bpm: number,
  ): void {
    const n = io.length
    if (n === 0) return
    const len = io[0].length
    const H = this.historyLen
    while (this.history.length < n) this.history.push(new Float32Array(H))

    const wetAmt = amount <= 0 ? 0 : Math.min(1, amount / 100)
    const samplesPerBar = Math.max(1, (this.sr * 60 * 4) / Math.max(20, bpm))
    const stepLen = Math.max(1, samplesPerBar / STEPS)
    const stepLenI = Math.max(1, Math.floor(stepLen))
    const maxGrain = Math.max(1, Math.floor(H / 2))
    const revLen = Math.min(stepLenI, maxGrain)
    const freezeLen = Math.min(this.freezeGrain, stepLenI, maxGrain)
    const subLen = Math.max(1, Math.min(Math.floor(stepLenI / REPEAT_SUBDIV), maxGrain))
    const sliceLen = Math.min(this.slice, stepLenI, maxGrain)
    const snapTol = Math.round((SNAP_TOL_MS / 1000) * this.sr)
    const prob = (amount / 100) * MAX_PROB

    // --- 再同期: host の拍位置と自走位置のズレが大きければスナップ（シーク/ループ/再生開始） ---
    const hostBarPos = glitchPhase * samplesPerBar
    let d = hostBarPos - this.localBarPos
    d -= samplesPerBar * Math.round(d / samplesPerBar) // 最短差（小節折返し考慮）
    if (Math.abs(d) > snapTol) {
      this.localBarPos = hostBarPos
      this.prevStepIdx = -1 // 次サンプルで境界扱い→グレイン再ラッチ
      this.resync = this.fade // スナップのクリックをフェードで隠す
    }

    for (let i = 0; i < len; i++) {
      // 入力を履歴へ
      for (let ch = 0; ch < n; ch++) this.history[ch][this.histWrite] = io[ch][i]

      let stepIdx = Math.floor(this.localBarPos / stepLen)
      if (stepIdx < 0) stepIdx = 0
      else if (stepIdx >= STEPS) stepIdx = STEPS - 1
      const posInStep = this.localBarPos - stepIdx * stepLen

      if (stepIdx !== this.prevStepIdx) {
        this.prevStepIdx = stepIdx
        this.stepStartWrite = this.histWrite
        this.stepStutter = rand01(stepIdx * 2 + 2) < 0.5 // Random の選択をステップ単位で固定
      }
      const type = steps[stepIdx] ?? TYPE_DRY

      // 境界フェード（ステップ端で wet を 0 に絞ってクリック回避）＋スナップフェード
      const edge = Math.min(posInStep, stepLen - posInStep)
      let wetEnv = edge < this.fade ? edge / this.fade : 1
      if (this.resync > 0) {
        wetEnv *= 1 - this.resync / this.fade
        this.resync--
      }
      const wet = wetAmt * (wetEnv < 0 ? 0 : wetEnv)

      const pInt = Math.floor(posInStep)
      const sign = (this.histWrite & 1) === 0 ? 1 : -1

      for (let ch = 0; ch < n; ch++) {
        const hist = this.history[ch]
        const dry = io[ch][i]
        let fx = dry
        if (type === TYPE_REPEAT) {
          fx = this.grain(hist, subLen, pInt, H)
        } else if (type === TYPE_FREEZE) {
          fx = this.grain(hist, freezeLen, pInt, H)
        } else if (type === TYPE_REVERSE) {
          let p = pInt
          if (p >= revLen) p = revLen - 1
          fx = hist[mod(this.stepStartWrite - p, H)]
        } else if (type === TYPE_RANDOM) {
          if (prob <= 0) {
            fx = dry
          } else if (this.stepStutter) {
            fx = this.grain(hist, sliceLen, pInt, H) // stutter＝スライスループ
          } else {
            // gate: 中央で無音（端はフェード）。fill=スペクトル反転を差し込む。
            const gateGain = edge < this.fade ? edge / this.fade : 0
            if (fill) {
              const gateMix = 1 - gateGain
              fx = dry * (1 - gateMix) + dry * sign * FILL_LEVEL * gateMix
            } else {
              fx = dry * gateGain
            }
          }
        }
        io[ch][i] = dry * (1 - wet) + fx * wet
      }

      this.localBarPos += 1
      if (this.localBarPos >= samplesPerBar) this.localBarPos -= samplesPerBar
      this.histWrite++
      if (this.histWrite >= H) this.histWrite = 0
    }
  }

  // stepStartWrite で終わる grain 長のグレインを posInStep でループ読み（Repeat/Freeze/stutter 共通）。
  private grain(hist: Float32Array, grain: number, pInt: number, H: number): number {
    const g = pInt % grain
    return hist[mod(this.stepStartWrite - grain + 1 + g, H)]
  }
}

function mod(x: number, m: number): number {
  return ((x % m) + m) % m
}

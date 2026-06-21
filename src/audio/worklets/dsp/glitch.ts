// Glitch ステップシーケンサ（ブロック=隣接モデル）。横=16分ステップ(1小節)、縦=タイプ。
// 同一 enum の連続セル＝1ブロック（小節頭で必ず分割）。**ブロック幅＝その効果の長さ（継続長）**。
// BPM同期・拍ロック・再現性（パターンがループ＝毎回同じ箇所）。docs/DSP.md §3。
// type: 0 Dry / 1 Glitch(極短ラチェット) / 2 Freeze(保持) / 3 Reverse(幅=逆レンジ) / 4 Random
//       / 5 Mute(無音=Spectral Fill 差込) / 6 Repeat1/16 / 7 Repeat1/8 / 8 Repeat1/4（ビートリピート）。
// Repeat の chunk(1リピート長)はセルの分割＝per-placement。chunk<幅 で連続ループに聞こえる。
// 拍位置は App が positionSamples から算出した glitchPhase(0..1)。worklet は localBarPos をサンプル
// 精度で自走し、大ドリフト（シーク/ループ/再生開始）だけスナップ＝rAFジッタを音に入れない。

const SEED = 0x9e3779b9 | 0
const STEPS = 16

const TYPE_DRY = 0
const TYPE_GLITCH = 1
const TYPE_FREEZE = 2
const TYPE_REVERSE = 3
const TYPE_RANDOM = 4
const TYPE_MUTE = 5
const TYPE_REP16 = 6
const TYPE_REP8 = 7
const TYPE_REP4 = 8

const HISTORY_MS = 2000 // 履歴リング（Reverse/Repeat/Freeze 用。最遅BPMの 2×幅を確保）
const FREEZE_GRAIN_MS = 70 // Freeze の保持グレイン
const FADE_MS = 3 // 端/シームのフェード（クリック回避）
const SNAP_TOL_MS = 50 // これ以上ズレたら再同期スナップ
const FILL_LEVEL = 0.7 // Mute の Spectral Fill 差し込みレベル

// step index → [0,1) 決定論ハッシュ（Random の stutter/gate 選択。シードで再現性）。
function rand01(n: number): number {
  let t = (n ^ SEED) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function mod(x: number, m: number): number {
  return ((x % m) + m) % m
}

export class Glitch {
  private readonly sr: number
  private readonly historyLen: number
  private readonly fade: number
  private readonly freezeGrain: number
  private history: Float32Array[] = []
  private histWrite = 0
  private localBarPos = 0
  private prevStepIdx = -1
  // 現ブロックの確定状態（ブロック頭でラッチ）
  private blockType = TYPE_DRY
  private blockStartPos = 0 // 小節内サンプル位置（ブロック先頭）
  private blockStartWrite = 0 // 履歴の書込位置（grain 基準）
  private blockLen = 1 // ブロック長（=継続長、samples）
  private blockChunk = 1 // grain 系タイプの 1 リピート長
  private blockStutter = false // Random の stutter/gate 選択
  private resync = 0

  constructor(sr: number) {
    this.sr = sr
    this.historyLen = Math.max(1, Math.round((HISTORY_MS / 1000) * sr))
    this.fade = Math.max(1, Math.round((FADE_MS / 1000) * sr))
    this.freezeGrain = Math.max(1, Math.round((FREEZE_GRAIN_MS / 1000) * sr))
  }

  // io を in-place。amount=全体 wet(0..100), fill=Mute のスペクトル反転, steps=16 ステップ enum,
  // glitchPhase=小節内位相(0..1), bpm。
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
    const glitchSlice = Math.min(Math.max(1, Math.round(samplesPerBar / 32)), maxGrain) // 1/32 音符
    const fade = this.fade
    const snapTol = Math.round((SNAP_TOL_MS / 1000) * this.sr)

    // --- 再同期: host 拍位置と自走位置のズレが大きければスナップ ---
    const hostBarPos = glitchPhase * samplesPerBar
    let d = hostBarPos - this.localBarPos
    d -= samplesPerBar * Math.round(d / samplesPerBar)
    if (Math.abs(d) > snapTol) {
      this.localBarPos = hostBarPos
      this.prevStepIdx = -1 // 次サンプルでブロック再ラッチ
      this.resync = fade
    }

    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < n; ch++) this.history[ch][this.histWrite] = io[ch][i]

      let stepIdx = Math.floor(this.localBarPos / stepLen)
      if (stepIdx < 0) stepIdx = 0
      else if (stepIdx >= STEPS) stepIdx = STEPS - 1

      // ブロック境界（同一 enum ランの先頭 or 小節頭 or 再同期後）でラッチ
      if (stepIdx !== this.prevStepIdx) {
        const type = steps[stepIdx] ?? TYPE_DRY
        const prevCell = this.prevStepIdx === -1 || stepIdx === 0 ? -999 : (steps[stepIdx - 1] ?? 0)
        if (type !== prevCell) {
          this.blockType = type
          this.blockStartWrite = this.histWrite
          this.blockStartPos = stepIdx * stepLen
          let bs = 1
          for (let j = stepIdx + 1; j < STEPS; j++) {
            if ((steps[j] ?? 0) === type) bs++
            else break
          }
          this.blockLen = bs * stepLen
          this.blockStutter = rand01(stepIdx * 2 + 2) < 0.5
          // grain 系の 1 リピート長を確定
          let chunk = stepLenI
          if (type === TYPE_GLITCH || (type === TYPE_RANDOM && this.blockStutter))
            chunk = glitchSlice
          else if (type === TYPE_FREEZE) chunk = this.freezeGrain
          else if (type === TYPE_REP16) chunk = stepLenI
          else if (type === TYPE_REP8) chunk = 2 * stepLenI
          else if (type === TYPE_REP4) chunk = 4 * stepLenI
          this.blockChunk = Math.min(Math.max(1, chunk), maxGrain)
        }
        this.prevStepIdx = stepIdx
      }

      const type = this.blockType
      const blockPhase = this.localBarPos - this.blockStartPos
      const pf = Math.floor(blockPhase < 0 ? 0 : blockPhase)
      // 端フェード（ブロック端でのみ wet を絞る＝内部ステップ境界では絞らない）＋再同期フェード
      const edge = Math.min(blockPhase, this.blockLen - blockPhase)
      let edgeEnv = edge < fade ? edge / fade : 1
      if (edgeEnv < 0) edgeEnv = 0
      let rGain = 1
      if (this.resync > 0) {
        rGain = 1 - this.resync / fade
        this.resync--
      }
      const wet = wetAmt * edgeEnv * rGain // grain/reverse 系
      const gateWet = wetAmt * rGain // gate 系（端処理は gateGain 側）
      const sign = (this.histWrite & 1) === 0 ? 1 : -1
      // gate ゲイン（中央=0 無音、端 fade）
      let gateGain = 0
      if (blockPhase < fade) gateGain = 1 - blockPhase / fade
      else if (blockPhase > this.blockLen - fade)
        gateGain = (blockPhase - (this.blockLen - fade)) / fade
      if (gateGain < 0) gateGain = 0
      else if (gateGain > 1) gateGain = 1
      const chunk = this.blockChunk
      const revLen = Math.min(this.blockLen | 0 || 1, maxGrain)

      for (let ch = 0; ch < n; ch++) {
        const hist = this.history[ch]
        const dry = io[ch][i]
        let out = dry
        if (type === TYPE_DRY) {
          out = dry
        } else if (type === TYPE_MUTE) {
          const fx = fill
            ? dry * gateGain + dry * sign * FILL_LEVEL * (1 - gateGain)
            : dry * gateGain
          out = dry * (1 - gateWet) + fx * gateWet
        } else if (type === TYPE_RANDOM && !this.blockStutter) {
          out = dry * (1 - gateWet) + dry * gateGain * gateWet // gate（fill なし）
        } else if (type === TYPE_REVERSE) {
          let p = pf
          if (p >= revLen) p = revLen - 1
          out = dry * (1 - wet) + hist[mod(this.blockStartWrite - p, H)] * wet
        } else {
          // Glitch / Freeze / Repeat / Random(stutter): grain ループ
          out = dry * (1 - wet) + this.grain(hist, chunk, pf, H) * wet
        }
        io[ch][i] = out
      }

      this.localBarPos += 1
      if (this.localBarPos >= samplesPerBar) this.localBarPos -= samplesPerBar
      this.histWrite++
      if (this.histWrite >= H) this.histWrite = 0
    }
  }

  // blockStartWrite 終端の chunk グレインを phase でループ読み（シーム crossfade でクリック回避）。
  private grain(hist: Float32Array, chunk: number, pf: number, H: number): number {
    const fade = this.fade
    const base = this.blockStartWrite - chunk + 1
    const g = pf % chunk
    let s = hist[mod(base + g, H)]
    if (chunk > 2 * fade && g >= chunk - fade) {
      const t = (chunk - g) / fade
      s = s * t + hist[mod(base + (g - (chunk - fade)), H)] * (1 - t)
    }
    return s
  }
}

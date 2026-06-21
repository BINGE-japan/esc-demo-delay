// Glitch ステップシーケンサ（ブロック=隣接モデル）。横=16分ステップ(1小節)、縦=タイプ。
// 同一 enum の連続セル＝1ブロック（小節頭で必ず分割）。**ブロック幅＝その効果の長さ（継続長）**。
// BPM同期・拍ロック・再現性（パターンがループ＝毎回同じ箇所）。docs/DSP.md §3。
// type: 0 Dry / 1 Glitch(極短ラチェット) / 2 Freeze(グラニュラー保持) / 3 Reverse(幅=逆レンジ)
//       / 4 Random(ステップ毎に再抽選) / 5 Mute(無音=Spectral Fill 差込)
//       / 6 Repeat1/16 / 7 Repeat1/8 / 8 Repeat1/4（ビートリピート）。
// Repeat の chunk(1リピート長)はセルの分割＝per-placement。chunk<幅 で連続ループに聞こえる。
// Freeze: ブロック頭で直近 FREEZE_REGION_MS を凍結バッファにスナップ→重なり合う窓化グレイン
//         （FREEZE_VOICES 声・読み位置ジッタ）で継ぎ目を消した持続音（≠スタッター）。docs/DSP.md §3。
// Random: ブロック幅=暴れる長さ。ステップ毎に seed=絶対step で {ラチェット/逆/ハーフ} を再抽選＝
//         毎1/16変化（≠均一ループの Repeat）。決定論なので再現性は保つ。
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
const FADE_MS = 3 // 端/シームのフェード（クリック回避）
const SNAP_TOL_MS = 50 // これ以上ズレたら再同期スナップ
const FILL_LEVEL = 0.7 // Mute の Spectral Fill 差し込みレベル

// Freeze（グラニュラー雲）。耳で確定した値（2026-06-21）。
const FREEZE_GRAIN_MS = 120 // グレイン長
const FREEZE_REGION_MS = 730 // 凍結スナップ域（この中から各グレインが読む）
const FREEZE_VOICES = 12 // 同時グレイン数（overlap=8 ＋丸め余裕）
const FREEZE_OVERLAP = 8 // 重なり数（hop=grain/overlap。多い=密=滑らか）
const FREEZE_JITTER_MS = 50 // 読み位置ジッタ（±）＝ループ周期を消す肝
const FREEZE_GAIN = 2.4 // 正規化後の音量トリム
// iceberg: **Freeze の wet 出力にのみ** 2-pole(12dB/oct) ハイパスで低域を落とす（他タイプ非適用）。
const FREEZE_HP_HZ = 310 // ハイパス カットオフ（耳で確定・固定）
const HP_K = 1.4142135623730951 // 1/Q = √2（Butterworth ダンピング）
const LUT_SIZE = 1024 // Hann 窓 LUT 解像度

// step index → [0,1) 決定論ハッシュ（Random の選択。シードで再現性）。
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
  private resync = 0
  // Random のマイクロ状態（ステップ毎に再ラッチ）
  private microStartPos = 0
  private microStartWrite = 0
  private microKind = 0
  // Freeze（グラニュラー）。
  private readonly freezeGrainLen: number
  private readonly freezeRegionLen: number
  private readonly freezeHop: number
  private readonly freezeJitter: number
  private readonly hannLut: Float32Array
  private freezeBuf: Float32Array[] = []
  private readonly vPos: Int32Array // -1=非アクティブ
  private readonly vStart: Int32Array // 凍結バッファ内の読み開始
  private freezeTimer = 0
  private freezeSeed = 0
  private freezeCount = 0
  // Freeze ハイパス（iceberg）。2-pole TPT SVF（係数は constructor で固定算出）。ch 毎状態。
  private hpIc1: number[] = []
  private hpIc2: number[] = []
  private readonly hpA1: number
  private readonly hpA2: number
  private readonly hpA3: number

  constructor(sr: number) {
    this.sr = sr
    this.historyLen = Math.max(1, Math.round((HISTORY_MS / 1000) * sr))
    this.fade = Math.max(1, Math.round((FADE_MS / 1000) * sr))
    this.freezeGrainLen = Math.max(2, Math.round((FREEZE_GRAIN_MS / 1000) * sr))
    this.freezeRegionLen = Math.max(
      this.freezeGrainLen + 1,
      Math.round((FREEZE_REGION_MS / 1000) * sr),
    )
    this.freezeHop = Math.max(1, Math.round(this.freezeGrainLen / FREEZE_OVERLAP))
    this.freezeJitter = Math.max(0, Math.round((FREEZE_JITTER_MS / 1000) * sr))
    this.hannLut = new Float32Array(LUT_SIZE + 1)
    for (let k = 0; k <= LUT_SIZE; k++)
      this.hannLut[k] = 0.5 * (1 - Math.cos((2 * Math.PI * k) / LUT_SIZE))
    this.vPos = new Int32Array(FREEZE_VOICES).fill(-1)
    this.vStart = new Int32Array(FREEZE_VOICES)
    const hpFc = Math.min(Math.max(20, FREEZE_HP_HZ), sr * 0.45)
    const hpG = Math.tan((Math.PI * hpFc) / sr)
    this.hpA1 = 1 / (1 + hpG * (hpG + HP_K))
    this.hpA2 = hpG * this.hpA1
    this.hpA3 = hpG * this.hpA2
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
    while (this.freezeBuf.length < n) this.freezeBuf.push(new Float32Array(this.freezeRegionLen))
    while (this.hpIc1.length < n) {
      this.hpIc1.push(0)
      this.hpIc2.push(0)
    }

    const wetAmt = amount <= 0 ? 0 : Math.min(1, amount / 100)
    const samplesPerBar = Math.max(1, (this.sr * 60 * 4) / Math.max(20, bpm))
    const stepLen = Math.max(1, samplesPerBar / STEPS)
    const stepLenI = Math.max(1, Math.floor(stepLen))
    const halfStep = Math.max(1, stepLenI >> 1)
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
          // grain 系の 1 リピート長を確定
          let chunk = stepLenI
          if (type === TYPE_GLITCH) chunk = glitchSlice
          else if (type === TYPE_REP16) chunk = stepLenI
          else if (type === TYPE_REP8) chunk = 2 * stepLenI
          else if (type === TYPE_REP4) chunk = 4 * stepLenI
          this.blockChunk = Math.min(Math.max(1, chunk), maxGrain)
          if (type === TYPE_FREEZE) this.snapshotFreeze(n, H, stepIdx)
        }
        // Random はブロック内でもステップ毎に再抽選（width=暴れる長さ、中身は毎step変化）
        if (this.blockType === TYPE_RANDOM) {
          this.microStartPos = stepIdx * stepLen
          this.microStartWrite = this.histWrite
          this.microKind = Math.floor(rand01(stepIdx * 101 + 7) * 3) // 0 ラチェット/1 逆/2 ハーフ
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
      const wet = wetAmt * edgeEnv * rGain // grain/reverse/freeze 系
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

      // Random のマイクロ位相・端フェード（ステップ単位）
      const microPhase = this.localBarPos - this.microStartPos
      const mpf = microPhase < 0 ? 0 : Math.floor(microPhase)
      const mEdge = Math.min(microPhase, stepLen - microPhase)
      let microEnv = mEdge < fade ? mEdge / fade : 1
      if (microEnv < 0) microEnv = 0
      const wetR = wetAmt * microEnv * rGain

      // Freeze グレイン発火（チャンネル非依存・1サンプル1回）
      if (type === TYPE_FREEZE && this.freezeTimer <= 0) {
        this.spawnFreezeGrain()
        this.freezeTimer += this.freezeHop
      }

      for (let ch = 0; ch < n; ch++) {
        const hist = this.history[ch]
        const dry = io[ch][i]
        let out = dry
        if (type === TYPE_DRY) {
          out = dry
        } else if (type === TYPE_FREEZE) {
          const frz = this.freezeHpProcess(ch, this.freezeRead(ch) * FREEZE_GAIN)
          out = dry * (1 - wet) + frz * wet
        } else if (type === TYPE_MUTE) {
          const fx = fill
            ? dry * gateGain + dry * sign * FILL_LEVEL * (1 - gateGain)
            : dry * gateGain
          out = dry * (1 - gateWet) + fx * gateWet
        } else if (type === TYPE_RANDOM) {
          let g: number
          if (this.microKind === 1) {
            let p = mpf
            if (p >= stepLenI) p = stepLenI - 1
            g = hist[mod(this.microStartWrite - p, H)] // 逆再生（ステップ幅）
          } else {
            const c = this.microKind === 0 ? glitchSlice : halfStep // ラチェット / ハーフ
            g = this.grain(hist, this.microStartWrite, Math.min(c, maxGrain), mpf, H)
          }
          out = dry * (1 - wetR) + g * wetR
        } else if (type === TYPE_REVERSE) {
          let p = pf
          if (p >= revLen) p = revLen - 1
          out = dry * (1 - wet) + hist[mod(this.blockStartWrite - p, H)] * wet
        } else {
          // Glitch / Repeat: grain ループ
          out = dry * (1 - wet) + this.grain(hist, this.blockStartWrite, chunk, pf, H) * wet
        }
        io[ch][i] = out
      }

      // Freeze ボイス前進（チャンネル非依存・1サンプル1回）
      if (type === TYPE_FREEZE) {
        for (let v = 0; v < FREEZE_VOICES; v++) {
          if (this.vPos[v] < 0) continue
          this.vPos[v]++
          if (this.vPos[v] >= this.freezeGrainLen) this.vPos[v] = -1
        }
        this.freezeTimer--
      }

      this.localBarPos += 1
      if (this.localBarPos >= samplesPerBar) this.localBarPos -= samplesPerBar
      this.histWrite++
      if (this.histWrite >= H) this.histWrite = 0
    }
  }

  // baseWrite 終端の chunk グレインを phase でループ読み（シーム crossfade でクリック回避）。
  private grain(
    hist: Float32Array,
    baseWrite: number,
    chunk: number,
    pf: number,
    H: number,
  ): number {
    const fade = this.fade
    const base = baseWrite - chunk + 1
    const g = pf % chunk
    let s = hist[mod(base + g, H)]
    if (chunk > 2 * fade && g >= chunk - fade) {
      const t = (chunk - g) / fade
      s = s * t + hist[mod(base + (g - (chunk - fade)), H)] * (1 - t)
    }
    return s
  }

  // ブロック頭で直近 FREEZE_REGION_MS を凍結バッファへ複写し、ボイスをリセット（決定論 seed）。
  private snapshotFreeze(n: number, H: number, stepIdx: number): void {
    const R = this.freezeRegionLen
    for (let ch = 0; ch < n; ch++) {
      const hist = this.history[ch]
      const buf = this.freezeBuf[ch]
      const base = this.histWrite - R + 1
      for (let k = 0; k < R; k++) buf[k] = hist[mod(base + k, H)]
    }
    for (let v = 0; v < FREEZE_VOICES; v++) this.vPos[v] = -1
    this.freezeTimer = 0
    this.freezeSeed = stepIdx
    this.freezeCount = 0
  }

  // 空きボイスに新グレインを割り当て（読み位置を中央±ジッタで決定論抽選）。
  private spawnFreezeGrain(): void {
    let v = -1
    for (let k = 0; k < FREEZE_VOICES; k++)
      if (this.vPos[k] < 0) {
        v = k
        break
      }
    if (v < 0) return
    const center = (this.freezeRegionLen - this.freezeGrainLen) >> 1
    const r = rand01(this.freezeSeed * 131 + this.freezeCount++ + 1)
    let s = Math.round(center + (r * 2 - 1) * this.freezeJitter)
    const maxStart = this.freezeRegionLen - this.freezeGrainLen
    if (s < 0) s = 0
    else if (s > maxStart) s = maxStart
    this.vStart[v] = s
    this.vPos[v] = 0
  }

  // 全アクティブボイスを Hann 窓で重ね合わせ→**窓和で正規化**（包絡一定＝トレモロ/粒を抑制）。
  // 立ち上がり（少声）で割って増幅しないよう下限 floor=定常窓和の半分(≈overlap/4)でクランプ。
  private freezeRead(ch: number): number {
    const buf = this.freezeBuf[ch]
    const lut = this.hannLut
    const gl = this.freezeGrainLen
    let acc = 0
    let wsum = 0
    for (let v = 0; v < FREEZE_VOICES; v++) {
      const p = this.vPos[v]
      if (p < 0) continue
      const w = lut[((p / gl) * LUT_SIZE) | 0]
      acc += buf[this.vStart[v] + p] * w
      wsum += w
    }
    const floor = FREEZE_OVERLAP / 4 // ≈定常窓和(overlap/2)の半分
    return acc / (wsum > floor ? wsum : floor)
  }

  // Freeze 用 2-pole ハイパス（TPT SVF・ch 毎状態）。低域を落として iceberg 風に。
  private freezeHpProcess(ch: number, x: number): number {
    const v3 = x - this.hpIc2[ch]
    const v1 = this.hpA1 * this.hpIc1[ch] + this.hpA2 * v3
    const v2 = this.hpIc2[ch] + this.hpA2 * this.hpIc1[ch] + this.hpA3 * v3
    this.hpIc1[ch] = 2 * v1 - this.hpIc1[ch]
    this.hpIc2[ch] = 2 * v2 - this.hpIc2[ch]
    return x - HP_K * v1 - v2
  }
}

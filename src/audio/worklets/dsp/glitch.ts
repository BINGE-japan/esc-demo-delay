// Glitch ステップシーケンサ（ブロック=隣接モデル）。横=16分ステップ(bars=1/2/4 小節)、縦=タイプ。
// 同一 enum の連続セル＝1ブロック（パターン頭でのみ分割＝小節跨ぎ可）。**ブロック幅＝継続長**。
// BPM同期・拍ロック・再現性（パターン bars*16 がループ＝毎回同じ箇所）。docs/DSP.md §3。
// セル値(raw)= ベース型(下位3bit) | Dive(bit3=8)。ベース型は排他、Dive だけ重ねられる（モディファイア）。
// ベース: 0 Dry / 1 Glitch(極短ラチェット) / 2 Freeze(グラニュラー保持) / 3 Reverse(幅=逆レンジ)
//       / 4 Mute(無音) / 5 Repeat(16分ビートリピート)。Mute には Dive 不可（UI 側で排他）。
// Dive: ベース出力を「レコードストップ」で原音→1オクターブ下へ線形減速（セル長＝降下時間）。
// Freeze: ブロック頭で直近 FREEZE_REGION_MS を凍結バッファにスナップ→重なり合う窓化グレイン
//         （FREEZE_VOICES 声・読み位置ジッタ）で継ぎ目を消した持続音（≠スタッター）。docs/DSP.md §3。
// Random モード(トグル): グリッドを無視し、全ステップで seed=絶対step から {dry/ラチェット/逆/ハーフ}
//         を再抽選＝決定論ランダム（dry も混ざる・再現性あり）。
// 拍位置は App が positionSamples から算出した glitchPhase(0..1)。worklet は localPos をサンプル
// 精度で自走し、大ドリフト（シーク/ループ/再生開始）だけスナップ＝rAFジッタを音に入れない。

import { STEPS_PER_BAR, clampBars } from '../params'

const SEED = 0x9e3779b9 | 0

const TYPE_DRY = 0 // 空セル＝素通り
const TYPE_GLITCH = 1 // 極短ラチェット
const TYPE_FREEZE = 2 // グラニュラー保持
const TYPE_REVERSE = 3 // 幅=逆再生レンジ
const TYPE_MUTE = 4 // 無音
const TYPE_REPEAT = 5 // 16分ビートリピート
const BASE_MASK = 7 // raw 下位3bit＝ベース型
const DIVE_BIT = 8 // raw bit3＝Dive モディファイア

const HISTORY_MS = 2000 // 履歴リング（Reverse/Repeat/Freeze 用。最遅BPMの 2×幅を確保）
const FADE_MS = 3 // 端/シームのフェード（クリック回避）
const SNAP_TOL_MS = 50 // これ以上ズレたら再同期スナップ
const HOLD_MS = 150 // glitchPhase がこれだけ更新されなければ「停止」と見なし素通り
// Dive（レコードストップ）: 再生レートを 1→DIVE_END_RATE へ**線形減速**（原音→下方へ）。
const DIVE_OCT = 1 // 降下量（オクターブ・固定）。耳で確定（2026-06-21）
const DIVE_END_RATE = Math.pow(2, -DIVE_OCT) // 終端の再生レート（=0.5＝1オクターブ下）

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

// Freeze Ice Reverb（FDN拡散残響）。グラニュラー雲を励起源に Iceverb 風“コー”を作る。
// 入力ディフュージョン(allpass×2) → 4ライン FDN(Hadamard 直交・各FBに damping LP) → wet。
// 係数は block 毎に更新（Decay=FBゲイン / Diffuse=allpass係数 / Size=ライン長 / Tone=damping）。
const FV_LINES = 4
const FV_BASE_MS = [19.1, 26.7, 34.3, 41.9] // 各ライン基準遅延（相互素寄り・Size=中で）
const FV_AP_MS = [5.3, 7.9] // 入力ディフュージョン allpass の遅延
const FV_SIZE_MIN = 0.5 // Size=0 のライン長スケール
const FV_SIZE_MAX = 1.6 // Size=1 のライン長スケール（最大バッファ確保もこれ基準）
const FV_FB_MAX = 0.97 // FB ゲイン上限（Hadamard 直交 ⇒ ||≤1、<1 で BIBO 安定）
const FV_AP_MAX = 0.75 // allpass 係数上限
const FV_OUT = 0.5 // wet 出力トリム
// 耳で確定した Ice Reverb 係数（2026-06-21・元デバッグ param 291-295 を定数化）。
const FV_DECAY = 0.12 // テール長（FBゲイン）
const FV_DIFFUSE = 0.7 // 入力ディフュージョン（allpass 係数）
const FV_SIZE = 0.31 // ライン長スケール（小=金属的）
const FV_TONE = 0.73 // damping（高=高域残す=氷）
const FREEZE_VERB_MIX = 0.14 // グラニュラー雲 ⇄ FDN残響 のブレンド（残響量）

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
  private localPos = 0
  private prevStepIdx = -1
  // 現ブロックの確定状態（ブロック頭でラッチ）
  private blockType = TYPE_DRY
  private blockStartPos = 0 // 小節内サンプル位置（ブロック先頭）
  private blockStartWrite = 0 // 履歴の書込位置（grain 基準）
  private blockLen = 1 // ブロック長（=継続長、samples）
  private blockChunk = 1 // grain 系タイプの 1 リピート長
  private prevPhase = -1 // 直近の glitchPhase（停止検出用）
  private frozenSamples = 0 // glitchPhase が更新されずに経過したサンプル数
  private readonly holdSamples: number
  private blockDive = false // Dive モディファイアが立っているか（ブロック頭でラッチ）
  private diveDelay = 0 // Dive: 現在の読み遅れ（成長＝ピッチ降下）。ブロック頭で 0
  private diveWrite = 0 // Dive 出力バッファの書込位置
  private readonly diveBufLen: number
  private diveBuf: Float32Array[] = [] // Dive: ベース出力を貯めて遅らせ読み（ch 毎）
  private resync = 0
  // Random モードのマイクロ状態（ステップ毎に再ラッチ）
  private microStartPos = 0
  private microStartWrite = 0
  private microKind = 0
  private prevRandomMode = false
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
  // iceberg HP は 4-pole(24dB/oct)＝2-pole×2 直列。a/b の2セクション状態（ch 毎）。
  private hpIc1: number[] = []
  private hpIc2: number[] = []
  private hpIc1b: number[] = []
  private hpIc2b: number[] = []
  private readonly hpA1: number
  private readonly hpA2: number
  private readonly hpA3: number
  // Freeze Ice Reverb（FDN）。Freeze の wet を Iceverb 風“コー”にする残響。
  private readonly fverb: FreezeVerb

  constructor(sr: number) {
    this.sr = sr
    this.fverb = new FreezeVerb(sr)
    this.historyLen = Math.max(1, Math.round((HISTORY_MS / 1000) * sr))
    this.holdSamples = Math.max(1, Math.round((HOLD_MS / 1000) * sr))
    this.diveBufLen = Math.max(8, Math.floor(this.historyLen / 2) + 8) // diveDelay(≤maxGrain) を収容
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

  // io を in-place。steps=最大64 ステップ enum, glitchPhase=パターン内位相(0..1), bpm,
  // randomMode=グリッド無視の決定論ランダム, bars=ループ長(1/2/4 小節)。パターン長=bars*16。
  // Dive(タイプ6)はセル長で原音→1オクターブ下へ線形減速（レコードストップ）。
  // wet は常時フル（空セル=Dry で透過＝専用 wet ノブ不要。端フェードは内部で適用）。
  process(
    io: Float32Array[],
    steps: Int32Array,
    glitchPhase: number,
    bpm: number,
    randomMode: boolean,
    bars: number,
  ): void {
    const n = io.length
    if (n === 0) return
    const len = io[0].length
    const H = this.historyLen
    while (this.history.length < n) this.history.push(new Float32Array(H))
    while (this.freezeBuf.length < n) this.freezeBuf.push(new Float32Array(this.freezeRegionLen))
    while (this.diveBuf.length < n) this.diveBuf.push(new Float32Array(this.diveBufLen))
    while (this.hpIc1.length < n) {
      this.hpIc1.push(0)
      this.hpIc2.push(0)
      this.hpIc1b.push(0)
      this.hpIc2b.push(0)
    }
    // Freeze Ice Reverb: バッファを ch 分確保（係数は固定＝FreezeVerb の constructor で設定済み）。
    this.fverb.ensure(n)

    // 停止検出: glitchPhase が一定時間更新されない＝再生停止/タブ非アクティブ(rAF 停止)。
    // その間は glitch を素通り＝自走ループが stale 履歴を持続音化する（ビーー）のを防ぐ。
    // 履歴は更新して復帰に備える。
    if (glitchPhase === this.prevPhase) this.frozenSamples += len
    else {
      this.frozenSamples = 0
      this.prevPhase = glitchPhase
    }
    if (this.frozenSamples > this.holdSamples) {
      for (let i = 0; i < len; i++) {
        for (let ch = 0; ch < n; ch++) this.history[ch][this.histWrite] = io[ch][i]
        this.histWrite++
        if (this.histWrite >= H) this.histWrite = 0
      }
      return
    }

    const samplesPerBar = Math.max(1, (this.sr * 60 * 4) / Math.max(20, bpm))
    const stepLen = Math.max(1, samplesPerBar / STEPS_PER_BAR)
    const stepLenI = Math.max(1, Math.floor(stepLen))
    const halfStep = Math.max(1, stepLenI >> 1)
    const maxGrain = Math.max(1, Math.floor(H / 2))
    const glitchSlice = Math.min(Math.max(1, Math.round(samplesPerBar / 32)), maxGrain) // 1/32 音符
    const fade = this.fade
    const snapTol = Math.round((SNAP_TOL_MS / 1000) * this.sr)
    // ループ長: bars(1..MAX_BARS) 小節ぶんのパターン。stepLen は16分のまま、パターン全体で wrap。
    const patternSteps = clampBars(bars) * STEPS_PER_BAR
    const samplesPerPattern = patternSteps * stepLen

    // --- 再同期: host 位置と自走位置のズレが大きければスナップ（パターン長基準） ---
    const hostPos = glitchPhase * samplesPerPattern
    let d = hostPos - this.localPos
    d -= samplesPerPattern * Math.round(d / samplesPerPattern)
    if (Math.abs(d) > snapTol) {
      this.localPos = hostPos
      this.prevStepIdx = -1 // 次サンプルでブロック再ラッチ
      this.resync = fade
    }
    if (randomMode !== this.prevRandomMode) {
      this.prevRandomMode = randomMode
      this.prevStepIdx = -1 // モード切替で再ラッチ
    }

    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < n; ch++) this.history[ch][this.histWrite] = io[ch][i]

      let stepIdx = Math.floor(this.localPos / stepLen)
      if (stepIdx < 0) stepIdx = 0
      else if (stepIdx >= patternSteps) stepIdx = patternSteps - 1

      // ステップ境界でラッチ。Random モードは毎ステップ再抽選、通常はブロック(隣接ラン)頭で確定。
      if (stepIdx !== this.prevStepIdx) {
        if (randomMode) {
          this.microStartPos = stepIdx * stepLen
          this.microStartWrite = this.histWrite
          // 0 dry / 1 ラチェット / 2 逆 / 3 ハーフ（dry も抽選で混ざる）
          this.microKind = Math.floor(rand01(stepIdx * 101 + 7) * 4)
        } else {
          // raw= ベース型|Dive。隣接判定は raw 全体（Dive 違いは別ブロック）。
          const raw = steps[stepIdx] ?? 0
          // 直前ステップから1つだけ進んだ時のみ「隣接ラン継続」を判定。跳び/初回/パターン頭は
          // 必ず新ブロック頭として再ラッチ（stale な blockStartPos を引きずらない）。
          const consecutive = stepIdx === (this.prevStepIdx + 1) % patternSteps
          const prevCell = !consecutive || stepIdx === 0 ? -999 : (steps[stepIdx - 1] ?? 0)
          if (raw !== prevCell) {
            const type = raw & BASE_MASK
            this.blockType = type
            this.blockDive = (raw & DIVE_BIT) !== 0
            this.blockStartWrite = this.histWrite
            this.blockStartPos = stepIdx * stepLen
            let bs = 1
            for (let j = stepIdx + 1; j < patternSteps; j++) {
              if ((steps[j] ?? 0) === raw) bs++
              else break
            }
            this.blockLen = bs * stepLen
            // grain 系の 1 リピート長: Glitch=1/32 固定スライス、Repeat=16分
            this.blockChunk = type === TYPE_GLITCH ? glitchSlice : Math.min(stepLenI, maxGrain)
            if (type === TYPE_FREEZE) this.snapshotFreeze(n, H, stepIdx)
            if (this.blockDive) {
              this.diveDelay = 0 // 読み遅れと出力バッファをブロック頭でリセット
              this.diveWrite = 0
            }
          }
        }
        this.prevStepIdx = stepIdx
      }

      const type = this.blockType
      const blockPhase = this.localPos - this.blockStartPos
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
      const wet = edgeEnv * rGain // grain/reverse/freeze 系（フル wet ×端フェード×再同期）
      const gateWet = rGain // gate 系（端処理は gateGain 側）
      // gate ゲイン（中央=0 無音、端 fade）
      let gateGain = 0
      if (blockPhase < fade) gateGain = 1 - blockPhase / fade
      else if (blockPhase > this.blockLen - fade)
        gateGain = (blockPhase - (this.blockLen - fade)) / fade
      if (gateGain < 0) gateGain = 0
      else if (gateGain > 1) gateGain = 1
      const chunk = this.blockChunk
      const revLen = Math.min(this.blockLen | 0 || 1, maxGrain)

      // Dive（レコードストップ）モディファイア: ベース出力を diveBuf に貯め、ブロック位相 p で
      // 再生レートを 1→DIVE_END_RATE へ線形減速（原音→1オクターブ下・上振れなし）して遅らせ読み。
      let diveRate = 1
      let diveI0 = 0
      let diveFrac = 0
      if (!randomMode && this.blockDive) {
        const dp =
          this.blockLen > 0 ? Math.min(1, (blockPhase < 0 ? 0 : blockPhase) / this.blockLen) : 0
        diveRate = 1 - (1 - DIVE_END_RATE) * dp
        const readPos = this.diveWrite - this.diveDelay
        diveI0 = Math.floor(readPos)
        diveFrac = readPos - diveI0
      }

      // Random モードのマイクロ位相・端フェード（ステップ単位）
      const microPhase = this.localPos - this.microStartPos
      const mpf = microPhase < 0 ? 0 : Math.floor(microPhase)
      const mEdge = Math.min(microPhase, stepLen - microPhase)
      let microEnv = mEdge < fade ? mEdge / fade : 1
      if (microEnv < 0) microEnv = 0
      const wetR = microEnv * rGain

      // Freeze グレイン発火（block モードで Freeze の時のみ・チャンネル非依存・1サンプル1回）。
      // 空きボイスが無ければ timer を進めず次サンプルで再試行（hop の取りこぼし＝密度ムラ回避）。
      if (!randomMode && type === TYPE_FREEZE && this.freezeTimer <= 0 && this.spawnFreezeGrain()) {
        this.freezeTimer += this.freezeHop
      }

      for (let ch = 0; ch < n; ch++) {
        const hist = this.history[ch]
        const dry = io[ch][i]
        let out = dry
        if (randomMode) {
          // 毎ステップ抽選: 0 dry / 1 ラチェット / 2 逆 / 3 ハーフ
          if (this.microKind === 0) {
            out = dry
          } else if (this.microKind === 2) {
            let p = mpf
            if (p >= stepLenI) p = stepLenI - 1
            out = dry * (1 - wetR) + hist[mod(this.microStartWrite - p, H)] * wetR // 逆再生
          } else {
            const c = this.microKind === 1 ? glitchSlice : halfStep // ラチェット / ハーフ
            const g = this.grain(hist, this.microStartWrite, Math.min(c, maxGrain), mpf, H)
            out = dry * (1 - wetR) + g * wetR
          }
        } else if (type === TYPE_DRY) {
          out = dry
        } else if (type === TYPE_FREEZE) {
          // グラニュラー雲（励起源）→ FDN残響 → Mix でブレンド → iceberg HP。
          const src = this.freezeRead(ch) * FREEZE_GAIN
          const rev = this.fverb.process(ch, src)
          const frz = this.freezeHpProcess(ch, src * (1 - FREEZE_VERB_MIX) + rev * FREEZE_VERB_MIX)
          out = dry * (1 - wet) + frz * wet
        } else if (type === TYPE_MUTE) {
          out = dry * (1 - gateWet) + dry * gateGain * gateWet // 中央=無音・両端フェード
        } else if (type === TYPE_REVERSE) {
          let p = pf
          if (p >= revLen) p = revLen - 1
          out = dry * (1 - wet) + hist[mod(this.blockStartWrite - p, H)] * wet
        } else if (type === TYPE_GLITCH || type === TYPE_REPEAT) {
          // grain ループ（chunk は latch で確定: Glitch=1/32 固定 / Repeat=16分）
          out = dry * (1 - wet) + this.grain(hist, this.blockStartWrite, chunk, pf, H) * wet
        }
        // Dive モディファイア: ベース出力を貯めて遅らせ読み＝降下（重ねがけ）
        if (!randomMode && this.blockDive) {
          const D = this.diveBuf[ch]
          const DL = this.diveBufLen
          D[this.diveWrite] = out
          out = D[mod(diveI0, DL)] * (1 - diveFrac) + D[mod(diveI0 + 1, DL)] * diveFrac
        }
        io[ch][i] = out
      }

      // Freeze ボイス前進（block モードで Freeze の時のみ・チャンネル非依存・1サンプル1回）
      if (!randomMode && type === TYPE_FREEZE) {
        for (let v = 0; v < FREEZE_VOICES; v++) {
          if (this.vPos[v] < 0) continue
          this.vPos[v]++
          if (this.vPos[v] >= this.freezeGrainLen) this.vPos[v] = -1
        }
        this.freezeTimer--
      }
      // Dive 読み遅れ前進（diveBuf 書込は +1/sample、読みは rate＝(1−rate) ずつ遅れ＝降下）
      if (!randomMode && this.blockDive) {
        this.diveDelay += 1 - diveRate
        const cap = Math.min(maxGrain, this.diveBufLen - 2)
        if (this.diveDelay > cap) this.diveDelay = cap
        this.diveWrite++
        if (this.diveWrite >= this.diveBufLen) this.diveWrite = 0
      }

      this.localPos += 1
      if (this.localPos >= samplesPerPattern) this.localPos -= samplesPerPattern
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

  // ブロック頭で直近 FREEZE_REGION_MS を凍結バッファへ複写し、ボイス・HP をリセット（決定論 seed）。
  private snapshotFreeze(n: number, H: number, stepIdx: number): void {
    const R = this.freezeRegionLen
    for (let ch = 0; ch < n; ch++) {
      const hist = this.history[ch]
      const buf = this.freezeBuf[ch]
      const base = this.histWrite - R + 1
      for (let k = 0; k < R; k++) buf[k] = hist[mod(base + k, H)]
      // iceberg HP を初期化＝Freeze 再開ごとに無入力状態から始める（onset クリック回避）
      this.hpIc1[ch] = 0
      this.hpIc2[ch] = 0
      this.hpIc1b[ch] = 0
      this.hpIc2b[ch] = 0
    }
    for (let v = 0; v < FREEZE_VOICES; v++) this.vPos[v] = -1
    this.freezeTimer = 0
    this.freezeSeed = stepIdx
    this.freezeCount = 0
    this.fverb.reset(n) // 残響テールを引きずらない（凍結ごとにクリーンスタート）
  }

  // 空きボイスに新グレインを割り当て（読み位置を中央±ジッタで決定論抽選）。空きが無ければ false。
  private spawnFreezeGrain(): boolean {
    let v = -1
    for (let k = 0; k < FREEZE_VOICES; k++)
      if (this.vPos[k] < 0) {
        v = k
        break
      }
    if (v < 0) return false
    const center = (this.freezeRegionLen - this.freezeGrainLen) >> 1
    const r = rand01(this.freezeSeed * 131 + this.freezeCount++ + 1)
    let s = Math.round(center + (r * 2 - 1) * this.freezeJitter)
    const maxStart = this.freezeRegionLen - this.freezeGrainLen
    if (s < 0) s = 0
    else if (s > maxStart) s = maxStart
    this.vStart[v] = s
    this.vPos[v] = 0
    return true
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

  // Freeze 用 4-pole(24dB/oct) ハイパス＝2-pole Butterworth TPT SVF×2 直列（ch 毎状態）。
  // 12dB/oct ではローが残る指摘→ 310Hz コーナーのまま低域をしっかり落とす（iceberg）。
  private freezeHpProcess(ch: number, x: number): number {
    let v3 = x - this.hpIc2[ch]
    let v1 = this.hpA1 * this.hpIc1[ch] + this.hpA2 * v3
    let v2 = this.hpIc2[ch] + this.hpA2 * this.hpIc1[ch] + this.hpA3 * v3
    this.hpIc1[ch] = 2 * v1 - this.hpIc1[ch]
    this.hpIc2[ch] = 2 * v2 - this.hpIc2[ch]
    const y1 = x - HP_K * v1 - v2
    v3 = y1 - this.hpIc2b[ch]
    v1 = this.hpA1 * this.hpIc1b[ch] + this.hpA2 * v3
    v2 = this.hpIc2b[ch] + this.hpA2 * this.hpIc1b[ch] + this.hpA3 * v3
    this.hpIc1b[ch] = 2 * v1 - this.hpIc1b[ch]
    this.hpIc2b[ch] = 2 * v2 - this.hpIc2b[ch]
    return y1 - HP_K * v1 - v2
  }
}

// Freeze Ice Reverb（FDN 拡散残響）。励起源（グラニュラー雲）を入れると Iceverb 風の“コー”を返す。
// 入力ディフュージョン(Schroeder allpass×2) → 4ライン FDN（Hadamard 直交フィードバック・各FBに
// 1-pole damping）。Hadamard は直交＝||=1 なので FB ゲイン<1 で BIBO 安定。係数は block 毎に更新。
class FreezeVerb {
  private readonly sr: number
  private readonly maxLen: number[] // 各ライン最大バッファ長（Size_MAX 基準）
  private readonly apLen: number[] // allpass 遅延長
  private dl: Float32Array[][] = [] // [ch][line] ディレイのリングバッファ
  private dlPos: Int32Array[] = [] // [ch] 各ラインの write 位置
  private apBuf: Float32Array[][] = [] // [ch][ap] allpass のリングバッファ
  private apPos: Int32Array[] = [] // [ch] 各 allpass の位置
  private lp: Float32Array[] = [] // [ch] 各ライン damping LP 状態
  private readonly len: Int32Array // 現在のライン長（Size 反映・int）
  private g = 0.8 // FB ゲイン（Decay）
  private apG = 0.6 // allpass 係数（Diffuse）
  private dampC = 0.8 // damping LP 係数（Tone。1=高域残す/氷, 小=暗い）

  constructor(sr: number) {
    this.sr = sr
    this.maxLen = FV_BASE_MS.map((ms) =>
      Math.max(4, Math.round((ms / 1000) * sr * FV_SIZE_MAX) + 4),
    )
    this.apLen = FV_AP_MS.map((ms) => Math.max(2, Math.round((ms / 1000) * sr)))
    this.len = new Int32Array(FV_LINES)
    for (let k = 0; k < FV_LINES; k++) this.len[k] = Math.round((FV_BASE_MS[k] / 1000) * sr)
    this.setParams(FV_DECAY, FV_DIFFUSE, FV_SIZE, FV_TONE) // 固定係数（耳で確定 2026-06-21）
  }

  // ch 分のバッファを確保（lazy）。
  ensure(n: number): void {
    while (this.dl.length < n) {
      this.dl.push(this.maxLen.map((L) => new Float32Array(L)))
      this.dlPos.push(new Int32Array(FV_LINES))
      this.apBuf.push(this.apLen.map((L) => new Float32Array(L)))
      this.apPos.push(new Int32Array(FV_AP_MS.length))
      this.lp.push(new Float32Array(FV_LINES))
    }
  }

  // block 毎: 0..1 のデバッグ値から係数を更新。
  setParams(decay: number, diffuse: number, size: number, tone: number): void {
    const cl = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
    this.g = cl(decay) * FV_FB_MAX
    this.apG = cl(diffuse) * FV_AP_MAX
    const sc = FV_SIZE_MIN + (FV_SIZE_MAX - FV_SIZE_MIN) * cl(size)
    for (let k = 0; k < FV_LINES; k++) {
      let L = Math.round((FV_BASE_MS[k] / 1000) * this.sr * sc)
      if (L < 2) L = 2
      else if (L > this.maxLen[k] - 1) L = this.maxLen[k] - 1
      this.len[k] = L
    }
    this.dampC = 0.05 + 0.95 * cl(tone) // 高=高域を残す（明るい/氷）/ 低=高域減衰（暗い）
  }

  // 凍結スナップ毎にリセット（前テールを引きずらない）。
  reset(n: number): void {
    this.ensure(n)
    for (let ch = 0; ch < n; ch++) {
      for (let k = 0; k < FV_LINES; k++) {
        this.dl[ch][k].fill(0)
        this.dlPos[ch][k] = 0
        this.lp[ch][k] = 0
      }
      for (let a = 0; a < FV_AP_MS.length; a++) {
        this.apBuf[ch][a].fill(0)
        this.apPos[ch][a] = 0
      }
    }
  }

  // 1 サンプル処理。x=励起（グラニュラー雲）。返り=残響 wet。
  process(ch: number, x: number): number {
    // 入力ディフュージョン（直列 Schroeder allpass×2）
    let s = x
    for (let a = 0; a < FV_AP_MS.length; a++) {
      const buf = this.apBuf[ch][a]
      const L = this.apLen[a]
      let p = this.apPos[ch][a]
      const d = buf[p]
      const y = -this.apG * s + d
      buf[p] = s + this.apG * y
      p++
      if (p >= L) p = 0
      this.apPos[ch][a] = p
      s = y
    }
    // FDN: 各ライン遅延読み → 1-pole damping LP
    const dl = this.dl[ch]
    const pos = this.dlPos[ch]
    const lp = this.lp[ch]
    const c = this.dampC
    lp[0] += c * (dl[0][mod(pos[0] - this.len[0], this.maxLen[0])] - lp[0])
    lp[1] += c * (dl[1][mod(pos[1] - this.len[1], this.maxLen[1])] - lp[1])
    lp[2] += c * (dl[2][mod(pos[2] - this.len[2], this.maxLen[2])] - lp[2])
    lp[3] += c * (dl[3][mod(pos[3] - this.len[3], this.maxLen[3])] - lp[3])
    const r0 = lp[0]
    const r1 = lp[1]
    const r2 = lp[2]
    const r3 = lp[3]
    // Hadamard 4×4 × 0.5（直交＝エネルギー保存）でフィードバックを混ぜる
    const m0 = 0.5 * (r0 + r1 + r2 + r3)
    const m1 = 0.5 * (r0 - r1 + r2 - r3)
    const m2 = 0.5 * (r0 + r1 - r2 - r3)
    const m3 = 0.5 * (r0 - r1 - r2 + r3)
    const g = this.g
    dl[0][pos[0]] = s + g * m0
    dl[1][pos[1]] = s + g * m1
    dl[2][pos[2]] = s + g * m2
    dl[3][pos[3]] = s + g * m3
    for (let k = 0; k < FV_LINES; k++) {
      pos[k]++
      if (pos[k] >= this.maxLen[k]) pos[k] = 0
    }
    return (r0 + r1 + r2 + r3) * FV_OUT
  }
}

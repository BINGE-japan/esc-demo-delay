// Glitch ステップシーケンサ（ブロック=隣接モデル）。横=16分ステップ(bars=1/2/4 小節)、縦=タイプ。
// 同一 enum の連続セル＝1ブロック（パターン頭でのみ分割＝小節跨ぎ可）。**ブロック幅＝継続長**。
// BPM同期・拍ロック・再現性（パターン bars*16 がループ＝毎回同じ箇所）。docs/DSP.md §3。
// セル値(raw)= ベース型(下位3bit) | Dive(bit3=8)。ベース型は排他、Dive だけ重ねられる（モディファイア）。
// ベース: 0 Dry / 1 Glitch(極短ラチェット) / 2 Freeze(短チャンクのフェード付きループ) / 3 Reverse(幅=逆レンジ)
//       / 4 Mute(無音) / 5 Repeat(16分ビートリピート)。Mute には Dive 不可（UI 側で排他）。
// Dive: ベース出力を「レコードストップ」で原音→1オクターブ下へ線形減速（セル長＝降下時間）。
// Freeze: ブロック頭で直近 1/32 音符を掴み、シーム crossfade でループ＝持続音。＋原音追従ゲイン
//         ＋iceberg HP(EQ)＋白色ノイズ(エア)。docs/DSP.md §3。
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

// Freeze（フェード付きリピート）: ブロック頭で短チャンク(FREEZE_LOOP_MS)を掴み、**オーバーラップ
// クロスフェード**でループ。2読み位置を L/2 ずらし Hann 窓（50%重なりで和=1）で混ぜる＝
// 包絡が平坦化＝アタックの連打が薄れる。短く（ループ周期>可聴ピッチ）するほど持続トーン寄り。
const FREEZE_LOOP_MS = 126 // 掴むチャンク長（耳で確定 2026-06-22）
const FREEZE_LOOP_MAX_MS = 160 // ループバッファ上限（FREEZE_LOOP_MS を収容）
// 後段 EQ（Freeze の wet にのみ）: HP370 → ピーク1.2k(+14dB Q2.2) → ハイシェルフ3k(-7.2dB Q1)。RBJ biquad ×3。
const FREEZE_HP_HZ = 370 // ハイパス（耳で確定 2026-06-22）
const FREEZE_PEAK_HZ = 1200
const FREEZE_PEAK_DB = 14
const FREEZE_PEAK_Q = 2.2
const FREEZE_SHELF_HZ = 3000
const FREEZE_SHELF_DB = -7.2
const FREEZE_SHELF_Q = 1
// 白色→**ピンクノイズ**（-3dB/oct）に変更（Paul Kellet economy・3-pole 近似）。HP 後に効く分を補うスケール。
const FREEZE_PINK_SCALE = 0.5 // ピンク化後の音量トリム（耳調整・要再試聴）
// Freeze の音量＝**原音(dry)の大きさに追従**（凍結中身依存で音量がバラつく問題への対処）:
//   出力 = loop × frzGain、frzGain = Level × inEnv / frzEnv（出力を inEnv×Level に正規化・上限クランプ）。
//   ⇒ どんな入力でも Freeze は「原音の大きさ × Level」で一定。耳で確定（2026-06-22）。
const FREEZE_LEVEL = 0.55 // Freeze 音量（原音比）
const FREEZE_NOISE = 0.28 // ピンクノイズのエア量
const FREEZE_ENV_ATK_MS = 15 // 入力/Freeze 包絡フォロワの attack
const FREEZE_ENV_REL_MS = 200 // 同 release（追従の滑らかさ＝ポンプ抑制）
const FREEZE_MAKEUP_MAX = 6 // 入力追従ゲイン上限（無音域での暴走防止・約+15dB）

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
  // Freeze（フェード付きリピート）: 短チャンクを crossfade ループ。
  private readonly freezeBufLen: number
  private freezeBuf: Float32Array[] = [] // 掴んだチャンク（ch 毎）
  private freezeLoopLen = 1 // 現ループ長（=1/32 音符・snapshot で確定）
  private freezePos = 0 // ループ読み位置
  // Freeze 音量を原音(dry)に追従させる包絡（音量を入力に合わせて一定化）。
  private inEnv = 0 // live dry 入力の包絡
  private frzEnv = 0 // Freeze 出力(crush後・正規化前)の包絡
  private readonly frzEnvAtk: number
  private readonly frzEnvRel: number
  private noiseState = 0x12345678 | 0 // Freeze エア用 ノイズ PRNG（xorshift32）→ pink 化
  private pinkB: Float64Array[] = [] // ピンクノイズ整形フィルタ状態（ch 毎・3-pole Kellet）
  // Freeze 後段 EQ（HP370 → ピーク1.2k → ハイシェルフ3k。RBJ biquad ×3）。
  private readonly eq: FreezeEq

  constructor(sr: number) {
    this.sr = sr
    this.historyLen = Math.max(1, Math.round((HISTORY_MS / 1000) * sr))
    this.holdSamples = Math.max(1, Math.round((HOLD_MS / 1000) * sr))
    this.diveBufLen = Math.max(8, Math.floor(this.historyLen / 2) + 8) // diveDelay を収容
    this.fade = Math.max(1, Math.round((FADE_MS / 1000) * sr))
    this.freezeBufLen = Math.max(8, Math.round((FREEZE_LOOP_MAX_MS / 1000) * sr) + 4)
    this.frzEnvAtk = 1 - Math.exp(-1 / ((FREEZE_ENV_ATK_MS / 1000) * sr))
    this.frzEnvRel = 1 - Math.exp(-1 / ((FREEZE_ENV_REL_MS / 1000) * sr))
    this.eq = new FreezeEq(sr)
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
    while (this.freezeBuf.length < n) this.freezeBuf.push(new Float32Array(this.freezeBufLen))
    while (this.diveBuf.length < n) this.diveBuf.push(new Float32Array(this.diveBufLen))
    while (this.pinkB.length < n) this.pinkB.push(new Float64Array(3))
    this.eq.ensure(n)
    // Freeze 音量倍率（出力 = 原音包絡 × ratio）とノイズ（エア）量＝耳で確定し定数化。
    const freezeRatio = FREEZE_LEVEL
    const noiseAmt = FREEZE_NOISE

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
    // Freeze の掴むチャンク長（FREEZE_LOOP_MS・バッファ上限でクランプ）。snapshot で確定。
    const freezeLoopSamples = Math.min(
      this.freezeBufLen - 1,
      Math.max(4, Math.round((FREEZE_LOOP_MS / 1000) * this.sr)),
    )
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
      let inPk = 0
      for (let ch = 0; ch < n; ch++) {
        this.history[ch][this.histWrite] = io[ch][i]
        const a = io[ch][i] < 0 ? -io[ch][i] : io[ch][i]
        if (a > inPk) inPk = a
      }
      // 原音(dry)の包絡を追従（Freeze 音量の基準）。
      this.inEnv += (inPk > this.inEnv ? this.frzEnvAtk : this.frzEnvRel) * (inPk - this.inEnv)

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
            if (type === TYPE_FREEZE) this.snapshotFreeze(n, H, freezeLoopSamples)
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

      // Freeze 音量を原音(dry)包絡に追従させるゲイン（frzEnv で正規化・上限クランプ）。
      // ノイズも同じ「原音 × ratio」基準で乗せる＝量が一定（浮かない）。
      let frzGain = 0
      let noiseLevel = 0
      if (type === TYPE_FREEZE) {
        const denom = this.frzEnv > 1e-4 ? this.frzEnv : 1e-4
        frzGain = (freezeRatio * this.inEnv) / denom
        if (frzGain > FREEZE_MAKEUP_MAX) frzGain = FREEZE_MAKEUP_MAX
        noiseLevel = freezeRatio * this.inEnv * noiseAmt
      }
      let freezePk = 0

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
          // 短チャンクを crossfade ループ → 原音追従ゲイン → ピンクノイズ(エア) → 後段 EQ。
          const loop = this.freezeLoopRead(ch)
          const a = loop < 0 ? -loop : loop
          if (a > freezePk) freezePk = a
          const air = this.nextPink(ch) * noiseLevel
          const frz = this.eq.process(ch, loop * frzGain + air)
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

      // Freeze ループ前進＋出力包絡更新（block モードで Freeze の時のみ・1サンプル1回）。
      if (!randomMode && type === TYPE_FREEZE) {
        this.frzEnv +=
          (freezePk > this.frzEnv ? this.frzEnvAtk : this.frzEnvRel) * (freezePk - this.frzEnv)
        this.freezePos++
        if (this.freezePos >= this.freezeLoopLen) this.freezePos = 0
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

  // ブロック頭で直近 loopLen サンプルを凍結バッファへ複写し、ループ位置・EQ・ピンク状態をリセット。
  private snapshotFreeze(n: number, H: number, loopLen: number): void {
    this.freezeLoopLen = loopLen
    for (let ch = 0; ch < n; ch++) {
      const hist = this.history[ch]
      const buf = this.freezeBuf[ch]
      const base = this.histWrite - loopLen // 直近 loopLen サンプルを掴む
      for (let k = 0; k < loopLen; k++) buf[k] = hist[mod(base + k, H)]
      this.eq.reset(ch) // EQ を無入力状態から（onset クリック回避）
      this.pinkB[ch][0] = 0
      this.pinkB[ch][1] = 0
      this.pinkB[ch][2] = 0
    }
    this.freezePos = 0
    this.frzEnv = this.inEnv // 追従ゲインの暖機（onset を原音レベルから始める）
  }

  // 掴んだチャンクをオーバーラップ・クロスフェードでループ読み。2読み位置を L/2 ずらし、Hann 窓
  // （w1+w2=1 になる位相）で混ぜる＝継ぎ目のクリックも、チャンク自身のアタック起伏も平坦化する。
  private freezeLoopRead(ch: number): number {
    const buf = this.freezeBuf[ch]
    const L = this.freezeLoopLen
    const g = this.freezePos
    let g2 = g + (L >> 1) // 半周ずらした第2読み位置
    if (g2 >= L) g2 -= L
    const c = Math.cos((2 * Math.PI * g) / L)
    const w1 = 0.5 * (1 - c) // Hann(g)
    const w2 = 0.5 * (1 + c) // Hann(g + L/2)＝w1 の半周ずれ（w1+w2=1）
    return buf[g] * w1 + buf[g2] * w2
  }

  // ピンクノイズ 1 サンプル。xorshift32 白色（ch 跨ぎ前進＝ステレオ非相関）→ Paul Kellet economy
  // 3-pole フィルタで -3dB/oct に整形。状態は ch 毎（pinkB）。
  private nextPink(ch: number): number {
    let x = this.noiseState
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.noiseState = x | 0
    const white = (x >>> 0) / 2147483648 - 1 // [-1,1)
    const b = this.pinkB[ch]
    b[0] = 0.99765 * b[0] + white * 0.099046
    b[1] = 0.963 * b[1] + white * 0.2965164
    b[2] = 0.57 * b[2] + white * 1.0526913
    return (b[0] + b[1] + b[2] + white * 0.1848) * FREEZE_PINK_SCALE
  }
}

// Freeze 後段 EQ: RBJ biquad ×3 を直列（HP370 → ピーク1.2k(+14dB Q2.2) → ハイシェルフ3k(-7.2dB Q1)）。
// 係数は constructor で固定算出。状態は ch 毎・stage 毎（transposed DF-II の z1/z2）。
class FreezeEq {
  private readonly co: Float64Array // 3 stage × [b0,b1,b2,a1,a2]
  private z1: Float64Array[] = [] // [ch] length 3
  private z2: Float64Array[] = []

  constructor(sr: number) {
    this.co = new Float64Array(15)
    this.setStage(0, biquadHighpass(sr, FREEZE_HP_HZ, Math.SQRT1_2))
    this.setStage(1, biquadPeak(sr, FREEZE_PEAK_HZ, FREEZE_PEAK_DB, FREEZE_PEAK_Q))
    this.setStage(2, biquadHighShelf(sr, FREEZE_SHELF_HZ, FREEZE_SHELF_DB, FREEZE_SHELF_Q))
  }

  private setStage(i: number, c: number[]): void {
    this.co.set(c, i * 5)
  }

  ensure(n: number): void {
    while (this.z1.length < n) {
      this.z1.push(new Float64Array(3))
      this.z2.push(new Float64Array(3))
    }
  }

  reset(ch: number): void {
    this.z1[ch].fill(0)
    this.z2[ch].fill(0)
  }

  process(ch: number, x: number): number {
    const co = this.co
    const z1 = this.z1[ch]
    const z2 = this.z2[ch]
    let s = x
    for (let i = 0; i < 3; i++) {
      const o = i * 5
      const y = co[o] * s + z1[i]
      z1[i] = co[o + 1] * s - co[o + 3] * y + z2[i]
      z2[i] = co[o + 2] * s - co[o + 4] * y
      s = y
    }
    return s
  }
}

// RBJ cookbook biquad 係数（a0 で正規化し [b0,b1,b2,a1,a2] を返す）。
function biquadHighpass(sr: number, f: number, q: number): number[] {
  const w0 = (2 * Math.PI * f) / sr
  const c = Math.cos(w0)
  const al = Math.sin(w0) / (2 * q)
  const a0 = 1 + al
  return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0]
}
function biquadPeak(sr: number, f: number, dB: number, q: number): number[] {
  const A = Math.pow(10, dB / 40)
  const w0 = (2 * Math.PI * f) / sr
  const c = Math.cos(w0)
  const al = Math.sin(w0) / (2 * q)
  const a0 = 1 + al / A
  return [(1 + al * A) / a0, (-2 * c) / a0, (1 - al * A) / a0, (-2 * c) / a0, (1 - al / A) / a0]
}
function biquadHighShelf(sr: number, f: number, dB: number, q: number): number[] {
  const A = Math.pow(10, dB / 40)
  const w0 = (2 * Math.PI * f) / sr
  const c = Math.cos(w0)
  const al = Math.sin(w0) / (2 * q)
  const sq = 2 * Math.sqrt(A) * al
  const a0 = A + 1 - (A - 1) * c + sq
  return [
    (A * (A + 1 + (A - 1) * c + sq)) / a0,
    (-2 * A * (A - 1 + (A + 1) * c)) / a0,
    (A * (A + 1 + (A - 1) * c - sq)) / a0,
    (2 * (A - 1 - (A + 1) * c)) / a0,
    (A + 1 - (A - 1) * c - sq) / a0,
  ]
}

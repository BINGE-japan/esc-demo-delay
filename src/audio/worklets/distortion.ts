// DSP worklet — fuzz / hard-clip distortion、'distortion' として登録。
//
// 組み立て役。実体は dsp/ の各ユニット（docs/DSP.md / docs/ARCHITECTURE.md）。
// 帯域スプリットで「選択帯域だけにエフェクト」を実現:
//   band = bandpass(in, lo, hi);  rest = in − band（位相反転＝引き算で完全再構成）
//   band → [Drive]→[Glitch]→[Pitch] → bandPost
//   out  = Normal: bandPost+rest / Solo: bandPost / Mute: rest  → Output → Bypass
// セクション ON/OFF・Solo/Mute・Bypass はクリック回避のクロスフェードで合成。
// パラメータは params.ts（SSoT）から生成（docs/ARCHITECTURE.md §4）。

import { PARAMS, MAX_STEPS } from './params'
import { BandSplit } from './dsp/band'
import { Saturation } from './dsp/saturation'
import { Glitch } from './dsp/glitch'
import { WarpPitch } from './dsp/pitch'

const dbToLin = (db: number): number => Math.pow(10, db / 20)
const TOGGLE_SMOOTH_MS = 8 // トグル/バイパス/Solo-Mute のクロスフェード時間

class DistortionProcessor extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
  static get parameterDescriptors() {
    return PARAMS.map((p) => ({
      name: p.name,
      defaultValue: p.default,
      minValue: p.min,
      maxValue: p.max,
      automationRate: 'k-rate' as const,
    }))
  }

  private readonly band: BandSplit
  private readonly sat: Saturation
  private readonly gli: Glitch
  private readonly pit: WarpPitch
  private readonly toggleCoef: number

  // クロスフェード用の平滑ゲイン（0..1）
  private satMix = 1
  private glitchMix = 1
  private bandGain = 1 // recombine: band 成分
  private restGain = 1 // recombine: rest 成分
  private bypassMix = 0
  private readonly glitchSteps = new Int32Array(MAX_STEPS) // ステップシーケンサのパターン（最大4小節）

  // スナップショット（ch毎・quantum 長、lazy 確保）
  private fullDry: Float32Array[] = [] // 元入力（全体 Bypass の基準）
  private bandPre: Float32Array[] = [] // 抜き出した帯域（エフェクト前。satMix の基準）
  private rest: Float32Array[] = [] // 帯域外（= fullDry − bandPre、out-of-band の dry）
  private snap: Float32Array[] = [] // セクション ON/OFF 用の一時退避

  constructor() {
    super()
    this.band = new BandSplit(sampleRate)
    this.sat = new Saturation(sampleRate)
    this.gli = new Glitch(sampleRate)
    this.pit = new WarpPitch(sampleRate)
    this.toggleCoef = 1 - Math.exp(-1 / ((TOGGLE_SMOOTH_MS / 1000) * sampleRate))
  }

  private ensureBuf(buf: Float32Array[], n: number, len: number): void {
    while (buf.length < n) buf.push(new Float32Array(len))
    for (let ch = 0; ch < n; ch++) {
      if (buf[ch].length !== len) buf[ch] = new Float32Array(len)
    }
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || !output) return true
    const n = output.length
    if (n === 0) return true
    const len = output[0].length

    // k-rate パラメータ
    const driveDb = parameters.drive[0]
    const tonePct = parameters.tone[0]
    const comp = parameters.comp[0] >= 0.5
    const outLin = dbToLin(parameters.output[0])
    const pitchDepth = parameters.pitch[0]
    const gliRandom = parameters.glitchRandom[0] >= 0.5
    const gliBars = parameters.glitchBars[0]
    const glitchPhase = parameters.glitchPhase[0]
    for (let s = 0; s < MAX_STEPS; s++) {
      const p = parameters['step' + s]
      const v = p ? Math.round(p[0]) : 0
      this.glitchSteps[s] = v < 0 ? 0 : v > 5 ? 5 : v // enum 0..5 にクランプ
    }
    const bpm = parameters.bpm[0]
    const bandLo = parameters.bandLo[0]
    const bandHi = parameters.bandHi[0]
    const satTarget = parameters.satOn[0] >= 0.5 ? 1 : 0
    const glitchTarget = parameters.glitchOn[0] >= 0.5 ? 1 : 0
    const solo = parameters.bandSolo[0] >= 0.5
    const mute = parameters.bandMute[0] >= 0.5
    const bypTarget = parameters.bypass[0] >= 0.5 ? 1 : 0
    // Solo 優先。Solo → band のみ / Mute → rest のみ / 通常 → 両方。
    const bandTarget = mute && !solo ? 0 : 1
    const restTarget = solo ? 0 : 1

    this.ensureBuf(this.fullDry, n, len)
    this.ensureBuf(this.bandPre, n, len)
    this.ensureBuf(this.rest, n, len)
    this.ensureBuf(this.snap, n, len)

    // 入力を fullDry にコピー
    for (let ch = 0; ch < n; ch++) {
      const inCh = input[ch]
      const d = this.fullDry[ch]
      for (let i = 0; i < len; i++) d[i] = inCh ? inCh[i] : 0
    }

    // === 帯域スプリット: bandPre = bandpass(in)、rest = in − bandPre、output = bandPre ===
    this.band.filterBand(this.fullDry, this.bandPre, bandLo, bandHi)
    for (let ch = 0; ch < n; ch++) {
      const dry = this.fullDry[ch]
      const pre = this.bandPre[ch]
      const r = this.rest[ch]
      const o = output[ch]
      for (let i = 0; i < len; i++) {
        r[i] = dry[i] - pre[i]
        o[i] = pre[i]
      }
    }

    // === 歪み Section（output=band を in-place） ===
    this.sat.process(output, driveDb, tonePct, comp)
    for (let i = 0; i < len; i++) {
      this.satMix += this.toggleCoef * (satTarget - this.satMix)
      for (let ch = 0; ch < n; ch++) {
        const o = output[ch]
        const pre = this.bandPre[ch]
        o[i] = pre[i] + (o[i] - pre[i]) * this.satMix
      }
    }

    // 音量恒常は saturation.ts のフィードフォワード補正（Drive/Tone の makeup）で完結。
    // 出力を測って後追いで下げるリアクティブ段は持たない＝ラグ/ムラなし（DECISIONS 2026-06-21）。

    // === Glitch Section ===
    for (let ch = 0; ch < n; ch++) this.snap[ch].set(output[ch])
    this.gli.process(output, this.glitchSteps, glitchPhase, bpm, gliRandom, gliBars)
    for (let i = 0; i < len; i++) {
      this.glitchMix += this.toggleCoef * (glitchTarget - this.glitchMix)
      for (let ch = 0; ch < n; ch++) {
        const o = output[ch]
        const s = this.snap[ch]
        o[i] = s[i] + (o[i] - s[i]) * this.glitchMix
      }
    }

    // === Pitch Section（Vinyl Warp 風の再現性ピッチ寄れ。depth=0 でほぼ透過） ===
    this.pit.process(output, pitchDepth, glitchPhase)

    // === 帯域 recombine（+ Solo/Mute） ===
    for (let i = 0; i < len; i++) {
      this.bandGain += this.toggleCoef * (bandTarget - this.bandGain)
      this.restGain += this.toggleCoef * (restTarget - this.restGain)
      for (let ch = 0; ch < n; ch++) {
        output[ch][i] = output[ch][i] * this.bandGain + this.rest[ch][i] * this.restGain
      }
    }

    // === Master: Output gain → 全体 Bypass（fullDry へクロスフェード） ===
    for (let i = 0; i < len; i++) {
      this.bypassMix += this.toggleCoef * (bypTarget - this.bypassMix)
      for (let ch = 0; ch < n; ch++) {
        const o = output[ch]
        const processed = o[i] * outLin
        o[i] = processed + (this.fullDry[ch][i] - processed) * this.bypassMix
      }
    }
    return true
  }
}

registerProcessor('distortion', DistortionProcessor)

// DSP worklet — fuzz / hard-clip distortion、'distortion' として登録。
//
// 組み立て役。実体は dsp/ の各ユニット（docs/DSP.md / docs/ARCHITECTURE.md）。
// 帯域スプリットで「選択帯域だけにエフェクト」を実現:
//   band = bandpass(in, lo, hi);  rest = in − band（位相反転＝引き算で完全再構成）
//   band → [Drive]→[Pitch]→[Glitch] → bandPost
//   out  = Normal: bandPost+rest / Solo: bandPost / Mute: rest  → Output → Bypass
// セクション ON/OFF・Solo/Mute・Bypass はクリック回避のクロスフェードで合成。
// パラメータは params.ts（SSoT）から生成（docs/ARCHITECTURE.md §4）。

import { PARAMS } from './params'
import { BandSplit } from './dsp/band'
import { Saturation } from './dsp/saturation'
import { LoudnessMatch } from './dsp/loudness'
import { Wobble } from './dsp/wobble'
import { Glitch } from './dsp/glitch'

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
  private readonly loud: LoudnessMatch
  private readonly wob: Wobble
  private readonly gli: Glitch
  private readonly toggleCoef: number

  // クロスフェード用の平滑ゲイン（0..1）
  private satMix = 1
  private pitchMix = 1
  private glitchMix = 1
  private bandGain = 1 // recombine: band 成分
  private restGain = 1 // recombine: rest 成分
  private bypassMix = 0

  // スナップショット（ch毎・quantum 長、lazy 確保）
  private fullDry: Float32Array[] = [] // 元入力（全体 Bypass の基準）
  private bandPre: Float32Array[] = [] // 抜き出した帯域（エフェクト前。loud/satMix の基準）
  private rest: Float32Array[] = [] // 帯域外（= fullDry − bandPre、out-of-band の dry）
  private snap: Float32Array[] = [] // セクション ON/OFF 用の一時退避

  constructor() {
    super()
    this.band = new BandSplit(sampleRate)
    this.sat = new Saturation(sampleRate)
    this.loud = new LoudnessMatch(sampleRate)
    this.wob = new Wobble(sampleRate)
    this.gli = new Glitch(sampleRate)
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
    const outLin = dbToLin(parameters.output[0])
    const wobAmt = parameters.wobble[0]
    const wobSpeed = parameters.wobbleSpeed[0]
    const wobOccur = parameters.wobbleOccur[0]
    const gliAmt = parameters.glitch[0]
    const gliFill = parameters.glitchFill[0] >= 0.5
    const bpm = parameters.bpm[0]
    const bandLo = parameters.bandLo[0]
    const bandHi = parameters.bandHi[0]
    const autoGain = parameters.autoGain[0] >= 0.5
    const satTarget = parameters.satOn[0] >= 0.5 ? 1 : 0
    const pitchTarget = parameters.pitchOn[0] >= 0.5 ? 1 : 0
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
    this.sat.process(output, driveDb, tonePct)
    this.loud.process(output, this.bandPre, autoGain) // 基準は帯域 dry
    for (let i = 0; i < len; i++) {
      this.satMix += this.toggleCoef * (satTarget - this.satMix)
      for (let ch = 0; ch < n; ch++) {
        const o = output[ch]
        const pre = this.bandPre[ch]
        o[i] = pre[i] + (o[i] - pre[i]) * this.satMix
      }
    }

    // === Pitch Section ===
    for (let ch = 0; ch < n; ch++) this.snap[ch].set(output[ch])
    this.wob.process(output, wobAmt, wobSpeed, wobOccur, bpm)
    for (let i = 0; i < len; i++) {
      this.pitchMix += this.toggleCoef * (pitchTarget - this.pitchMix)
      for (let ch = 0; ch < n; ch++) {
        const o = output[ch]
        const s = this.snap[ch]
        o[i] = s[i] + (o[i] - s[i]) * this.pitchMix
      }
    }

    // === Glitch Section ===
    for (let ch = 0; ch < n; ch++) this.snap[ch].set(output[ch])
    this.gli.process(output, gliAmt, gliFill)
    for (let i = 0; i < len; i++) {
      this.glitchMix += this.toggleCoef * (glitchTarget - this.glitchMix)
      for (let ch = 0; ch < n; ch++) {
        const o = output[ch]
        const s = this.snap[ch]
        o[i] = s[i] + (o[i] - s[i]) * this.glitchMix
      }
    }

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

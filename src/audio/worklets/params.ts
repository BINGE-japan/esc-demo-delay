// パラメータ定義の SSoT。worklet（parameterDescriptors）と App.vue（useParam / UI）が
// この1配列から派生する＝数値を変えるのはここ1箇所（docs/ARCHITECTURE.md §4-5）。
//
// tsconfig: このファイルは worklet プロジェクト配下（src/audio/worklets/**）。App は
// worklets を exclude しているが、依存として import するぶんは型チェックを通る（純データのため）。
// 環境固有 global（DOM / audioworklet）は一切使わないこと。

export type ParamSection = 'drive' | 'pitch' | 'glitch' | 'band' | 'master'

export interface ParamDef {
  /** VST controller の addParameter tag（useParam の id）。本プラグインは 200番台。 */
  id: number
  /** AudioParam 名（worklet ⇄ App の橋渡しキー）。 */
  name: string
  /** UI 表示名。 */
  label: string
  min: number
  max: number
  default: number
  /** 表示単位。'dB' | '%' | 'Hz' | ''（トグル）。 */
  unit: string
  /** UI/DSP のセクション分け。 */
  section: ParamSection
  /** 0/1 のトグル（スライダでなくスイッチ）。 */
  toggle?: boolean
  /** 対数スケール（周波数など）。UI スライダと useParam の正規化を log に。 */
  log?: boolean
  /** UI に出さず useParam も作らない（transport 等が裏で供給する内部 AudioParam）。 */
  hidden?: boolean
}

export const PARAMS: ParamDef[] = [
  // --- 歪み ---
  {
    id: 200,
    name: 'drive',
    label: 'Drive',
    min: 0,
    max: 48,
    default: 12,
    unit: 'dB',
    section: 'drive',
  },
  {
    id: 201,
    name: 'tone',
    label: 'Tone',
    min: -100,
    max: 100,
    default: 0,
    unit: '%',
    section: 'drive',
  },
  {
    id: 205,
    name: 'autoGain',
    label: 'Auto Gain',
    min: 0,
    max: 1,
    default: 1,
    unit: '',
    section: 'drive',
    toggle: true,
  },
  {
    id: 206,
    name: 'satOn',
    label: 'Drive On',
    min: 0,
    max: 1,
    default: 1,
    unit: '',
    section: 'drive',
    toggle: true,
  },
  // --- ピッチ（Wobble） ---
  {
    id: 203,
    name: 'wobble',
    label: 'Wobble',
    min: 0,
    max: 100,
    default: 0,
    unit: '%',
    section: 'pitch',
  },
  {
    id: 210,
    name: 'wobbleSpeed',
    label: 'Wob Speed',
    min: 0,
    max: 100,
    default: 40,
    unit: '%',
    section: 'pitch',
  },
  {
    id: 211,
    name: 'wobbleOccur',
    label: 'Wob Occur',
    min: 0,
    max: 100,
    default: 100,
    unit: '%',
    section: 'pitch',
  },
  {
    id: 207,
    name: 'pitchOn',
    label: 'Pitch On',
    min: 0,
    max: 1,
    default: 1,
    unit: '',
    section: 'pitch',
    toggle: true,
  },
  // --- グリッチ ---
  {
    id: 204,
    name: 'glitch',
    label: 'Glitch',
    min: 0,
    max: 100,
    default: 0,
    unit: '%',
    section: 'glitch',
  },
  {
    id: 212,
    name: 'glitchFill',
    label: 'Spectral Fill',
    min: 0,
    max: 1,
    default: 0,
    unit: '',
    section: 'glitch',
    toggle: true,
  },
  {
    id: 217,
    name: 'glitchOn',
    label: 'Glitch On',
    min: 0,
    max: 1,
    default: 1,
    unit: '',
    section: 'glitch',
    toggle: true,
  },
  // --- 帯域（エフェクトをかける周波数の選択。全エフェクト一括） ---
  {
    id: 213,
    name: 'bandLo',
    label: 'Band Lo',
    min: 20,
    max: 20000,
    default: 20,
    unit: 'Hz',
    section: 'band',
    log: true,
  },
  {
    id: 214,
    name: 'bandHi',
    label: 'Band Hi',
    min: 20,
    max: 20000,
    default: 20000,
    unit: 'Hz',
    section: 'band',
    log: true,
  },
  {
    id: 215,
    name: 'bandSolo',
    label: 'Solo',
    min: 0,
    max: 1,
    default: 0,
    unit: '',
    section: 'band',
    toggle: true,
  },
  {
    id: 216,
    name: 'bandMute',
    label: 'Mute',
    min: 0,
    max: 1,
    default: 0,
    unit: '',
    section: 'band',
    toggle: true,
  },
  // --- マスター ---
  {
    id: 202,
    name: 'output',
    label: 'Output',
    min: -24,
    max: 6,
    default: 0,
    unit: 'dB',
    section: 'master',
  },
  {
    id: 208,
    name: 'bypass',
    label: 'Bypass',
    min: 0,
    max: 1,
    default: 0,
    unit: '',
    section: 'master',
    toggle: true,
  },
  // --- 内部（UI/useParam なし。App が transport.tempo を流し込む） ---
  {
    id: 209,
    name: 'bpm',
    label: 'BPM',
    min: 20,
    max: 999,
    default: 120,
    unit: '',
    section: 'master',
    hidden: true,
  },
]

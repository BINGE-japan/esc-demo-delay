// パラメータ定義の SSoT。worklet（parameterDescriptors）と App.vue（useParam / UI）が
// この1配列から派生する＝数値を変えるのはここ1箇所（docs/ARCHITECTURE.md §4-5）。
//
// tsconfig: このファイルは worklet プロジェクト配下（src/audio/worklets/**）。App は
// worklets を exclude しているが、依存として import するぶんは型チェックを通る（純データのため）。
// 環境固有 global（DOM / audioworklet）は一切使わないこと。

export type ParamSection = 'drive' | 'glitch' | 'band' | 'master'

// Glitch シーケンサのループ長 SSoT（worklet・App・StepGrid が共有＝drift 防止）。
export const STEPS_PER_BAR = 16 // 16分・1小節あたりのステップ数
export const MAX_BARS = 4 // 小節数の上限（タブ 1/2/4）
export const MAX_STEPS = MAX_BARS * STEPS_PER_BAR // ステップ param の最大数（64）
/** bars 値を 1..MAX_BARS の整数に丸めてクランプ。 */
export const clampBars = (v: number): number => Math.min(MAX_BARS, Math.max(1, Math.round(v)))

/** `grid` param の種別（StepGrid が step セル群と bars セレクタを判別）。 */
export type GridRole = 'step' | 'bars'

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
  /** ステップシーケンサのグリッド用。useParam ハンドルは作るが自動スライダ UI には出さない（専用グリッド UI が描画）。 */
  grid?: boolean
  /** grid param の種別（step セル / bars セレクタ）。App/StepGrid が name 文字列でなくこれで判別。 */
  gridRole?: GridRole
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
  // Comp: ON=自然圧縮（操作点追従＝遅い envelope。普通の歪み）/ OFF=ダイナミクス保持（速い envelope）。
  // ID 222（221 は反映されなかった実験の名残のため欠番）。
  {
    id: 222,
    name: 'comp',
    label: 'Comp',
    min: 0,
    max: 1,
    default: 1,
    unit: '',
    section: 'drive',
    toggle: true,
  },
  // --- グリッチ（ステップシーケンサ：横=16分ステップ / 縦=タイプ。docs/DSP.md §3 Glitch） ---
  // Pitch: Vinyl の Warp 風＝再現性のあるピッチ寄れ/ワウ（depth）。glitchPhase ロックで毎ループ同じ。
  // 旧 Glitch(204) intensity ノブを撤去し id 204 を Pitch に転用（空セル=Dry で透過するので wet 不要）。
  {
    id: 204,
    name: 'pitch',
    label: 'Pitch',
    min: 0,
    max: 100,
    default: 0,
    unit: '%',
    section: 'glitch',
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
  // Random モード: グリッドを無視し全ステップを決定論ランダム（dry も混ざる・再現性あり）。
  {
    id: 290,
    name: 'glitchRandom',
    label: 'Random',
    min: 0,
    max: 1,
    default: 0,
    unit: '',
    section: 'glitch',
    toggle: true,
  },
  // 小節数（ループ長）: 1/2/4 小節をタブで選択。パターン=bars*16 ステップで反復。
  // grid:true で自動スライダから除外し、StepGrid がタブ＋bars*16 列を描画。
  {
    id: 288,
    name: 'glitchBars',
    label: 'Bars',
    min: 1,
    max: MAX_BARS,
    default: 2,
    unit: '',
    section: 'glitch',
    grid: true,
    gridRole: 'bars',
  },
  // ステップ 0..63（16分・内部解像度）。パターン長=bars*16（最大4小節=64）。
  // 値(raw)= ベース型(下位3bit) | Dive(bit3=8)。0..13（ベース 0..5 ＋ Dive で +8）:
  //   ベース 0=Dry / 1=Glitch / 2=Freeze / 3=Reverse / 4=Mute / 5=Repeat。Dive は重ねがけ（Mute 不可）。
  // 隣接する同一 raw＝1ブロック（幅=継続長・小節跨ぎ可、パターン頭でのみ分割）。
  // 表示は8分カラム（StepGrid が2スロット=8分単位でペイント）だが内部・スナップは16分。
  // grid:true ＝ useParam は作るが自動スライダに出さず StepGrid が描画。id 223–286。
  ...Array.from(
    { length: MAX_STEPS },
    (_, i): ParamDef => ({
      id: 223 + i,
      name: `step${i}`,
      label: `Step ${i + 1}`,
      min: 0,
      max: 13,
      default: 0,
      unit: '',
      section: 'glitch',
      grid: true,
      gridRole: 'step',
    }),
  ),
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
  // --- 内部（UI/useParam なし。App が transport から流し込む） ---
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
  // パターン内の位相 0..1（App が positionSamples mod パターン長 から算出）。Glitch の拍ロック用。
  {
    id: 287,
    name: 'glitchPhase',
    label: 'Glitch Phase',
    min: 0,
    max: 1,
    default: 0,
    unit: '',
    section: 'master',
    hidden: true,
  },
]

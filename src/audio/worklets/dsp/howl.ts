// Howl: 歪み成分を「原音の符号(sign)でリングmod」して、原音に調和した金属味を加算する（1ノブ・暫定）。
// 外部キャリア(sin/fc)なし＝つまみ非連動。歪みが足した成分 delta = driveOut − dry を、
// 原音の符号 sign(dry)（＝原音ピッチの**単位**方形波）で掛ける:
//   metal = delta · sign(dry)   → 原音ピッチに調和した倍音＝「元の音を誇張」した金属。方形波キャリア
//   なので倍音リッチでキンキン。**単位振幅なので積で痩せず、はっきり鳴る**
//   （旧 delta·dry は |dry| 倍に痩せてほぼ聞こえなかった → sign に変更）。
//   metal を固定ハイパス（DC除去＋キンキン）→ out = driveOut + amt·GAIN·metal（加算・置換でない）。
// Drive 0（delta≈0）なら金属0。基音は無加工。音量は後段 Loudness が dry に揃える。docs/DSP.md §2c。
// ⚠️ 方形波キャリアは倍音無限＝エイリアシング多め（OS=Phase 3 で低減）。

const GAIN = 6 // 金属成分のレベル（耳調整）
const HP_HZ = 1200 // 金属成分のハイパス（DC除去＋キンキン）。固定＝つまみ非連動

export class Howl {
  private readonly hpCoef: number
  private lp: number[] = [] // metal のハイパス用 lowpass 状態（ch 毎）

  constructor(sr: number) {
    this.hpCoef = 1 - Math.exp((-2 * Math.PI * HP_HZ) / sr)
  }

  // io(=歪み出力) の歪み成分(io−dry)を sign(dry) でリングmod、HPF して加算（in-place）。
  process(io: Float32Array[], dry: Float32Array[], amountPct: number): void {
    const n = io.length
    if (n === 0) return
    const amt = amountPct / 100
    if (amt <= 0) return // 0 は完全素通り
    const len = io[0].length
    while (this.lp.length < n) this.lp.push(0)
    const g = amt * GAIN

    for (let ch = 0; ch < n; ch++) {
      const o = io[ch]
      const d = dry[ch]
      let lp = this.lp[ch]
      for (let i = 0; i < len; i++) {
        const carrier = d[i] >= 0 ? 1 : -1 // 原音の符号＝原音ピッチの単位方形波（痩せない・調和）
        const metal = (o[i] - d[i]) * carrier // 歪み成分を原音ピッチでリングmod
        lp += this.hpCoef * (metal - lp)
        const hp = metal - lp // ハイパス＝キンキン（DC除去）
        o[i] = o[i] + g * hp // 加算（歪みはそのまま＋金属味を足す）
      }
      this.lp[ch] = lp
    }
  }
}

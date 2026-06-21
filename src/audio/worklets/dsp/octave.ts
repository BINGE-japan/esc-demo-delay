// Octave（固定ピッチ歪み＝オクターヴ・ファズ）。
// 全波整流で 1 オクターブ上の倍音を生成し、DC（整流の直流成分）を 1-pole HP で除去して
// 原信号にブレンド＝fuzz に自然な「オクターヴ上」キャラ。歪み段の後・Glitch の前に置く。
// On/Off は distortion.ts のクロスフェードで（このユニットは常時 wet を作る）。
// ブレンド/補正量は耳調整（詳細は今後 debug param で詰める）。docs/DSP.md 段「Octave」。

const OCTAVE_MIX = 0.6 // オクターブ成分のブレンド量
const OCT_MAKEUP = 1.8 // 整流で痩せる分の音量補正
const DC_HP_HZ = 25 // DC 除去の 1-pole ハイパス カットオフ

export class OctaveFuzz {
  private readonly hpCoef: number
  private hp: number[] = [] // DC 除去 HP 状態（ch 毎）

  constructor(sr: number) {
    this.hpCoef = 1 - Math.exp((-2 * Math.PI * DC_HP_HZ) / sr)
  }

  // io を in-place。全波整流→DC 除去→原信号にブレンド。
  process(io: Float32Array[]): void {
    const n = io.length
    if (n === 0) return
    while (this.hp.length < n) this.hp.push(0)
    for (let ch = 0; ch < n; ch++) {
      const d = io[ch]
      if (!d) continue
      let hp = this.hp[ch]
      for (let i = 0; i < d.length; i++) {
        const x = d[i]
        const rect = x < 0 ? -x : x // 全波整流（オクターブ上＋DC）
        hp += this.hpCoef * (rect - hp) // 整流の DC を追従
        const oct = (rect - hp) * OCT_MAKEUP // DC 除去＝オクターブ成分
        let y = x * (1 - OCTAVE_MIX) + oct * OCTAVE_MIX
        if (y > 1)
          y = 1 // overflow 防止（整流＋makeup で full scale を超えうる＝fuzz 的にクリップ）
        else if (y < -1) y = -1
        d[i] = y
      }
      this.hp[ch] = hp
    }
  }
}

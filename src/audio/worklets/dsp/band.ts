// 帯域スプリット: バンドパスで選択帯域(lo..hi)を抜き出す。残り(out-of-band)は呼び出し側で
// `in − band`（位相反転＋加算＝引き算）で作る → band + rest = in が厳密に成立＝完全再構成。
// はっきり分けるため 4-pole（24dB/oct）: HP(lo)×2 → LP(hi)×2 を TPT State-Variable で。
// TPT はカットオフを動かしてもジッパーノイズが出ない。状態はチャンネル毎（SVF 8 状態）。
// 詳細は docs/DSP.md §2b。

const Q = 0.7071 // 各 2-pole セクションの Q（バターワース近似）
const K = 1 / Q

export class BandSplit {
  private readonly sr: number
  // ch 毎の状態: [hp1ic1,hp1ic2, hp2ic1,hp2ic2, lp1ic1,lp1ic2, lp2ic1,lp2ic2]
  private st: Float64Array[] = []

  constructor(sr: number) {
    this.sr = sr
  }

  // src の lo..hi バンドパスを dst に書く（4-pole）。
  filterBand(src: Float32Array[], dst: Float32Array[], loHz: number, hiHz: number): void {
    const n = src.length
    if (n === 0) return
    const len = src[0].length
    while (this.st.length < n) this.st.push(new Float64Array(8))

    const nyq = this.sr * 0.45
    const lo = Math.min(nyq, Math.max(10, loHz))
    const hi = Math.min(nyq, Math.max(10, hiHz))
    // TPT 係数（tan プリワープ）。lo=HP / hi=LP。lo>=hi なら通過帯域が空 → ほぼ 0（全 dry）。
    const gLo = Math.tan((Math.PI * lo) / this.sr)
    const a1Lo = 1 / (1 + gLo * (gLo + K))
    const a2Lo = gLo * a1Lo
    const a3Lo = gLo * a2Lo
    const gHi = Math.tan((Math.PI * hi) / this.sr)
    const a1Hi = 1 / (1 + gHi * (gHi + K))
    const a2Hi = gHi * a1Hi
    const a3Hi = gHi * a2Hi

    for (let ch = 0; ch < n; ch++) {
      const s = this.st[ch]
      const inp = src[ch]
      const out = dst[ch]
      for (let i = 0; i < len; i++) {
        let x = inp[i]
        x = svf(x, K, a1Lo, a2Lo, a3Lo, s, 0, true) // HP1 @lo
        x = svf(x, K, a1Lo, a2Lo, a3Lo, s, 2, true) // HP2 @lo
        x = svf(x, K, a1Hi, a2Hi, a3Hi, s, 4, false) // LP1 @hi
        x = svf(x, K, a1Hi, a2Hi, a3Hi, s, 6, false) // LP2 @hi
        out[i] = x
      }
    }
  }
}

// TPT SVF 1 セクション（Cytomic）。off は状態オフセット。hp=true で HP、false で LP を返す。
function svf(
  x: number,
  k: number,
  a1: number,
  a2: number,
  a3: number,
  st: Float64Array,
  off: number,
  hp: boolean,
): number {
  const ic1 = st[off]
  const ic2 = st[off + 1]
  const v3 = x - ic2
  const v1 = a1 * ic1 + a2 * v3
  const v2 = ic2 + a2 * ic1 + a3 * v3
  st[off] = 2 * v1 - ic1
  st[off + 1] = 2 * v2 - ic2
  return hp ? x - k * v1 - v2 : v2
}

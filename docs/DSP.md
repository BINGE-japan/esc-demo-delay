# DSP — 歪みアルゴリズム仕様（実装の核）

> DSP は `src/audio/worklets/` 配下の**ユニットに分割**。`distortion.ts` は組み立て役、実体は `dsp/*.ts`。
> 実装はここに従う。アルゴリズムを変えたら **先にここを直し**、[DECISIONS.md](./DECISIONS.md) に理由を追記する。
> 構成の俯瞰は [ARCHITECTURE.md](./ARCHITECTURE.md) §2。
>
> ステータス: **v0.3** / 最終更新: 2026-06-20

## 0. 前提

- サンプル単位処理。`process()` は 128 サンプル／ブロック（Web Audio 標準）。
- パラメータは AudioParam（k-rate、ブロック先頭1値）で受け取る（[ARCHITECTURE.md](./ARCHITECTURE.md) §4）。
- 各ユニットは `constructor(sampleRate)` で定数を算出。音作りの定数は**各ユニット冒頭**に集約（後から調整しやすく）。
- ステレオ整合: Wobble の LFO・Glitch の判定・Loudness のゲインは **全 ch 共通**。フィルタ/ディレイ/スライスのバッファは **ch 毎**。

## 1. セクションと段構成

6 セクション（Drive / Howl / Pitch / Glitch / Band / Master）。UI も同じ区切り（[SPEC.md](./SPEC.md) §6）。
全体は **帯域スプリット**で挟む: `in → band/rest 分割 →` 下の段（band 側）`→ recombine(+Solo/Mute)`（§2b）。実処理順は上から下。

| セクション | 段              | 内容                                                                                | パラメータ                                               | ユニット            |
| ---------- | --------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------- |
| **歪み**   | Drive           | `x *= 10^(driveDb/20)`                                                              | Drive(200)                                               | `dsp/saturation.ts` |
| 歪み       | Hard Clip       | `clamp(x, -1, +1)`                                                                  | —                                                        | 〃                  |
| 歪み       | Drive makeup    | Drive で増えた RMS を静的に打ち消す                                                 | Drive 連動                                               | 〃                  |
| 歪み       | Tone（Tilt EQ） | 低/高を逆方向にゲイン（暗⇄明）＋ Tone makeup                                        | Tone(201)                                                | 〃                  |
| **Howl**   | 自己リングmod   | 歪み成分(driveOut−dry)を**sign(dry)でmod**＋HPF＝原音を誇張した金属味を加算（暫定） | Howl(218)/Howl On(220)                                   | `dsp/howl.ts`       |
| Howl/歪み  | Loudness Match  | **Drive+Howl を dry に合わせる**（音量一定。残差トリム）                            | Auto Gain(205)                                           | `dsp/loudness.ts`   |
| **Pitch**  | Wobble          | 可変ディレイのピッチのヨレ（Depth/Speed/Occur）                                     | Wobble(203)/Speed(210)/Occur(211)+bpm(209)/Pitch On(207) | `dsp/wobble.ts`     |
| **Glitch** | Glitch          | 再現性グリッチ（リピート/ゲート）＋スペクトル反転フィル                             | Glitch(204)/Spectral Fill(212)/Glitch On(217)            | `dsp/glitch.ts`     |
| **Master** | Output Gain     | `y *= 10^(outDb/20)`                                                                | Output(202)                                              | `distortion.ts`     |
| Master     | Bypass          | 全体を dry へクロスフェード                                                         | Bypass(208)                                              | 〃                  |

- セクション ON/OFF（Drive On=206 / Howl On=220 / Pitch On=207 / Glitch On=217）・Solo/Mute・Bypass(208) は **クリック回避のクロスフェード**（≈8ms 平滑）で切替（`distortion.ts`）。
- 帯域スプリット（Band Lo=213 / Hi=214 / Solo=215 / Mute=216）は §2b。OS（Phase 3）は Hard Clip の前後に挿入予定（§4）。

## 2. 音量を「常に一定」に（要・前回方針の更新）⭐

「挿してる間ずっと音量一定」を満たす。**ポンピングはさせない**。両立のため **2 段構え**（[DECISIONS.md](./DECISIONS.md) 2026-06-20）:

1. **計算補正（フィードフォワード・knob 由来・信号に追従しない＝ポンプ皆無）**
   - **Drive makeup**: ハードクリップで増える RMS を `driveLin` から逆算して打ち消す。
   - **Tone makeup**: Tilt の知覚ラウドネス増分を基準スペクトルから逆算して打ち消す。
2. **遅い自動トリム（Loudness Match、~300ms・遅いのでポンプしない）**
   - dry と wet の RMS を遅く測り、残差（信号レベル/スペクトル依存ぶん）を埋める。Auto Gain(205) で ON/OFF。

> 原理: 真の「常に一定」は信号追従が要る＝速いとポンプ。だから計算補正で大半を消し、**遅い**トリムで残差だけ詰める＝一定かつ無ポンプ。

### Drive makeup（`dsp/saturation.ts`）

基準サイン波（peak=1）で出力 RMS が入力 RMS に一致するゲインを `driveLin` だけから算出:

```
G = driveLin
G ≤ 1:  MS = G² / 2
G > 1:  θc = asin(1/G);  MS = (2/π)[ G²(θc/2 − sin(2θc)/4) + (π/2 − θc) ]
makeup = sqrt(0.5 / MS)
```

検算: `G=1`→makeup=1（透過）。`G→∞`→makeup→0.707（矩形 RMS=フルスケールサイン RMS）。

### Tone makeup（`dsp/saturation.ts`）

Tilt で明るく（高域ブースト）すると知覚音量が上がる分を下げる。基準スペクトルの低/高エネルギー比 `pLow/pHigh`（`TONE_COMP_HIGH_WEIGHT`=0.6）で:

```
toneComp = 1 / sqrt(pLow*gLow² + pHigh*gHigh²)
```

`tone=0` で 1（透過）。重みは耳で調整可（定数）。

### Loudness Match（`dsp/loudness.ts`）

```
coef = 1 - exp(-1 / (0.3s * sampleRate))         // ~300ms
dryMs += coef*(dryMono² - dryMs);  wetMs += coef*(wetMono² - wetMs)
target = enabled ? clamp(sqrt(dryMs/(wetMs+ε)), -24dB..+24dB) : 1
gain  += coef*(target - gain)                    // 遅い → ポンプしない
wet *= gain
```

モノ合算で測り 1 ゲインを全 ch に適用（ステレオ像維持）。

## 2b. 帯域スプリット（エフェクトをかける周波数を選ぶ）⭐

選択帯域 `lo..hi` だけにエフェクトを適用し、帯域外は素通りにする（`dsp/band.ts`＋`distortion.ts`）。

- **抜き出し**: `band = bandpass(in, lo, hi)`。**4-pole（24dB/oct）TPT SVF**（HP(lo)×2 → LP(hi)×2）。lo/hi をスイープしてもジッパー無し。「はっきり分ける」ため急峻に。
- **残り**: `rest = in − band`（位相反転＋加算＝引き算）→ `band + rest = in` が **厳密に成立＝完全再構成**（境界に穴/コブが出ない）。
- **適用**: `band → [Drive]→[Pitch]→[Glitch] → bandPost`。**全エフェクト一括**（[DECISIONS.md](./DECISIONS.md) 2026-06-20）。
- **合成（recombine）**:
  - Normal: `out = bandPost + rest`（帯域内=100%Wet / 帯域外=100%Dry）
  - **Solo**(215): `out = bandPost`（選択帯域だけ試聴）
  - **Mute**(216): `out = rest`（その帯域を抜いた残りだけ試聴）
  - Solo/Mute はクロスフェード。両 ON は Solo 優先。
- **基準の使い分け**: エフェクト内の Loudness Match と各セクション ON/OFF は **band-dry（bandPre）** 基準。全体 Bypass だけ **元入力（fullDry）** 基準。
- エフェクトが中立なら `bandPost = band` → `band+rest = in` で完全透過。`lo=20/hi=20k` で全帯域＝実質オフ。`lo>=hi` は通過帯域が空 → 全 dry。
- ⚠️ 完全なブリックウォール分離は FFT/線形位相が要る（レイテンシ増）。現状は IIR 24dB/oct（必要なら将来 OS と併せ検討）。重い処理時は境界周辺に位相由来の微小アーティファクトが出うる（中立時は無し）。

## 2c. Howl（歪み成分の自己リングmod：金属的・1ノブ・暫定）⭐

> ⚠️ **暫定実装**。「一旦 金属音に寄せて」の方向。外部キャリア RM → 原音での自己mod に変更（本命は別＝ユーザー確認待ち）。

**歪み成分**を**原音の符号 sign(dry) でリングmod**して金属味を加算する（`dsp/howl.ts`＋`distortion.ts`）。外部キャリア(sin/fc)は使わない（＝つまみ非連動）。`delta = driveOut − dry` を **sign(dry)（原音ピッチの単位方形波）**で掛ける → 原音ピッチに調和した倍音＝**元の音を誇張**した金属。方形波キャリアなので倍音リッチでキンキン。

```
amt = howl/100; if amt<=0: 素通り。dry = bandPre（歪み前のクリーン帯域）
for ch, i:
  carrier = sign(dry)                   // 原音ピッチの単位方形波（±1。痩せない・調和）
  metal = (driveOut − dry) · carrier    // 歪み成分を原音ピッチでリングmod
  metal = highpass(metal, 1200Hz)       // DC除去＋キンキン化（固定・つまみ非連動）
  out   = driveOut + amt·GAIN·metal      // 加算（置換でない。GAIN=6）
```

- パラメータ: **Howl(218)**=金属ブレンド量（`amt·GAIN`）/ **Howl On(220)**。**1ノブ**。fc 概念は無し。
- **キャリアは sign(dry)**: 旧 `delta·dry`（原音そのもの）は積が `|dry|` 倍に痩せて**ほぼ聞こえなかった** → **単位振幅の sign(dry)** に変更し、痩せずはっきり鳴る。符号は原音ピッチに同期＝調和（元の音を誇張）。
- **狙い**: キンキンは**元の音を誇張**した響き（原音ピッチに調和）＝エイリアンな外部トーンでない。基音(dry)は無加工。`Drive=0`→`delta≈0`→金属0（歪みがある所だけ）。
- **加算**: 歪み(driveOut)はそのまま残し金属を**足す**（crossfade=置換 はやめた）。
- **HPF 必須**: `delta·sign(dry)` は偶関数成分で DC が出る → ハイパスで除去。これが**キンキン化**も担う（固定 1200Hz、つまみ非連動）。
- **配置**: 歪み（Drive）の**後**＝差分を作るため。Loudness は更に後で音量一定（バイパスでも不変）。
- 経緯: 外部キャリア RM（エイリアン/つまみ連動嫌）→ 原音自己mod（`delta·dry`）は痩せて無音 → **sign(dry) キャリア**で痩せ解消（[DECISIONS.md](./DECISIONS.md) 2026-06-21）。暫定。⚠️ 方形波キャリア＝エイリアシング多め（OS=Phase 3）。将来案: 本命キャラ確定 / GAIN・HP の追い込み。

## 3. 各段の数式（補足）

### Drive / Hard Clip（`dsp/saturation.ts`）

```
x = clamp(inSample * 10^(driveDb/20), -1, +1) * makeup
```

### Tone（Tilt EQ、`dsp/saturation.ts`）

```
tiltDb = (tone/100) * 18                         // TILT_MAX_DB
gLow = 10^(-tiltDb/20);  gHigh = 10^(+tiltDb/20)
lp += pivotCoef*(x - lp)                          // pivot ~800Hz, ch毎
xt = (lp*gLow + (x - lp)*gHigh) * toneComp
```

### Wobble（`dsp/wobble.ts`）

可変ディレイをランダム LFO で揺らし、読み出し速度変化＝ドップラーでピッチをヨレさせる。3 パラメータ:

- **Depth（揺れ幅, 203）**: ディレイ変調幅 `depth = (wobble/100)*maxDelay`（`MAX_DELAY_MS`=10ms）。
- **Speed（揺れの速さ, 210）**: LFO レート。`speedHz = 0.5〜14Hz` を指数マップし、更新間隔・平滑をそこから算出。
- **Occur（頻度, 211）**: 100%=常時 ON。<100% は **BPM ビートごとにシード付き判定**（`rand01(beat) < occur/100`）＝同じ BPM・同じ開始なら **同じビートで鳴る（再現性あり）**。ON/OFF は ~5ms クロスフェード。

```
speedHz = 0.5*(14/0.5)^(speed/100);  interval = sr/speedHz;  smooth = 1-exp(-2π·speedHz/sr)
if (counter<=0){ target = rand*2-1; counter = interval }
cur += smooth*(target - cur)
beat = floor(frame / (sr*60/bpm));  active = occur>=100 || rand01(beat) < occur/100
occGate += gateCoef*((active?1:0) - occGate)         // ~5ms クロスフェード
delay = base + depth*occGate*cur
data = lerp(buf[floor(w-delay)], next, frac)          // フラクショナル読み出し
```

バッファは `maxDelay`(=Depth 上限) で確保するので Speed に依らず安全。`wobble=0` でも基準ディレイ（≈数ms）は通る（ピッチ変化なし）。bpm は transport 供給（[ARCHITECTURE.md](./ARCHITECTURE.md) §4）。量感は耳で調整。

### Glitch（`dsp/glitch.ts`）

自前 `frame` をグリッド（≈80ms）に割り、シード付き決定論ハッシュで判定 → **同じ再生で同じ位置**＝再現性あり。質感はリピート/ゲートのミックス。

```
k = floor(frame/step);  pos = frame - k*step
on = rand01(k*2+1) < (glitch/100)*0.8
type = rand01(k*2+2) < 0.5 ? stutter : gate
// stutter: 前半 slice(≈30ms) を取り込み素通り、後半はループ再生
// gate: 無音化、両端 fade(≈3ms) でクリック回避
```

**Spectral Fill（212）** ON: gate の無音を埋めず **スペクトル反転音**を差し込む。`(-1)^n`（サンプル毎に符号反転）を掛けると周波数特性が低↔高にミラーされる。エッジは gate フェードでクロスフェード:

```
gateMix = 1 - gateGain;  sign = (frame & 1) ? -1 : 1
fill ? data = data*(1-gateMix) + (data*sign*0.7)*gateMix     // スペクトル反転を差し込む
     : data *= gateGain                                       // 無音(従来)
```

### Output / Bypass（`distortion.ts`）

```
out = processed * 10^(outDb/20)
out = out + (dry - out) * bypassMix              // bypassMix→1 で dry(真のバイパス)
```

## 4. オーバーサンプリング（Phase 3 の設計メモ）

ハードクリップは帯域外倍音を生みナイキスト超成分が折り返る（エイリアシング）。アップ（zero-stuff+LPF）→ クリップ → ダウン（AA LPF ≈`0.45·元fs` → 1/N 間引き）。half-band FIR / Butterworth など。倍率変更は構造が変わるためグラフ再構築。FIR は群遅延の申告が要る。

## 5. 既知のリスク

- **ザイパーノイズ**: k-rate ゲインのブロック境界段差。可聴なら 1-pole スムージング追加。
- **Loudness の追従遅れ**: 遅い（~300ms）のでノブ操作後 1 秒弱で音量が整う（仕様。速くするとポンプ）。
- **計算補正の前提**: Drive/Tone makeup は基準信号前提。極端に小/大な信号では Loudness Match（自動トリム）が残差を埋める。Auto Gain OFF 時は計算補正のみ。
- **Glitch のクリック**: stutter ループ境界は微小クリックが出うる（質感として許容）。gate はフェード済み。
- **Wobble レイテンシ**: 常時 ≈数ms。Dry/Wet 無しなのでコムフィルタ問題は無し。

## 6. 実装対応表（機能 → ファイル）

| 機能                          | 置き場所                                                 |
| ----------------------------- | -------------------------------------------------------- |
| 組み立て・セクション/バイパス | `distortion.ts`（クロスフェード）                        |
| Drive / Clip / makeup / Tone  | `dsp/saturation.ts`                                      |
| 遅い自動トリム                | `dsp/loudness.ts`                                        |
| ピッチのヨレ                  | `dsp/wobble.ts`                                          |
| 再現性グリッチ                | `dsp/glitch.ts`                                          |
| パラメータ定義（SSoT）        | `params.ts`（[ARCHITECTURE.md](./ARCHITECTURE.md) §4-5） |

> worklet は `distortion.ts`（プロセッサ登録名 `'distortion'`）。`my-delay` からリネーム済み（[DECISIONS.md](./DECISIONS.md) 2026-06-20）。

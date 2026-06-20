# DSP — 歪みアルゴリズム仕様（実装の核）

> DSP は `src/audio/worklets/` 配下の**ユニットに分割**。`distortion.ts` は組み立て役、実体は `dsp/*.ts`。
> 実装はここに従う。アルゴリズムを変えたら **先にここを直し**、[DECISIONS.md](./DECISIONS.md) に理由を追記する。
> 構成の俯瞰は [ARCHITECTURE.md](./ARCHITECTURE.md) §2。
>
> ステータス: **v0.3** / 最終更新: 2026-06-21

## 0. 前提

- サンプル単位処理。`process()` は 128 サンプル／ブロック（Web Audio 標準）。
- パラメータは AudioParam（k-rate、ブロック先頭1値）で受け取る（[ARCHITECTURE.md](./ARCHITECTURE.md) §4）。
- 各ユニットは `constructor(sampleRate)` で定数を算出。音作りの定数は**各ユニット冒頭**に集約（後から調整しやすく）。
- ステレオ整合: Wobble の LFO・Glitch の判定・makeup ゲイン（Drive/Tone）は **全 ch 共通**。フィルタ/ディレイ/スライスのバッファは **ch 毎**。

## 1. セクションと段構成

5 セクション（Drive / Pitch / Glitch / Band / Master）。UI も同じ区切り（[SPEC.md](./SPEC.md) §6）。
全体は **帯域スプリット**で挟む: `in → band/rest 分割 →` 下の段（band 側）`→ recombine(+Solo/Mute)`（§2b）。実処理順は上から下。

| セクション | 段              | 内容                                                                                                                 | パラメータ                                               | ユニット            |
| ---------- | --------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------- |
| **歪み**   | Drive           | `x *= 10^(driveDb/20)`                                                                                               | Drive(200)                                               | `dsp/saturation.ts` |
| 歪み       | Hard Clip       | `clamp(x, -1, +1)`                                                                                                   | —                                                        | 〃                  |
| 歪み       | Drive makeup    | **入力レベルを見て** RMS＋知覚明るさを打ち消す（実効ドライブ a·Drive・即時）。Comp で envelope 速さ＝圧縮/保持を切替 | Drive 連動 / Comp(222)                                   | 〃                  |
| 歪み       | Tone（Tilt EQ） | 低/高を逆方向にゲイン（暗⇄明）＋ Tone makeup                                                                         | Tone(201)                                                | 〃                  |
| **Pitch**  | Wobble          | 可変ディレイのピッチのヨレ（Depth/Speed/Occur）                                                                      | Wobble(203)/Speed(210)/Occur(211)+bpm(209)/Pitch On(207) | `dsp/wobble.ts`     |
| **Glitch** | Glitch          | 再現性グリッチ（リピート/ゲート）＋スペクトル反転フィル                                                              | Glitch(204)/Spectral Fill(212)/Glitch On(217)            | `dsp/glitch.ts`     |
| **Master** | Output Gain     | `y *= 10^(outDb/20)`                                                                                                 | Output(202)                                              | `distortion.ts`     |
| Master     | Bypass          | 全体を dry へクロスフェード                                                                                          | Bypass(208)                                              | 〃                  |

- セクション ON/OFF（Drive On=206 / Pitch On=207 / Glitch On=217）・Solo/Mute・Bypass(208) は **クリック回避のクロスフェード**（≈8ms 平滑）で切替（`distortion.ts`）。
- 帯域スプリット（Band Lo=213 / Hi=214 / Solo=215 / Mute=216）は §2b。OS（Phase 3）は Hard Clip の前後に挿入予定（§4）。

## 2. 音量を「常に一定」に（入力レベル連動フィードフォワード）⭐

「挿してる間ずっと音量一定」を、**Drive/Tone と入力レベルから計算して下げる**フィードフォワードで満たす。**出力は測らない**（後追いで下げるリアクティブ段なし＝ラグ・ムラ・swell-duck が原理的に出ない）。

> ⚠️ **ノブ値だけ**だと「入力フルスケール前提」の較正になり、入力が小さいと **Drive がただのゲイン化して音量が上がる**（クリップ手前では歪まず増幅するだけなのに、フルスケール前提の makeup は少ししか下げない）。これが「補正が追いつかない」の正体。そこで **入力ピーク envelope `a`（出力でなく入力）** を見て、**実効クリップドライブ `Geff = a·driveLin`** で補正を評価する。`a` は入力が一定なら steady ＝ **Drive を回した瞬間に効く**（遅延ゼロ）。

- **Drive makeup（RMS）**: `clip` で増える RMS を `Geff` から逆算。**クリップ前(Geff≤1)＝`1/driveLin`（ゲインを完全相殺＝音量不変・ダイナミクス保持）**、フルスケール(a=1)で従来式。
- **Drive makeup（知覚＝明るさ）**: クリップ倍音の**明るさ（＝ラウドネス増）**を、`Geff` で引く静的表（`dsp/weighting.ts` の重み付け）で打ち消す。
- **Tone makeup**: Tilt の知覚ラウドネス増分を基準スペクトルから逆算して打ち消す。
- 総合: `makeup = a · driveMakeup(Geff) · table(dB(Geff))`（per-block・k-rate）。
- **Comp(222)**: 入力 envelope `a` の速さで**ダイナミクスの圧縮/保持**を切替（ON=遅い＝自然圧縮・既定 / OFF=速い＝保持。下記「入力レベル envelope ＋ Comp」）。音量恒常（vs Drive）は両モード維持。

> 原理: クリップのラウドネス増は **入力レベル×Drive**（どれだけクリッパを叩くか）で決まる ⇒ ノブだけでは追えず、入力レベルが要る。入力（出力でなく）を見るので **Drive 操作に遅延ゼロ・出力 swell/duck なし**。**RMS 一定 ≠ 知覚音量一定** なので明るさも `Geff` 連動で引く。
> ⚠️ 入力を正弦と見なすモデル＋基準正弦較正なので**実素材では完全一定でなく僅かな差は残る**（固定オフセット。時間的なラグ/ムラではない）。効きの調整は `WEIGHT_HIGH`/`REF_F0_HZ`。リアクティブな Loudness Match・Auto Gain(205) は**撤去済み**、look-ahead は SDK レイテンシ非申告で VST 不可（[DECISIONS.md](./DECISIONS.md) 2026-06-21）。

### 入力レベル envelope ＋ Comp（`dsp/saturation.ts`）

入力（=クリッパ前）のピークを attack/release で追う（出力でなく入力＝feed-forward）:

```
p = max|input| (ch 横断・サンプル毎)
env += (p>env ? atk : rel)·(p − env)
a = max(env, 1e-6)                        // 入力振幅推定（正弦近似）
```

`a` は makeup 評価にのみ使う（音声には掛けない）。Drive を回しても `a` は steady ＝ makeup は driveLin で即時更新（遅延ゼロ）。

**Comp(222) で envelope の速さ＝ダイナミクスの扱いを切替**:

- **Comp OFF（ダイナミクス保持）= 速い**（ATK 5ms / REL 150ms）。`a` がトランジェントに追従 → makeup が各音を再レベル → クリップが潰した分を持ち上げ直す＝**出力ダイナミクス≈入力**（クリーンな粒立ち・歪んでもレンジ残る）。
- **Comp ON（自然圧縮・既定）= 遅い**（ATK 250ms / REL 400ms）。`a` は操作点＝サステインのレベルだけ追い、**トランジェントは動かさない** → トランジェントは `clip` で頭打ち＝**ダイナミクスレンジが圧縮**（普通の歪み）。サステイン（≈a, クリップ前）は makeup=1/driveLin で入力レベル維持＝**レベル感は一定**。Drive↑で頭打ちが下がる＝圧縮が増える。
- **Comp ON のレベル補償（ざっくり一律トリム）**: 圧縮でピークが潰れる分、Comp OFF（≒dry）より RMS が下がる。そこで Comp ON のみ `makeup` に最大 `COMP_TRIM_DB`(既定7dB・耳調整) のトリムを足して OFF/dry に近づける（＝コンプの makeup gain・密度感）。**クリップ量(操作点 Geff の dB)でゲート**し、`Geff≤0dB`（歪んでない）→0、`COMP_TRIM_FULL_DB`(≈12dB) 以上→最大。低 Drive では中立（bypass 近接を壊さない）。Drive に即時（geffDb は driveLin で即更新）。簡易近似なので素材により残差あり（耳調整: `COMP_TRIM_DB`/`COMP_TRIM_FULL_DB`）。
- どちらも `a` は入力由来＝Drive 操作に遅延ゼロ・出力非測定（swell/duck なし）。トグル切替は coef を変えるだけ＝state 連続＝クリック無し。`ENV_*_(SLOW_)MS` は耳調整。

### Drive makeup（RMS、`dsp/saturation.ts`）

`clip(G·sin)`（unit sine, G=実効ドライブ）の RMS を入力 RMS に一致させるゲインを `G` から算出:

```
G ≤ 1:  MS = G² / 2          → makeup = 1/G（クリップ前＝ゲイン相殺）
G > 1:  θc = asin(1/G);  MS = (2/π)[ G²(θc/2 − sin(2θc)/4) + (π/2 − θc) ]
        makeup_RMS = sqrt(0.5 / MS)
```

実行時は **実効ドライブ `Geff = a·driveLin`** で評価し、入力レベル `a` を掛けて戻す:
`makeup = a · driveMakeup(Geff) · table(dB(Geff))`。検算: `a=1`（フルスケール）→ 従来の `driveMakeup(driveLin)·table`。`Geff≤1`（クリップ前）→ `a·(1/Geff)·1 = 1/driveLin`（音量不変・ダイナミクス保持）。

### Drive makeup（知覚＝明るさ、`dsp/saturation.ts`）

RMS makeup は**素の RMS** しか合わせず、クリップ倍音が足す**明るさ**を取りこぼす。そこで起動時に
**知覚重み付きラウドネスを Drive=0（透過）に揃える総ゲイン** を表に焼く（基準正弦 `REF_F0_HZ`≈330Hz・
`dsp/weighting.ts` の重み付けと同一）:

```
nPer = round(sr / REF_F0_HZ)                          // 基準正弦 1 周期
wms(G) = Σ weight(clip(sin·G))²  /nPer                 // ウォームアップ後 1 周期の重み付き平均二乗
fullMakeup(G) = sqrt( wms(透過) / wms(G) )             // その波形(unit sine を G でクリップ)の重み付きラウドネスを透過に一致
table[dB(G)]  = fullMakeup(G) / driveMakeup(G)         // RMS makeup に乗せる「明るさ」分
// 実行時: table は **実効ドライブ Geff=a·driveLin の dB** で引く（入力レベル連動）
```

- 表は「unit sine を実効ドライブ G でクリップした波形」の明るさ補正なので、実信号(振幅 a・ノブ g)＝`clip(a·g·sin)` ＝ G=a·g クリップと同形 ⇒ 同じ表を `Geff=a·driveLin` で引けばよい（`a=1` で従来＝`driveDb` 引き）。
- `Geff≤1`（クリップ前）→ table≈1（明るさ増なし）。表は 0–48dB を `DRIVE_TABLE_SIZE`=96 点。
- ⚠️ 入力を正弦と見なすモデル＋基準正弦(330Hz)較正。実素材では僅かな固定差が残る（ラグ/ムラではない）。効きすぎ（明るい音が痩せる）なら `WEIGHT_HIGH`（weighting.ts）か `REF_F0_HZ` を耳調整。

### Tone makeup（`dsp/saturation.ts`）

Tilt で明るく（高域ブースト）すると知覚音量が上がる分を下げる。基準スペクトルの低/高エネルギー比 `pLow/pHigh`（`TONE_COMP_HIGH_WEIGHT`=0.6）で:

```
toneComp = 1 / sqrt(pLow*gLow² + pHigh*gHigh²)
```

`tone=0` で 1（透過）。重みは耳で調整可（定数）。

> **リアクティブな Loudness Match は撤去**（2026-06-21）。「下げるまでの間（後追いラグ）が気持ち悪い／ムラが出る」ため、出力を測る段をやめ、上記の純フィードフォワード（ノブ値から計算）だけにした（[DECISIONS.md](./DECISIONS.md) 2026-06-21）。`dsp/weighting.ts` は Drive 知覚 makeup 表の構築に使われ続ける。

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
- **基準の使い分け**: 各セクション ON/OFF（satMix 等）の dry 基準は **band-dry（bandPre）**。全体 Bypass だけ **元入力（fullDry）** 基準。
- エフェクトが中立なら `bandPost = band` → `band+rest = in` で完全透過。`lo=20/hi=20k` で全帯域＝実質オフ。`lo>=hi` は通過帯域が空 → 全 dry。
- ⚠️ 完全なブリックウォール分離は FFT/線形位相が要る（レイテンシ増）。現状は IIR 24dB/oct（必要なら将来 OS と併せ検討）。重い処理時は境界周辺に位相由来の微小アーティファクトが出うる（中立時は無し）。

## 2c. Howl（廃止）

> **Howl セクションは削除**（2026-06-21）。金属味の付加を数案（ウェーブフォルダー / 外部キャリア RM / 原音自己 RM / 奇数倍音エキサイター）試したが、いずれも狙いに届かず撤去した（[DECISIONS.md](./DECISIONS.md) 2026-06-21）。試行は git 履歴（コミット `e2d4b81` 他）に残る。将来やり直す場合は別アルゴリズムで起こす。

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

- **ザイパーノイズ**: k-rate makeup（`driveMakeup·table`）のブロック境界段差。Drive 高速スイープで可聴なら ~8ms 1-pole で `makeup` を per-sample スムージング（`distortion.ts` の `TOGGLE_SMOOTH_MS` イディオム）。
- **音量恒常の精度**: 入力レベル連動フィードフォワード（計算のみ・出力非測定）なので**ラグ/ムラ/swell-duck は出ない**。入力を正弦と見なすモデル＋基準正弦(330Hz)較正のため**実素材では完全一定でなく僅かな固定差は残る**（時間変動でない）。明るい実素材で痩せるなら `WEIGHT_HIGH`/`REF_F0_HZ` を下げる。
- **入力 envelope ＋ Comp**: `a` はピーク追従。**Comp OFF=速い(5/150ms)＝ダイナミクス保持**、**Comp ON=遅い(250/400ms)＝自然圧縮**（操作点だけ追いトランジェントはクリップで頭打ち）。Comp ON ではセクションのレベル変化に ~250ms で追従＝緩い操作点適応が乗る（入力由来・musical 時定数なので毎音 swell/duck とは別物）。圧縮の強弱は Drive と `ENV_*_SLOW_MS` で調整。
- **Glitch のクリック**: stutter ループ境界は微小クリックが出うる（質感として許容）。gate はフェード済み。
- **Wobble レイテンシ**: 常時 ≈数ms。Dry/Wet 無しなのでコムフィルタ問題は無し。

## 6. 実装対応表（機能 → ファイル）

| 機能                                   | 置き場所                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| 組み立て・セクション/バイパス          | `distortion.ts`（クロスフェード）                        |
| Drive / Clip / makeup(RMS+知覚) / Tone | `dsp/saturation.ts`（音量恒常はここで完結）              |
| 知覚重み付け（明るさの音量換算）       | `dsp/weighting.ts`（Drive 知覚 makeup 表の構築に使用）   |
| ピッチのヨレ                           | `dsp/wobble.ts`                                          |
| 再現性グリッチ                         | `dsp/glitch.ts`                                          |
| パラメータ定義（SSoT）                 | `params.ts`（[ARCHITECTURE.md](./ARCHITECTURE.md) §4-5） |

> worklet は `distortion.ts`（プロセッサ登録名 `'distortion'`）。`my-delay` からリネーム済み（[DECISIONS.md](./DECISIONS.md) 2026-06-20）。

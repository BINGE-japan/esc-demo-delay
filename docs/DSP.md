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
- ステレオ整合: Glitch の判定・Pitch の warp カーブ・makeup ゲイン（Drive/Tone）は **全 ch 共通**。フィルタ/スライス/Pitch ディレイのバッファは **ch 毎**。

## 1. セクションと段構成

4 セクション（**信号フロー順** = Band / Drive / Glitch / Master）。Pitch は Glitch 内のノブ。UI も同じ区切り（[SPEC.md](./SPEC.md) §6）。
全体は **帯域スプリット**で挟む: `in → band/rest 分割 →` 下の段（band 側）`→ recombine(+Solo/Mute)`（§2b）。実処理順は上から下。

| セクション | 段                 | 内容                                                                                                                  | パラメータ                                                            | ユニット            |
| ---------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------- |
| **歪み**   | Drive              | `x *= 10^(driveDb/20)`                                                                                                | Drive(200)                                                            | `dsp/saturation.ts` |
| 歪み       | Hard Clip          | `clamp(x, -1, +1)`                                                                                                    | —                                                                     | 〃                  |
| 歪み       | Drive makeup       | **入力レベルを見て** RMS＋知覚明るさを打ち消す（実効ドライブ a·Drive・即時）。Comp で envelope 速さ＝圧縮/保持を切替  | Drive 連動 / Comp(222)                                                | 〃                  |
| 歪み       | Tone（Tilt EQ）    | 低/高を逆方向にゲイン（暗⇄明）＋ Tone makeup                                                                          | Tone(201)                                                             | 〃                  |
| **Pitch**  | Warp ピッチ寄れ    | 可変ディレイを glitchPhase ロックの決定論カーブで揺らす＝再現性ワウ（Glitch の後・帯域内）                            | Pitch(204)                                                            | `dsp/pitch.ts`      |
| **Glitch** | ステップシーケンサ | ブロック(隣接)モデル・6タイプ(Dry/Glitch/Freeze/Reverse/Mute/Repeat)＋Random モード・小節数1/2/4・BPM拍ロック・再現性 | Glitch(204)/On(217)/Random(290)/Bars(288)/Step×64(223-286)/phase(287) | `dsp/glitch.ts`     |
| **Master** | Output Gain        | `y *= 10^(outDb/20)`                                                                                                  | Output(202)                                                           | `distortion.ts`     |
| Master     | Bypass             | 全体を dry へクロスフェード                                                                                           | Bypass(208)                                                           | 〃                  |

- セクション ON/OFF（Drive On=206 / Glitch On=217）・Solo/Mute・Bypass(208) は **クリック回避のクロスフェード**（≈8ms 平滑）で切替（`distortion.ts`）。Pitch(204) は depth ノブ。
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
- **Comp ON のレベル補償（ざっくり一律トリム）**: 圧縮でピークが潰れる分、Comp OFF（≒dry）より RMS が下がる。そこで Comp ON のみ `makeup` に最大 `COMP_TRIM_DB`(既定4dB・耳調整) のトリムを足して OFF/dry に近づける（＝コンプの makeup gain・密度感）。**クリップ量(操作点 Geff の dB)でゲート**し、`Geff≤0dB`（歪んでない）→0、`COMP_TRIM_FULL_DB`(=6dB) 以上→最大で**以降一定**。低 Drive では中立（bypass 近接を壊さない）。`FULL` を低く（12→6）して**早期プラトー**にし「Drive を上げるほど Comp ON が大きくなる」を抑えた（2026-06-21）。簡易近似なので素材により残差あり（耳調整: `COMP_TRIM_DB`/`COMP_TRIM_FULL_DB`）。
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

### Pitch（`dsp/pitch.ts`）

**Vinyl の Warp 風＝再現性のあるピッチ寄れ/ワウ**。可変ディレイを「決定論カーブ」で揺らし、読み出し速度変化＝ドップラーでピッチを寄れさせる。Glitch の後・帯域内。`Pitch(204)` ノブ=揺れ量(depth)。トグル無し（depth=0 でほぼ透過＝中心ディレイのみ）。

カーブは **値ノイズ**: パターン内位相 `glitchPhase`(0..1) を `K=Rate` 区間に分け、各点 `rand01(k)∈[-1,1]` を **smoothstep 補間**。`k1=(k0+1)%K` でループ端が連続（h[K]=h[0]）＝**パターンごとに同形＝毎ループ同じ揺れ＝再現性**。

```
x = glitchPhase * K;  h0 = rand01(floor(x)%K); h1 = rand01((floor(x)+1)%K)
mod    = h0 + (h1-h0)*smoothstep(frac(x))      // [-1,1]
target = Base + mod * (depth/100) * Swing       // block 毎の目標ディレイ
cur   += smoothCoef*(target - cur)              // per-sample 平滑（block/rAF 段差除去）
y      = lerp(buf[w-cur], buf[w-cur+1], frac)   // フラクショナル読み出し（ドップラー＝寄れ）
```

glitchPhase は block(≈rAF 60Hz)更新だが per-sample 平滑でジッタを音に入れない。耳で確定（2026-06-21）: `SWING_MS`=16(±変調幅)・`BASE_MS`=20(中心ディレイ)・`RATE`=4(K=区間数=細かさ/速さ)・`SMOOTH_MS`=4。`BASE`≥`SWING` でディレイが正。band/rest は相補なので中心ディレイのコムは実質無し。揺れ速度はパターン長(bars)にも依る（長いほど遅い）。

### Glitch — ステップシーケンサ（`dsp/glitch.ts`）⭐

横=**16分ステップ** / 縦=タイプの択一パターンを、再生中の拍に当たるステップで適用。**ループ長＝`Bars(288)`(1/2/4 小節)** で可変＝パターン=`bars×16`(最大64) ステップでループ＝**再現性**。拍ロックは曲タイムライン（VST）/再生開始基準（Web）。タイプ enum: **0=Dry(空=素通り) / 1=Glitch(極短ラチェット) / 2=Freeze / 3=Reverse / 4=Mute / 5=Repeat(16分)**。

**ブロック(隣接)モデル**: 同一 enum の連続セル＝1ブロック（**パターン頭でのみ分割＝小節跨ぎ可**）。**ブロック幅＝その効果の継続長**（隣接で伸ばす＝追加操作なし）。`steps[]`（最大64）が毎ブロック来るのでラン先頭で `patternSteps`(=bars×16) まで前方走査して `blockLen` を確定。ブロック頭で `blockStartWrite`(履歴位置)・chunk・Freeze スナップをラッチ。`blockPhase = localPos − blockStartPos`。

**Random モード（トグル `glitchRandom`/290）**: グリッドを無視し、**全ステップで** seed=絶対step から `microKind∈{0 dry / 1 ラチェット / 2 逆 / 3 ハーフ}` を再抽選＝決定論ランダム（dry も混ざる・再現性あり）。ブロックモデルは使わずステップ独立。モード切替時は次ステップで再ラッチ。

**拍同期（拍ロック＋サンプル精度＋ジッタ耐性）**:

```
// App: posSec=positionSamples/sr(VST) または ctx.currentTime-start(Web); secPerPattern=60/bpm*4*bars
//      glitchPhase = (posSec mod secPerPattern)/secPerPattern  （0..1・小マグニチュード＝float精度安全）
// worklet（glitch.ts）: stepLen=sr*60*4/bpm/16; samplesPerPattern=bars*16*stepLen
hostPos = glitchPhase*samplesPerPattern
d = shortestDiff(hostPos, localPos, samplesPerPattern)
if |d| > SNAP_TOL(≈50ms): localPos = hostPos; 次サンプルで境界再ラッチ; resync フェード
// 以降 localPos をサンプル毎に +1, samplesPerPattern で wrap（サンプル精度の自走）
stepIdx = floor(localPos / stepLen);  posInStep = localPos - stepIdx*stepLen
```

小ドリフトは無視＝**rAF(60Hz) ジッタを音に入れない**。大ドリフト（シーク/ループ/再生開始）だけスナップ。出力は測らない。

**履歴リング**: ch 毎に `HISTORY_MS`(=2000ms,≈768KB stereo@48k) を全サンプル書込。grain/Reverse はここから読み（chunk・revLen ≤ `historyLen/2` にクランプ）。grain は `blockStartWrite` 終端の chunk をループ読み（シーム crossfade でクリック回避）。

**タイプ別**（`out=dry*(1-wet)+fx*wet`、wet=`Glitch(204)/100`×端フェード×再同期。**端フェードはブロック端のみ**＝内部ステップ境界では絞らない）:

```
Dry:     fx = dry（空セル）
Glitch:  grain = 1/32音符の極短スライスをループ＝ラチェット/アーティファクト（chunk 固定）
Freeze:  ブロック頭で直近 FREEZE_REGION(=730ms) を凍結バッファにスナップ→重なり合う窓化グレイン
         (FREEZE_GRAIN=120ms・FREEZE_VOICES=12・overlap=8・読み位置±JITTER≈50ms) を Hann 窓で
         重ね合わせ、**窓和で正規化**（包絡一定＝トレモロ/粒を抑制、立上り floor で増幅回避）→
         GAIN(=2.4)→**2-pole HP(iceberg・310Hz 固定・Freeze の wet のみ)で低域カット**。
         単一ループのコム/周期が無い滑らかな持続音（≠スタッター）
Reverse: hist[blockStartWrite − blockPhase]（revLen=ブロック幅）＝直前ブロック幅を逆再生
Mute:    gate（中央=無音・両端 FADE）
Repeat:  chunk=16分(stepLen) を継続長(ブロック幅)ぶんループ。幅>16分 で連続ループに聞こえる
```

**Random モード時**（グリッド無視・全ステップ独立）: `microKind` で `0 dry / 1 ラチェット(1/32) / 2 逆(ステップ幅) / 3 ハーフ(stepLen/2 ループ)` を毎ステップ抽選。端は microEnv フェード。

`Glitch(204)`=全体 wet（既定100、空グリッド=全Dryで透過）。`Random(290)`=Random モード トグル。

⚠️ Glitch は **loudness 後・band 内**で動作＝Reverse/Repeat は「歪んだ band 信号」のグレイン。4/4 前提(v1)。**同タイプ隣接は必ず融合**（独立した同タイプ短ブロック連打は不可・要ギャップ）。ブロックは**パターン頭でのみ分割**＝小節跨ぎブロック可。低BPM履歴・自動化レーン・停止中ホールドは [SPEC.md](./SPEC.md) §8。Tape-stop は後日。

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
- **Pitch**: 中心ディレイ ≈数ms（band/rest 相補でコムは実質無し）。可変ディレイの読み出しは線形補間（高速変調で僅かな帯域低下＝許容）。

## 6. 実装対応表（機能 → ファイル）

| 機能                                   | 置き場所                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| 組み立て・セクション/バイパス          | `distortion.ts`（クロスフェード）                        |
| Drive / Clip / makeup(RMS+知覚) / Tone | `dsp/saturation.ts`（音量恒常はここで完結）              |
| 知覚重み付け（明るさの音量換算）       | `dsp/weighting.ts`（Drive 知覚 makeup 表の構築に使用）   |
| Warp ピッチ寄れ                        | `dsp/pitch.ts`                                           |
| 再現性グリッチ                         | `dsp/glitch.ts`                                          |
| パラメータ定義（SSoT）                 | `params.ts`（[ARCHITECTURE.md](./ARCHITECTURE.md) §4-5） |

> worklet は `distortion.ts`（プロセッサ登録名 `'distortion'`）。`my-delay` からリネーム済み（[DECISIONS.md](./DECISIONS.md) 2026-06-20）。

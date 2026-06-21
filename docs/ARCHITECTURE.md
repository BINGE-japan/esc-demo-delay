# ARCHITECTURE — 構造仕様（How の SSoT）

> ファイル/モジュール構成・信号フロー・SDK 連携・パラメータ橋渡しを定義する。
> 配線を変えたら **先にここを直し**、[DECISIONS.md](./DECISIONS.md) に理由を追記してから実装する。
>
> ステータス: **v0.3** / 最終更新: 2026-06-21

## 1. 全体像

Web 技術（Vue + AudioWorklet）で書いたプラグインを、Suara SDK が runtime（VST / Web）の違いを吸収して両環境で動かす。
SDK の詳細は [src/sdk/index.ts](../src/sdk/index.ts) 参照。本書は **このディストーション固有の配線**を扱う。

## 2. ファイル / モジュール構成

DSP は**ユニット分割**（後から各要素を調整しやすく。[DSP.md](./DSP.md) §1/§6）。

| パス                                                                            | 役割                                                                                                          | 触る頻度 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| [src/App.vue](../src/App.vue)                                                   | グラフ構築・UI（params.ts 駆動・セクション）・橋渡し                                                          | 高       |
| [src/audio/worklets/params.ts](../src/audio/worklets/params.ts)                 | **パラメータ定義 SSoT**（worklet と App が共有）                                                              | 高       |
| [src/audio/worklets/distortion.ts](../src/audio/worklets/distortion.ts)         | worklet 本体＝組み立て役（セクション/Bypass クロスフェード）                                                  | 高       |
| [src/audio/worklets/dsp/band.ts](../src/audio/worklets/dsp/band.ts)             | 帯域スプリット（4-pole TPT SVF バンドパス）                                                                   | 中       |
| [src/audio/worklets/dsp/saturation.ts](../src/audio/worklets/dsp/saturation.ts) | 歪み（Drive→Clip→makeup(RMS+知覚)→Tone）。**音量恒常はここで完結**                                            | 中       |
| [src/audio/worklets/dsp/weighting.ts](../src/audio/worklets/dsp/weighting.ts)   | 知覚重み付け（明るさの音量換算）。Drive 知覚 makeup 表の構築に使用                                            | 中       |
| [src/audio/worklets/dsp/pitch.ts](../src/audio/worklets/dsp/pitch.ts)           | Pitch（Vinyl Warp 風＝可変ディレイ×glitchPhase ロックの決定論ワウ）                                           | 中       |
| [src/audio/worklets/dsp/glitch.ts](../src/audio/worklets/dsp/glitch.ts)         | グリッチ・ステップシーケンサ（ブロック隣接・raw=ベース6型\|Dive重ね・拍ロック・Random モード）                | 中       |
| [src/components/StepGrid.vue](../src/components/StepGrid.vue)                   | Glitch シーケンサ UI（クリップ式・8分カラム/内部16分・クリック8分作成+右端16分リサイズ・Dive重ね/Mute最下段） | 中       |
| [src/sdk/](../src/sdk/)                                                         | SDK（runtime 抽象）。原則編集しない（vendored）                                                               | 低       |
| `docs/`                                                                         | 仕様の SSoT                                                                                                   | 高       |

- 各 DSP ユニットは `class`＋`constructor(sampleRate)`。音作りの定数は**ユニット冒頭**に集約。
- `distortion.ts` は入力を dry に退避し、各ユニットを順に呼び、セクション ON/OFF・Bypass を**クロスフェード**で合成（[DSP.md](./DSP.md) §1）。
- Vite は worklet エントリ＋その import を**1ファイルにバンドル**（`?worker&url`）。分割しても出力は単一 worklet。

## 3. 信号フロー（グラフ構築）

[App.vue](../src/App.vue) `buildGraph()`:

```
createDawInput()  → MediaStreamAudioSourceNode → AudioWorkletNode('distortion') → ctx.destination
```

worklet 内のセクション順は [DSP.md](./DSP.md) §1。HMR は worklet 変更時に新 AudioContext でグラフ再構築（`import.meta.hot`）。

## 4. パラメータ SSoT と橋渡し ⭐

### SSoT = `params.ts`

- パラメータ定義（id / name / label / min / max / default / unit / section / toggle / log / hidden / grid / gridRole）は [params.ts](../src/audio/worklets/params.ts) の `PARAMS` 配列に**一元化**。ループ長定数（`STEPS_PER_BAR` / `MAX_BARS` / `MAX_STEPS` / `clampBars`）も同ファイルが export＝worklet・App・StepGrid が共有。
- **worklet**: `parameterDescriptors` を `PARAMS.map(...)` で生成。
- **App.vue**: `PARAMS` を回して `useParam` ハンドルと UI を生成（セクションで分割）。
- **`grid` フラグ**: `useParam` ハンドルは作る（StepGrid が読み書き＋VST 自動化）が**自動スライダ UI には出さない**。`hidden`（ハンドル自体作らない）との中間。Glitch の `step0..63` と `glitchBars` が該当＝`StepGrid.vue` が描画。種別は **`gridRole`（'step' / 'bars'）** で判別（App は name 文字列でなく gridRole で振り分ける）。
- ⇒ 値域や既定を変えるのは **`params.ts` 1 箇所**。worklet と App が自動追従（drift しない）。
- tsconfig: app は `src/audio/worklets/**` を exclude するが、`params.ts` は**純データ**なので App から依存 import しても型チェックを通る（環境固有 global を使わないこと）。`vp check` で検証済み。

### 橋渡し（値を DSP へ）

```
[Web]  ノブ/スイッチ → useParam.setFromUser() → useParam.value(reactive)
[VST]  DAW automation → SDK read path → useParam.value(reactive)
                                          │  App.vue watch(value)
                                          ▼
              AudioWorkletNode.parameters.get(name).value = ...  → worklet process() の parameters[name]
```

- **採用**: AudioWorklet ネイティブ **AudioParam**（k-rate）。Web=ノブ / VST=automation を `useParam.value` が同じ reactive 値に正規化済みなので watch→AudioParam で両 runtime 共通。
- トグル（各 ON / Solo / Mute / Bypass）も 0/1 の AudioParam。worklet 側でクロスフェード平滑（クリック回避）。
- 音量の計算補正（Drive/Tone makeup）は worklet 内で完結＝ノブ値から算出する純フィードフォワード（専用パラメータなし。リアクティブな自動トリムは撤去、[DECISIONS.md](./DECISIONS.md) 2026-06-21）。
- **bpm は例外的に transport 駆動**: hidden param（UI/useParam なし）。App が `watch(transport.state.tempo)` → `applyParam('bpm', tempo)`。Glitch が BPM グリッドで拍ロック・再現性を持つために worklet へ供給する。
- **glitchPhase も transport 駆動**: hidden param。App が再生中 rAF で `positionSamples`(VST)/`ctx.currentTime`(Web) から**パターン内位相(0..1・パターン長=bars×16)**を算出→`applyParam('glitchPhase', …)`。worklet はこれにサンプル精度で同期し Glitch ステップを拍ロック（大ドリフトのみスナップ）。停止中はホールド。Bars は App が `barsHandle` から読んで位相計算に使う。
- OS（Phase 3）だけは構造的なので AudioParam でなく `processorOptions`＋グラフ再構築。

## 5. パラメータ ID と SDK の規約

- `useParam(id, opts)` の `id` は VST controller の `addParameter` tag と一致必須（[param.ts](../src/sdk/param.ts) 冒頭）。
- 既存: synth `0..5` / saturator `100..102`。本プラグインは **200番台**:
  - 連続: Drive=200, Tone=201, Output=202, Pitch=204, Band Lo=213(log), Band Hi=214(log)
  - トグル: Drive On=206, Comp=222, Bypass=208, Solo=215, Mute=216, Glitch On=217, Random=290
  - `grid`（自動スライダ外・StepGrid 描画）: Bars=288（ループ長 1/2/4 小節）/ Step 1–64 = 223–286（raw 0..13＝ベース(0Dry/1Glitch/2Freeze/3Reverse/4Mute/5Repeat)|Dive(8)。クリップ式・8分カラム/内部16分）
  - 内部: bpm=209（App が `transport.tempo` を供給）/ glitchPhase=287（App がパターン内位相 0..1 を供給）。どちらも `hidden:true`・UI/useParam なし
  - 廃止/欠番: 203・210・211＝旧 Wobble 系（2026-06-21）/ 205＝旧 Auto Gain（2026-06-21）/ 207＝旧 Pitch On→Octave（共に撤去、2026-06-21）/ 212＝旧 Spectral Fill（2026-06-21）/ 218・219・220＝旧 Howl 系（2026-06-21）/ 221＝実験の名残 / 239＝旧 glitchPhase（287 へ移設）。再利用しない（VST tag 衝突回避）。204 は旧 Glitch wet→Pitch に転用（2026-06-21）
- Web runtime では `id` は read/write されず knob のローカル状態のみ。VST 配線時に controller 側 tag と突き合わせる。

## 6. runtime 差分の扱い

| 項目       | Web                                     | VST                              |
| ---------- | --------------------------------------- | -------------------------------- |
| 音声入力   | 仮想源（tone/file/pulse）               | DAW bus（main/sidechain）        |
| 再生制御   | DAW simulator の Play/Stop（transport） | DAW が供給（mount時に自動 play） |
| パラメータ | ノブ/スイッチのローカル状態             | DAW automation read/write        |
| 起点       | `runtime.isWeb`                         | `runtime.isVst`                  |

分岐は [App.vue](../src/App.vue) の `runtime.isWeb / isVst`。新規 UI も同じ分岐に乗せる。

## 7. ビルド/検証

- `vp dev` 開発（COOP/COEP 有効）/ `vp build` 本番 / `vp check` fmt+lint+typecheck。
- VST パッケージングはグローバル `suara` CLI（`vp run build:dev` 等）。
- worklet（`src/audio/worklets/**`、`dsp/` 含む）は `tsconfig.worklet.json`（DOM lib 無し）でチェック。DOM API を worklet に書かない。

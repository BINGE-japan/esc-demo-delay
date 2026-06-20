# DECISIONS — 決定ログ / 変更履歴（追記専用）

> 仕様変更・設計判断を **時系列で追記**する。古い項目は消さない（取り消す場合も「撤回」として追記）。
> 1項目 = 日付 + 決定 + 理由 + 影響箇所。実装より先にここへ書く。
>
> 形式: `### YYYY-MM-DD — タイトル` / **決定** / **理由** / **影響**

---

### 2026-06-20 — ドキュメント駆動（ドキュメント至上主義）で進める

**決定**: 開発はバイブコーディングで進める。`docs/` を仕様の SSoT とし、(1) 実装前に仕様確定、(2) 実装は常にドキュメント準拠、(3) 変更は必ず本ログ＋該当ドキュメントへ追記、の3ルールを CLAUDE.md にも明記。
**理由**: バイブコーディングで迷子にならないため。コードとドキュメントの乖離を「ドキュメントを先に直す」運用で防ぐ。
**影響**: `docs/SPEC.md` `docs/DSP.md` `docs/ARCHITECTURE.md` `docs/DECISIONS.md` `docs/TASKS.md` `CLAUDE.md` を新規作成。

### 2026-06-20 — 製品キャラクター = ファズ／ハードクリップ

**決定**: 基本シェイパーをハードクリップ `clamp(x,-1,+1)` にする。soft clip 系（オーバードライブ）・bitcrusher は採らない。
**理由**: ユーザー選定。攻撃的・荒いキャラクターを軸にするため。
**影響**: [DSP.md](./DSP.md) 段3、[SPEC.md](./SPEC.md) §2。ハードクリップ起因のエイリアシング対策として OS の重要度が上がる。

### 2026-06-20 — MVP優先のフェーズ戦略

**決定**: まず Drive + Output + ハードクリップ + 最小UI で end-to-end に音を出す。Tone→OS→キャラクター拡張は後フェーズ。
**理由**: ユーザー選定。動く土台を先に作り、迷子を防ぐ。
**影響**: [TASKS.md](./TASKS.md) のフェーズ定義、[SPEC.md](./SPEC.md) §3。

### 2026-06-20 — 搭載コントロール = Drive / Tone / Output / OS（Dry/Wet 除外）

**決定**: 入出力ゲイン・Tone・オーバーサンプリングを搭載。Dry/Wet ミックスは今回スコープ外。
**理由**: ユーザー選定。
**影響**: [SPEC.md](./SPEC.md) §4 パラメータ表。Dry/Wet が必要になれば新規 DECISION を起こして追加。

### 2026-06-20 — パラメータ橋渡しは AudioWorklet ネイティブ AudioParam

**決定**: `useParam.value`（reactive）を App.vue で watch し、`AudioWorkletNode` の AudioParam へ流す。worklet は `parameterDescriptors` で受ける。OS だけは構造的設定なので processorOptions + グラフ再構築。
**理由**: Web=ノブ / VST=DAW automation という別ソースが `useParam.value` に正規化済みのため、watch→AudioParam で両 runtime 共通経路になる。補間もブラウザ任せにできる。postMessage/SAB 自前は不要なコスト。
**影響**: [ARCHITECTURE.md](./ARCHITECTURE.md) §4、worklet の `parameterDescriptors`、App.vue の watcher 新設。

### 2026-06-20 — パラメータ ID は 200番台

**決定**: Drive=200, Tone=201, Output=202。OS は自動化対象外（ID なし）。
**理由**: 既存規約 synth `0..5` / saturator `100..102`（[param.ts](../src/sdk/param.ts)）と衝突回避し、100刻みの慣習に合わせる。
**影響**: [SPEC.md](./SPEC.md) §4、VST controller 配線時に `addParameter` tag と突き合わせ。

### 2026-06-20 — DSP は仮UIで先に通す（本命はパラメータ×UI）

**決定**: DSP の作り込みは後回しにし、audible チェーン（Drive→ハードクリップ→Tone→Output）を**仮UI（range スライダ）**で end-to-end に通して一旦「実装完了」とする。Tone（本来 Phase 2）は MVP と同じ橋渡し経路なので前倒しで実装。オーバーサンプリング（段2/4）は Phase 3 のまま保留。
**理由**: ユーザー判断 — 「DSP は手段で、本命はパラメータと UI をどう面白く絡めるか」。全パラメータを触れる土台を最短で用意し、以降は UI×パラメータの試行に集中する。
**影響**: worklet に段1/3/5/6 と `parameterDescriptors` を実装。App.vue に仮UI（Drive/Tone/Output）と AudioParam 橋渡し（watch）を追加。**仮UI は後で本UIに差し替える前提**。[TASKS.md](./TASKS.md) Phase 1 完了＋Phase 2 の DSP/橋渡しを前倒し。

### 2026-06-20 — worklet を distortion にリネーム（delay 命名を一掃）

**決定**: テンプレ由来の `my-delay` 命名を `distortion` に統一。ファイル `my-delay.ts`→`distortion.ts`、プロセッサ登録名 `'my-delay'`→`'distortion'`、クラス `MyDelay`→`Distortion`、App.vue の import/HMR/ノード名/表示テキストも追従。範囲は**コード＋ドキュメントのみ**（リポジトリ/パッケージ名 `esc-demo-delay` は据え置き）。
**理由**: ディストーションなのに delay 命名が残るのはドキュメント至上主義（迷子防止）と矛盾。audible 実装が一区切りでビルドも通っている今が安全なリネームのタイミング。
**影響**: worklet/App.vue のコード、ARCHITECTURE/DSP/TASKS/README のファイル参照を更新。[TASKS.md](./TASKS.md) Phase 4 のリネーム項目を完了に。

### 2026-06-20 — 触り心地パラメータ 5 点（Drive音量一定 / Tone tilt / Wobble / Glitch）

ユーザー要望の DSP 改善 5 点を実装。本命は「パラメータ × UI の絡み」のため DSP は決め打ちで通し、量感は耳で調整する前提。

1. **Drive を上げても音量が変わらない** → 段3b に **静的メイクアップ**を追加。基準サイン波で出力 RMS が一定になる補正を `driveLin` だけから算出（[DSP.md](./DSP.md) 段3b）。
2. **コンピング（ポンピング）しない** → 上記を**エンベロープ追従の動的オートゲインにせず静的**にした。レベルは揃うがコンプ的に動かない。ユーザー確認済み（「ポンピングさせない」）。
3. **Tone の効きを分かりやすく** → 1-pole LP を廃し **Tilt EQ（暗⇄明、pivot ~800Hz、±18dB）** に変更。パラメータ意味が Hz(log) → 双極 %（-100..+100, 既定0）に変わる（[DSP.md](./DSP.md) 段5）。
4. **ランダムなピッチのヨレ** → **Wobble(203)** 追加。可変ディレイ＋スムーズなランダム LFO でドップラー的にヨレさせる（[DSP.md](./DSP.md) 段7）。
5. **再現性のあるランダムグリッチ** → **Glitch(204)** 追加。自前サンプルカウンタをグリッドに割り、シード付き決定論ハッシュで判定 → 同じ再生で同じ位置。質感は**リピート/ゲートのミックス**（ユーザー選択）（[DSP.md](./DSP.md) 段8）。

**付随変更**: Output 既定を -6dB → **0dB**（メイクアップで音量が揃うため透過を既定に）。処理順は Output を最後に（Drive→Clip→Makeup→Tone→Wobble→Glitch→Output）。
**影響**: worklet 全面改修、App.vue にスライダ2本追加（Wobble/Glitch）と Tone の意味変更、parameterDescriptors / useParam / SPEC §4 / ARCHITECTURE §4-5 / DSP §1-2 を更新。

### 2026-06-20 — 音量恒常化 / セクション分離 / パーツ分け / バイパス（v0.3）

ユーザー要望「挿してる間 音量一定・パーツ分けで調整しやすく・歪みとピッチ&グリッチをUI/DSPで分離・バイパス」への対応。実装前に方針合意済み。

1. **音量を常に一定（ポンピングさせない）** → **2 段構え**で両立（[DSP.md](./DSP.md) §2）:
   - 計算補正（フィードフォワード・knob 由来＝信号追従しないのでポンプ皆無）: **Drive makeup**（RMS 逆算）＋ **Tone makeup**（可聴度=知覚ラウドネス逆算、新規。Tone は従来 補正ゼロだった）。
   - **遅い自動トリム（Loudness Match、~300ms）**: dry/wet RMS で残差を埋める。遅いのでポンプしない。Auto Gain(205) で ON/OFF。
   - ユーザーの「Drive増分を計算して下げ、Toneは可聴度から逆算」という案＝まさにフィードフォワード。ポンピング＝“量”でなく“速さ”の問題、と認識合わせ済み。
2. **セクション分離（DSP も UI も）** → 歪み / ピッチ&グリッチ / マスター の 3 つ。歪みセクションがラウドネス恒常の責任を持ち、ピッチ&グリッチは下流（グリッチの一瞬の音量変化は演出として自動ゲイン対象外）。
3. **パーツ分け（後から調整しやすく）** → DSP を `dsp/saturation.ts` / `loudness.ts` / `wobble.ts` / `glitch.ts` に分割、`distortion.ts` は組み立て役。音作りの定数は各ユニット冒頭に集約。**パラメータ定義は `params.ts` に SSoT 化**（worklet の descriptors と App の useParam/UI が両方ここから派生 → 数値変更は 1 箇所）。tsconfig 分離（app は worklets を exclude）でも純データなら共有 import が通ることを `vp check` で確認。
4. **バイパス** → 全体 Bypass(208) ＋ セクション個別 Drive On(206) / Pitch&Glitch On(207)。すべてクリック回避のクロスフェード（~8ms）。

**付随**: トグル系パラメータ 205-208 を追加（0/1 AudioParam）。旧 `Distortion` クラスは `DistortionProcessor`（組み立て役）に。
**影響**: worklet 全面再構成、App.vue を params.ts 駆動・セクション UI に、SPEC §2-6 / DSP 全面 / ARCHITECTURE §2,4,5 を更新。
**残課題**: 量感の耳調整（Tone makeup の高域重み、Wobble 深さ/レート、Glitch グリッド/確率、Loudness 時定数）。Auto Gain の基準レベル感。

### 2026-06-20 — Wobble の Depth/Speed/Occur 化 ＋ Glitch の Spectral Fill

ユーザー要望「Wobble に 揺れ幅・頻度（常に↔たまに、たまには BPM 準拠で再現性）・速さ／ Glitch に 無音へ周波数特性反転音を差し込むモード」への対応。

- **Wobble を 3 パラメータに**:
  - Depth(203, 旧 Wobble): 揺れ幅（ディレイ変調幅、`MAX_DELAY_MS`=10ms）。
  - Wob Speed(210): 揺れの速さ。LFO レートを 0.5〜14Hz に指数マップ（更新間隔・平滑をそこから算出）。バッファは Depth 上限で確保するので Speed 非依存に安全。
  - Wob Occur(211): 頻度。100%=常時 ON、<100%=「たまに」。**BPM ビートごとにシード付き判定**（`rand01(beat) < occur/100`）で **再現性あり**。ON/OFF は ~5ms クロスフェード。
  - そのため **bpm(209) を hidden param で新設**し、App が `transport.tempo` を流し込む（[ARCHITECTURE.md](./ARCHITECTURE.md) §4）。`params.ts` に `hidden` フラグ追加（UI/useParam を作らない）。
- **Glitch に Spectral Fill(212) トグル**: gate の無音区間を埋めず、**`(-1)^n` 変調のスペクトル反転音**（周波数特性を低↔高にミラー）を差し込む。エッジは gate フェードでクロスフェード。
  - 「周波数特性反転」は**スペクトル反転（低↔高ミラー）**と解釈。トーンの明↔暗逆転が意図なら別途切替可（要確認）。

**影響**: `params.ts`（+wobbleSpeed/wobbleOccur/glitchFill/bpm, hidden フラグ）、`dsp/wobble.ts`（全面）、`dsp/glitch.ts`（fill 追加）、`distortion.ts`（受け渡し）、`App.vue`（hidden 除外＋bpm 橋渡し）、SPEC §4 / DSP §1,3 / ARCHITECTURE §4-5 を更新。
**残課題**: Wobble の MAX_DELAY/Speed レンジ、Occur のグリッド（現状ビート単位）、Spectral Fill のレベル(0.7)を耳で調整。

### 2026-06-20 — Pitch/Glitch セクション分離 ＋ 帯域指定（Band Focus）

ユーザー要望「Pitch と Glitch のセクションも分ける」「エフェクトをかける周波数を指定（帯域内100%Wet/帯域外100%Dry、Solo/Mute 試聴、位相反転で抜き取る）」への対応。

- **Pitch / Glitch をセクション分離**: 旧 `fxOn`(207) を **Pitch On(207) と Glitch On(217)** に分割。UI も 3→**5 セクション**（Drive / Pitch / Glitch / Band / Master）。
- **帯域指定（Band Focus）**: 新ユニット `dsp/band.ts`。`band = bandpass(in, lo, hi)`、`rest = in − band`（**位相反転＝引き算で完全再構成**）。`band` にだけ全エフェクトを適用し `out = band 処理結果 + rest`（帯域内100%Wet / 帯域外100%Dry）。ユーザーの「位相反転で抜き取る」発想を採用。
  - フィルタ: 「**できる限りはっきり**」→ **4-pole（24dB/oct）TPT SVF**（HP×2/LP×2）。lo/hi スイープでジッパー無し。ブリックウォールは FFT/レイテンシ要のため将来。
  - **Solo(215)=帯域だけ試聴 / Mute(216)=帯域を抜いた残りだけ試聴**（クロスフェード、Solo 優先）。
  - スコープ: **全エフェクト一括**（1組の Lo/Hi）。ユーザー選択。
  - 基準: Loudness/セクション ON-OFF は band-dry、全体 Bypass は元入力。
- **Band Lo/Hi は log スケール**: `params.ts` に `log` フラグ追加、useParam と UI スライダ（0..1 正規化）を log に。

**影響**: `dsp/band.ts` 新規、`distortion.ts`（split→effects→recombine+Solo/Mute に再構成）、`params.ts`（pitchOn/glitchOn/bandLo/bandHi/bandSolo/bandMute, log フラグ）、`App.vue`（5 セクション・log スライダ・Hz 表示）、SPEC §4-6 / DSP §1,2b / ARCHITECTURE §2,5 を更新。
**残課題**: フィルタ次数（更に急峻 or FFT）、Solo が pre/post どちらの帯域か（現状 post）、量感調整。

> パラメータの範囲・既定値は v0.3 提案。確定したらここに「範囲確定」として追記する。

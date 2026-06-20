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

### 2026-06-20 — Howl（ハウリング倍音）追加：フィードバック・レゾネーター

ユーザー要望「ディストーションにハウリングみたいな倍音を付加」。方式は**フィードバック・レゾネーター**（ユーザー選択）。

- 新ユニット `dsp/howl.ts`：中庸Q の TPT SVF バンドパスを**フィードバックループ**に入れ、**ループ内 tanh ソフトクリップ**で限界周期を作る。feedback（=Howl 量）を上げると自己発振寸前まで行き、歪み信号で励起されて鳴く/悲鳴る。出力は**加算（倍音付加）**。
- パラメータ: **Howl(218)**=量 / **Howl Freq(219, log)**=共鳴周波数 / **Howl On(220)**。新セクション 'howl'（UI 6 セクションに）。
- **配置**: Drive 直後（Loudness の後段）。「倍音付加」＝意図的にエネルギーを足すので**音量一定の対象外**（howl は Loudness Match を通さない）。
- 安定化: feedback 有限(≤1.5)＋tanh で振幅有界＋freq クランプ。`howl=0` は完全素通り。
- 質問対応: 現状フィルタは ① Tone(Tilt EQ, saturation.ts) ② Band(band.ts) の2つのみ。独立レゾナンスが無かったので Howl がその系統の初の追加。

**影響**: `dsp/howl.ts` 新規、`params.ts`（howl/howlFreq/howlOn＋section 'howl'）、`distortion.ts`（Drive 直後に Howl セクション＋クロスフェード）、`App.vue`（SECTIONS に Howl）、SPEC §4-6 / DSP §1,2c / ARCHITECTURE §2,5 を更新。
**残課題**: FB_MAX(1.5)・level マップ・freq 既定の耳調整。加算で 0dBFS 超過の可能性（将来：出力ソフトリミット / freq のピッチ追従 / 倍音スタック）。次は Glitch 強化 → Pitch 強化（[TASKS.md](./TASKS.md)）。

### 2026-06-20 — Howl 是正：自己発振（ドローン）→ 入力駆動の共鳴サチュレーション

初版 Howl は `feedback = amt*1.5`（>1）で**自己発振**し、選んだ Freq が入力と無関係にドローン（＝オシレーターで単音を鳴らすのと同じ）になっていた。ユーザー指摘で是正。

- **是正方針（ユーザー選択）**: 入力駆動の共鳴サチュレーション。**自己発振させない**。入力を共鳴ピーク（フォルマント）で色付け→`tanh` でサチュレートし、**入力周波数に応じた飽和倍音**を加算。倍音は入力由来＝弾いた音に追従。入力が止まれば減衰（ドローンしない）。
- **発振しない実装**: feedback は **正規化バンドパス**（`prev = k*v1`, peak≈1）に掛けるので **loop gain ≈ fb < 1**（`FB_MAX=0.8`）。Q（鳴きの鋭さ）を上げても発振しない。
- Howl Freq の意味を「発振ピッチ」→「**鳴きの音色（フォルマント）周波数**」に変更（パラメータ定義・範囲は据え置き）。
- 定数: `Q 2..18 / FB_MAX 0.8 / drive 1.5..7`（amount で連動、耳調整）。

**影響**: `dsp/howl.ts` 全面書き換え（params/distortion/App は不変）。DSP §1,2c / SPEC §4 Howl 記述を是正。
**学び**: 高Q共鳴＋フィードバックは loop gain≥1 で容易に自己発振（ドローン化）。フィードバックは**正規化した**バンドパスに掛けて loop gain<1 を担保する。

### 2026-06-20 — Howl 再是正：共鳴系を廃し「入力依存ウェーブフォルダー」へ

是正版（入力駆動の共鳴サチュレーション）でも、結局 **固定 Freq の共鳴が鳴り続けてキャラが固定**というユーザー指摘。要件を「**1ノブで、上げると入力に対して大袈裟に倍音が付加され、入力の音でキャラが全然変わる**」と再定義。

- **結論: 共鳴フィルタ系は本質的にキャラ固定 → 全面的に非線形シェイピングへ。採用＝ウェーブフォルダー**（`folded = sin(g·x)`, `out = x + level·folded`, `g = lerp(1.2,6, amt)`）。
  - 折り返し回数が**入力の瞬時振幅/波形で激変** → 付加倍音のキャラが入力依存で激変（弱い=素直/強い=大量倍音）。強い IMD で単音・和音・ノイズが別物。
  - 固定周波数が無い＝ドローンしない・入力に完全追従。Drive(クリップ=潰す)とは別物（折り返し）。
- **1ノブ化**: `Howl Freq(219) を廃止`（共鳴ではないので不要）。`Howl(218)` で g と付加レベルが連動。Howl は無状態に。
- ⚠️ エイリアシング（高次倍音）→ OS=Phase 3 で低減予定。⚠️ 加算で 0dBFS 超過しうる（Output で）。
- 将来案: 自己FM（より高カオス）/ 非対称フォルド（偶数次）/ キャラクターノブ。

**影響**: `dsp/howl.ts` 全面（共鳴→sin フォルダ・無状態）、`params.ts`（howlFreq 削除）、`distortion.ts`（freq 引数・sr 削除）。DSP §1,2c / SPEC §4 / ARCHITECTURE §5 を更新。
**学び**: 「入力でキャラが変わる」要件には**共鳴（固定周波数を足す）ではなく非線形（入力の倍音を作る）**。ウェーブフォルダー/自己FM は IMD が強く入力依存が大きい。

### 2026-06-20 — Howl 音量一定化（Loudness 内側へ）＋ 金属感アップ

ユーザー指摘:「**バイパスで音量が変わらないのが本エフェクトの肝**。Howl で音量が変わりすぎ。あと上げても音があまり変わらない。もっと上げたら金属的倍音が跳ね上がるイメージ」。

- **是正1（音量一定）**: Howl を **Loudness Match の後段に置いて加算→音量増**になっていたのが原因。**Loudness の前段**へ移動し、Loudness が **Drive+Howl をまとめて dry に揃える**。→ Howl は「倍音だけ増えて音量は一定」。**バイパスでも音量不変の原則を回復**。
  - 信号順: `Drive→Clip→makeup→Tone → Howl → Loudness → Pitch → Glitch`（loud を howl の後ろへ）。
  - 「Howl は音量一定の対象外」という前回の決定を撤回。
- **是正2（金属感アップ／効きを強く）**: 折り返し量を `g = lerp(2,16, amt²)`（**二乗カーブ**で上げるほど急増）に拡大。Howl を上げると**金属的高次倍音が跳ね上がる**。音量変化が消えたことで効きも明瞭に。

**影響**: `distortion.ts`（loud.process を Howl の後へ移動）、`dsp/howl.ts`（g 拡大・二乗カーブ・コメント）。DSP §1 表（Loudness を Howl の後へ）・§2c / SPEC §4-5 を更新。
**注意**: Auto Gain OFF 時は Loudness が効かないので Howl は音量増になる（＝Auto Gain ON が音量一定の前提）。必要なら将来 Howl 単体の軽い正規化を追加。

### 2026-06-20 — Howl を（暫定）リングモジュレーターへ：wavefolder は“歪み”でNG

ユーザー指摘:「音量は解決。だが全然求めてる音じゃない。**本当は違うが一旦 金属音に寄せて**実装して。今は Drive 無しでも Howl で歪んで聞こえるし、Drive＋Howl で“チリチリ”＝白ノイズみたいになる」。

- **原因**: wavefolder は非線形＝**“歪み”を足す**方式。小信号でも折り返す→歪んで聞こえる。クリップ済み信号を高 g で折る→高次倍音が氾濫しエイリアシングで**白ノイズ/fizz** 化。＝金属音ではない。
- **暫定採用＝リングモジュレーター**: `out = x·(1−amt+amt·sin(2π·fc·t))`。入力の各倍音を ±fc にシフト＝**非調和（ベル/クラング/金属）**。**振幅変調なので歪まない**（ゲイン増/クリップ無し、`|乗数|≤1`）→「Drive 無しでも歪む / fizz 化」が解消。無音→無音（ドローンなし）。`fc = lerp(150,1800, amt)` で**1ノブ**（mix とキャリアを連動）。
- **配置据え置き**: Drive 直後＝Loudness の前 → 音量一定を維持。
- **暫定である旨を明記**（本命キャラはユーザーが追って具体化）。

**影響**: `dsp/howl.ts`（wavefolder→ring mod・位相状態を持つ）、`distortion.ts`（`new Howl(sampleRate)` に戻す）。DSP §1,2c / SPEC §4 を更新。
**学び**: 「金属音」≠歪み（waveshaping）。金属＝**非調和成分**＝ring mod / 周波数シフト / 非調和共鳴。歪み系（fold/clip）はいくら盛っても“歪み/ノイズ”にしかならない。

### 2026-06-20 — Howl（ring mod）を歪みの「前」へ移動

試聴の結果「ring mod の方向は近いが、まだ違う」。Howl が歪みの**後ろ**だった（歪み→倍音リッチ→それ全部に ±fc 側帯波→密でゴチャつく）。ユーザー選択で**歪みの前**へ移動。

- 新順: `Howl(ring mod) → Drive(Clip/Tone) → Loudness → …`。きれいな非調和パーシャル（金属/ベル）を作ってから**歪ませる＝ファズが金属音に食いつく**一体感。
- 実装: `distortion.ts` で Howl セクションを sat の前に。Drive On クロスフェードの基準を bandPre→**Howl 後のスナップ**に変更（Drive Off でも Howl は残る）。Loudness は Drive の後で Howl+Drive を bandPre に合わせる＝音量一定を維持。
- ring mod 自体は据え置き（暫定・金属寄せ）。本命キャラは引き続き探索。

**影響**: `distortion.ts`（順序入替＋satMix 基準変更）。DSP §1 表（Howl を先頭へ）・§2c 配置 / SPEC §5 フロー を更新。

### 2026-06-20 — Howl: キンキン化＋加算ブレンド（べったり解消）

試聴フィードバック「もっとキンキン。今は“べったりずっと”鳴ってるのが気になる。つまみを上げたら**歪みの中に金属味がブレンド**されるイメージ」。

- **キンキン**: キャリア fc を 150–1800Hz → **700–6000Hz** に。上げるほど高くキンキン。
- **べったり解消＝加算ブレンドへ**: crossfade `1-amt+amt·c`（amt=1 で純リング＝dry 消滅＝全部金属＝べったり）をやめ、**加算 `x·(1+amt·c)`** に。dry(=歪みの素)を常に保持し、金属成分を量で混ぜる → つまみ＝金属味のブレンド量。歪みの前段なので「歪みの中に金属味」。
- ピーク gain 最大 +6dB になるが後段 Loudness が音量一定に。

**影響**: `dsp/howl.ts`（fc レンジ・m を加算ブレンドへ・ヘッダ）。DSP §2c / SPEC §4 を更新。
**残**: 「べったり」がまだ気になる場合の次手 = 金属成分を動的に（エンベロープ/トランジェント連動）/ ハイパスして低域の濁りを除く。本命キャラは継続探索。

### 2026-06-20 — Howl 動的化（べったり/うるささ解消）＋ fc レンジ調整

試聴「まだべったり。ずっと鳴ってうるさい。**動的化**して。キンキンレンジは少し高すぎ→**700–3500**に」。

- **動的化**: 金属ブレンド量を**入力のトランジェント**で駆動。速い env（atk1ms/rel30ms）と遅い env（120ms）の差 `tr=max(0,envF−envS)` → `dyn=clamp(tr·SENS,0,1)·amt`。**アタックで鳴き、持続音では dyn→0 で金属が消える** → 鳴りっぱなし（べったり/うるさい）を解消。`m = 1 + dyn·c`。
- **fc レンジ**: 700–6000 → **700–3500**（高すぎを是正）。
- 加算ブレンド／歪み前段／ring mod は据え置き。`SENS=3`・env 時定数は耳調整用の定数。

**影響**: `dsp/howl.ts`（env 追従の状態追加・dyn 駆動・fc）。DSP §2c / SPEC §4 を更新。
**残**: トランジェント感度（SENS）・env 時定数の追い込み。本命キャラは継続探索。

### 2026-06-20 — Howl: 「歪み成分のみ」リングモジュレーション（ユーザー案）

全体に RM する方式（crossfade／加算／動的トランジェント）はどれも「べったり/うるさい」が残った。ユーザー案：**歪み成分だけに ring mod を掛ける**＝「歪みから原音を抜いた要素だけに金属音を足す」。

- **採用**: `delta = driveOut − dry`（dry=bandPre＝歪み前のクリーン帯域）を作り、**delta だけ**を ring mod。`out = dry + delta·(1 − amt + amt·sin(2π·fc·t))`。基音(dry)は無加工。
- **効果**: 基音はクリーン、**歪みのザリザリ/倍音だけ金属化**＝金属歪み。`Drive=0`→`delta≈0`→金属0（歪みがある所だけ金属味）。全体に掛けないので**べったり/うるささを構造的に回避**。「Drive 無しで金属が歪む」も解消。
- **配置変更**: Howl を歪みの**後**へ（差分を作るため）。順 `Drive → Howl(delta RM) → Loudness`。動的トランジェント機構は撤去（不要に）。fc=700–3500 据え置き。

**影響**: `dsp/howl.ts`（差分 RM・引数 dry 追加・env 撤去）、`distortion.ts`（順序 Drive→Howl、howl.process に bandPre を渡す）。DSP §1,2c / SPEC §4-5 を更新。
**学び**: 「歪みに金属味」は全体変調でなく **wet−dry の差分（歪み成分）だけ変調**するとクリーンさを保てる。これは Howl 以外（例: コーラス/グリッチを歪み成分だけに）にも応用できる発想。

### 2026-06-21 — Howl: 外部キャリア廃止→「原音で自己リングmod」＋加算

ユーザー要望：「fc をつまみに連動させたくない。キンキンは**元の音を誇張**した感じで鳴ればいい。置換でなく**加算**に」。

- **外部キャリア(sin/fc) 廃止**: 固定/連動どちらの外部 fc も「元と無関係＝エイリアン」。代わりに歪み成分 `delta=driveOut−dry` を **原音 dry 自身で掛ける（自己リングmod）**。積は入力の**整数倍音** → **原音に調和した倍音を誇張**＝「元の音を誇張」した金属。fc という概念自体が消える（つまみ非連動）。
- **加算に変更**: 旧 `dry+delta·factor`（crossfade=置換）→ `out = driveOut + amt·GAIN·metal`（歪みはそのまま＋金属を足す）。
- **HPF 必須**: `delta·dry` は偶関数で DC が出る → 固定ハイパス(1200Hz)で除去。これが**キンキン化**も兼ねる（固定＝つまみ非連動）。
- GAIN=4 / HP=1200Hz は耳調整用。配置（歪みの後）・差分基準（dry=bandPre）・Loudness 後段は据え置き。

**影響**: `dsp/howl.ts` 全面（自己mod＋HPF・状態は HPF の lp のみ・fc/phase 廃止）。`distortion.ts` は不変。DSP §1,2c / SPEC §4-5 を更新。
**学び**: 「元の音を誇張した金属」＝外部キャリアでなく**入力自身をキャリアにした自己変調**（積が整数倍音＝調和）。`delta·dry` は偶関数で DC が出るので HPF 必須（兼キンキン化）。

### 2026-06-21 — Howl: 自己mod の痩せを修正（キャリアを sign(dry) に）

「Howl を上げても何も変わらない」。原因：`metal = delta·dry` は**信号×信号の積**で、`|dry|`（例 0.3）倍に痩せてほぼ無音だった。

- **修正**: キャリアを `dry` → **`sign(dry)`（原音ピッチの単位方形波, ±1）**に。単位振幅なので**痩せず、はっきり鳴る**。符号は原音ピッチに同期＝**調和（元の音を誇張）**を維持。方形波なので倍音リッチでキンキン。GAIN 4→6。
- 加算／HPF（DC除去＋キンキン）／歪みの後ろ／fc 廃止 は据え置き。
- ⚠️ 方形波キャリア＝倍音無限でエイリアシング多め（OS=Phase 3 で低減）。

**影響**: `dsp/howl.ts`（carrier=sign(dry)・GAIN）。DSP §2c / SPEC §4 を更新。
**学び**: 「信号×信号」のリングmodは積で痩せる（両方<1なら更に小さく）。**片方を単位振幅（sign 等）にすると痩せずに鳴る**。

> パラメータの範囲・既定値は v0.3 提案。確定したらここに「範囲確定」として追記する。

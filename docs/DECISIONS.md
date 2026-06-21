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

### 2026-06-21 — Loudness Match を「知覚重み付き RMS（K特性ライク）」に

ユーザー指摘：「**Howl を上げると歪むし音量も変わる。Drive を上げても音量が変わる。音量は常に一定のはずでは？**」。

- **原因**: 音量補正（Drive/Tone makeup ＋ Loudness Match）が全部 **素の RMS 一致**で、**RMS 一定 ≠ 知覚音量一定**。Drive の高次倍音・Howl の金属（HPF 1.2kHz 以上を加算）で**明るく＝うるさく**なる分を、素 RMS は取りこぼす。
- **修正**: `dsp/loudness.ts` の測定を **知覚重み付き RMS** に変更。測定前に**ハイシェルフ**（分割点 `WEIGHT_PIVOT_HZ`=1500Hz 以上を `WEIGHT_HIGH`=2.0≈+6dB）を通してから二乗・平滑。明るくなった wet は重み付き RMS が大きく出る → ゲインが下がる → **知覚音量が一定**。重みは dry/wet 同一なので、元から明るい素材は比が不変＝音色は変えず、wet が dry より明るくなった**増分だけ**がゲインを下げる。
- ゲインは素の音声に適用（重み付けは測定のみ）。時定数 300ms・±24dB クランプ・モノ合算・Auto Gain トグルは据え置き。`WEIGHT_PIVOT_HZ`/`WEIGHT_HIGH` は耳調整用。
- **注**: 「Howl を上げると歪む」のうち**音量・明るさ**はこれで一定化されるが、金属フィズという**音色**は加算成分の性質（別途キャラ調整の対象）。

**影響**: `dsp/loudness.ts`（重み付け 1-pole 2 本追加）。DSP §2（方針・Loudness Match 式）を更新。`distortion.ts`/`params.ts` は不変。
**学び**: 「挿してる間ずっと音量一定」を歪み系で守るには **RMS でなく知覚（周波数重み付き）ラウドネス**で合わせる必要がある。歪みやエキサイターは RMS を変えずに明るさ＝知覚音量を上げるため、素 RMS マッチでは破綻する。

### 2026-06-21 — Howl: ロボっぽい低域櫛を除去（HPF 1.2kHz/1-pole → 3kHz/2-pole）

ユーザー指摘：「Howl の**金属音が低いところがロボっぽい**。メタリックなキンキンは良いが、ロボっぽいあたりは要らない」。

- **原因**: リングmod は f0(原音ピッチ) の整数倍に密な櫛を DC〜高域へ広げる。**低い櫛(1〜3kHz)は音程感が出てロボ/ボコーダー感**、高い櫛(3kHz〜)がキンキン。旧 HPF は **1.2kHz・1-pole(6dB/oct)** とゆるく、ロボ帯(1〜3kHz)が残っていた。
- **修正**: `dsp/howl.ts` の金属ハイパスを **3kHz・2-pole(12dB/oct, 1-pole×2 直列)** に。低域櫛を急峻に切り、キンキンだけ残す。GAIN=6・sign(dry) キャリア・加算・配置は据え置き。`HP_HZ` は耳調整用。
- **学び**: リングmod 系の「ロボっぽさ」＝**carrier 基音近傍(低次)のサイドバンド**。高域の密な櫛が「金属/キンキン」。ロボ感を消すには低域櫛を**高め＋急峻**な HPF で削るのが効く。

**影響**: `dsp/howl.ts`（HP_HZ 1200→3000・1-pole→2-pole・lp 状態 2 本）。DSP §1 表 / §2c を更新。`distortion.ts`/`params.ts` は不変。

### 2026-06-21 — Howl セクションを廃止（削除）

ユーザー判断：「**うまくいかないから Howl セクションは捨てよう**」。

- **背景**: 金属味の付加を多数試行（自己発振ドローン → 共鳴サチュ → ウェーブフォルダー → 外部キャリア RM → 原音自己 RM(sign) → HPF 3kHz/2-pole → 奇数倍音エキサイター(チェビシェフ＋Threshold)）したが、ドローン/べったり/ロボっぽさ/「ただのエキサイター」等で**狙い（歪みが金属味を帯びる）に届かず**。これ以上の小手先調整より一旦撤去を選択。
- **削除内容**: `dsp/howl.ts` を削除。`params.ts` から Howl(218)/Howl On(220) と `ParamSection` の `'howl'` を除去。`distortion.ts` から import/フィールド/`howlMix`/param 読み/Howl 節を除去。`App.vue` の SECTIONS から `'howl'` を除去（UI は params 駆動なので自動で消える）。**6→5 セクション**。
- **ID 218/219/220 は再利用しない**（VST controller tag 衝突回避・履歴の一貫性）。
- **残した副産物**: Loudness Match の**知覚重み付き RMS**（2026-06-21 の別決定）は Howl と独立で **Drive 単体の音量恒常に効く**ため**維持**。
- 試行の実装は git 履歴に残る（例: sign-ring-mod 版＝コミット `e2d4b81`）。将来やり直すなら別アルゴリズムで新規に起こす。

**影響**: `dsp/howl.ts` 削除、`params.ts`/`distortion.ts`/`App.vue` から Howl 除去。SPEC §2,4,5,6 / DSP §1,2,2c / ARCHITECTURE §2,5 / TASKS Phase 2.9 を更新。`vp check`（21 files）/ `vp build` 通過。
**学び**: 暫定実装を畳むときは **(1) 試行履歴を残す（commit / DECISIONS）→ (2) SSoT から綺麗に除去（params/型/UI/docs を一括）→ (3) 副産物の良い改善は切り分けて残す**。ID は欠番にして再利用しない。

### 2026-06-21 — 音量恒常のラグ解消（FF知覚補正＋緩急トリム、look-ahead 不採用）

ユーザー指摘：「**音量を抑えるまでにタイムラグがあって気持ち悪い**」。方式は提示オプションから **「FF強化＋緩急トリム」** を選択。

- **ラグの正体**: `driveMakeup` は **RMS** しか合わせず、クリップ倍音が足す**知覚的明るさ（=ラウドネス増）**を即時補正していなかった。その明るさ増分を 300ms 対称の Loudness Match が**後追い**で下げる＝swell→duck（~0.5–1s）。
- **対策(1) 静的「知覚 Drive makeup」**（`dsp/saturation.ts`）: 起動時に基準正弦(`REF_F0_HZ`=330Hz)を clip→**Loudness と同一の重み付け**で測り、`fullMakeup(g)=sqrt(wms(0)/wms(g))` を表に。実行時 `makeup = driveMakeup·table_lerp`。Drive を上げた瞬間に RMS も明るさも即時補正＝トリムの target≈1（動かない）。0–48dB / 96 点。
- **対策(2) 緩急 ballistics**（`dsp/loudness.ts`）: 対称 300ms → **fast-attack 15ms（大きくなった→速く下げる）/ slow-release 300ms（緩く戻す＝ポンプ回避）**、検出器 `DET_MS`=60ms（旧 300ms）。残差だけを速攻で捕まえ緩く戻す。
- **重み付けの SSoT 化**: `WEIGHT_PIVOT_HZ`/`WEIGHT_HIGH` とハイシェルフを **`dsp/weighting.ts`** に集約し loudness/saturation 両方が import（ファイル間ドリフト防止）。
- **look-ahead は不採用**: 数ms 先読みで先回りduck＝ラグ完全消滅だが、**Suara SDK はプラグインのレイテンシを DAW に申告する仕組みが無い** → VST で他トラックと位相/タイミングがズレる（Web のみ可）。よって VST 製品としては採らない。
- 据え置き: `±24dB` クランプ・モノ合算・Auto Gain(205) トグル・チェーン順（`distortion.ts` 不変）・新パラメータなし。

**影響**: 新規 `dsp/weighting.ts`、`dsp/saturation.ts`（知覚 makeup 表）、`dsp/loudness.ts`（緩急＋weighting 共有）。DSP §2/§5/§6 / ARCHITECTURE §2 / TASKS を更新。`distortion.ts`/`params.ts`/`App.vue` は不変。
**学び**: 歪み系の「常に一定」は **(a) 決定論ぶん（knob 由来）は知覚重み付きの静的 FF で即時に消す → (b) 信号依存の残差だけを非対称 ballistics で速攻 catch / 緩 release**。対称に速い leveler はポンプ、対称に遅いと後追いラグ。look-ahead は本来の正攻法だがホストへのレイテンシ申告が要る。

### 2026-06-21 — Loudness の緩急 ballistics を撤回（ムラ/ポンプ）→ 遅く滑らかに戻す

直前の「FF知覚補正＋緩急トリム」導入後、ユーザー指摘：「**音量にムラが出た**」。

- **原因**: 残差トリムに入れた **fast-attack(15ms)＋短い検出器(60ms)** が、**素材自身の音量変化（プログラム・ダイナミクス）に反応して上下** → トレモロ/ポンプ＝ムラ。非対称（target<gain で速攻）はリップルを整流してさらに揺れを助長。
- **判断**: ラグの本当の対策は **Part 1（saturation.ts の静的な知覚 Drive makeup＝即時・FF）** の方。これがある以上、リアクティブなトリムを速くする必要はなく、むしろ**遅く滑らか**にすべき。緩急 ballistics は不要かつ有害だった。
- **修正**: `dsp/loudness.ts` を **対称 ~300ms の滑らかな単一時定数**に戻す（`DET_MS/ATTACK_MS/RELEASE_MS` を撤去、`TIME_CONST_MS=300`）。検出・ゲインとも 300ms。知覚重み付き（weighting.ts）・±24dB クランプ・モノ合算・Auto Gain は据え置き。
- **Part 1（知覚 Drive makeup）は維持**（ラグ対策の本体。これ自体はムラの原因ではない＝固定 Drive では定数）。

**影響**: `dsp/loudness.ts`（緩急→滑らか）。DSP §2/§5/§6・ARCHITECTURE §2・TASKS Phase 2.10 を更新。`saturation.ts`/`weighting.ts`/`distortion.ts`/`params.ts` は不変。
**学び**: 残差レベラーを**速く/非対称**にすると、エフェクトのラウドネス差でなく**素材のダイナミクスを潰して**ムラ/ポンプになる。歪み系の「常に一定」は **(a) knob 由来の決定論ぶんを即時 FF で消す → (b) レベラーは遅く滑らかに残差だけ**、が正解。速さで解こうとしない。

### 2026-06-21 — 音量恒常を純フィードフォワード化（リアクティブ Loudness Match と Auto Gain を撤去）

ユーザー指摘：「**下げるまでの間（後追いラグ）が気持ち悪い**。**音にムラ**も出る。Drive/Tone の**アルゴリズムから上がる分を計算して下げる**シンプルで堅牢な実装にできないか。**音を出してから計測するんじゃなくて**」。

- **決定**: 出力を測って後追いで下げる**リアクティブな Loudness Match を撤去**し、**ノブ値から計算して下げる純フィードフォワード**だけにする。`Auto Gain(205)` も撤去。
- **理由**: ラグ（swell→duck）もムラ/ポンプも**「測ってから反応する」リアクティブ段が原因**。フィードフォワード（信号に追従しない・即時）なら原理的にどれも出ない。音量恒常に必要な部品は既に saturation.ts に揃っている:
  - **Drive makeup（RMS）**＝クリップで増える RMS をノブ値から逆算。
  - **Drive makeup（知覚＝明るさ）**＝クリップ倍音の明るさ増を起動時の静的表で逆算（`dsp/weighting.ts` の重み付け）。
  - **Tone makeup**＝Tilt の知覚増を逆算。
    これらの積＝「アルゴリズムから上がる分」を即時に打ち消す。
- **トレードオフ**: 基準正弦(330Hz)較正なので**実素材では完全一定でなく僅かな差は残る**。だが「シンプル・堅牢・ラグ/ムラなし」を優先（ユーザー意向）。効きは `WEIGHT_HIGH`/`REF_F0_HZ` で耳調整。
- **削除**: `dsp/loudness.ts`（リアクティブ段）。`distortion.ts` から import/フィールド/`autoGain` 読み/`loud.process` 呼びを除去。`params.ts` から `Auto Gain(205)` を除去（UI は params 駆動で自動消滅）。`dsp/weighting.ts` は Drive 知覚 makeup 表の構築に**継続使用**。
- **据え置き**: チェーン順（Drive→Pitch→Glitch）・Output・Bypass・帯域スプリット。**ID 205 は再利用しない**（VST tag 衝突回避）。

**影響**: `distortion.ts`/`params.ts`（Loudness/AutoGain 除去）、`dsp/loudness.ts` 削除、`dsp/saturation.ts`/`dsp/weighting.ts`（コメント）。SPEC §2/§4/§5/§6・DSP §1/§2/§2b/§5/§6・ARCHITECTURE §2/§4/§5・TASKS Phase 2.6/2.10 を更新。`vp check`/`vp build` 通過。
**学び**: 「挿してる間ずっと音量一定」を**最もシンプル・堅牢**に満たすのは、出力測定（リアクティブ）でなく **knob 値からの計算（フィードフォワード）**。歪み系では RMS だけでなく**知覚的な明るさ**もノブ値から逆算して引く。リアクティブ段はラグ/ムラ/ポンプの温床なので、要求が「常に一定・触り心地」なら持たない方がよい（精度の最後の数 % は捨てる）。

### 2026-06-21 — Drive makeup を入力レベル連動に（フィードフォワードのまま追従精度を上げる）

ユーザー指摘：「**Drive の上がり幅に補正が全然追いついてない。波形が変わって音圧が上がってるだけ？**」。

- **原因**: makeup を **ノブ(driveLin)だけ**から、しかも「入力フルスケール前提」で較正していた。実入力は小さいので、クリップ手前では Drive が**ただのゲイン**として効くのに、フルスケール前提の makeup は少ししか下げない → 音量が上がる。指摘どおり「波形変化で音圧↑」も二次的にあるが、主因はこの**入力レベル非依存**。原理的にノブだけでは入力レベルが変わると追えない（クリップ量＝入力×Drive）。
- **決定**: **入力ピーク envelope `a`（出力でなく入力＝feed-forward）** を見て、**実効クリップドライブ `Geff=a·driveLin`** で makeup を評価する。`makeup = a · driveMakeup(Geff) · table(dB(Geff))`。
  - クリップ前(Geff≤1)→ `1/driveLin`（ゲイン完全相殺＝音量不変・**ダイナミクス保持**）。フルスケール(a=1)→ 従来式に一致。
  - 知覚(明るさ)表も `Geff` で引く（同じ波形＝同じ明るさ補正）。表自体は不変。
  - `a` は入力一定なら steady ＝ **Drive を回した瞬間に効く**（遅延ゼロ）。出力は測らないので swell/duck なし（前にやめたリアクティブとは別物）。
- **理由**: 「出力測定の後追い（ラグ/ムラ）」は避けたい、でも「ノブだけ」では追従できない、の両立解。入力を見るのは feed-forward でクリップ前は `a` 非依存なので過渡の揺れも小さい。
- **トレードオフ**: 入力を正弦と見なすモデル＋基準正弦較正なので**実素材で僅かな固定差は残る**（時間変動でない）。`WEIGHT_HIGH`/`REF_F0_HZ`/`ENV_ATK/REL_MS` で耳調整。
- ユーザー選択肢: 「入力レベルを見て補正（推奨）」を採用（他案: ノブのみ現状維持 / クリップ前正規化＝ダイナミクス消失、は不採用）。

**影響**: `dsp/saturation.ts`（入力ピーク envelope ＋ Geff 連動 makeup。`ENV_ATK_MS=5`/`ENV_REL_MS=150` 追加）。DSP §1表/§2/§5 ・SPEC §2/§4 を更新。`distortion.ts`/`params.ts`/`weighting.ts` は不変。
**学び**: 歪みのラウドネス増は **入力レベル×Drive**（クリッパの叩き込み量）で決まる ⇒ knob だけでは原理的に追えない。**入力**（出力でなく）を見れば feed-forward のまま追従でき、Drive 操作に遅延ゼロ・swell/duck なし。クリップ前を `1/driveLin` にするとゲインが相殺されダイナミクスも保たれる。

### 2026-06-21 — Comp トグル（ダイナミクス保持 ⇄ 自然圧縮）追加

入力レベル連動 makeup 後のユーザー観察：「音量差は消えたが、**ドライ音のダイナミクスを保ったまま歪む**。普通の歪みはコンプ的作用でレンジが減るのに残ってる」。決定：「**現状（保持）は残してトグルで切替**。切替時は『普通に圧縮しつつレベル感は保つ』」。

- **原因**: 入力 envelope を速く（ATK 5ms）したため、トランジェント毎に `a` が追従＝makeup が各音を再レベル＝クリップが潰した分を持ち上げ直す → ダイナミクス保持。
- **決定**: **Comp(222) トグル**を Drive セクションに追加。2モードの差は **入力 envelope の速さだけ**（makeup 式は共通）:
  - **Comp ON（自然圧縮・既定）**= 遅い envelope（ATK 250 / REL 400ms）。操作点＝サステインだけ追い、トランジェントはクリップで頭打ち＝**ダイナミクス圧縮**。サステインは makeup=1/driveLin で**レベル感一定**。Drive↑で圧縮↑。
  - **Comp OFF（保持）**= 速い envelope（5/150ms、現状）。トランジェント追従でダイナミクス保持。
  - 両モードとも音量恒常（vs Drive）・出力非測定（swell/duck なし）。`a` は入力由来＝Drive 操作に遅延ゼロ。トグル切替は coef 変更のみ＝state 連続＝クリック無し。
- **ID**: Comp=**222**（221 は反映されなかった実験 howlThresh の名残のため欠番）。既定 ON（普通の歪みを既定に）。

**影響**: `params.ts`（+comp=222）、`dsp/saturation.ts`（slow envelope 定数 `ENV_ATK_SLOW_MS=250`/`ENV_REL_SLOW_MS=400` ＋ `process(...,comp)` でモード選択）、`distortion.ts`（comp 読み・受け渡し）。SPEC §2/§4/§6・DSP §1/§2/§5・ARCHITECTURE §5・TASKS を更新。`App.vue`/`weighting.ts` は不変（UI は params 駆動で自動）。
**学び**: 「歪みのコンプ感」は **入力 envelope の時定数**で決まる。速い＝各音を再レベル＝ダイナミクス保持、遅い＝操作点固定＝トランジェントがクリップで潰れ自然圧縮。同じ makeup 式のまま envelope 速さだけで2キャラを出せる（どちらも音量恒常・出力非測定を維持）。

### 2026-06-21 — Comp ON のレベル補償（ざっくり一律トリム・クリップ量ゲート）

ユーザー観察：「いい感じ。ただ **Comp OFF のとき RMS 5dB くらい大きい**かも」。

- **原因**: Comp はクリップ波形は同じで違いは makeup の envelope だけ。Comp OFF（速い）はトランジェントを makeup が持ち上げ直す＝ピーク復活＝RMS 高い（≒dry）。Comp ON（遅い）はトランジェントが clip で頭打ち＝**圧縮で RMS が下がる**。定常部は一致、差はトランジェント分（≈5dB）。圧縮の自然な結果。
- **決定**: 「圧縮しつつレベルを保つ」ため、Comp ON のみ **レベル補償トリム**を makeup に足す（＝コンプの makeup gain）。ユーザー選択は**「ざっくり一律トリム」**。
  - 厳密自動マッチ（出力/クリップ energy を測る）は外したリアクティブ依存に戻るため不採用。代わりに**固定 `COMP_TRIM_DB`(≈5dB) を上限に、クリップ量(操作点 Geff の dB)でゲート**: `Geff≤0dB`→0 / `COMP_TRIM_FULL_DB`(≈12dB)以上→最大、線形ランプ。
  - **ゲート理由**: 純粋な一律 +5dB は Drive=0（歪まない）でも Comp ON を +5dB にして bypass 近接を壊す。クリップ量ゲートで低 Drive は中立に保つ（「一律」の精神＝1定数 ＋ 効き始めゲートのみ）。
  - Drive に即時（geffDb は driveLin で即更新・`a` は steady）。出力非測定＝swell/duck/lag なし。Comp OFF は不変。
- **限界**: 操作点 Geff でゲートするためトランジェントのみクリップする軽歪み時は控えめ＝簡易近似（素材により残差）。耳調整: `COMP_TRIM_DB`/`COMP_TRIM_FULL_DB`。

**影響**: `dsp/saturation.ts`（`COMP_TRIM_DB=5`/`COMP_TRIM_FULL_DB=12` ＋ Comp ON 時のゲート付きトリム）。DSP §2・SPEC §4 を更新。`params.ts`/`distortion.ts`/`weighting.ts` 不変。
**学び**: 圧縮（ピーク頭打ち）は必然的に RMS を下げる。「圧縮しつつレベル維持」＝コンプの makeup gain が要る。厳密自動は出力測定（=lag/pump の元）に戻るので、**クリップ量ゲート付きの一律トリム**で feed-forward・即時・低 Drive 中立を満たす近似が良い落としどころ。

### 2026-06-21 — Glitch をBPM同期ステップシーケンサに（拍ロック・再現性）

ユーザー要望:「手打ちは面倒だがランダムっぽいグリッチが欲しい、しかし再生し直しても**同じ箇所で同じグリッチ**＝再現性。BPM準拠で拍にロックしたアクセント。完全ランダムは後。**横=拍/縦=タイプのマス目UI**」。壁打ちで仕様確定。

- **設計**: 1小節 × **16ステップ（16分・4/4 v1）**。各ステップに type 択一: **0=Dry / 1=Repeat(ラチェット) / 2=Freeze / 3=Reverse / 4=Random**（Gate は Random 内に内包、Tape-stop は後日）。パターンはループ＝**本質的に再現性**。Random は既存シード付き stutter/gate＝"ランダム質感だが決定論"、置く場所は選べる。**完全ランダムトグルは後日**（グリッド無視で確率ばら撒き）。
- **拍ロック=曲タイムライン**: App が `positionSamples`(VST) / `ctx.currentTime`(Web) から **小節内位相 glitchPhase(0..1)** を算出し隠し param で worklet へ。worklet は `localBarPos` をサンプル精度で自走し、**大ドリフト（シーク/ループ/再生開始）だけスナップ**＝rAF ジッタを音に入れない。Web は再生位置が無いので再生開始基準（worklet コードは共通）。
- **DSP**(`dsp/glitch.ts` 改修): ch毎の履歴リング(`HISTORY_MS=2000`≈768KB stereo@48k)を全サンプル書込。Repeat/Freeze/Reverse はそこからグレイン読み。境界・スナップは `FADE_MS` フェード。`Glitch(204)`=全体 wet（既定 **0→100**、空グリッド=全Dryなら透過なので安全）、`Spectral Fill(212)`=Random gate の質感。
- **パラメータ**: step0..15 = **id 223–238**（enum 0..4、`grid:true`）、`glitchPhase`= **id 239**(hidden)。`ParamDef` に **`grid?` フラグ**新設＝useParam ハンドルは作るが自動スライダ UI には出さず `StepGrid.vue` が描画。16ステップ=16自動化レーン（VST）は許容（プリセット復元・自動化が無料＝既存 AudioParam 方針と整合）。
- **UI**: `src/components/StepGrid.vue`（16列×5行・列択一・最下段 Dry・再生中ステップをハイライト）。まず仮UI、整形は後（DSP先行）。

**影響**: `dsp/glitch.ts` 全面改修、`params.ts`(step×16+glitchPhase+`grid`+Glitch default)、`distortion.ts`(step 配列+phase 受け渡し)、`App.vue`(phase pump+grid 振り分け+StepGrid)、`src/components/StepGrid.vue` 新規。SPEC §2,4,6 / DSP §1,3 / ARCHITECTURE §2,4,5 / TASKS Phase 2.11 を更新。`vp check`(22 files)/`vp build` 通過。
**学び**: 「ランダム感×再現性×非手打ち×おいしい箇所」は**短いループ・パターン＋拍ロック＋"Random"を1タイプ化**で同時解決。曲位置同期は **App が 0..1 位相を計算→worklet 自走＋大ズレのみスナップ**で float 精度/ジッタ/レイテンシ非申告を回避（出力は測らない）。非スカラ配列は **ステップ毎スカラ AudioParam** が既存ブリッジに最も素直。

### 2026-06-21 — Glitch シーケンサをブロック(隣接)モデルに＋タイプ刷新（Repeat per-cell 分割・Mute）

壁打ちで詰めた結論。ステップシーケンサ（`c028013`）を進化:

- **ブロック(隣接)モデル**: 同一 enum の連続セル＝1ブロック（小節頭で必ず分割）。**ブロック幅＝その効果の長さ（継続長）**。隣接で伸ばす＝追加操作・ノブ・行ゼロ（dblue のリサイズ・ブロックと同発想）。
- **ループの2軸問題**: ループは chunk(1リピート長)×継続長の2軸。隣接は1軸しか与えない＝継続長に割当。**chunk はパターンから導出不能**なのでグローバル1ノブだと拍ごとに変えられない → **chunk をセル(enum)に内包＝per-cell** が唯一の自由解（「行で見せる」も「セルで持つ」も同じデータの別ビュー）。よって Repeat を分割3つ（1/16・1/8・1/4）の enum 値に。データは enum 拡張のみ（新 param・ノブ無し）。
- **リネーム**（混乱回避）: 旧 Repeat→**Glitch**（極短ラチェット）、旧 Loop→**Repeat**（ビートリピート）。**Mute** 新規。
- enum 0..8: Dry / Glitch / Freeze / Reverse / Random / Mute / Repeat1/16 / Repeat1/8 / Repeat1/4。
- タイプ別: **Reverse はブロック幅＝逆再生レンジ**（幅で逆レンジが伸びる）。**Mute** に Spectral Fill(212) を移管（無音に (-1)^n 反転を差し込む）。**Repeat** は chunk=分割を継続長ぶんループ（chunk<幅 で連続ループ）。Glitch=固定極短(1/32)スライス、Freeze=70ms 保持、Random=シード stutter/gate。
- 全タイプ履歴リング読み、ブロック頭で grain ラッチ、端/シームは FADE フェード。拍同期（glitchPhase→localBarPos 自走＋大ドリフトのみスナップ）は流用。
- 他製品の裏取り: Ableton Beat Repeat の "Grid"(スライス長=グローバル1ノブで artifact↔loop)、dblue Glitch(リサイズ・ブロック＋per-scene パラメータ)、Effectrix(per-step は別 modulation lane)。→ per-cell 分割は「行/セルどちらのビューでも可」の素直な自由解と判断。

**影響**: `dsp/glitch.ts` 全面（per-step→ブロック・ディスパッチ、9タイプ）。`params.ts`（step max 4→8・enum コメント・Fill→Mute 注）。`StepGrid.vue`（9行）。`distortion.ts` は不変（steps 0..8 round）。SPEC §4 / DSP §1,§3 / ARCHITECTURE §2,§5 / TASKS を更新。`vp check`(22)/`vp build` 通過。
**学び**: 「per-placement で2軸自由」を行/ノブ肥大なしで＝**継続長は隣接(ブロック幅)・chunk はセル enum**。ループ系は「chunk×継続長」を分けて考えると設計が決まる。業界は chunk=グローバルが主流だが、グリッドなら per-cell enum が最も自由かつ素直。

### 2026-06-21 — Freeze をグラニュラー化 / Random をステップ毎再抽選（Stage A: DSP 先行）

試聴の壁打ちで判明した2問題への対応。UI 構造（Repeat 行集約・Dry 行削除・小節数セレクタ）は Stage B で別途。

- **Freeze ≒ Glitch 問題**: 旧 Freeze は「70ms チャンク1個をシーム crossfade でループ」＝**構造的にコムフィルタ**でループ周期(≈14Hz)が可聴＝ただのスタッター。Glitch と機構が同一だった。リサーチ(Clouds/SC Warp1/Tone.js GrainPlayer/PaulStretch、dblue・Effectrix・Beat Repeat・Gross Beat は freeze と stutter を**別モジュール**で分離)。**決定**: Freeze を**非同期グラニュラー雲**に置換。ブロック頭で直近 FREEZE_REGION(≈400ms) を凍結バッファにスナップ→重なり合う Hann 窓グレイン(FREEZE_GRAIN≈180ms・FREEZE_VOICES=6・overlap=4・読み位置±JITTER≈60ms・決定論 seed)で**単一周期を消した持続音**に。Glitch は短スライス1ループ＝ラチェットのまま＝両者が構造的に別物に。スペクトル(FFT)Freeze は ~20ms レイテンシ＋framing 配管が要るので将来の "glass" モードとして温存。
- **Random 連続＝Repeat 問題**: ブロックモデルで Random 連続セルが1ブロックになり、ブロック単位の1回抽選を幅ぶんループ＝Repeat と区別不能だった。**決定**: Random は**ブロック内でもステップ毎に seed=絶対step で再抽選**（microKind∈{ラチェット/逆/ハーフ}）。幅=暴れる継続長は保ちつつ中身が毎1/16変化＝均一ループの Repeat と明確に別物。決定論なので再現性は維持。

**影響**: `dsp/glitch.ts`（Freeze=グラニュラー雲＝凍結バッファ/Hann LUT/ボイスプール、Random=マイクロ再抽選、`grain()` を baseWrite 引数化して共用）。params/UI/配線は不変（enum 0..8 のまま）。DSP §3（Freeze/Random/ラッチ記述）を更新。`vp check`(22)/`vp build` 通過。耳調整定数: FREEZE_GRAIN/REGION/VOICES/JITTER/GAIN。
**学び**: freeze と stutter は「速度の連続」でなく**別アルゴリズム**（stutter=短スライスを見せる／freeze=境界を隠す＝多声ジッタ重ね合わせ）。隣接ブロックモデルで "Random" を活かすには**ブロック内サブステップ再抽選**が要る（幅=継続長と中身の変化を分離）。

### 2026-06-21 — Freeze 定数を耳で確定 ＋ iceberg ハイパス追加

DEBUG スライダ（Grain/Region/Gain を一時 param 化）で試聴し確定。

調整は **DEBUG スライダ（Grain/Region/Gain/HP を一時 param 化）→耳で確定→定数へ焼き戻し・param 撤去** の手順で実施（commit には debug param を残さない）。

- **範囲確定**（glitch.ts 定数化）: `FREEZE_GRAIN_MS=120` / `FREEZE_REGION_MS=730` / `FREEZE_GAIN=2.4`。overlap=8・VOICES=12・JITTER=50ms・窓和正規化は据置。
- **iceberg ハイパス**: **Freeze の wet 出力にのみ** 2-pole(12dB/oct) TPT SVF ハイパス（Butterworth Q=1/√2）を通し低域カット＝氷的な質感に。`FREEZE_HP_HZ=310` 固定（係数は constructor で一度算出）。他タイプには非適用。立上りはブロック端フェードが過渡を覆う。

**影響**: `dsp/glitch.ts`（FREEZE 定数確定・freezeHpProcess 追加）、`params.ts`（debug param なし＝据置）、`distortion.ts`・`App.vue` 実質変化なし。DSP §3 Freeze 更新。`vp check`(22)/`vp build` 通過。
**学び**: グラニュラー freeze は**長グレインで滑らか・短グレインで質感**のトレードオフ（確定は短め120ms＋HP で iceberg 寄り）。固定 hop 由来の振幅周期は**窓和正規化**で消えるので GAIN 調整が素直になる。質感フィルタは**該当タイプの wet のみ**に閉じる（全体に漏らさない）。

### 2026-06-21 — Comp ON トリムの Drive 連動を緩和（Drive で大きくなる問題）

**決定**: Comp ON のレベル補償トリムを `COMP_TRIM_DB 7→4` / `COMP_TRIM_FULL_DB 12→6`。
**理由**: ユーザー指摘「Drive を上げると（Comp ON で）また音量が大きくなる」。A/B で確認＝犯人はこのトリム。トリムは `geffDb`(実効ドライブ dB)に比例して 0→最大へ伸びるため、Drive を回すほど持ち上げが増えていた。`FULL` を 6dB に下げて**早期プラトー**化＝中〜高 Drive では一定にし Drive 連動の伸びを止める。最大量も 7→4 に低減。
**影響**: `dsp/saturation.ts`（定数2つ）。DSP §2 更新。makeup 本体（`a·fullMakeup(geff)`）は Drive 不変なので、Comp OFF はもともとフラット。絶対レベル（ON/OFF 差）は要再試聴で再調整しうる。
**学び**: ラウドネス一定の土台は FF makeup で取れている。Comp トリムを**クリップ量比例**にすると Drive=音量になってしまう→**早期プラトー**で「効くが Drive には連動しない」形にするのが筋。

### 2026-06-21 — Spectral Fill(212) 撤去

**決定**: Glitch の Spectral Fill トグル（id 212・Mute 無音への (-1)ⁿ 反転差し込み）を削除。
**理由**: ユーザー判断「おそらくもう必要ない」。Mute は素直に無音（両端フェード）でよい。
**影響**: `params.ts`（212 削除）、`dsp/glitch.ts`（Mute 分岐を gate のみに簡素化・`fill` 引数/`FILL_LEVEL`/`sign` 撤去）、`distortion.ts`（gliFill 配線撤去）。SPEC §4 表/ID 注・DSP §1,§3・ARCHITECTURE §4-5 更新。id 212 は欠番（再利用しない）。

### 2026-06-21 — Glitch 型セット刷新（enum 0..5・Random をモード化・Dry/Repeat 整理）

壁打ちで確定。ステップシーケンサの型を絞り、Random を「セル」から「モード」に変更。

- **Repeat は16分のみ**（旧 1/8・1/4 を廃止）。per-cell 分割（拍ごとに分割を変える）は使わない判断＝行/操作の複雑さを削減。
- **Dry 行を削除**: 空セル＝Dry(素通り)。StepGrid はアクティブセル再クリックで 0(Dry) にクリア（トグル）。
- **Random をモード・トグル化**（`glitchRandom`/290）: 「セル単位のランダムは不要」との判断。ON でグリッドを無視し**全ステップ**を seed=絶対step で決定論ランダム（`microKind∈{dry/ラチェット/逆/ハーフ}`＝**dry も混ざる**・再現性あり）。旧「全セル Random」と同等＋dry 混入。
- **enum を 0..5 に圧縮**: 0 Dry(空) / 1 Glitch / 2 Freeze / 3 Reverse / 4 Mute / 5 Repeat(16分)。
- これで StepGrid は **5行**（Rpt/Mute/Rev/Frz/Glt）。

**影響**: `dsp/glitch.ts`（enum・latch を randomMode 分岐・dispatch・chunk 簡素化・TYPE_RANDOM/REP8/REP4 撤去）、`params.ts`（step max 8→5・`glitchRandom`(290) 追加・コメント）、`distortion.ts`（randomMode 配線）、`StepGrid.vue`（5行・クリッククリア）。SPEC §4,§6・DSP §1,§3・ARCHITECTURE §2,§5 更新。
**学び**: 「自由度」は増やすほど良いわけでない＝per-cell 分割は要らなかった。ランダムは**セルでなくモード**の方が UI も意図も素直（全体に効くトグル＋再現性）。

### 2026-06-21 — Glitch のループ長を可変に（小節数タブ 1/2/4）

**決定**: ステップシーケンサのループ長を `Bars(288)`(1/2/4 小節) で可変化。グリッドは `bars×16` 列に伸び（16/32/64）、その長さでループ。step param を 16→**64**(223–286) に拡張、`glitchPhase` を 239→**287** へ移設（旧 239 は欠番）。
**理由**: ユーザー「16セル(1小節)だと、これだけタイプがあるのに横軸が足りず機能を使い切れない」。タブは**16列ページングでなく、ループ長そのもの**を切替（1小節=16列1小節ループ / 4小節=64列4小節ループ）。Effectrix も尺は可変。1/2/4 で確定（128=8小節は不採用）。
**設計**: worklet は `patternSteps=bars×16`、`localPos` をパターン長で wrap、ブロックは**パターン頭でのみ分割**（小節跨ぎブロック可＝長い Freeze/Reverse も可）。App は `barsHandle` を読み**パターン内位相**を算出して `glitchPhase` 供給。StepGrid はタブ＋`bars×16`列を描画（`grid` の step群と bars を `name` で振り分け）。
**影響**: `params.ts`（step 16→64・`glitchBars`(288)・glitchPhase 239→287）、`dsp/glitch.ts`（STEPS→STEPS_PER_BAR・patternSteps・localPos リネーム・bars 引数）、`distortion.ts`（64 step・bars 配線）、`App.vue`（phase pump 複数小節・stepHandles 絞り込み・barsHandle）、`StepGrid.vue`（タブ＋可変列）。SPEC §4,§6・DSP §1,§3・ARCHITECTURE §2,§4-5 更新。
**判断（要再確認）**: 既定は **2 小節**（16=単調すぎ / 64=初期で広すぎ、の中間）。VST automation lane は最大 64 step。
**学び**: 「タブ＝ページング」と「タブ＝ループ長切替」は別物。ユーザー意図は後者（尺を作り込む）。データは最大長(64)で確保し、`bars` で使用範囲を決めるのが素直。

### 2026-06-21 — Pitch(Wobble) セクション撤去 → Octave（固定ピッチ歪み）に置換

**決定**: Wobble（可変ディレイのピッチのヨレ）セクションを撤去し、`dsp/wobble.ts` を削除。代わりに **Octave（オクターヴ・ファズ）** を歪み段の後・Glitch の前に追加（`dsp/octave.ts`）。`Octave(207)` トグルで ON/OFF（旧 `pitchOn`=207 を転用）。`Pitch` セクション自体を廃し、Octave トグルは Drive セクションに置く。
**理由**: ユーザー「ピッチセクションは無くして、エフェクト成分にのみ固定のピッチ歪みを付与するボタンオンオフに」。fuzz/ハードクリップ製品に最も自然な固定ピッチ歪み＝**オクターヴ・ファズ（全波整流でオクターブ上）**を採用（判断・要確認）。中身（ブレンド/補正/カットオフ）は他完了後に debug param で詰める前提。
**実装**: `|x|` で全波整流（周波数倍＝1オクターブ上）→ 1-pole HP(≈25Hz) で整流 DC を除去 → `PITCH_MIX`≈0.6 で原信号にブレンド・`OCT_MAKEUP`≈1.8 で音量補正。On/Off は distortion.ts のクロスフェード（既存 Pitch スロットを流用）。信号は band の中＝**全セル Mute=無音**（歪み成分のみに閉じない、の方針どおり）。
**影響**: `dsp/wobble.ts` 削除・`dsp/octave.ts` 新規、`distortion.ts`（Wobble→OctaveFuzz・pitchMix→octaveMix・wob 系 param 読み撤去）、`params.ts`（203/210/211 削除・207 を octave に転用・`ParamSection` から 'pitch' 削除）、`App.vue`（SECTIONS から Pitch 削除・bpm コメント）。SPEC §2,4,5,6・DSP §0,1,7・ARCHITECTURE §2,4-5 更新。203/210/211 は欠番。
**判断（要再確認）**: ピッチ歪み＝オクターブアップで実装（他候補: 固定ピッチシフト/サブオクターブ/ハーモナイザ）。既定 OFF。配置は Drive→Octave→Glitch。
**学び**: 「エフェクト成分のみに効かせる」は全セル Mute でドライ漏れ＝不自然になるため不採用。band→歪み→(Octave)→Glitch の素直な直列が、Mute=無音 を保ちつつ意図を満たす。

### 2026-06-21 — UI セクション順を信号フロー順に

**決定**: App.vue の UI セクション表示順を **Band(Focus) → Drive → Glitch → Master** に変更（旧: Drive → Glitch → Band → Master）。
**理由**: ユーザー「bandpass を通った音に歪みが乗るなら、今の最後の方にある並びは不自然＝実際の信号の流れに沿った順に」。帯域抽出が入口（最初）なので Band を先頭に。
**影響**: `App.vue`（`SECTIONS` 配列の並び）のみ。SPEC §2,§6・DSP §1 のセクション列挙を信号フロー順に更新。DSP 処理順は元から band→drive→octave→glitch なので変更なし（UI 表示順だけ整合）。

### 2026-06-21 — 全体コードレビュー（フレッシュ・エージェント）の指摘を反映

別エージェント2観点（DSP 正しさ / 設計クリンナップ）でレビューし、確度の高い指摘を修正。

**DSP 修正**:

- **Freeze 再開時の HP クリック**: iceberg ハイパスの状態（`hpIc1/2`）を Freeze ブロック毎にリセットしていなかった → `snapshotFreeze` で 0 クリア（onset の不連続クリック回避）。
- **Octave のピーク overflow**: 整流＋`OCT_MAKEUP` でブレンド出力が full scale を超えうる → `±1` にクランプ（fuzz 的・後段/出力の overflow 回避）。
- **Freeze ボイス枯渇で hop 取りこぼし**: `spawnFreezeGrain` が空き無しでも `freezeTimer` を進めていた → 成否(boolean)を返し**成功時のみ** timer 前進（次サンプル再試行＝密度ムラ回避）。
- **非連続ステップ跳びでブロック誤判定**: `prevCell` が単一ステップ前進前提だった → `stepIdx === (prevStepIdx+1)%patternSteps` の**連続判定**を入れ、跳び/初回/パターン頭は必ず新ブロック頭に。
- **step enum クランプ**: `distortion.ts` で round 後に `0..5` クランプ（自動化ランプ等での範囲外を防止）。

**設計クリンナップ**:

- **SSoT 定数化**: `params.ts` に `STEPS_PER_BAR=16` / `MAX_BARS=4` / `MAX_STEPS=64` / `clampBars()` を export し、`glitch.ts`・`distortion.ts`・`App.vue`・`StepGrid.vue` で共有＝三重複していた `64`/`16`/bars クランプを解消（drift 防止）。
- **`gridRole` 判別子**: `ParamDef.gridRole:'step'|'bars'` を追加。App は `name.startsWith('step')`/`find(...)!` をやめ **gridRole で判別**＋bars 欠落は init で明示エラー。
- **命名**: `octave.ts` の `PITCH_MIX`（旧 Pitch 機能の名残）→ `OCTAVE_MIX`。

**影響**: `dsp/glitch.ts`・`dsp/octave.ts`・`distortion.ts`・`params.ts`・`App.vue`・`StepGrid.vue`。`vp check`(22)/`vp build` 通過。DSP §1,§3,Octave 数式の定数名・クランプ記述を更新。
**学び**: 数のSSoT（小節長・ステップ数）は1箇所に。質感フィルタは効果ブロック毎に**状態リセット**しないと再開クリックが出る。非線形(整流)は**出力クランプ**で系全体の overflow を防ぐ。

### 2026-06-21 — Octave 撤去 → Pitch（Vinyl Warp 風）に一本化 ／ Glitch wet ノブ撤去 ／ セル固定幅

**経緯**: item6 の「固定ピッチ歪み」を私が**オクターヴ・ファズ**と解釈して入れたが（要再確認と但し書き）、ユーザーが望むピッチは「**Vinyl の Warp 機能みたいな再現性のあるピッチ寄れ（ワウ）**」＝ピッチ**変調**であり、倍音を足す Octave とは別物だった。ユーザー判断で **Octave を撤去し Pitch に一本化**。

- **Octave 撤去**: `dsp/octave.ts` 削除・`octave(207)` 撤去（207 欠番）。
- **Glitch wet(204) 撤去**: 「グリッチ intensity ノブは不要（空セル=Dry で透過する）」→ `glitch(204)` 撤去し `gli.process` から `amount` 引数も削除（常時フル wet＝端フェードのみ内部適用）。id 204 を Pitch に転用。
- **Pitch（Warp, 204）追加**: `dsp/pitch.ts`。可変ディレイを **glitchPhase ロックの決定論カーブ**（Σ amp·sin(2π(freq·phase+ph)) の wow+flutter, freq=パターン整数倍）で揺らす＝**毎ループ同じ揺れ＝再現性**（glitch と同じ思想）。ノブ=depth。Glitch の後・帯域内に挿入。block 段差/rAF ジッタは per-sample 平滑で除去。中身(HARMONICS/BASE/DEPTH/SMOOTH)は今後 debug param で詰める。
- **StepGrid セル固定幅**: ユーザー「セルは1Bar時より小さくしない。幅が要ればプラグインを広げて」→ セルを `flex-1`→**固定 `w-4`(=1Bar時相当)**。グリッチ section を `w-fit` にしてグリッド幅へ伸ばし、コントロールは `max-w-[18rem]` で細いまま、外枠は中央寄せ＝**プラグインが横に広がる**（縮小しない）。

**影響**: `dsp/octave.ts` 削除・`dsp/pitch.ts` 新規、`distortion.ts`（Octave 段削除・Pitch 段を Glitch 後に・gliAmt/amount 撤去）、`glitch.ts`（amount/wetAmt 撤去）、`params.ts`（204 Glitch→Pitch・207 撤去）、`StepGrid.vue`（固定幅）、`App.vue`（レイアウト幅）。SPEC §2,4,5,6・DSP §0,1,Pitch・ARCHITECTURE §2,5 更新。
**判断（要再確認）**: Warp の揺れカーブは「パターンにロック＝毎ループ同形」で実装（Vinyl 実機の不規則 wow とは別、再現性優先）。揺れの速さ・深さ・質感は耳調整前提。セル固定幅 `w-4`。
**学び**: 「固定ピッチ歪み」(item6)と「ピッチが揺れる」(今回)は別概念＝歪み vs 変調。ユーザーの参照(Vinyl Warp)が出た時点で**変調**と確定。再現性は glitch と同じく**位相ロック**で担保。

### 2026-06-21 — Pitch(Warp) を値ノイズ化＋DEBUG パラメータ追加（MAX をもっと揺らす）

**決定**: ユーザー「MAX 時はもっとわかりやすく揺れて。debug パラメータ各種用意して」。Warp カーブを Σsin から **値ノイズ**（パターンを K 区間に分け seed 付き高さを smoothstep 補間・ループ端連続）に作り替え、**Swing/Base/Rate/Smooth を DEBUG param 化**（pchSwing 291 / pchBase 292 / pchRate 293 / pchSmooth 294）。MAX の揺れ幅を既定で大きく（Swing 16ms・Rate 8）。
**理由**: 旧 Σsin（freq 1/3/7・Swing≈4ms）は MAX でも揺れが浅く分かりにくかった。値ノイズ＋Swing/Rate を上げると揺れが大きく/速くなり、耳で詰めやすい。debug は Freeze と同じ「ライブ→確定→焼き戻し」運用。
**影響**: `dsp/pitch.ts`（値ノイズ・process 引数 swing/base/rate/smooth）、`params.ts`（291–294）、`distortion.ts`（配線）、`App.vue`（fmt に `ms` 再追加）。DSP §Pitch 更新。確定後に定数化して 291–294 撤去。
**学び**: 「再現性」は**位相ロックの決定論カーブ**で担保しつつ、揺れの大きさ/速さは Swing/Rate で独立に出すと調整が素直。値ノイズはループ端を `h[K]=h[0]` で連続にすれば周期化＝再現性と両立。

### 2026-06-21 — Pitch(Warp) 定数を耳で確定（範囲確定）

**決定**: `SWING_MS=16` / `RATE=4` / `BASE_MS=20` / `SMOOTH_MS=4` を `dsp/pitch.ts` 定数へ焼き戻し、DEBUG param（pchSwing/Base/Rate/Smooth = 291–294）を撤去。
**影響**: `pitch.ts`（定数化・process 引数を depth/glitchPhase に戻す）、`params.ts`（291–294 削除）、`distortion.ts`（配線）、`App.vue`（`ms` fmt 撤去）。DSP §Pitch 更新。291–294 は欠番。

### 2026-06-21 — セルに長さ概念（8分カラム表示・内部16分）＋ Dive(ぎゅーん降下)タイプ追加

ユーザー仕様変更2点。

- **8分カラム表示（セル長）**: 「4Bar 分ぽちぽちが辛い。セルに長さの概念を。1セル=8分、最小16分、横連結=長さ、4Bar=今の2Bar の長さ」。**内部解像度・スナップは16分のまま（STEPS_PER_BAR=16・最大64スロット）**、**StepGrid 表示だけ8分カラム**（`bars×8`）に。1クリックで内部16分2スロットをペイント＝8分セル、再クリックでクリア。横連結=隣接ブロック=長さ（worklet 不変）。4小節=32カラム=今の2小節幅。**注: 16分単体置きは現UIでは未対応（データは16分なので将来クリック追加可）＝要確認。**
- **Dive タイプ(enum 6)**: 「Pitch をぎゅーんと降下させる行。セル長で1オクターブ下がる」。`dsp/glitch.ts` に新タイプ。ブロック位相 p で `rate=2^(-diveOct·p)`（1→2^-diveOct）、`histWrite−diveDelay` を読み `diveDelay += (1−rate)`＝読みが遅れ＝ピッチ降下（セル長＝降下にかかる時間）。**降下オクターブは DEBUG param `glitchDiveOct`(291)・既定1**（ユーザーが数値指定→確定後 定数化）。

**影響**: `dsp/glitch.ts`（TYPE_DIVE・diveDelay・dispatch・diveOct 引数）、`params.ts`（step max 5→6・glitchDiveOct 291・コメント）、`distortion.ts`（diveOct 配線・clamp 0..6）、`StepGrid.vue`（8分カラム・2スロットペイント・Dive 行＝6行）。SPEC §4,§6・DSP §1,§3・ARCHITECTURE §2,§5 更新。
**判断（要再確認）**: 8分カラム＝内部16分で「1クリック=8分」。16分単体置きの UI は未実装（必要なら追加）。Dive は線形 `2^(-oct·p)` 降下・既定1オクターブ。
**学び**: 「セルに長さ」は内部解像度を変えずに**表示の粒度（8分カラム）＋1クリック複数スロット**で出せる＝worklet 不変で済む。ピッチ降下は**可変ディレイの読み遅れ成長**＝ドップラーで実装（tape-stop 的）。

### 2026-06-21 — Dive を確定（1オクターブ固定・レコードストップ＝線形減速）

**決定**: Dive を **原音から1オクターブ下へ線形減速（レコードストップ）** に変更し、降下量を `DIVE_OCT=1` 固定（DEBUG param `glitchDiveOct`/291 撤去）。再生レートを `1 − (1−DIVE_END_RATE)·p`（`DIVE_END_RATE=2^-1=0.5`）で 1→0.5 へ線形に落とす。
**理由**: ユーザー「1oct でよさそう、固定で。ただ原音より高い位置からフォールするのが気になる→原音から1オクターブ下に、レコードのストップみたいに」。旧 `2^(-oct·p)`（オクターブ線形）は初動の落ちが急で「高い所から落ちる」感。**再生レート線形減速**＝実機のレコードストップ（一定減速）に寄せ、起点は原音(rate=1)・終点は1oct下(rate=0.5)に固定。
**影響**: `dsp/glitch.ts`（DIVE_OCT/DIVE_END_RATE 定数・rate 式・process から diveOct 引数撤去）、`params.ts`（291 削除）、`distortion.ts`（配線撤去）。DSP §1,§3 更新。291 欠番。

### 2026-06-21 — Dive を「重ねがけモディファイア」に（同時オン対応・調査の結論 B）

**調査結論**: タイプは機能で3群——(1) ソース系(Glitch/Freeze/Reverse/Repeat)＝出力の定義なので**互いに排他**、(2) **Dive**＝出力への後段ピッチ変換なので**唯一重ねられる**、(3) Mute＝完全排他。よって同居できるのは「ソース1つ＋Dive」。ユーザー決定: **Dive だけ重ねられるように**（UI は後で工夫）。
**決定（モデル B）**: セル値を **raw= ベース型(下位3bit) | Dive(bit3=8)**（0..13）に。Dive はベース型ではなくなり、**ベース出力を後段で降下させるモディファイア**に。
**DSP**: `glitch.ts` で Dive 専用の出力バッファ `diveBuf`(ch毎・履歴の半分長) を持ち、各ブロックでベース出力を貯めて `diveWrite−diveDelay` を遅らせ読み＝降下（`blockDive` フラグでラッチ・隣接判定は raw 全体）。Dry+Dive＝純ピッチ降下、Glitch+Dive＝ラチェットが降下、等。Mute+Dive は UI で禁止。
**UI**: StepGrid 行を Dive(重ね・sky色)／ソース(排他・emerald)／**Mute(最下段・rose色・排他＝選ぶと Dive クリア)** に。クリックでベース排他トグル＋Dive 独立トグル。ドラッグ伸縮(#3)は別途。
**影響**: `dsp/glitch.ts`（TYPE_DIVE→BASE_MASK/DIVE_BIT・diveBuf/blockDive・dispatch を後段モディファイア化）、`params.ts`（step max 6→13・コメント）、`distortion.ts`（clamp 0..13）、`StepGrid.vue`（重ね/Mute 配色）。SPEC §4,§6・DSP §1,§3・ARCHITECTURE §2,§5 更新。
**学び**: 多くのエフェクトは「出力の定義」で排他。重ねられるのは**後段モディファイア**だけ＝Dive を type でなく**bit フラグ**にし、ベース出力に後がけする構成が素直（拡張時も「モディファイア群」を bit で足せる）。

### 2026-06-21 — StepGrid に横ドラッグ・ペイント（なぞって伸縮）

**決定**: セルを**横ドラッグでなぞって伸縮**（pointerdown でトグル方向を決め、同一行を pointerenter でなぞる＝付与/除去）。「端っこを掴んで伸ばす」要望への**機能優先 v1**。
**現状の限界（要再確認）**: 解像度は**8分カラム単位**のドラッグ（クリック=8分のまま）。**端ハンドルでの16分（カラム半分）リサイズ**は、8分カラム表示で16分を扱う＝サブカラムのクリップ描画への作り直しが要るため、**本UI整備時（ユーザーが「UIで工夫」する回）にまとめて**。データ・スナップは16分なので拡張可能。
**影響**: `StepGrid.vue`（pointerdown/enter/up のドラッグペイント・select-none/touch-none）。SPEC §6 更新。worklet 不変。
**学び**: ドラッグペイントは「方向(add/remove)を down で確定→同一行を enter でなぞる」が素直で堅牢。16分の端リサイズはサブカラム描画前提＝UI 本実装のスコープ。

### 2026-06-21 — UI は DSP 完了後に Three.js で全面刷新（当面は仮UI据え置き）

**決定**: プラグイン UI は **DSP を詰め切ってから Three.js 等で全面的に作り直す**。それまで `App.vue`/`StepGrid.vue` は**仮UI**のまま（params.ts 駆動のスライダ＋8分カラム・ドラッグペイント）。**StepGrid の作り込み（16分の端ハンドル・リサイズ＝サブカラムのクリップ描画、配色/レイアウト整形 等）はやらない**＝本UI刷新のスコープに送る。
**理由**: ユーザー方針「UI は後で Three.js でめちゃくちゃ変える」。throwaway な仮UI に投資しない。DSP 機能の試聴に足りるだけの最小操作性があればよい。
**影響**: 当面 `StepGrid.vue` は現状維持。今後の作業は **DSP 優先**（[[dsp-first-then-ui]]）。16分編集・本UIは Three.js フェーズで。

### 2026-06-21 — 仮UIを16分カラムに戻す（8分カラムでは16分セルを置けないため）

**決定**: StepGrid を **8分カラム表示 → 16分カラム表示**に戻す（`cols=bars×16`・1カラム=内部1スロット）。1セル=16分（最小）、8分は2セル、長尺はドラッグ。
**理由**: ユーザー指摘「16分の長さのセルが入力できなくない？」。8分カラム（1クリック=2スロット）では**16分単体が置けなかった**。「8分カラムで16分も置く」はサブカラムのクリップ描画が必要だが、UI は後で Three.js 全面刷新の方針＝仮UIに作り込まない。よって**16分カラム＋ドラッグペイント**で全長（16分〜）を置けるようにするのが最小で機能的。4小節=64カラムと横長になるがドラッグで埋められ、幅は w-fit で広がる（throwaway UI なので許容）。
**影響**: `StepGrid.vue`（16分カラム・単スロット書込・ハイライト `current===c`）。App は currentStep が16分インデックスなので変更不要。SPEC §4,§6・DSP §3・ARCHITECTURE §2,§5 を16分カラム表記に更新。worklet 不変。
**学び**: 「8分デフォルト＋16分最小」を**単一クリックの粒度**で両立は不可（サブカラム必須）。仮UI では**16分カラム＋ドラッグ**にして粒度問題をドラッグへ逃がすのが素直。8分カラム最適化（45cfe0d）は撤回。

### 2026-06-21 — StepGrid をクリップ式に（8分カラム表示のまま16分長を入力可）

**決定**: 直前の「16分カラムに戻す」は誤読。正しくは **「8分カラム表示のまま、セルを16分の長さにできる」**＝**クリップ式（セルを位置・長さで描画、端ドラッグで16分スナップ・リサイズ）** に作り直し。

- **内部16分**（1スロット `SLOT_W=8px`、8分カラム=16px）。各行は1本のトラック div（ボタン羅列でなく）。セルは active なランを絶対配置 div で描画。
- **操作**: 空カラムをクリック＝8分セル作成（クリック位置の8分カラム[偶数slot, +1]）→そのままドラッグで伸縮。**セル右端(EDGE=6px)をドラッグ＝16分スナップでリサイズ**（最短=anchor のみ＝16分）。**セル本体クリック＝そのランを消去**。pointer capture＋clientX→slot で 16分精度。
  **理由**: ユーザー「戻すんじゃない。8分カラムで16分の長さにできるようにする」。8分カラムの**コンパクトさ**と16分の**精度**を両立するにはサブカラム＝クリップ描画が必須（ボタン1個=8分では16分を表現できない）。仮UI だが機能的に実装（本UIは Three.js 刷新時）。
  **影響**: `StepGrid.vue` 全面（クリップ式・pointer 計算・ラン描画・グリッド背景）。worklet/params 不変。SPEC §4,§6・DSP §3・ARCHITECTURE §2,§5 を「クリップ式・8分カラム/内部16分」に更新。
  **学び**: 「N分カラム表示＋それより細かい単位の編集」はボタン羅列では無理＝**clientX→スロット＋絶対配置のクリップ描画**が要る。`pointer-events-none` をセル/ヘッドに付け、トラック1枚で全 pointer を捌くのが堅牢。

### 2026-06-21 — DSP バグレビュー: 「ビーー」持続音の修正 ＋ Mute+Dive 優先 ＋ doc/code 整合

フレッシュ・エージェントで全 DSP をレビュー（持続音/NaN/フィードバック/OOB 観点）。

- **「ビーー」の原因＝Glitch の自走ループ（最有力・修正）**: `localPos` を毎サンプル自走させ、`glitchPhase` が止まると（再生停止／**デバッグ中にブラウザのタブが非アクティブ→rAF 停止**で位相が更新されない）、停止位置で **stale な履歴をループし続け持続音化**。Suara でなく当方バグ。**修正**: `glitchPhase` が `HOLD_MS=150ms` 更新されなければ「停止」と見なし **glitch を素通り**（履歴は更新して復帰に備える）。`glitch.ts` に `prevPhase/frozenSamples/holdSamples`。
- **Pitch の常時20msディレイ（修正）**: depth=0 でも band に中心ディレイ ~20ms がかかり、狭帯域で rest とコム＋レイテンシ。**depth=0 は完全バイパス**（バッファ更新のみ）に。
- **Mute+Dive（ユーザー要望・修正）**: Mute セルに Dive を置いたら **Dive 優先**＝Mute をどける（`base=MUTE && add(dive)` → `base=0`）。逆（Mute を後置）は従来どおり Dive クリア＝**最後の操作が勝つ**。
- **doc/code 整合**: 信号順は実コードどおり **band→Drive→Glitch→Pitch**（DSP §2b の旧 `[Drive]→[Pitch]→[Glitch]` を修正）。Pitch 中心ディレイは「数ms」でなく 20ms（depth>0 時のみ）と明記。
- **レビューで bug 無し確認**: Dive readback・Pitch ディレイにフィードバック無し、saturation の log/sqrt/asin は定義域安全、band は cutoff を sr\*0.45 にクランプ、Freeze バッファ境界 OK（NaN/OOB 無し）。

**影響**: `dsp/glitch.ts`（停止 hold）、`dsp/pitch.ts`（depth=0 バイパス）、`StepGrid.vue`（Mute+Dive 優先）。DSP §2b/§3/Pitch 更新。`vp check`(22)/`vp build` 通過。
**学び**: rAF 駆動の位相を worklet 自走で補間する設計は、**rAF が止まる状況（タブ非アクティブ/停止）で自走が暴走**する。位相更新の停止を検出して hold するのが必須。常時オンの可変ディレイは**未使用時バイパス**しないとコム/レイテンシが残る。

### 2026-06-21 — StepGrid 操作: クリック=消去をクリック/ドラッグ判定に、左右ドラッグで伸縮

**問題**: 端ゾーン判定(EDGE=6px)が16分セル(8px)をほぼ覆い、16分クリックがリサイズ扱い＝消えない。
**決定**: 端ゾーン廃止。**移動有無で判定** — `pointerdown` で `moved=false`、スロットが変われば `moved=true`。`pointerup` で **!moved かつ作成でない＝クリック→そのランを消去**。ドラッグは **掴んだ側の反対端を `fixed` に、左右どちらへ動かしても** `[min(fixed,s), max(fixed,s)]` に差分 set/clear で伸縮（**左ドラッグでも伸長**・要望どおり）。空クリックは16分作成（`created` フラグでクリック消去から除外）。
**影響**: `StepGrid.vue`（drag 状態を fixed/lo/hi/moved/created に・onDown/onMove/endDrag 刷新・EDGE 撤去）。SPEC §4,§6・ARCHITECTURE §2 更新。worklet 不変。
**学び**: 小セルでの「端掴みリサイズ vs クリック消去」は px の端ゾーンでは破綻＝**move 有無でクリック/ドラッグを判別**するのが堅牢。伸縮は固定端＋min/max で左右対称に。

### 2026-06-21 — UI 整理: Band Mute 撤去 / Band を2ポイント1本スライダ / Comp・Drive On を常時ON固定

**決定**: ユーザー要望でトグル4種を整理。

- **Band Mute(216) 撤去**: 帯域の試聴は **Solo のみ**（off=帯域+残りを合成）。worklet の recombine から `bandGain`/`bandTarget` を削除し `output += rest * restGain`（Solo で restGain→0）だけに簡素化。
- **Band を1本スライダ＋2 thumb に**: 旧 Band Lo/Hi の2スライダ → 新コンポーネント [BandRange.vue](../src/components/BandRange.vue)（log・トラックをクリック/ドラッグで**近い側 thumb** を掴む・lo≤hi クランプ）。params は Lo=213/Hi=214 のまま（UI だけ統合）。App は band の `unit==='Hz'` を自動スライダから除外して BandRange へ委譲。
- **Comp(222) 撤去 → 常時 ON 固定**: トグルを廃止し distortion.ts は `sat.process(..., true)`。`saturation.ts` は comp 引数（OFF=速い envelope）の実装を残すが本プラグインは ON 固定で配線（自然圧縮・既定挙動のまま）。
- **Drive On(206) 撤去 → 常時 ON 固定**: 歪み段の ON/OFF クロスフェード（`satMix`）を削除。Drive 段は常に適用。

**理由**: 「Mute いらない・Solo だけ」「帯域は2ポイントの1本スライダが直感的」「Comp は常時 ON でいい」「Drive On も不要」。いずれも UI のノイズ削減＝触る軸を絞る。挙動は既定（Comp ON・Drive ON）と同じなので音は不変、操作面だけ簡素化。
**影響**: `params.ts`（206/216/222 削除）・`distortion.ts`（satMix/bandGain/mute 削除・comp 固定 true）・`App.vue`（band Hz を BandRange へ）・新規 `BandRange.vue`。SPEC §2/§4/§5/§6・DSP §1/§2/§2b・ARCHITECTURE §4/§5/§2 を更新。206/216/222 は **欠番**（VST tag 再利用しない）。`vp check`(23)/`vp build` 通過。
**学び**: 「常時 ON 化」は param を消すだけでなく **worklet のクロスフェード段（mix 平滑）も撤去**して初めて簡素になる（dead path を残さない）。N本スライダ→1本2 thumb は、トラック1枚に pointer を集約し**近い thumb を掴む**方式が最小で堅牢（StepGrid と同じ clientX→正規化）。

### 2026-06-21 — Freeze を Ice Reverb（FDN拡散残響）化（Iceverb 風“コー”・デバッグ param 付き）

**決定**: Freeze のグラニュラー雲（凍結域の窓化グレイン）を**そのまま励起源**に、後段へ **FDN 拡散残響**を追加して Guitar Rig「Iceverb」風の“コー”を作る。リサーチの **案A（FDN残響）** を採用（[[freeze-ice-reverb-research]]・シマー(案B)は後日）。

- **構成**: `グラニュラー雲(src) → 入力 allpass×2(ディフュージョン) → 4ライン FDN(Hadamard 直交FB・各FBに 1-pole damping) → Mix で src とブレンド → iceberg HP(310Hz)`。`glitch.ts` に `FreezeVerb` クラスを追加（Freeze ブロック中のみ per-sample 駆動・凍結スナップごとに `reset`）。
- **安定性**: Hadamard 4×4×0.5 は直交（‖=1）＝FB ゲイン `< FV_FB_MAX(0.97)` で BIBO 安定。damping LP も ‖≤1。励起は有界 ⇒ 出力有界（NaN/発散なし）。
- **デバッグ param（暫定 291-295・section=glitch）**: `Frz Decay`(FBゲイン=テール長) / `Frz Diffuse`(allpass係数) / `Frz Size`(ライン長スケール・小=金属的) / `Frz Tone`(damping・高=高域残す=氷) / `Frz Mix`(雲⇄残響)。0..100→0..1 で `distortion.ts`→`glitch.process(...,fv)` に渡す。**耳で詰めたら定数化して param は撤去**（Pitch/Dive と同じ debug→bake 運用）。

**理由**: 現 Freeze（グラニュラー雲のみ）は「ザラついたパッド」で、Iceverb の**拡散残響感・氷/金属の煌めき**が無い。FFT 不使用・既存 delay/allpass/comb 部品で組める案A が最短かつ worklet 負荷も現実的（worklet 13.7→16.2kB）。シマー(オクターブ上FB)は効果大だがスコープ増のため次段。
**影響**: `dsp/glitch.ts`（`FreezeVerb` 追加・Freeze 分岐・snapshot reset・process 引数 `fv`）/ `params.ts`（291-295 追加）/ `distortion.ts`（読み出し＋受け渡し）。docs SPEC §4・DSP §3 Freeze・ARCHITECTURE §2/§5・TASKS 更新。`vp check`(23)/`vp build` 通過。**未コミット＝耳で試聴→定数化してからコミット予定**。
**学び**: FDN は Hadamard（直交）＋FBゲイン<1 で安定が保証できる＝設計が読める。Size でライン長を変えると金属⇄ルームを連続で振れる。debug param は「定数化したら撤去」を最初から DECISIONS/SPEC に明記して暫定だと分かるようにする。

### 2026-06-21 — Freeze Ice Reverb 定数化 ＋ iceberg HP を 4-pole 化（ロー残り対応）

**決定**: 直前の Freeze Ice Reverb（FDN）を耳で確定し**定数化**。ユーザー試聴値 `Frz Decay 12% / Diffuse 70% / Size 31% / Tone 73% / Mix 14%` を `glitch.ts` 定数 `FV_DECAY=0.12 / FV_DIFFUSE=0.70 / FV_SIZE=0.31 / FV_TONE=0.73 / FREEZE_VERB_MIX=0.14` に焼き込み、**デバッグ param 291-295 を撤去**（`FreezeVerbParams` interface・process の `fv` 引数も削除＝署名を `(io,steps,glitchPhase,bpm,randomMode,bars)` に戻す）。FreezeVerb は constructor で `setParams` を一度呼ぶ固定係数。

- **iceberg HP を 2-pole(12dB/oct)→4-pole(24dB/oct) に強化**: ユーザー「Freeze にローが残る」指摘。検証の結果 HP は正しく効いていた（2-pole Butterworth @310・凍結ごとリセット）が、**12dB/oct が緩く 150–300Hz が残る**のが原因。コーナー 310Hz は維持し、2-pole TPT SVF を**2 段直列**にして低域をしっかり削る（`freezeHpProcess` に b セクション state 追加・snapshot で両 state リセット）。

**理由**: Iceverb の“氷”感は低域がスッと抜けていることが効く。デバッグ運用（Pitch/Dive と同じ debug→bake）どおり、値が決まったら定数化して UI を綺麗に保つ。HP はカットオフを上げるより**スロープを立てる**方が、ユーザーが選んだ 310Hz の質感を保ったまま低域だけ削れる。
**影響**: `dsp/glitch.ts`（定数化・`fv` 引数撤去・4-pole HP・b state）/ `params.ts`（291-295 削除）/ `distortion.ts`（debug 読み出し撤去・呼び出し簡素化）。docs SPEC §4・DSP §3 Freeze・ARCHITECTURE §2/§5・TASKS 更新。**291-295 は欠番**（VST tag 再利用しない）。`vp check`(23)/`vp build` 通過。**まだローが多い/少ないなら HP カットオフ(310)を調整 or シマー(案B)追加で対応**。
**学び**: 「HP が効いてない気がする」は多くが**スロープのゆるさ**（バグでなく次数）。コーナー据え置きで段数を増やすのが、質感を保ったまま量を増やす素直な手。debug→bake は ID を毎回 291 起点で使い回すので、撤去時に必ず欠番として記録する。

### 2026-06-22 — Freeze 再設計: グラニュラー＋FDN を破棄 → フェード付きリピート＋追従＋ピンク＋EQ

**決定**: 直前の Freeze（グラニュラー雲＋FDN Ice Reverb＋tanh Crush）を**全面破棄**し、シンプルな**フェード付きリピート**に作り直して定数化。

経緯（試聴で逐次修正→最終形）:

- **Crush の問題**: tanh 潰しは「音圧」でなく**音量が暴れて制御不能**＝撤去。代わりに **Freeze 音量を原音(dry)包絡に追従**（出力 = inEnv×Level・上限+15dB クランプ）＝入力でバラつかず一定（Level=0.55）。
- **グラニュラーの問題**: 読み位置が狭く実質 ~grain 長のループ＝「サンプル繰り返し」、全域散布にしても**ブチブチ/アタック連打**で意図と違う。→ **グレイン雲・FDN を捨て、短チャンク(126ms)のオーバーラップ crossfade ループ**に。**2読み位置を L/2 ずらし Hann 窓（w1+w2=1）で混ぜる**＝継ぎ目クリックも**チャンク自身のアタック起伏も平坦化**（連打が消える）。短いほどループ周期が可聴ピッチ＝持続トーン寄り。
- **ノイズ**: 白色→**ピンクノイズ**（Paul Kellet economy・-3dB/oct）。Freeze セル中のみ・原音追従レベル(Noise=0.28)で加算。
- **後段 EQ**: RBJ biquad ×3 = **HP370 → ピーク1.2k(+14dB Q2.2) → ハイシェルフ3k(-7.2dB Q1)**（旧 iceberg 4-pole HP@310 を置換）。

**理由**: 「グレイン保持より、短いチャンクを掴んでフェードで繰り返し、その上に EQ＋ノイズ」というユーザー方針。クロスフェードは**継ぎ目を繋ぐだけでなくオーバーラップで包絡を平坦化**して初めてアタック連打が消える（ユーザー指摘どおり）。音量の入力依存は**潰し**でなく**原音追従**で解くのが正解。
**影響**: `dsp/glitch.ts`（FreezeVerb 削除・グラニュラー/Crush/iceberg HP 削除・`freezeLoopRead`(2読み Hann)・`nextPink`・`FreezeEq`(RBJ biquad×3) 追加・process 引数から freeze 系を撤去し定数化）/ `params.ts`（debug 291-293 削除）/ `distortion.ts`（配線撤去）。docs SPEC §4・DSP §3・ARCHITECTURE §2/§5・TASKS 更新。**291-293 は欠番**。`vp check`(23)/`vp build` 通過。
**確定値**: `FREEZE_LOOP_MS=126 / FREEZE_LEVEL=0.55 / FREEZE_NOISE=0.28`、EQ=HP370・Peak1.2k+14dBQ2.2・Shelf3k-7.2dBQ1、`FREEZE_PINK_SCALE=0.5`（**ピンク音量は要再試聴**＝白→ピンクで知覚音量が変わるため、必要なら SCALE か NOISE を再調整）。
**学び**: 短ループの「羽ばたき/連打」は**継ぎ目クリックでなくチャンク包絡の周期反復**＝seam crossfade では消えない。**2読み位置×Hann のオーバーラップ加算（和=1）**で包絡を平坦化するのが本質。音量一定化は潰しでなく入力追従。デバッグ→bake は ID を 291 起点で使い回すので撤去時に欠番記録。

### 2026-06-22 — Dive×Mute 共存＋連続フォール / Random をUI生成(ボタン+シード)に刷新

**① Dive を Mute と共存可・フォールを連続化**

**決定**: Dive を **Mute と重ねられる**ようにし（UI 排他を撤去）、Dive のフォール（ピッチ降下）を **DIVE_BIT が連続する範囲(dive run)全体で1回**に変更（従来はベースブロック頭でリセット＝Mute 等で base が変わると**やり直し**）。

- `glitch.ts`: Dive のラッチを base ブロックと**分離**。`diveNow && !divePrev`（DIVE_BIT 連続の頭）でのみ `diveDelay/diveWrite` リセット＋`diveStartPos/diveRunLen` 確定。フォール位相 `dp = (localPos−diveStartPos)/diveRunLen`。
- **Mute セルの扱い**: 出力は無音（Mute ゲート）のまま、diveBuf には `dry` を書いて内容を途切れさせない＝**ミュート後そのまま降下が続く**。非 Mute は従来どおり遅らせ読み。
- `StepGrid.vue` `applySlot`: Dive 行は base を触らず dive のみ、Mute 行は dive を触らず base のみ＝共存（raw=Mute\|Dive=12 が成立）。
  **理由**: ユーザー「長いフォールの間にミュートされても、ミュート後はそのまま Dive の続きが欲しい」。フォールは"効果の継続"なので base ブロックでなく **Dive の連続範囲**に紐づけるのが自然。

**② Random を DSP モード撤去 → UI 生成（Random ボタン＋シード＋Clear）**

**決定**: DSP の「ランダムモード（`glitchRandom`/290 トグル・グリッド無視で全ステップ決定論抽選）」を**全撤去**し、**StepGrid の Random ボタン**がシード（表示・押すたびに前進）から**実セルを生成**して `steps[]` に書く方式に変更。**Clear ボタン**で全消去。

- `params.ts`: `glitchRandom`(290) 削除＝**欠番**。`glitch.ts`: `randomMode` 引数・micro 状態・`rand01`/`SEED` を削除（process が素直にグリッド再生＝コード大幅簡素化）。`distortion.ts`: 配線撤去。`StepGrid.vue`: `seed` ref・`hash()`・`randomize()`（密度 0.45・Dive 重なり 0.12・ベース 1..5）・`clearAll()`＋ボタン。
  **理由**: 「ランダムは実装ガラッと変えて、ボタン＋シードで押すたびにセル配置が変わる方式に」。実セルを書くので**拍ロック・再現性・後からの手編集**が自然に効く（DSP 特殊モードより素直で柔軟）。

**影響**: `dsp/glitch.ts`（Dive run・Mute 共存・random 撤去）/ `params.ts`（290 削除）/ `distortion.ts`（randomMode 配線撤去）/ `StepGrid.vue`（applySlot・Random/Clear/seed）。docs SPEC §4/§6・DSP §1/§3・ARCHITECTURE §2/§5・TASKS 更新。**290 は欠番**。`vp check`(23)/`vp build` 通過。Random の密度/Dive 率は要試聴（定数）。
**学び**: 「効果の継続長」を持つモディファイア（Dive）は**自分の連続範囲**に位相を紐づける（base ブロックと分離）と、他タイプの割り込み（Mute）に強い。ランダムは"DSP の特殊再生モード"より"**グリッドに実セルを書く UI 操作**"にする方が、既存のロック/再現性/編集と素直に噛み合う。

### 2026-06-22 — Random 重み付け詰め ＋ シード操作（VST はキー入力不可＝ボタンのみ）／DSP 一旦完成

**Random 生成の重み付け**（耳で調整・StepGrid 定数）:

- **Mute は必ず単発16分**: 単発Mute同士が隣接すると連結して8分以上に見える指摘→ **Mute を置いたら次セルを必ず空ける**＝両隣に Mute が来ない。重みはやや高め(6/14)。
- **Dive は8分(2セル)が最頻＋残りランダム長(3-6)**。run 化で被覆が増えた指摘→ density 0.04 に抑制。
- **空セルに単発16分 Glitch を追加**（他タイプの割合は保ったまま Glitch だけ盛る・**隣接 Glitch は不可**で単発維持）。

**シード操作の UI**: ◀(前のシード)/▶・Random(次)/`#seed` 表示/Clear。最初テキスト入力欄→**VST で打てない**ことが判明。調査の結果、**Suara の VST GUI は hacked chromium＋C++/.mm ブローカ**で、キーイベントは届く（SDK の VirtualKeyboard が window keydown を使えている）が **DOM 入力欄へのキー配送/フォーカスはネイティブ層が握る＝プラグイン JS から不可**（JS `.focus()` も無効）。画面内テンキーも試作したが「使いづらい」と却下→ **◀▶ ボタンのみ**に確定（Random=+1 なので直前は ◀ 一発で戻れる）。

**理由**: ランダムは「いい配置をすぐ出す＋直前に戻れる」が要件。VST のキー制約は SDK ネイティブ層の管轄でこのリポジトリ(JS GUI)からは変えられないため、**ポインタ操作(ボタン)に寄せるのが唯一確実**。
**影響**: `StepGrid.vue`（重み付け生成・◀▶/Random/Clear・seed 表示。テキスト入力/テンキーは撤去）。docs SPEC §4/§6・DSP §3・TASKS 更新。`vp check`(23)/`vp build` 通過。
**学び**: 「ランダムを実セルで書く」方式は、生成ロジック(重み・ラン・隣接制約)を **UI 側の素直な JS** で書けて調整が速い（DSP 特殊モードより圧倒的に楽）。VST webview のキーボードはホスト/ネイティブ依存＝**プラグイン GUI からは諦めてポインタ操作に倒す**のが堅実。**この時点で DSP は一旦完成**（後日コードレビュー → UI フェーズへ）。

> パラメータの範囲・既定値は v0.3 提案。確定したらここに「範囲確定」として追記する。

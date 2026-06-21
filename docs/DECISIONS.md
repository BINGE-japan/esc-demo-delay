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

> パラメータの範囲・既定値は v0.3 提案。確定したらここに「範囲確定」として追記する。

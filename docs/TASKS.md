# TASKS — 実装ロードマップと進捗

> フェーズ単位の進行管理。着手前に該当フェーズの仕様（[SPEC.md](./SPEC.md) / [DSP.md](./DSP.md) / [ARCHITECTURE.md](./ARCHITECTURE.md)）を読む。
> 完了したらチェックを付け、仕様変更が出たら [DECISIONS.md](./DECISIONS.md) に追記してから進む。
>
> 最終更新: 2026-06-21

## 凡例

- [ ] 未着手 / [~] 進行中 / [x] 完了

## Phase 0 — 土台（現状）

- [x] passthrough worklet で in→out 配線が通っている（既存テンプレ）
- [x] 仕様ドキュメント初版（SPEC/DSP/ARCHITECTURE/DECISIONS/TASKS）

## Phase 1 — MVP（まず歪んだ音を出す）

目標: Web で Drive を上げると歪み、Output で音量補正できる。[SPEC.md](./SPEC.md) §7 受け入れ基準を満たす。

- [x] worklet に `parameterDescriptors`（drive/tone/output）を追加（[ARCHITECTURE.md](./ARCHITECTURE.md) §4）
- [x] worklet `process()` に段1（Input Gain）・段3（Hard Clip）・段6（Output Gain）を実装（[DSP.md](./DSP.md) §2）
- [x] App.vue に Drive / Output（＋Tone）スライダ（仮UI）を追加
- [x] `useParam(200,...)` / `useParam(202,...)` を生成し、watch で AudioParam へ橋渡し
- [~] Web で test tone / file 再生 → 歪み確認（受け入れ基準）← **要試聴**
- [x] `vp check` 通過
- [~] 動作確認後、変更点を各ドキュメントに反映（試聴後に完了）

## Phase 2 — Tone

> 仮UI方針（[DECISIONS.md](./DECISIONS.md) 2026-06-20）で MVP と同じ橋渡し経路のため DSP/橋渡しを前倒し実装。

- [x] worklet に段5（1-pole LPF）と Tone パラメータ（201, log, 500..18000Hz）を追加（[DSP.md](./DSP.md) §2 段5）
- [x] チャンネル毎の LPF 状態保持（`lpState`）
- [x] App.vue に Tone スライダ追加 + 橋渡し（仮UI）
- [~] 高域が削れることを確認 / `vp check`（vp check 済・**試聴要**）

## Phase 2.5 — 触り心地パラメータ（実装済・要試聴）

> ユーザー要望 5 点（[DECISIONS.md](./DECISIONS.md) 2026-06-20）。本命の UI×パラメータに向け DSP を先行実装。

- [x] 段3b 静的メイクアップ（Drive を上げても音量一定・ポンピング無）（[DSP.md](./DSP.md) 段3b）
- [x] 段5 Tone を Tilt EQ（暗⇄明、±%）に変更（[DSP.md](./DSP.md) 段5）
- [x] 段7 Wobble（可変ディレイ＋ランダム LFO）追加 / param 203（[DSP.md](./DSP.md) 段7）
- [x] 段8 Glitch（再現性・リピート/ゲートのミックス）追加 / param 204（[DSP.md](./DSP.md) 段8）
- [x] App.vue に Wobble/Glitch スライダ追加・Tone を双極 % に・Output 既定 0dB
- [x] `vp check` 通過
- [~] 試聴で各ノブの効きと量感を確認・調整（**要試聴**、量感は耳で詰める）

## Phase 2.6 — 音量恒常 / パーツ分け / バイパス（実装済・要試聴）

> ユーザー要望（[DECISIONS.md](./DECISIONS.md) 2026-06-20 v0.3）。

- [x] DSP をユニット分割（`dsp/saturation.ts` / `loudness.ts` / `wobble.ts` / `glitch.ts`）、`distortion.ts` は組み立て役
- [x] パラメータ定義を `params.ts` に SSoT 化（worklet descriptors / App useParam・UI が派生）
- [x] 音量恒常: Drive makeup ＋ **Tone makeup（新規）** ＋ 遅い自動トリム（Loudness Match, Auto Gain トグル） ※後に**自動トリム/Auto Gain は撤去**し純フィードフォワード化（Phase 2.10）
- [x] セクション分離（歪み / ピッチ&グリッチ / マスター）を DSP・UI 両方で
- [x] バイパス: 全体(208) ＋ セクション個別(206/207)、クロスフェードでクリック回避
- [x] App.vue を params.ts 駆動・セクション UI に刷新
- [x] `vp check` / `vp build` 通過
- [~] 試聴で音量恒常・各セクション・バイパスを確認、量感を耳で調整（**要試聴**）

## Phase 2.7 — Wobble 拡張 / Glitch Spectral Fill（実装済・要試聴）

> ユーザー要望（[DECISIONS.md](./DECISIONS.md) 2026-06-20）。

- [x] Wobble に Depth(203) / Wob Speed(210) / Wob Occur(211)
- [x] Wob Occur の「たまに」は BPM グリッドにシード付き判定で再現性あり（bpm=209 を transport から供給）
- [x] `params.ts` に `hidden` フラグ（bpm の UI/useParam を作らない）、App が transport.tempo を橋渡し
- [x] Glitch に Spectral Fill(212): ゲート無音にスペクトル反転音（(-1)ⁿ）を差し込む
- [x] `vp check` / `vp build` 通過
- [~] 試聴で Depth/Speed/Occur の効き・Spectral Fill の質感・BPM 同期の再現性を確認、量感を調整（**要試聴**）

## Phase 2.8 — セクション分離 ＋ 帯域指定（Band Focus）（実装済・要試聴）

> ユーザー要望（[DECISIONS.md](./DECISIONS.md) 2026-06-20）。

- [x] Pitch / Glitch をセクション分離（Pitch On=207 / Glitch On=217、UI 5 セクションに）
- [x] 帯域スプリット `dsp/band.ts`（4-pole TPT SVF）＋ `rest = in − band` 完全再構成
- [x] 帯域内100%Wet / 帯域外100%Dry、Solo(215)/Mute(216) 試聴（クロスフェード）
- [x] Band Lo(213)/Hi(214) を log スケール（`params.ts` log フラグ、App の log スライダ・Hz 表示）
- [x] `vp check` / `vp build` 通過
- [~] 試聴で帯域の切れ・Solo/Mute・帯域内外の Wet/Dry を確認、フィルタ急峻さと量感を調整（**要試聴**）

## Phase 2.9 — Howl（ハウリング倍音）【廃止】

> **このセクションは削除**（2026-06-21）。金属味付加を数案試したが狙いに届かず撤去（[DECISIONS.md](./DECISIONS.md) 2026-06-21）。試行は git 履歴に残る。やり直す場合は別アルゴリズムで新規に起こす。

- [x] ~~`dsp/howl.ts`（ウェーブフォルダー → 外部キャリア RM → 原音自己 RM → 奇数倍音エキサイター を順に試行）~~ → **削除**
- [x] ~~パラメータ Howl(218)/Howl On(220)~~ → **削除**（ID 218/219/220 は再利用しない）
- [x] 副産物として残した改善: **Loudness Match を知覚重み付きに**（Drive の明るさ増分も音量として勘定＝Drive 単体の音量恒常が向上。[DECISIONS.md](./DECISIONS.md) 2026-06-21）
- [x] `vp check` / `vp build` 通過（Howl 削除後）

## Phase 2.10 — 音量恒常を純フィードフォワード化（実装済・要試聴）

> ユーザー指摘「下げるまでの間（後追いラグ）が気持ち悪い／音量にムラ。**アルゴリズム（Drive/Tone）から上がる分を計算して下げる**シンプル堅牢な実装に。音を出してから計測しない」。方式＝**純フィードフォワード**（リアクティブ撤去。[DECISIONS.md](./DECISIONS.md) 2026-06-21）。

- [x] 知覚重み付けを `dsp/weighting.ts` に切り出し（Drive 知覚 makeup 表の構築に使用）
- [x] **静的「知覚 Drive makeup」**（`dsp/saturation.ts`）: 起動時に基準正弦を clip→重み付けして表化、`makeup=driveMakeup·table`＝RMS＋明るさ増をノブ値から**即時**補正
- [x] ~~緩急 ballistics~~ → ~~遅く滑らかなトリム~~ → **リアクティブな Loudness Match と Auto Gain(205) を撤去**。`dsp/loudness.ts` 削除。出力を測る段をなくし純フィードフォワードだけに（ラグ/ムラ/ポンプが原理的に出ない）
- [x] look-ahead は SDK のレイテンシ非申告のため不採用（VST タイミングずれ）
- [x] **入力レベル連動 makeup**（`dsp/saturation.ts`）: ノブだけだと「フルスケール前提」較正で入力が小さいと Drive がただのゲイン化＝補正が追いつかない指摘を是正。入力ピーク envelope `a` を見て**実効ドライブ Geff=a·driveLin** で評価＝クリップ前は `1/driveLin`（ゲイン相殺）。Drive 操作に遅延ゼロ・出力非測定（[DECISIONS.md](./DECISIONS.md) 2026-06-21）
- [x] **Comp(222) トグル**: 「ダイナミクス保持のまま歪む」指摘→保持/圧縮を切替。差は入力 envelope の速さのみ（ON=遅い250/400ms＝自然圧縮・既定 / OFF=速い5/150ms＝保持）。makeup 式共通・音量恒常維持（[DECISIONS.md](./DECISIONS.md) 2026-06-21）
- [x] **Comp ON レベル補償**: 「Comp OFF が ~5dB 大きい」指摘→ Comp ON に一律トリム（最大 `COMP_TRIM_DB`≈5dB・クリップ量 Geff でゲート＝低 Drive 中立）。簡易近似・耳調整（[DECISIONS.md](./DECISIONS.md) 2026-06-21）
- [x] `vp check` / `vp build` 通過
- [~] 試聴: **Comp ON** で素材のダイナミクスレンジが圧縮（サステインのレベル感は一定）/ **Comp OFF** で保持、を A/B。Drive スイープで両モード音量一定。圧縮量は Drive・`ENV_*_SLOW_MS` で調整（**要試聴**）

## Phase 2.11 — Glitch ステップシーケンサ（実装済・要試聴）

> 壁打ちで確定（[DECISIONS.md](./DECISIONS.md) 2026-06-21）。横=16分ステップ(1小節)/縦=タイプ・BPM拍ロック・再現性。

- [x] 初版: 16ステップ・5タイプ（Dry/Repeat/Freeze/Reverse/Random）・拍同期・StepGrid 仮UI（コミット `c028013`）
- [x] **ブロック(隣接)モデルに刷新**（壁打ち・[DECISIONS.md](./DECISIONS.md) 2026-06-21）: 同一 enum 連続セル＝1ブロック・**幅=継続長**。`dsp/glitch.ts` を per-step→ブロック・ディスパッチに全面書換
- [x] **タイプ刷新**: enum 0..8＝Dry/**Glitch**(旧Repeat)/Freeze/**Reverse(幅=逆レンジ)**/Random/**Mute**(新・Spectral Fill 移管)/**Repeat×3**(旧Loop=ビートリピート, chunk=1/16・1/8・1/4 を**per-cell**)
- [x] `params.ts`: step max 4→8・enum コメント・Fill→Mute 注。`StepGrid.vue` 9行に。`distortion.ts` は不変（0..8 round）
- [x] 拍同期: App が positionSamples(VST)/ctx.currentTime(Web) → glitchPhase(0..1)、worklet は自走＋大ドリフトのみスナップ（サンプル精度・ジッタ耐性）
- [x] `vp check`(22 files) / `vp build` 通過
- [~] **試聴（DSP先行の核）**: ブロック幅で継続長／Repeat 行で chunk（拍ごと可変）／Reverse 幅で逆レンジ／Mute(+Fill)／拍ロック・再現性・境界クリック無し。`GLITCH_SLICE`/`FREEZE_GRAIN_MS`/分割 を耳調整（**要試聴**）
- [ ] 音が決まったら **StepGrid UI を整形**（Repeat 分割のコンパクト表示・配色・ハイライト・ラベル）＝DSP確定後
- [ ] 後日: 完全ランダムトグル / Tape-stop / Random の小節間変化 / ブロック split 操作 / 4/4 以外（timeSig を worklet へ）

## Phase 2.12 — Glitch/Pitch 仕上げ一括（実装済・要試聴）

> オートモードで一括実装＋段階コミット＋フレッシュ・レビュー（[DECISIONS.md](./DECISIONS.md) 2026-06-21 の各項）。

- [x] **Freeze グラニュラー化＋iceberg HP**（コミット `c96a46c`）: 単一ループ→4声ジッタ窓グレイン＋窓和正規化、Freeze wet のみ 2-pole HP(310Hz)。Random をステップ毎再抽選に
- [x] **音量(item4)**: Comp ON トリムの Drive 連動を緩和（`COMP_TRIM_DB 7→4` / `FULL 12→6` 早期プラトー、`d09338c`）
- [x] **Spectral Fill 撤去(item7)**（`609eaff`）
- [x] **型セット刷新(item3/5/2)**（`f186924`）: Repeat16分のみ・Dry 行削除(空=Dry)・Random をモード化(290)・enum 0..5・StepGrid 5行
- [x] **小節数タブ(item1)**（`4475e82`）: 1/2/4 小節＝bars×16(最大64)・ループ長そのものを切替・複数小節 phase・glitchPhase 239→287
- [x] **Pitch→Octave(item6)**（`5fcfb3d`）: Wobble 撤去→オクターヴ・ファズ(207)を歪み段の後・Glitch 前に
- [x] **セクション順(item8)**（`7ad5a76`）: UI を信号フロー順 Band→Drive→Glitch→Master に
- [x] **UI 整理**（2026-06-21）: Band Mute(216) 撤去（Solo のみ）/ Band Lo/Hi を**2ポイント1本スライダ**（`BandRange.vue`）/ Comp(222)・Drive On(206) を**常時ON固定**でトグル撤去（[DECISIONS.md](./DECISIONS.md) 2026-06-21）
- [x] **レビュー反映**（`472bee3`）: Freeze HP リセット / Octave クランプ / Freeze 枯渇 hop / ブロック連続判定 / SSoT 定数化(`STEPS_PER_BAR`等) / `gridRole` 判別子
- [~] **試聴（DSP先行）**: Freeze 滑らかさ・Octave 量感・Random モード・小節数・Drive 音量を確認し定数を耳調整（**要試聴**）
- [ ] Octave の中身（ブレンド/補正/カットオフ）を debug param で詰める。StepGrid UI 整形（音確定後）

### 次の DSP 強化（予定）

- [x] ピッチ強化 → **Octave（固定ピッチ歪み＝オクターヴ・ファズ）で実装**（item6・`5fcfb3d`）。他候補（ハーモナイザ/ダイブ/サブオクターブ）は将来検討
- [x] ~~Freeze Ice Reverb 化（グラニュラー＋FDN）~~ → **破棄**（ブチブチ/連打で意図と違う）。Freeze を**フェード付きリピートに作り直し**（2026-06-22）
- [x] **Freeze = フェードリピート**（2026-06-22）: 短チャンク(126ms)のオーバーラップ crossfade ループ（2読み位置×Hann・和=1＝アタック連打を平坦化）＋原音追従ゲイン(Level 0.55)＋ピンクノイズ(0.28)＋後段 EQ(HP370/ピーク1.2k+14 Q2.2/シェルフ3k-7.2 Q1)。耳で確定し定数化（debug 291-293 撤去）（[DECISIONS.md](./DECISIONS.md) 2026-06-22・[DSP.md](./DSP.md) §3 Freeze）
- [~] 要試聴: フェードリピートの質感・ピンクノイズ量（PINK_SCALE）・EQ を確認。ピンク音量は要再試聴
- [x] **Dive×Mute 共存＋連続フォール**（2026-06-22）: Dive を DIVE_BIT 連続範囲で1回のフォールに（Mute と共存・ミュート区間は無音だがフォール継続）（[DECISIONS.md](./DECISIONS.md) 2026-06-22）
- [x] **Random を UI 生成に刷新**（2026-06-22）: DSP ランダムモード(290)撤去 → StepGrid の Random ボタン(シード・押すたび別配置)＋Clear ボタンで実セル生成
- [x] **Random 重み付け**（2026-06-22）: ベース=ラン単位（**Mute は必ず単発16分＝両隣を空ける**+やや高頻度/他1-3）、Dive=8分(2セル)最頻＋残りランダム長(3-6)で Dive 被覆を抑制(0.04)、**空セルに単発16分 Glitch を追加(隣接Glitch不可)**。定数: `RND_BASE_DENSITY 0.3`/`RND_DIVE_DENSITY 0.04`/`RND_GLITCH_EXTRA 0.2`、Mute 重み 6/14
- [x] **シード操作**（2026-06-22）: ◀(前)/▶(次)/Random(+1)/`#seed` 表示/Clear。**VST はキー入力が Suara runtime に取られ DOM 入力欄に届かない（ネイティブ層の制約・JS不可）→ ボタンのみ**（テキスト入力・画面内テンキーは試作後に撤去）
- [x] **DSP 一旦完成**（2026-06-22）。後日コードレビュー → その後 UI（Three.js 想定）へ

## Phase 3 — オーバーサンプリング

- [ ] OS 方式（FIR/IIR・倍率）を確定し DECISIONS に追記（[DSP.md](./DSP.md) §3）
- [ ] 段2/段4（アップ/AAダウン）を worklet に実装
- [ ] OS セレクタ UI（off/2x/4x）+ processorOptions + グラフ再構築（[ARCHITECTURE.md](./ARCHITECTURE.md) §4）
- [ ] エイリアシング低減を確認（高Drive・高域入力で比較） / レイテンシ申告検討

## Phase 4 — キャラクター拡張・仕上げ（任意）

- [ ] クリップモード（square/sign・非対称）追加可否を DECISIONS で判断
- [ ] ザイパー/DC 等の既知リスク対処（[DSP.md](./DSP.md) §4）
- [x] worklet を distortion にリネーム（ファイル/プロセッサ名/クラス、[DECISIONS.md](./DECISIONS.md) 2026-06-20）
- [ ] 製品表示名確定 → SPEC + suara.json 更新
- [ ] VST runtime での実機確認（controller の addParameter tag 突き合わせ）

## バックログ / 保留

- Dry/Wet ミックス（今回スコープ外。必要時に DECISIONS 起こして復活）
- 自作ノブ部品（MVP は range スライダで可）
- プリセット機能

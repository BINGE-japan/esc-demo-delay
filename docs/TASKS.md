# TASKS — 実装ロードマップと進捗

> フェーズ単位の進行管理。着手前に該当フェーズの仕様（[SPEC.md](./SPEC.md) / [DSP.md](./DSP.md) / [ARCHITECTURE.md](./ARCHITECTURE.md)）を読む。
> 完了したらチェックを付け、仕様変更が出たら [DECISIONS.md](./DECISIONS.md) に追記してから進む。
>
> 最終更新: 2026-06-20

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
- [x] 音量恒常: Drive makeup ＋ **Tone makeup（新規）** ＋ 遅い自動トリム（Loudness Match, Auto Gain トグル）
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

## Phase 2.9 — Howl（ハウリング倍音）（実装済・要試聴）

> ユーザー要望（[DECISIONS.md](./DECISIONS.md) 2026-06-20）。DSP強化の第1弾。

- [x] `dsp/howl.ts`：**入力依存ウェーブフォルダー**（`sin(g·x)` 折り返し・1ノブ・無状態）
  - 是正経緯: 初版=自己発振ドローン → 共鳴サチュ → どちらも「固定 Freq でキャラ固定」とユーザー指摘 → 共鳴系を廃し非線形シェイピング（wavefolder）へ（[DECISIONS.md](./DECISIONS.md) 2026-06-20）
- [x] パラメータ Howl(218)/Howl On(220)、Howl Freq(219) は廃止（1ノブ化）
- [x] **音量一定化**: Howl を Loudness Match の**前段**へ（Drive+Howl をまとめて dry に揃える＝バイパスで音量不変）
- [x] **金属音へ（暫定）**: wavefolder（＝歪み/fizz でNG）→ **リングモジュレーター**（`x·(1−amt+amt·sin(2π·fc·t))`, `fc=lerp(150,1800,amt)`, 1ノブ）
- [x] **配置を歪みの前へ**: `Howl→Drive` 順に（金属音を作ってから歪ませる＝ファズが食いつく。後ろだと密でゴチャつく）
- [x] **キンキン化＋加算ブレンド**: `x·(1+dyn·c)`（dry 常時保持＝金属ブレンド量、べったり回避）。fc は最終 700–3500Hz
- [x] **歪み成分のみ RM（ユーザー案）**: 基音クリーン・歪みのザリだけ金属化。Drive0→金属0
- [x] **原音で自己mod＋加算（fc廃止）**: `out = driveOut + amt·GAIN·HPF((driveOut−dry)·sign(dry))`。外部キャリアをやめ原音ピッチでmod＝「元の音を誇張」した調和金属。置換→加算。HPF でキンキン＋DC除去
  - 痩せ修正: キャリア `dry`→`sign(dry)`（単位方形波）ではっきり鳴るように（[DECISIONS.md](./DECISIONS.md) 2026-06-21）
- [x] `vp check` / `vp build` 通過
- [ ] **本命の Howl キャラを確定**（自己mod は暫定。試聴で詰める）
- [~] 試聴で「上げたら金属が出る／元の音を誇張／べったりでない」を確認、GAIN/HP を調整（**要試聴**）

### 次の DSP 強化（予定）

- [ ] グリッチ強化（BPM同期 / Reverse / Ratchet / Tape-stop / Bitcrush 等）
- [ ] ピッチ強化（固定シフト / ハーモナイザ / ピッチダイブ / サブオクターブ 等）

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

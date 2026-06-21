# SPEC — 製品仕様（What の SSoT）

> このファイルは「何を作るか」の単一の真実 (SSoT)。実装はここに書かれた仕様に従う。
> 仕様を変えるときは **先にここを直し**、理由を [DECISIONS.md](./DECISIONS.md) に追記してから実装する。
>
> ステータス: **v0.3（レビュー用）** / 最終更新: 2026-06-21

## 1. これは何か

Suara SDK 上に作る **ファズ／ハードクリップ系ディストーション** オーディオエフェクト（VST3 + Web）。
入力をゲインで強く押し込み、ハードクリップで波形を潰して倍音を生む「攻撃的・荒い」キャラクターを軸にする。

- マニフェスト名: `SuaraDevEffect`（[suara.json](../suara.json)）/ category: `Fx|Distortion`
- 種別: `effect`（入力あり）
- 製品名（表示名）: **未確定（TBD）** — 仮 "Binge Fuzz"。確定したら本節と suara.json を更新。

## 2. キャラクター（core identity）

- **ファズ／ハードクリップ**。基本シェイパーは硬いクリップ（`clamp(x, -1, +1)`）。
- Drive を上げても Tone を変えても **聴覚上の音量は一定**（**Drive/Tone と入力レベルから計算補正**でラウドネスを揃える＝出力を測らない＝ラグ/ムラ/ポンプなし → [DSP.md](./DSP.md) §2）。
- 音作りの軸を Drive だけでなく **Tone（暗⇄明の Tilt EQ）/ Comp（歪みのコンプ感 ON/OFF＝ダイナミクス圧縮⇄保持）/ Glitch（BPM同期ステップシーケンサ＝拍ロック・再現性）/ Pitch（Vinyl Warp 風の再現性ピッチ寄れ）** に広げ、パラメータ × UI の絡みで遊べる器にする。
- 構成は **Band(Focus) / Drive / Glitch / Master** の 4 セクションに分離（DSP も UI も**信号フロー順**。各セクション ON/OFF ＋ 帯域指定 ＋ 全体 Bypass）。Pitch は Glitch セクションのノブ。
- ハードクリップは無限次倍音を生むため **折返しノイズ（エイリアシング）対策＝オーバーサンプリング** が品質の肝（→ Phase 3）。

## 3. スコープ方針

**MVP優先**。まず最小構成で end-to-end に音を出し、動く土台を作ってから機能を積む。
各機能の MVP/後フェーズ振り分けは [TASKS.md](./TASKS.md) のフェーズ定義に従う。

- MVP に入れる: Drive（入力ゲイン）、Output（出力ゲイン）、ハードクリップ、プラグインUI（ノブ）の最小形
- 実装済（前倒し）: Tone（Tilt EQ）、Drive 音量一定（makeup）、Glitch、Pitch（Vinyl Warp 風）（[DECISIONS.md](./DECISIONS.md) 2026-06-20〜21）
- 後フェーズ: オーバーサンプリング（Phase 3）→ キャラクター拡張・本UI
- **今回スコープ外**: Dry/Wet ミックス（今回の選定で除外。将来必要なら DECISIONS に起こして追加）

## 4. パラメータ仕様

denormalize 済みの実値で UI／DSP は扱い、VST 境界のみ normalized 0..1（変換は [param.ts](../src/sdk/param.ts) に集約）。
**定義の SSoT は [src/audio/worklets/params.ts](../src/audio/worklets/params.ts)**（worklet と App が共有。数値を変えるのはそこ1箇所 → [ARCHITECTURE.md](./ARCHITECTURE.md) §4-5）。本表はその写し。

| id      | 名前          | 範囲         | 既定 | 種別       | 単位 | セクション | 備考                                                                                    |
| ------- | ------------- | ------------ | ---- | ---------- | ---- | ---------- | --------------------------------------------------------------------------------------- |
| 200     | Drive         | 0 〜 +48     | +12  | 連続       | dB   | 歪み       | fuzz の主役。音量は一定                                                                 |
| 201     | Tone          | -100 〜 +100 | 0    | 連続(双極) | %    | 歪み       | **Tilt EQ**。<0 暗 / 0 平 / >0 明                                                       |
| 206     | Drive On      | 0 / 1        | ON   | トグル     | —    | 歪み       | 歪みセクションの ON/OFF                                                                 |
| 222     | Comp          | 0 / 1        | ON   | トグル     | —    | 歪み       | ON=自然圧縮（普通の歪み）/ OFF=ダイナミクス保持                                         |
| 204     | Pitch         | 0 〜 100     | 0    | 連続       | %    | グリッチ   | Vinyl Warp 風の再現性ピッチ寄れ（depth）。Glitch の後・帯域内                           |
| 290     | Random        | 0 / 1        | OFF  | トグル     | —    | グリッチ   | Random モード（グリッド無視・全ステップ決定論ランダム・再現性あり）                     |
| 288     | Bars          | 1 / 2 / 4    | 2    | 選択(enum) | —    | グリッチ   | ループ長(小節数)。タブ切替で grid が bars×8 カラムに伸びる（`grid`・内部16分）          |
| 217     | Glitch On     | 0 / 1        | ON   | トグル     | —    | グリッチ   | グリッチセクションの ON/OFF                                                             |
| 223–286 | Step 1–64     | 0 〜 13      | 0    | 連続(enum) | —    | グリッチ   | raw=ベース(0..5)\|Dive(8)。0Dry/1Glt/2Frz/3Rev/4Mute/5Rpt＋Dive重ね（`grid`・内部16分） |
| 213     | Band Lo       | 20 〜 20k    | 20   | 連続(log)  | Hz   | 帯域       | エフェクトをかける下限周波数                                                            |
| 214     | Band Hi       | 20 〜 20k    | 20k  | 連続(log)  | Hz   | 帯域       | エフェクトをかける上限周波数                                                            |
| 215     | Solo          | 0 / 1        | OFF  | トグル     | —    | 帯域       | 選択帯域だけ試聴                                                                        |
| 216     | Mute          | 0 / 1        | OFF  | トグル     | —    | 帯域       | 選択帯域を抜いた残りを試聴                                                              |
| 202     | Output        | -24 〜 +6    | 0    | 連続       | dB   | マスター   | 最終出力ゲイン                                                                          |
| 208     | Bypass        | 0 / 1        | OFF  | トグル     | —    | マスター   | 全体バイパス（dry へクロスフェード）                                                    |
| —       | OS            | off/2x/4x    | 2x   | 構造的     | —    | （内部）   | Phase 3、AudioParam 外                                                                  |
| 209     | (bpm)         | 20 〜 999    | 120  | 内部       | —    | （内部）   | UI/useParam なし。transport.tempo を供給（Glitch 拍ロック用）                           |
| 287     | (glitchPhase) | 0 〜 1       | 0    | 内部       | —    | （内部）   | UI/useParam なし。App がパターン内位相を供給（拍ロック用）                              |

- **Drive**: 入力をクリッパに押し込む量。音量は**入力レベル連動の計算補正**（実効クリップ量 a·Drive で RMS＋知覚明るさを補正）で一定＝出力非測定・即時。クリップ前はゲインを相殺するので「ただの音量上げ」にならない（[DSP.md](./DSP.md) §2）。
- **Comp**: 歪みの**コンプ感**の ON/OFF。ON=入力 envelope を遅く（操作点だけ追う）→ トランジェントがクリップで頭打ち＝**ダイナミクスレンジが自然に圧縮**（普通の歪み）。OFF=envelope 速い→**ダイナミクス保持**のまま歪む（クリーンな粒立ち）。ON は圧縮で下がる分をレベル補償トリム（クリップ量ゲート）で OFF/dry に近づける。どちらも音量恒常（vs Drive）は維持（[DSP.md](./DSP.md) §2）。
- **Tone**: 暗⇄明の **Tilt EQ**（pivot 約 800Hz、±18dB）。中央フラット。Tone でも音量は一定（Tone makeup）。
- **Glitch（ステップシーケンサ・クリップ式ブロックモデル）**: **横=8分カラム/縦=タイプ**のタイムライン（**内部16分**＝1スロット8px・8分カラム16px）。**空をクリック=16分セル作成（最短）、セルを左右どちらにドラッグでも16分スナップで伸縮（掴んだ反対端を固定）、セルをクリック(無移動)で消去**。空＝Dry(素通り)。**同一タイプの連続＝1ブロック（幅=継続長・小節跨ぎ可）**。タイプ: **ベース(排他)= Glitch(極短ラチェット) / Freeze / Reverse(幅=逆レンジ) / Mute / Repeat(16分)**、＋**Dive(重ねがけモディファイア)=セル長で原音→1オクターブ下へ降下（レコードストップ）**。**Dive だけベースに重ねられる**（Mute には不可）。raw= ベース(0..5) | Dive(8)。**`Bars(288)`=ループ長(1/2/4 小節)をタブで選択**＝グリッドが bars×8 カラム(内部16分)に伸び、その長さでループ。BPM同期・**拍ロック**でパターンがループ＝**再現性**（専用 wet ノブは無し＝空セルで透過）。`Random(290)`=**Random モード**（グリッド無視・全ステップ決定論ランダム・dry も混ざる・再現性あり）。Tape-stop は後日（[DSP.md](./DSP.md) §3 Glitch）。
- **Pitch**: **Vinyl の Warp 風＝再現性のあるピッチ寄れ/ワウ**。可変ディレイを **glitchPhase にロックした決定論カーブ**（複数正弦の wow+flutter）で揺らしてピッチを寄れさせる＝**毎ループ同じ揺れ方**。ノブ=揺れ量(depth)。Glitch の後・帯域内に挿入。揺れの速さ/質感は耳調整（詳細は今後 debug param）（[DSP.md](./DSP.md) §「Pitch」）。
- **Band（Focus）**: エフェクトをかける周波数帯を選ぶ。`band = bandpass(in, Lo, Hi)`、`rest = in − band`（完全再構成）。**帯域内=100%Wet / 帯域外=100%Dry**。**Solo**=帯域だけ試聴 / **Mute**=帯域を抜いた残りだけ試聴。全エフェクト一括（[DSP.md](./DSP.md) §2b）。
- **Drive On / Glitch On / Bypass**: クリック回避のクロスフェードで切替（[DSP.md](./DSP.md) §1）。Pitch は depth ノブ（0=ほぼ透過）でトグル無し。
- **(bpm)**: 内部 AudioParam。UI/useParam は無く、App が `transport.tempo` を流し込む（Glitch の BPM 拍ロックに使用）。
- **(glitchPhase)**: 内部 AudioParam。App が `positionSamples`(VST)/`ctx.currentTime`(Web) からパターン内位相(0..1・パターン長=bars×16)を算出し供給（Glitch ステップの拍ロック）。
- **OS**: 音質設定。構造を変えるため **AudioParam でなく構築時設定**＋グラフ再構築。VST 自動化対象外。

> ⚠️ **パラメータID は controller の `addParameter` tag と SSoT**。既存規約: synth `0..5`、saturator `100..102`。本プラグインは **200番台**（連続 200-202＋204(Pitch)＋213/214、トグル 206・208＋215-217＋222(Comp)＋290(Random)、Bars=288(`grid`)、**ステップ 223–286(`grid`・raw 0..13＝ベース\|Dive・最大64)**、内部 bpm=209・glitchPhase=287。**廃止/欠番: 203・210・211=旧 Wobble / 205=旧 Auto Gain / 207=旧 Pitch On→Octave（共に撤去）/ 212=旧 Spectral Fill / 218・219・220=旧 Howl 系 / 221=実験の名残 / 239=旧 glitchPhase(287へ移設)**＝再利用しない。204 は旧 Glitch wet→Pitch に転用）。`grid` フラグ＝useParam は作るが自動スライダに出さず StepGrid が描画。値は v0.3 提案 — レビューで確定。

## 5. 信号フロー（最終形の目標）

```
in ─┬─ bandpass(Lo..Hi) → band → [Drive→Clip→makeup(RMS+知覚)→Tone]→[Glitch]→[Pitch] → bandPost ─┐
    └────────────────────────────── rest = in − band ───────────────────────────────────────────┤
                       Normal: bandPost+rest / Solo: bandPost / Mute: rest
                                                                  → Output → Bypass(in へ) → out
```

帯域スプリットで「選択帯域だけにエフェクト」（[DSP.md](./DSP.md) §2b）。セクション ON/OFF・Solo/Mute・Bypass はクロスフェード。OS は将来 Clip の前後に挿入。実処理順・数式は [DSP.md](./DSP.md) §1-3。

## 6. UI

- **プラグインUI（[App.vue](../src/App.vue) 本体）**: [params.ts](../src/audio/worklets/params.ts) 駆動で **4 セクション（信号フロー順 = Band(Focus) / Drive / Glitch / Master）**に分けて表示。連続パラメータはスライダ（周波数は log）、トグル（各 ON / Comp / Solo / Mute / Bypass）はスイッチ。Glitch セクションには **ステップシーケンサ（[StepGrid.vue](../src/components/StepGrid.vue)・クリップ式・小節数タブ＋bars×8 カラム(内部16分)×6行・クリックで16分作成/左右ドラッグで16分リサイズ/クリック(無移動)で消去・固定幅で幅が要れば横に伸びる）** ＋ Pitch ノブを表示（`grid` param をスライダでなくグリッドで描画、再生中ステップをハイライト）。**両 runtime に存在**。現状は仮UI。本UI（パラメータ×UI の作り込み）はこれから。
- **DAW simulator（[SuaraHostPanel.vue](../src/sdk/helper/SuaraHostPanel.vue)）**: Web runtime のみ。再生・入力ソース・レベル・MIDI を供給する DAW 代役。**プラグインのノブはここに足さない**（混同回避）。
- MVP の見た目は最小（range スライダ可）。専用ノブ部品は後フェーズで検討。

## 7. 受け入れ基準（MVP）

- [ ] Web（`vp dev`）で test tone / 音声ファイルを再生し、Drive を上げると歪んで聞こえる
- [ ] Output で歪み音の音量を補正できる
- [ ] Drive=0dB かつ Output=0dB のとき、クリップに達しない小信号はほぼ素通り（透明）
- [ ] ノブ操作が worklet の DSP に反映される（[ARCHITECTURE.md](./ARCHITECTURE.md) のパラメータ橋渡し経由）
- [ ] `vp check`（fmt + lint + typecheck）が通る

## 8. 未確定事項（要レビュー）

- 製品表示名（TBD）
- パラメータの範囲・既定値（v0.3 は提案値。特に Tone ±18dB / Tone makeup 高域重み / Pitch(Warp) 揺れ量・速さ / Glitch グリッド・Freeze / Loudness 時定数は**耳で調整**前提）
- キャラクター拡張の方向（hard clip 一本 → 将来 square/sign・非対称クリップ等のモード追加可否）
- 本UI のデザイン（パラメータ × UI の絡め方が本命。range スライダ → 自作ノブ/連動/ビジュアル反応など）
- Glitch シーケンサ v1 の前提・要調整（**4/4 固定** / 最大64自動化レーンの是非 / `HISTORY_MS`=2000 の低BPM余裕 / 停止中ホールド / 専用 wet ノブ無し＝空セルで透過）。後日: 完全ランダムトグル・Tape-stop・per-step probability・4/4 以外対応

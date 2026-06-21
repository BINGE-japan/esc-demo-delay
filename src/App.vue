<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createDawInput, runtime, useParam, useTransport } from '@suara/sdk'
import type { ParamHandle } from '@suara/sdk'
import SuaraHostPanel from '@suara/sdk/helper/SuaraHostPanel.vue'
import StepGrid from './components/StepGrid.vue'
import { PARAMS } from './audio/worklets/params'
import type { ParamDef, ParamSection } from './audio/worklets/params'

// The DSP worklet, written in TypeScript and bundled by Vite. `?worker&url` hands
// back a URL for addModule(); `worker.format: 'es'` (vite.config) keeps it
// wrapper-free so it loads straight into the AudioWorkletGlobalScope.
import workletUrl from './audio/worklets/distortion.ts?worker&url'

const transport = useTransport()
const playing = ref(false)

// パラメータは params.ts(SSoT)から生成。id/範囲/既定はそこ1箇所。
// 各 param に useParam ハンドルを束ねて持つ(docs/ARCHITECTURE.md §4-5)。
interface ParamUI {
  def: ParamDef
  handle: ParamHandle
}
// hidden(bpm 等の内部 param)は UI/useParam を作らない。
const uiParams: ParamUI[] = PARAMS.filter((p) => !p.hidden).map((p) => ({
  def: p,
  handle: useParam(p.id, { min: p.min, max: p.max, default: p.default, log: p.log }),
}))

// UI セクション分け。
// 信号フロー順に表示: 帯域抽出 → 歪み(+Octave) → Glitch → Master。
const SECTIONS: { key: ParamSection; title: string }[] = [
  { key: 'band', title: 'Band (Focus)' },
  { key: 'drive', title: 'Drive' },
  { key: 'glitch', title: 'Glitch' },
  { key: 'master', title: 'Master' },
]
// grid param（ステップ）は自動スライダから除外＝専用 StepGrid が描画。
const grouped = SECTIONS.map((s) => ({
  ...s,
  items: uiParams.filter((u) => u.def.section === s.key && !u.def.grid),
}))

// ステップシーケンサ: ステップ(step0..63)・小節数(glitchBars)ハンドルと再生中ステップ。
const stepHandles = uiParams
  .filter((u) => u.def.grid && u.def.name.startsWith('step'))
  .map((u) => u.handle)
const barsHandle = uiParams.find((u) => u.def.name === 'glitchBars')!.handle
const currentStep = ref(0)

let ctx: AudioContext | null = null
let node: AudioWorkletNode | null = null
let source: MediaStreamAudioSourceNode | null = null
let moduleUrl = workletUrl

// パラメータ橋渡し(docs/ARCHITECTURE.md §4): useParam.value を worklet の AudioParam へ。
function applyParam(name: string, value: number): void {
  const p = node?.parameters.get(name)
  if (p) p.value = value
}

async function buildGraph() {
  ctx = new AudioContext()
  await ctx.audioWorklet.addModule(moduleUrl)
  node = new AudioWorkletNode(ctx, 'distortion', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  })
  // 構築直後に現在値を反映(以降は watch が追従)。
  for (const u of uiParams) applyParam(u.def.name, u.handle.value)
  applyParam('bpm', transport.state.tempo) // hidden: transport が供給(Glitch の BPM 拍ロック)
  // DAW input (VST) or the web DAW-simulator's source → worklet → output.
  const stream = await createDawInput()
  source = ctx.createMediaStreamSource(stream)
  source.connect(node).connect(ctx.destination)
}

// value が変わるたび(ノブ操作 / VST automation)に AudioParam を更新。
for (const u of uiParams) {
  watch(
    () => u.handle.value,
    (v) => applyParam(u.def.name, v),
  )
}

// BPM は transport(VST=DAW / web=simulator のテンポ)から worklet へ。Glitch の BPM 拍ロックに。
watch(
  () => transport.state.tempo,
  (v) => applyParam('bpm', v),
)

// --- 仮UI ヘルパ ---
function fmt(def: ParamDef, v: number): string {
  if (def.toggle) return v >= 0.5 ? 'ON' : 'OFF'
  if (def.unit === 'Hz')
    return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`
  const sign = def.min < 0 && v > 0 ? '+' : ''
  if (def.unit === 'dB') return `${sign}${v.toFixed(1)} dB`
  if (def.unit === '%') return `${sign}${Math.round(v)}%`
  return `${Math.round(v)}`
}
function stepFor(def: ParamDef): number {
  return def.unit === 'dB' ? 0.5 : 1
}
// log パラメータ(周波数)のスライダは 0..1 正規化で扱い、表示/設定は実値(Hz)で。
function toNorm01(def: ParamDef, v: number): number {
  return Math.log(v / def.min) / Math.log(def.max / def.min)
}
function fromNorm01(def: ParamDef, t: number): number {
  return def.min * Math.pow(def.max / def.min, t)
}
function sliderModel(u: ParamUI): number {
  return u.def.log ? toNorm01(u.def, u.handle.value) : u.handle.value
}
function onSlide(u: ParamUI, e: Event): void {
  const raw = Number((e.target as HTMLInputElement).value)
  u.handle.setFromUser(u.def.log ? fromNorm01(u.def, raw) : raw)
}
function toggle(u: ParamUI): void {
  u.handle.begin()
  u.handle.setFromUser(u.handle.value >= 0.5 ? 0 : 1)
  u.handle.end()
}

// --- ステップ拍ロック: 小節内位相 glitchPhase(0..1) を transport から worklet へ ---
// VST=positionSamples(DAW 再生位置) / Web=ctx.currentTime 相対。再生中だけ rAF 更新（停止中はホールド）。
// 4/4 前提（v1）。worklet 側はこの位相にサンプル精度で同期し、大ドリフトだけスナップ。
let phaseRaf = 0
let webStart = 0
function pumpPhase(): void {
  phaseRaf = 0
  if (!ctx || !playing.value) return
  const tempo = transport.state.tempo || 120
  const bars = Math.min(4, Math.max(1, Math.round(barsHandle.value)))
  const steps = bars * 16
  const secPerPattern = (60 / tempo) * 4 * bars
  const posSec =
    runtime.isVst && transport.state.positionSamples > 0
      ? transport.state.positionSamples / ctx.sampleRate
      : ctx.currentTime - webStart
  let phase = (posSec % secPerPattern) / secPerPattern
  if (phase < 0) phase += 1
  applyParam('glitchPhase', phase)
  currentStep.value = Math.min(steps - 1, Math.floor(phase * steps))
  phaseRaf = requestAnimationFrame(pumpPhase)
}
function startPhasePump(): void {
  if (phaseRaf || !ctx) return
  webStart = ctx.currentTime
  phaseRaf = requestAnimationFrame(pumpPhase)
}
function stopPhasePump(): void {
  if (phaseRaf) cancelAnimationFrame(phaseRaf)
  phaseRaf = 0
}

async function play() {
  if (!ctx) await buildGraph()
  await ctx?.resume()
  playing.value = true
  startPhasePump()
}

async function stop() {
  if (ctx && ctx.state === 'running') await ctx.suspend()
  playing.value = false
  stopPhasePump()
}

async function teardown() {
  stopPhasePump()
  source?.disconnect()
  node?.disconnect()
  if (ctx && ctx.state !== 'closed') await ctx.close()
  ctx = null
  node = null
  source = null
  playing.value = false
}

// VST runtime: audio flows from the DAW continuously, so start on mount.
// Web runtime: the DAW-simulator's transport (Play / Stop) drives playback.
onMounted(() => {
  if (runtime.isVst) void play()
})
watch(
  () => transport.state.isPlaying,
  (isPlaying) => {
    if (runtime.isWeb) void (isPlaying ? play() : stop())
  },
)

// HMR: rebuild the graph on a fresh AudioContext when the worklet's DSP changes
// (a context can't re-register a processor name, so a new one is the clean way).
if (import.meta.hot) {
  import.meta.hot.accept('./audio/worklets/distortion.ts?worker&url', async (mod) => {
    const next = (mod as { default: string } | undefined)?.default
    if (!next) return
    moduleUrl = next
    const wasPlaying = playing.value
    await teardown()
    if (wasPlaying) await play()
  })
}

onBeforeUnmount(teardown)
</script>

<template>
  <main
    class="flex min-h-full flex-col items-center justify-center gap-3 bg-neutral-950 text-neutral-100"
  >
    <h1 class="text-xl font-semibold tracking-tight">SuaraDevEffect</h1>
    <p class="text-sm text-neutral-400">runtime: {{ runtime.kind }} · in → distortion → out</p>
    <p class="text-sm" :class="playing ? 'text-emerald-400' : 'text-neutral-500'">
      {{ playing ? '● playing' : '○ stopped' }}
    </p>

    <!-- 仮UI(docs/DECISIONS.md): params.ts 駆動・セクション分け。本UI(パラメータ×UI)はこれから。 -->
    <div class="mt-2 flex w-72 flex-col gap-3">
      <section
        v-for="g in grouped"
        :key="g.key"
        class="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
      >
        <p class="text-[10px] uppercase tracking-widest text-neutral-500">{{ g.title }}</p>

        <template v-for="u in g.items" :key="u.def.id">
          <!-- 連続パラメータ: range スライダ -->
          <label v-if="!u.def.toggle" class="flex flex-col gap-1 text-xs text-neutral-400">
            <span class="flex justify-between">
              <span>{{ u.def.label }}</span>
              <span class="tabular-nums text-neutral-200">{{ fmt(u.def, u.handle.value) }}</span>
            </span>
            <input
              type="range"
              :min="u.def.log ? 0 : u.def.min"
              :max="u.def.log ? 1 : u.def.max"
              :step="u.def.log ? 0.001 : stepFor(u.def)"
              :value="sliderModel(u)"
              class="accent-emerald-400"
              @pointerdown="u.handle.begin()"
              @input="onSlide(u, $event)"
              @pointerup="u.handle.end()"
            />
          </label>

          <!-- トグル: スイッチボタン -->
          <button
            v-else
            type="button"
            class="flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors"
            :class="
              u.handle.value >= 0.5
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-neutral-800 text-neutral-500'
            "
            @click="toggle(u)"
          >
            <span>{{ u.def.label }}</span>
            <span class="tabular-nums">{{ fmt(u.def, u.handle.value) }}</span>
          </button>
        </template>

        <!-- グリッチ・ステップシーケンサ（横=16分ステップ / 縦=タイプ）。仮UI、後で整形。 -->
        <StepGrid
          v-if="g.key === 'glitch'"
          :steps="stepHandles"
          :bars="barsHandle"
          :current="currentStep"
        />
      </section>
    </div>

    <p v-if="runtime.isWeb" class="text-xs text-neutral-600">controls in the DAW simulator ↘</p>

    <!-- web runtime only: stands in for the DAW (transport / audio input / MIDI). -->
    <SuaraHostPanel v-if="runtime.isWeb" />
  </main>
</template>

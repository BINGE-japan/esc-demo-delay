<script setup lang="ts">
// 帯域(Band)の Lo/Hi を1本のスライダ上の2ポイント(thumb)で指定する仮UI（log=周波数）。
// トラックをクリック/ドラッグ＝近い側の thumb を掴んで移動。lo<=hi をクランプ。
// 本UI は DSP 後に Three.js で刷新（throwaway）。
import { computed } from 'vue'
import type { ParamHandle } from '@suara/sdk'

const props = defineProps<{ lo: ParamHandle; hi: ParamHandle; min: number; max: number }>()

// log 正規化（実値Hz ⇄ 0..1）。
const toNorm = (v: number): number => Math.log(v / props.min) / Math.log(props.max / props.min)
const fromNorm = (t: number): number =>
  props.min * Math.pow(props.max / props.min, t < 0 ? 0 : t > 1 ? 1 : t)

const loN = computed(() => toNorm(props.lo.value))
const hiN = computed(() => toNorm(props.hi.value))

function fmt(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`
}

// ドラッグ中の thumb。lo=true なら下限側、false なら上限側。
let drag: { handle: ParamHandle; lo: boolean } | null = null

function tFromX(e: PointerEvent, el: HTMLElement): number {
  const r = el.getBoundingClientRect()
  const t = (e.clientX - r.left) / r.width
  return t < 0 ? 0 : t > 1 ? 1 : t
}
function applyAt(t: number): void {
  if (!drag) return
  let v = fromNorm(t)
  if (drag.lo)
    v = Math.min(v, props.hi.value) // lo は hi を越えない
  else v = Math.max(v, props.lo.value) // hi は lo を下回らない
  drag.handle.setFromUser(v)
}
function onDown(e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const t = tFromX(e, el)
  const lo = Math.abs(t - loN.value) <= Math.abs(t - hiN.value) // 近い側の thumb
  const handle = lo ? props.lo : props.hi
  handle.begin()
  drag = { handle, lo }
  applyAt(t)
}
function onMove(e: PointerEvent): void {
  if (drag) applyAt(tFromX(e, e.currentTarget as HTMLElement))
}
function onUp(): void {
  if (drag) {
    drag.handle.end()
    drag = null
  }
}
</script>

<template>
  <div class="flex w-full max-w-[18rem] flex-col gap-1 text-xs text-neutral-400">
    <span class="flex justify-between">
      <span>Band</span>
      <span class="tabular-nums text-neutral-200">{{ fmt(lo.value) }} – {{ fmt(hi.value) }}</span>
    </span>
    <div
      class="relative h-4 cursor-pointer touch-none select-none"
      @pointerdown.prevent="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <!-- トラック -->
      <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-neutral-700"></div>
      <!-- 選択帯域 -->
      <div
        class="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded bg-emerald-500/70"
        :style="{ left: `${loN * 100}%`, right: `${(1 - hiN) * 100}%` }"
      ></div>
      <!-- thumbs -->
      <div
        class="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300"
        :style="{ left: `${loN * 100}%` }"
      ></div>
      <div
        class="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300"
        :style="{ left: `${hiN * 100}%` }"
      ></div>
    </div>
  </div>
</template>

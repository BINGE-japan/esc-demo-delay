<script setup lang="ts">
// Glitch ステップシーケンサの仮UI（クリップ式・横=8分カラム / 縦=タイプ）。本UIは DSP 後に Three.js で刷新。
// セル値(raw)= ベース型(下位3bit) | Dive(bit3=8)。ベースは排他、Dive だけ重ねがけ（Mute には不可）。
// 内部16分（1スロット=SLOT_W px、8分=2スロット）。空カラムをクリック=8分セル作成、
// セル右端をドラッグで16分スナップ伸縮（最短16分=カラム半分）、セル本体クリックで消去。
// 行: Dive(モディファイア・sky) / Rpt/Rev/Frz/Glt(ベース・排他・emerald) / Mute(最下段・rose・排他)。
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { ParamHandle } from '@suara/sdk'
import { STEPS_PER_BAR, MAX_BARS, clampBars } from '../audio/worklets/params'

const props = defineProps<{ steps: ParamHandle[]; bars: ParamHandle; current: number }>()

const BASE_MASK = 7
const DIVE_BIT = 8
const MUTE = 4
const SLOT_W = 8 // 16分1スロットの幅(px)。8分カラム=16px
const EDGE = 6 // 右端リサイズの掴みゾーン(px)

type RowKind = 'dive' | 'source' | 'mute'
interface Row {
  label: string
  val: number
  kind: RowKind
}
const ROWS: Row[] = [
  { label: 'Dive', val: 0, kind: 'dive' },
  { label: 'Rpt', val: 5, kind: 'source' },
  { label: 'Rev', val: 3, kind: 'source' },
  { label: 'Frz', val: 2, kind: 'source' },
  { label: 'Glt', val: 1, kind: 'source' },
  { label: 'Mute', val: MUTE, kind: 'mute' },
]
const BAR_TABS = [1, 2, MAX_BARS]

const barCount = computed(() => clampBars(props.bars.value))
const slots = computed(() => barCount.value * STEPS_PER_BAR) // 16分スロット数
const trackW = computed(() => slots.value * SLOT_W)
// 8分=薄線, 小節=濃線のグリッド背景。
const gridStyle = computed(() => ({
  width: `${trackW.value}px`,
  backgroundImage: [
    `repeating-linear-gradient(to right, rgba(255,255,255,.06) 0 1px, transparent 1px ${SLOT_W * 2}px)`,
    `repeating-linear-gradient(to right, rgba(255,255,255,.16) 0 1px, transparent 1px ${SLOT_W * STEPS_PER_BAR}px)`,
  ].join(','),
}))

// ドラッグ状態（右端リサイズ / 作成直後の伸縮）。
let drag: { row: Row; anchor: number; end: number } | null = null

function rawAt(s: number): number {
  const h = props.steps[s]
  return h ? Math.round(h.value) : 0
}
function active(s: number, row: Row): boolean {
  if (s < 0 || s >= slots.value) return false
  const raw = rawAt(s)
  return row.kind === 'dive' ? (raw & DIVE_BIT) !== 0 : (raw & BASE_MASK) === row.val
}
function writeRaw(s: number, raw: number): void {
  const h = props.steps[s]
  if (!h) return
  h.begin()
  h.setFromUser(raw)
  h.end()
}
// 1スロットに行の属性を付与/除去（ベース排他・Dive 重ね・Mute は Dive クリア）。
function applySlot(s: number, row: Row, add: boolean): void {
  const raw = rawAt(s)
  let base = raw & BASE_MASK
  let dive = (raw & DIVE_BIT) !== 0
  if (row.kind === 'dive') {
    if (base === MUTE) return
    dive = add
  } else if (row.kind === 'mute') {
    if (add) {
      base = MUTE
      dive = false
    } else if (base === MUTE) base = 0
  } else {
    if (add) base = row.val
    else if (base === row.val) base = 0
  }
  const next = base | (dive ? DIVE_BIT : 0)
  if (next !== raw) writeRaw(s, next)
}
function setRange(a: number, b: number, row: Row, add: boolean): void {
  for (let s = a; s <= b; s++) applySlot(s, row, add)
}
// s を含む連続ラン[a,b]（その行が active な範囲）。
function run(s: number, row: Row): [number, number] {
  let a = s
  let b = s
  while (a - 1 >= 0 && active(a - 1, row)) a--
  while (b + 1 < slots.value && active(b + 1, row)) b++
  return [a, b]
}
// 行ごとの描画ラン（連続 active）。
function runsFor(row: Row): { a: number; b: number }[] {
  const res: { a: number; b: number }[] = []
  let a = -1
  for (let s = 0; s < slots.value; s++) {
    if (active(s, row)) {
      if (a < 0) a = s
    } else if (a >= 0) {
      res.push({ a, b: s - 1 })
      a = -1
    }
  }
  if (a >= 0) res.push({ a, b: slots.value - 1 })
  return res
}
function slotFromX(e: PointerEvent, el: HTMLElement): number {
  const x = e.clientX - el.getBoundingClientRect().left
  let s = Math.floor(x / SLOT_W)
  if (s < 0) s = 0
  else if (s >= slots.value) s = slots.value - 1
  return s
}
function onDown(e: PointerEvent, row: Row): void {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const x = e.clientX - el.getBoundingClientRect().left
  const s = slotFromX(e, el)
  if (active(s, row)) {
    const [a, b] = run(s, row)
    if (x >= (b + 1) * SLOT_W - EDGE) {
      drag = { row, anchor: a, end: b } // 右端→リサイズ
    } else {
      setRange(a, b, row, false) // 本体→消去
    }
  } else {
    const a = s - (s % 2) // 8分カラム頭
    const b = Math.min(a + 1, slots.value - 1)
    setRange(a, b, row, true) // クリック=8分作成
    drag = { row, anchor: a, end: b } // そのままドラッグで伸縮可
  }
}
function onMove(e: PointerEvent, row: Row): void {
  if (!drag || drag.row !== row) return
  const el = e.currentTarget as HTMLElement
  let end = slotFromX(e, el)
  if (end < drag.anchor) end = drag.anchor // 最短=anchor のみ(=16分)
  if (end > drag.end) setRange(drag.end + 1, end, row, true)
  else if (end < drag.end) setRange(end + 1, drag.end, row, false)
  drag.end = end
}
function endDrag(): void {
  drag = null
}
onMounted(() => window.addEventListener('pointerup', endDrag))
onBeforeUnmount(() => window.removeEventListener('pointerup', endDrag))

function setBars(n: number): void {
  props.bars.begin()
  props.bars.setFromUser(n)
  props.bars.end()
}
function rowColor(row: Row): string {
  if (row.kind === 'dive') return 'bg-sky-500/70'
  if (row.kind === 'mute') return 'bg-rose-500/70'
  return 'bg-emerald-500/70'
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      <p class="text-[10px] uppercase tracking-widest text-neutral-500">
        Sequencer · 8th (16th snap)
      </p>
      <div class="flex gap-px">
        <button
          v-for="b in BAR_TABS"
          :key="b"
          type="button"
          class="rounded-[2px] px-1.5 py-0.5 text-[9px] transition-colors"
          :class="
            barCount === b
              ? 'bg-emerald-500/70 text-neutral-950'
              : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
          "
          @click="setBars(b)"
        >
          {{ b }}{{ b > 1 ? ' bars' : ' bar' }}
        </button>
      </div>
    </div>
    <div class="flex select-none flex-col gap-px">
      <div
        v-for="row in ROWS"
        :key="row.label"
        class="flex items-center gap-px"
        :class="row.kind === 'mute' ? 'mt-1' : ''"
      >
        <span class="w-6 shrink-0 pr-1 text-right text-[9px] text-neutral-500">{{
          row.label
        }}</span>
        <div
          class="relative h-4 shrink-0 touch-none rounded-[2px] bg-neutral-900"
          :style="gridStyle"
          @pointerdown.prevent="onDown($event, row)"
          @pointermove="onMove($event, row)"
          @pointerup="endDrag"
          @pointercancel="endDrag"
        >
          <div
            v-for="r in runsFor(row)"
            :key="r.a"
            class="pointer-events-none absolute top-0 h-4 rounded-[2px]"
            :class="rowColor(row)"
            :style="{ left: `${r.a * SLOT_W}px`, width: `${(r.b - r.a + 1) * SLOT_W}px` }"
          />
          <div
            v-if="current >= 0 && current < slots"
            class="pointer-events-none absolute top-0 h-4 w-px bg-amber-400/90"
            :style="{ left: `${current * SLOT_W}px` }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

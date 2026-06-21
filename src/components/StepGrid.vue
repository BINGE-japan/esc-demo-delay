<script setup lang="ts">
// Glitch ステップシーケンサの仮UI（横=16分カラム / 縦=タイプ）。本UIは DSP 後に Three.js で刷新。
// セル値(raw)= ベース型(下位3bit) | Dive(bit3=8)。ベースは排他、Dive だけ重ねがけ（Mute には不可）。
// 1セル=16分（最小）。クリック/横ドラッグでなぞって伸縮（8分=2セル, 長尺=ドラッグ）。
// 行: Dive(モディファイア・sky色) / Rpt/Rev/Frz/Glt(ベース・排他・emerald) / Mute(最下段・rose色・排他)。
//   ベース 0=Dry(空) / 1=Glitch / 2=Freeze / 3=Reverse / 4=Mute / 5=Repeat。
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { ParamHandle } from '@suara/sdk'
import { STEPS_PER_BAR, MAX_BARS, clampBars } from '../audio/worklets/params'

const props = defineProps<{ steps: ParamHandle[]; bars: ParamHandle; current: number }>()

const BASE_MASK = 7
const DIVE_BIT = 8
const MUTE = 4
const BEAT = STEPS_PER_BAR / 4 // 1拍=4分=16分4つ

type RowKind = 'dive' | 'source' | 'mute'
interface Row {
  label: string
  val: number
  kind: RowKind
}
// 上→下。Dive(重ね)→ソース(排他)→Mute(最下段)。
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
const cols = computed(() => barCount.value * STEPS_PER_BAR) // 16分カラム数

// ドラッグペイント状態（なぞって伸縮）。同一行内のみ適用。
let paint: { row: Row; add: boolean } | null = null

function rawAt(c: number): number {
  const h = props.steps[c]
  return h ? Math.round(h.value) : 0
}
function active(c: number, row: Row): boolean {
  const raw = rawAt(c)
  return row.kind === 'dive' ? (raw & DIVE_BIT) !== 0 : (raw & BASE_MASK) === row.val
}
function writeRaw(c: number, raw: number): void {
  const h = props.steps[c]
  if (!h) return
  h.begin()
  h.setFromUser(raw)
  h.end()
}
// add=true で付与、false で除去。ベース排他・Dive 重ね・Mute は Dive クリア。
function applyCell(c: number, row: Row, add: boolean): void {
  const raw = rawAt(c)
  let base = raw & BASE_MASK
  let dive = (raw & DIVE_BIT) !== 0
  if (row.kind === 'dive') {
    if (base === MUTE) return // Mute には Dive 不可
    dive = add
  } else if (row.kind === 'mute') {
    if (add) {
      base = MUTE
      dive = false
    } else if (base === MUTE) base = 0
  } else {
    if (add)
      base = row.val // ベース変更で Dive 維持
    else if (base === row.val) base = 0
  }
  const next = base | (dive ? DIVE_BIT : 0)
  if (next !== raw) writeRaw(c, next)
}
function onDown(c: number, row: Row): void {
  const add = !active(c, row) // クリック=トグル、ドラッグ=同方向に伸縮
  paint = { row, add }
  applyCell(c, row, add)
}
function onEnter(c: number, row: Row): void {
  if (paint && paint.row === row) applyCell(c, row, paint.add)
}
function endPaint(): void {
  paint = null
}
onMounted(() => window.addEventListener('pointerup', endPaint))
onBeforeUnmount(() => window.removeEventListener('pointerup', endPaint))

function setBars(n: number): void {
  props.bars.begin()
  props.bars.setFromUser(n)
  props.bars.end()
}
function gap(col: number): string {
  if (col % STEPS_PER_BAR === 0 && col > 0) return 'ml-1.5' // 小節頭
  if (col % BEAT === 0) return 'ml-0.5' // 拍頭
  return ''
}
function cellClass(c: number, row: Row): string {
  if (!active(c, row)) return 'border-neutral-800 bg-neutral-900 hover:bg-neutral-800'
  if (row.kind === 'dive') return 'border-sky-400/70 bg-sky-500/70'
  if (row.kind === 'mute') return 'border-rose-400/70 bg-rose-500/70'
  return 'border-emerald-500/70 bg-emerald-500/70'
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      <p class="text-[10px] uppercase tracking-widest text-neutral-500">Sequencer · 16th</p>
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
        <button
          v-for="s in cols"
          :key="s"
          type="button"
          class="h-4 w-4 shrink-0 touch-none rounded-[2px] border transition-colors"
          :class="[
            cellClass(s - 1, row),
            gap(s - 1),
            current === s - 1 ? 'ring-1 ring-amber-400/80' : '',
          ]"
          @pointerdown.prevent="onDown(s - 1, row)"
          @pointerenter="onEnter(s - 1, row)"
        />
      </div>
    </div>
  </div>
</template>

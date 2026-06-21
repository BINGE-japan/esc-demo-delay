<script setup lang="ts">
// Glitch ステップシーケンサの仮UI（横=8分カラム / 縦=タイプ）。
// セル値(raw)= ベース型(下位3bit) | Dive(bit3=8)。ベースは排他、Dive だけ重ねがけ（Mute には不可）。
// 表示カラム=8分。1クリックで内部16分スロット2個をペイント。横連結=長さ。内部/スナップは16分。
// 行: Dive(モディファイア・別色) / Rpt/Rev/Frz/Glt(ベース・排他) / Mute(最下段・別色・排他/Dive クリア)。
//   ベース 0=Dry(空) / 1=Glitch / 2=Freeze / 3=Reverse / 4=Mute / 5=Repeat。
import { computed } from 'vue'
import type { ParamHandle } from '@suara/sdk'
import { STEPS_PER_BAR, MAX_BARS, clampBars } from '../audio/worklets/params'

const props = defineProps<{ steps: ParamHandle[]; bars: ParamHandle; current: number }>()

const BASE_MASK = 7
const DIVE_BIT = 8
const MUTE = 4

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
const EIGHTHS_PER_BAR = STEPS_PER_BAR / 2 // 表示は8分カラム（内部16分の2スロット=1カラム）

const barCount = computed(() => clampBars(props.bars.value))
const cols = computed(() => barCount.value * EIGHTHS_PER_BAR)

function rawAt(dc: number): number {
  const h = props.steps[2 * dc]
  return h ? Math.round(h.value) : 0
}
function active(dc: number, row: Row): boolean {
  const raw = rawAt(dc)
  return row.kind === 'dive' ? (raw & DIVE_BIT) !== 0 : (raw & BASE_MASK) === row.val
}
// 表示カラム dc → 内部16分スロット [2dc, 2dc+1] に同じ raw を書く。
function writeRaw(dc: number, raw: number): void {
  for (const h of [props.steps[2 * dc], props.steps[2 * dc + 1]]) {
    if (!h) continue
    h.begin()
    h.setFromUser(raw)
    h.end()
  }
}
function setCell(dc: number, row: Row): void {
  const raw = rawAt(dc)
  const base = raw & BASE_MASK
  const dive = (raw & DIVE_BIT) !== 0
  let next: number
  if (row.kind === 'dive') {
    if (base === MUTE) return // Mute には Dive 不可
    next = base | (dive ? 0 : DIVE_BIT)
  } else {
    // ソース/Mute=排他ベース。トグル。Mute は Dive をクリア、他はベース変更で Dive 維持。
    const nextBase = base === row.val ? 0 : row.val
    const nextDive = row.val === MUTE ? 0 : dive ? DIVE_BIT : 0
    next = nextBase | nextDive
  }
  writeRaw(dc, next)
}
function setBars(n: number): void {
  props.bars.begin()
  props.bars.setFromUser(n)
  props.bars.end()
}
function playing(dc: number): boolean {
  return Math.floor(props.current / 2) === dc
}
function gap(col: number): string {
  if (col % EIGHTHS_PER_BAR === 0 && col > 0) return 'ml-1.5'
  if (col % 2 === 0) return 'ml-0.5'
  return ''
}
// 行ごとのアクティブ配色（Dive=sky / Mute=rose / ソース=emerald）。
function cellClass(dc: number, row: Row): string {
  if (!active(dc, row)) return 'border-neutral-800 bg-neutral-900 hover:bg-neutral-800'
  if (row.kind === 'dive') return 'border-sky-400/70 bg-sky-500/70'
  if (row.kind === 'mute') return 'border-rose-400/70 bg-rose-500/70'
  return 'border-emerald-500/70 bg-emerald-500/70'
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      <p class="text-[10px] uppercase tracking-widest text-neutral-500">Sequencer · 8th</p>
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
    <div class="flex flex-col gap-px">
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
          class="h-4 w-4 shrink-0 rounded-[2px] border transition-colors"
          :class="[
            cellClass(s - 1, row),
            gap(s - 1),
            playing(s - 1) ? 'ring-1 ring-amber-400/80' : '',
          ]"
          @click="setCell(s - 1, row)"
        />
      </div>
    </div>
  </div>
</template>

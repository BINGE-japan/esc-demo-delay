<script setup lang="ts">
// Glitch ステップシーケンサの仮UI（横=8分カラム / 縦=タイプ・択一）。
// 上のタブで小節数(1/2/4)を選択＝グリッドが横に伸びる（ループ長そのものが変わる）。
// 表示カラム=8分。1クリックで内部16分スロット2個をペイント（=8分セル）。横連結=長さ（隣接ブロック）。
// 内部解像度・移動スナップは16分（最小16分）。空セル=Dry(素通り)。再クリックでクリア(=Dry)。
// 値=タイプ enum（params.ts / glitch.ts と一致）:
//   0=Dry(空) / 1=Glitch / 2=Freeze / 3=Reverse / 4=Mute / 5=Repeat(16分) / 6=Dive(ぎゅーん下降)
import { computed } from 'vue'
import type { ParamHandle } from '@suara/sdk'
import { STEPS_PER_BAR, MAX_BARS, clampBars } from '../audio/worklets/params'

const props = defineProps<{ steps: ParamHandle[]; bars: ParamHandle; current: number }>()

// 上→下の表示順（enum 降順）。Dry 行は無し＝空セルが Dry。
const ROWS = [
  { label: 'Dive', val: 6 },
  { label: 'Rpt', val: 5 },
  { label: 'Mute', val: 4 },
  { label: 'Rev', val: 3 },
  { label: 'Frz', val: 2 },
  { label: 'Glt', val: 1 },
]
const BAR_TABS = [1, 2, MAX_BARS]
const EIGHTHS_PER_BAR = STEPS_PER_BAR / 2 // 表示は8分カラム（内部16分の2スロット=1カラム）

const barCount = computed(() => clampBars(props.bars.value))
const cols = computed(() => barCount.value * EIGHTHS_PER_BAR) // 8分カラム数

// 表示カラム dc → 内部16分スロット [2dc, 2dc+1]。
function active(dc: number, val: number): boolean {
  const h = props.steps[2 * dc]
  return h ? Math.round(h.value) === val : false
}
// クリック: 未選択→そのタイプ(2スロット=8分)、選択済み→0(Dry)へクリア（トグル）。
function setCell(dc: number, val: number): void {
  const a = props.steps[2 * dc]
  if (!a) return
  const next = Math.round(a.value) === val ? 0 : val
  for (const h of [a, props.steps[2 * dc + 1]]) {
    if (!h) continue
    h.begin()
    h.setFromUser(next)
    h.end()
  }
}
function setBars(n: number): void {
  props.bars.begin()
  props.bars.setFromUser(n)
  props.bars.end()
}
// 再生中の16分 → 8分カラム。
function playing(dc: number): boolean {
  return Math.floor(props.current / 2) === dc
}
// 拍/小節の区切りに左マージン（2カラム=拍頭、EIGHTHS_PER_BAR=小節頭をやや広く）。
function gap(col: number): string {
  if (col % EIGHTHS_PER_BAR === 0 && col > 0) return 'ml-1.5'
  if (col % 2 === 0) return 'ml-0.5'
  return ''
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
      <div v-for="row in ROWS" :key="row.val" class="flex items-center gap-px">
        <span class="w-6 shrink-0 pr-1 text-right text-[9px] text-neutral-500">{{
          row.label
        }}</span>
        <button
          v-for="s in cols"
          :key="s"
          type="button"
          class="h-4 w-4 shrink-0 rounded-[2px] border transition-colors"
          :class="[
            active(s - 1, row.val)
              ? 'border-emerald-500/70 bg-emerald-500/70'
              : 'border-neutral-800 bg-neutral-900 hover:bg-neutral-800',
            gap(s - 1),
            playing(s - 1) ? 'ring-1 ring-amber-400/80' : '',
          ]"
          @click="setCell(s - 1, row.val)"
        />
      </div>
    </div>
  </div>
</template>

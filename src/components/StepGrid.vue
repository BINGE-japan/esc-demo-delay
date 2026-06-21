<script setup lang="ts">
// Glitch ステップシーケンサの仮UI（横=16分ステップ / 縦=タイプ・択一）。
// 空セル=Dry(素通り)。セルクリックでその列にタイプを設定、アクティブセル再クリックでクリア(=Dry)。
// 値=タイプ enum（params.ts / glitch.ts と一致）:
//   0=Dry(空) / 1=Glitch / 2=Freeze / 3=Reverse / 4=Mute / 5=Repeat(16分)
import type { ParamHandle } from '@suara/sdk'

const props = defineProps<{ steps: ParamHandle[]; current: number }>()

// 上→下の表示順（enum 降順）。Dry 行は無し＝空セルが Dry。
const ROWS = [
  { label: 'Rpt', val: 5 },
  { label: 'Mute', val: 4 },
  { label: 'Rev', val: 3 },
  { label: 'Frz', val: 2 },
  { label: 'Glt', val: 1 },
]

function active(stepIdx: number, val: number): boolean {
  const h = props.steps[stepIdx]
  return h ? Math.round(h.value) === val : false
}
// クリック: 未選択→そのタイプ、選択済み→0(Dry)へクリア（トグル）。
function setCell(stepIdx: number, val: number): void {
  const h = props.steps[stepIdx]
  if (!h) return
  const next = Math.round(h.value) === val ? 0 : val
  h.begin()
  h.setFromUser(next)
  h.end()
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <p class="text-[10px] uppercase tracking-widest text-neutral-500">Sequencer · 16th</p>
    <div class="flex flex-col gap-px">
      <div v-for="row in ROWS" :key="row.val" class="flex items-center gap-px">
        <span class="w-6 shrink-0 pr-1 text-right text-[9px] text-neutral-500">{{
          row.label
        }}</span>
        <button
          v-for="s in 16"
          :key="s"
          type="button"
          class="h-4 flex-1 rounded-[2px] border transition-colors"
          :class="[
            active(s - 1, row.val)
              ? 'border-emerald-500/70 bg-emerald-500/70'
              : 'border-neutral-800 bg-neutral-900 hover:bg-neutral-800',
            (s - 1) % 4 === 0 ? 'ml-0.5' : '',
            current === s - 1 ? 'ring-1 ring-amber-400/80' : '',
          ]"
          @click="setCell(s - 1, row.val)"
        />
      </div>
    </div>
  </div>
</template>

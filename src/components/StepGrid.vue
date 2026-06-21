<script setup lang="ts">
// Glitch ステップシーケンサの仮UI（クリップ式・横=8分カラム / 縦=タイプ）。本UIは DSP 後に Three.js で刷新。
// セル値(raw)= ベース型(下位3bit) | Dive(bit3=8)。ベースは排他、Dive は重ねがけ（**Mute とも共存可**）。
// 内部16分（1スロット=SLOT_W px、8分=2スロット）。空をクリック=16分セル作成（デフォ最短）、
// セルを左右どちらにドラッグでも16分スナップで伸縮（掴んだ反対端を固定）、セルをクリック(無移動)で消去。
// 行: Dive(モディファイア・sky) / Rpt/Rev/Frz/Glt(ベース・排他・emerald) / Mute(最下段・rose・排他)。
// Random/▶=シード前進で別配置・◀=前のシードに戻る（#seed 表示）/ Clear=全消去。VST はキー入力不可でボタンのみ。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ParamHandle } from '@suara/sdk'
import { STEPS_PER_BAR, MAX_BARS, clampBars } from '../audio/worklets/params'

const props = defineProps<{ steps: ParamHandle[]; bars: ParamHandle; current: number }>()

const BASE_MASK = 7
const DIVE_BIT = 8
const MUTE = 4
const SLOT_W = 8 // 16分1スロットの幅(px)。8分カラム=16px

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

// ドラッグ状態。fixed=固定端、lo/hi=現在の範囲、moved=動いたか、created=空クリック作成か。
let drag: {
  row: Row
  fixed: number
  lo: number
  hi: number
  moved: boolean
  created: boolean
} | null = null

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
// 1スロットに行の属性を付与/除去（ベースは排他、Dive は重ね＝Mute とも共存可）。
function applySlot(s: number, row: Row, add: boolean): void {
  const raw = rawAt(s)
  let base = raw & BASE_MASK
  let dive = (raw & DIVE_BIT) !== 0
  if (row.kind === 'dive') {
    dive = add // base はそのまま（Mute とも共存）
  } else if (row.kind === 'mute') {
    if (add)
      base = MUTE // dive は触らない（共存）
    else if (base === MUTE) base = 0
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
  const s = slotFromX(e, el)
  if (active(s, row)) {
    const [a, b] = run(s, row)
    const fixed = s - a <= b - s ? b : a // 掴んだ側の反対端を固定（左寄り掴み→右端固定）
    drag = { row, fixed, lo: a, hi: b, moved: false, created: false }
  } else {
    setRange(s, s, row, true) // クリック=16分作成（最短）
    drag = { row, fixed: s, lo: s, hi: s, moved: false, created: true }
  }
}
function onMove(e: PointerEvent, row: Row): void {
  if (!drag || drag.row !== row) return
  const s = slotFromX(e, e.currentTarget as HTMLElement)
  const lo = Math.min(drag.fixed, s)
  const hi = Math.max(drag.fixed, s)
  if (lo === drag.lo && hi === drag.hi) return // 同じスロット＝動いてない
  drag.moved = true
  if (lo < drag.lo) setRange(lo, drag.lo - 1, row, true) // 左へ伸長
  if (hi > drag.hi) setRange(drag.hi + 1, hi, row, true) // 右へ伸長
  if (lo > drag.lo) setRange(drag.lo, lo - 1, row, false) // 左を短縮
  if (hi < drag.hi) setRange(hi + 1, drag.hi, row, false) // 右を短縮
  drag.lo = lo
  drag.hi = hi
}
function endDrag(): void {
  if (drag && !drag.moved && !drag.created) setRange(drag.lo, drag.hi, drag.row, false) // クリック=消去
  drag = null
}
onMounted(() => window.addEventListener('pointerup', endDrag))
onBeforeUnmount(() => window.removeEventListener('pointerup', endDrag))

function setBars(n: number): void {
  props.bars.begin()
  props.bars.setFromUser(n)
  props.bars.end()
}

// --- ランダム生成 / クリア ---
// seed は ◀ / ▶ / Random で増減（VST はキー入力が runtime に取られ DOM 入力不可のためボタンのみ）。
const seed = ref(1)
const RND_BASE_DENSITY = 0.3 // ベースのラン開始確率（16分毎）
const RND_DIVE_DENSITY = 0.04 // Dive ラン開始確率（控えめ＝被覆 ~11%）
const RND_DIVE_TWO = 0.6 // Dive 長が8分(2セル)になる確率（残りはランダム長）
const RND_DIVE_MAX_EXT = 4 // Dive 伸長時の追加幅（残りは 3-6 セル）
const RND_GLITCH_EXTRA = 0.2 // 空セルに単発16分 Glitch を追加で撒く確率（他は保ちつつ Glitch 多め）
// 決定論ハッシュ [0,1)（seed と index から）。
function hash(a: number, b: number): number {
  let t = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0
  t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296
}
// 重み付きベース型抽選: Glt/Frz/Rev/Rpt 各2、Mute 6（多め）。total 14。
function pickBase(r: number): number {
  const x = r * 14
  if (x < 2) return 1 // Glitch
  if (x < 4) return 2 // Freeze
  if (x < 6) return 3 // Reverse
  if (x < 12) return MUTE // 4（重み6）
  return 5 // Repeat
}
// seed.value から現在の小節範囲を埋める（インクリメントしない＝同じシードで同じ配置を再現）。範囲外は 0。
// ベースはラン単位（Mute は必ず単発16分＝両隣を空ける / 他は1-3セル）。Dive は2個以上(8分+)のランで重ねる。
function generate(): void {
  const sd = seed.value
  const n = slots.value
  const total = props.steps.length
  const raws: number[] = Array.from({ length: total }, () => 0)
  let k = 0
  let s = 0
  while (s < n) {
    if (hash(sd, k++) < RND_BASE_DENSITY) {
      const base = pickBase(hash(sd, k++))
      if (base === MUTE) {
        raws[s++] = MUTE // 16分単発
        s++ // 次セルを必ず空けて隣接 Mute を防ぐ（Mute が両サイドに来ない＝8分以上にならない）
      } else {
        const len = 1 + Math.floor(hash(sd, k++) * 3) // 他=1-3セル
        for (let j = 0; j < len && s < n; j++) raws[s++] = base
      }
    } else s++
  }
  // 空セルに単発16分 Glitch を追加（他タイプの割合は保ちつつ Glitch を多めに）。
  // 隣が Glitch なら置かない＝追加 Glitch も連続させず単発16分に保つ。
  for (let i = 0; i < n; i++) {
    if ((raws[i] & BASE_MASK) !== 0) continue // 空セルのみ
    if (hash(sd, k++) >= RND_GLITCH_EXTRA) continue
    if (i > 0 && (raws[i - 1] & BASE_MASK) === 1) continue // 左隣が Glitch
    if (i < n - 1 && (raws[i + 1] & BASE_MASK) === 1) continue // 右隣が Glitch
    raws[i] = 1 // Glitch
  }
  s = 0
  while (s < n) {
    if (hash(sd, k++) < RND_DIVE_DENSITY) {
      let len = 2 // 8分(2セル)が最頻
      if (hash(sd, k++) >= RND_DIVE_TWO) len = 3 + Math.floor(hash(sd, k++) * RND_DIVE_MAX_EXT) // 残り=ランダム長(3-6)
      for (let j = 0; j < len && s < n; j++) raws[s++] |= DIVE_BIT
    } else s++
  }
  for (let i = 0; i < total; i++) writeRaw(i, i < n ? raws[i] : 0)
}
// シードを確定→再生成。
function applySeed(v: number): void {
  seed.value = v | 0
  generate()
}
// Random / ▶: シードを前進。◀: 後退（直前のランダムに戻る）。
function randomize(): void {
  applySeed(seed.value + 1)
}
function prevSeed(): void {
  applySeed(seed.value - 1)
}
function clearAll(): void {
  for (let s = 0; s < props.steps.length; s++) writeRaw(s, 0)
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
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="rounded-[2px] bg-sky-600/70 px-1.5 py-0.5 text-[9px] text-neutral-50 transition-colors hover:bg-sky-500/70"
          @click="randomize"
        >
          Random
        </button>
        <button
          type="button"
          title="前のシードに戻る"
          class="rounded-[2px] bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-300 transition-colors hover:bg-neutral-700"
          @click="prevSeed"
        >
          ◀
        </button>
        <span class="w-10 text-center text-[9px] tabular-nums text-neutral-400">#{{ seed }}</span>
        <button
          type="button"
          title="次のシードへ"
          class="rounded-[2px] bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-300 transition-colors hover:bg-neutral-700"
          @click="randomize"
        >
          ▶
        </button>
        <button
          type="button"
          class="rounded-[2px] bg-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-400 transition-colors hover:bg-neutral-700"
          @click="clearAll"
        >
          Clear
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

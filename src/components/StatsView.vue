<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart, LineChart, BarChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { store, txsOfMonth, categoryById, accountById } from '../store.js'
import { fmtMoney, fmtPct, monthKey, monthLabel, addMonths, nowDateKey, monthRange, ACCOUNT_META } from '../lib/format.js'

echarts.use([PieChart, LineChart, BarChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer])

const month = ref(monthKey(nowDateKey()))
const emit = defineEmits(['edit'])

const monthTxs = computed(() => txsOfMonth(month.value))
const stats = computed(() => {
  const [start, end] = monthRange(month.value)
  const days = Math.max(1, monthKey(nowDateKey()) === month.value
    ? Number(nowDateKey().slice(8, 10))
    : new Date(Number(month.value.slice(0, 4)), Number(month.value.slice(5, 7)), 0).getDate())
  let income = 0, expense = 0
  for (const t of monthTxs.value) {
    if (t.type === 'income') income += t.amount
    if (t.type === 'expense') expense += t.amount
  }
  return { income, expense, net: income - expense, avg: expense / days, days, start, end }
})

/** 上月支出与环比(上月为 0 或无数据时不展示) */
const mom = computed(() => {
  let last = 0
  const prevKey = addMonths(month.value, -1)
  for (const t of txsOfMonth(prevKey)) {
    if (t.type === 'expense') last += t.amount
  }
  if (!last) return null
  const cur = stats.value.expense
  const pct = (cur - last) / last
  return { last, pct }
})

const byCategory = computed(() => {
  const map = new Map()
  for (const t of monthTxs.value) {
    if (t.type !== 'expense') continue
    const c = categoryById(t.categoryId)
    const key = c?.name || '未分类'
    map.set(key, (map.get(key) || 0) + t.amount)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
})

const byAccount = computed(() => {
  const map = new Map()
  for (const t of monthTxs.value) {
    if (t.type !== 'expense') continue
    const a = accountById(t.accountId)
    const key = a?.name || '未知来源'
    map.set(key, (map.get(key) || 0) + t.amount)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
})

const trend = computed(() => {
  const keys = []
  for (let i = 5; i >= 0; i--) keys.push(addMonths(month.value, -i))
  const inc = [], exp = []
  for (const k of keys) {
    let i = 0, e = 0
    for (const t of store.txs.filter((t) => monthKey(t.date) === k)) {
      if (t.type === 'income') i += t.amount
      else if (t.type === 'expense') e += t.amount
    }
    inc.push(Math.round(i * 100) / 100)
    exp.push(Math.round(e * 100) / 100)
  }
  return { keys: keys.map(monthLabel), inc, exp }
})

/* —— 年度总览 —— */
const year = ref(nowDateKey().slice(0, 4))
const years = computed(() => {
  const set = new Set([String(new Date().getFullYear())])
  for (const t of store.txs) set.add(t.date.slice(0, 4))
  return [...set].filter((y) => /^\d{4}$/.test(y)).sort().reverse()
})
const yearStats = computed(() => {
  let income = 0, expense = 0
  const activeMonths = new Set()
  const byMonth = Array.from({ length: 12 }, () => ({ i: 0, e: 0 }))
  for (const t of store.txs) {
    if (!t.date.startsWith(year.value)) continue
    const m = Number(t.date.slice(5, 7)) - 1
    if (m < 0 || m > 11) continue
    if (t.type === 'income') { income += t.amount; byMonth[m].i += t.amount; activeMonths.add(m) }
    else if (t.type === 'expense') { expense += t.amount; byMonth[m].e += t.amount; activeMonths.add(m) }
  }
  const r2 = (v) => Math.round(v * 100) / 100
  return {
    income: r2(income), expense: r2(expense), net: r2(income - expense),
    avg: r2(expense / Math.max(1, activeMonths.size)),
    inc: byMonth.map((x) => r2(x.i)), exp: byMonth.map((x) => r2(x.e))
  }
})

/* —— 图表 —— */
const pieEl = ref(null)
const lineEl = ref(null)
const barEl = ref(null)
const yearEl = ref(null)
let charts = []
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()

function renderCharts() {
  charts.forEach((c) => c.dispose())
  charts = []
  const axis = { color: css('--text-dim'), fontSize: 11 }
  const split = css('--line')

  if (pieEl.value) {
    const chart = echarts.init(pieEl.value)
    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}<br/>¥{c}（{d}%）' },
      series: [{
        type: 'pie', radius: ['58%', '82%'], center: ['50%', '50%'],
        itemStyle: { borderRadius: 6, borderColor: css('--card'), borderWidth: 2 },
        label: { color: css('--text-dim'), fontSize: 11 },
        data: byCategory.value.map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      }],
      color: ['#e8b45c', '#c96f4a', '#8a9b6e', '#5f8faf', '#9d7bb0', '#c9a44a', '#6fbf8f', '#b06f6f', '#7a8ca3', '#d9c07a', '#a38f6f', '#68999a', '#8f7f9f', '#b8a48f', '#5f9f9f', '#c98f8f']
    })
    charts.push(chart)
  }
  if (lineEl.value) {
    const chart = echarts.init(lineEl.value)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['收入', '支出'], textStyle: { color: css('--text-dim') }, top: 0 },
      grid: { left: 8, right: 12, top: 32, bottom: 0, containLabel: true },
      xAxis: { type: 'category', data: trend.value.keys, axisLabel: { ...axis, interval: 2 } },
      yAxis: { type: 'value', axisLabel: axis, splitLine: { lineStyle: { color: split } } },
      series: [
        { name: '收入', type: 'line', smooth: true, data: trend.value.inc, itemStyle: { color: css('--gold') }, areaStyle: { opacity: 0.12 } },
        { name: '支出', type: 'line', smooth: true, data: trend.value.exp, itemStyle: { color: '#c96f4a' }, areaStyle: { opacity: 0.1 } }
      ]
    })
    charts.push(chart)
  }
  if (barEl.value) {
    const chart = echarts.init(barEl.value)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 8, right: 30, top: 8, bottom: 0, containLabel: true },
      xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { lineStyle: { color: split } } },
      yAxis: { type: 'category', data: byAccount.value.map((x) => x[0]).reverse(), axisLabel: axis },
      series: [{
        type: 'bar', barWidth: 12, itemStyle: { borderRadius: 6, color: css('--gold') },
        data: byAccount.value.map((x) => Math.round(x[1] * 100) / 100).reverse()
      }]
    })
    charts.push(chart)
  }
  if (yearEl.value) {
    const chart = echarts.init(yearEl.value)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['收入', '支出'], textStyle: { color: css('--text-dim') }, top: 0 },
      grid: { left: 8, right: 12, top: 32, bottom: 0, containLabel: true },
      xAxis: { type: 'category', data: Array.from({ length: 12 }, (_, i) => `${i + 1}月`), axisLabel: axis },
      yAxis: { type: 'value', axisLabel: axis, splitLine: { lineStyle: { color: split } } },
      series: [
        { name: '收入', type: 'bar', barWidth: 8, itemStyle: { borderRadius: 4, color: css('--gold') }, data: yearStats.value.inc },
        { name: '支出', type: 'bar', barWidth: 8, itemStyle: { borderRadius: 4, color: '#c96f4a' }, data: yearStats.value.exp }
      ]
    })
    charts.push(chart)
  }
}

let ro = null
onMounted(async () => {
  await nextTick()
  renderCharts()
  ro = new ResizeObserver(() => charts.forEach((c) => c.resize()))
  ;[pieEl, lineEl, barEl, yearEl].forEach((r) => r.value && ro.observe(r.value.parentElement))
})
onBeforeUnmount(() => { ro?.disconnect(); charts.forEach((c) => c.dispose()) })
watch([month, year, () => store.settings.theme], renderCharts)

const topCat = computed(() => byCategory.value.slice(0, 10))
const maxCat = computed(() => topCat.value[0]?.[1] || 1)
</script>

<template>
  <header class="head">
    <h1 class="head__title serif">统计</h1>
  </header>

  <div class="monthnav">
    <button class="btn btn--ghost" @click="month = addMonths(month, -1)">‹</button>
    <div class="monthnav__label serif">{{ monthLabel(month) }}</div>
    <button class="btn btn--ghost" @click="month = addMonths(month, 1)">›</button>
  </div>

  <section class="tiles">
    <div class="card tile">
      <span>总支出</span>
      <b class="num">{{ fmtMoney(stats.expense) }}</b>
      <small v-if="mom" class="num tile__mom" :class="mom.pct > 0 ? 'tile__mom--up' : 'tile__mom--down'">
        {{ mom.pct > 0 ? '▲' : '▼' }} {{ fmtPct(Math.abs(mom.pct)) }} 较上月
      </small>
    </div>
    <div class="card tile"><span>总收入</span><b class="num amt-in">+{{ fmtMoney(stats.income) }}</b></div>
    <div class="card tile"><span>结余</span><b class="num" :style="stats.net < 0 ? 'color: var(--ink-red)' : ''">{{ fmtMoney(stats.net) }}</b></div>
    <div class="card tile"><span>日均支出</span><b class="num">{{ fmtMoney(stats.avg) }}</b></div>
  </section>

  <div class="sec-title">支出分类占比</div>
  <section class="card chart-card">
    <div ref="pieEl" class="chart chart--pie"></div>
  </section>

  <div class="sec-title">近六个月收支趋势</div>
  <section class="card chart-card">
    <div ref="lineEl" class="chart chart--line"></div>
  </section>

  <div class="sec-title">消费来源分布</div>
  <section class="card chart-card">
    <div ref="barEl" class="chart chart--bar"></div>
  </section>

  <div class="sec-title">分类排行</div>
  <section class="card ranks">
    <div v-for="[name, v] in topCat" :key="name" class="rank">
      <span class="rank__name">{{ name }}</span>
      <div class="rank__bar"><i :style="{ width: (v / maxCat * 100).toFixed(1) + '%' }"></i></div>
      <span class="rank__val num">{{ fmtMoney(v) }}</span>
    </div>
    <p v-if="!topCat.length" class="rank--empty">本月暂无支出</p>
  </section>

  <div class="sec-title">年度总览</div>
  <section class="card chart-card">
    <div class="year-chips">
      <button
        v-for="y in years" :key="y"
        class="chip" :class="{ 'chip--on': year === y }" @click="year = y"
      >{{ y }}年</button>
    </div>
    <div class="year-tiles">
      <div class="yt"><span>总支出</span><b class="num">{{ fmtMoney(yearStats.expense) }}</b></div>
      <div class="yt"><span>总收入</span><b class="num amt-in">+{{ fmtMoney(yearStats.income) }}</b></div>
      <div class="yt"><span>结余</span><b class="num" :style="yearStats.net < 0 ? 'color: var(--ink-red)' : ''">{{ fmtMoney(yearStats.net) }}</b></div>
      <div class="yt"><span>月均支出</span><b class="num">{{ fmtMoney(yearStats.avg) }}</b></div>
    </div>
    <div ref="yearEl" class="chart chart--year"></div>
  </section>
</template>

<style scoped>
.head__title { font-size: 26px; letter-spacing: 8px; margin: 0 0 14px; }
.monthnav { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 16px; }
.monthnav__label { font-size: 17px; letter-spacing: 3px; min-width: 110px; text-align: center; }

.tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
@media (min-width: 900px) { .tiles { grid-template-columns: repeat(4, 1fr); } }
.tile { display: flex; flex-direction: column; gap: 7px; padding: 14px 16px; }
.tile span { font-size: 12px; color: var(--text-dim); letter-spacing: 2px; }
.tile b { font-size: 18px; }
.tile__mom { font-size: 11.5px; color: var(--text-faint); }
.tile__mom--up { color: var(--ink-red); }
.tile__mom--down { color: var(--ink-green); }

.chart-card { padding: 10px 6px; }
.chart { width: 100%; }
.chart--pie { height: 300px; }
.chart--line { height: 240px; }
.chart--bar { height: max(150px, calc(v-bind('byAccount.length') * 36px)); }

.ranks { display: flex; flex-direction: column; gap: 12px; }
.rank { display: grid; grid-template-columns: 74px 1fr 86px; align-items: center; gap: 12px; }
.rank__name { font-size: 13px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rank__bar { height: 8px; background: var(--card-2); border-radius: 4px; overflow: hidden; }
.rank__bar i { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--gold), var(--gold-deep)); }
.rank__val { font-size: 13px; text-align: right; }
.rank--empty { color: var(--text-faint); text-align: center; margin: 8px 0; font-size: 13px; }

.year-chips { display: flex; gap: 8px; padding: 6px 10px 14px; }
.year-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 0 10px 14px; }
.yt { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.yt span { font-size: 11px; color: var(--text-faint); letter-spacing: 1px; }
.yt b { font-size: 14px; }
.chart--year { height: 230px; }
</style>

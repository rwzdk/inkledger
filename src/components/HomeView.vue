<script setup>
import { ref, computed } from 'vue'
import { store, monthSummary, accountById, categoryById } from '../store.js'
import { fmtMoney, monthKey, monthLabel, addMonths, fmtDay, weekLabel, nowDateKey, ACCOUNT_META } from '../lib/format.js'
import AppIcon from './AppIcon.vue'
import DataIcon from './DataIcon.vue'

const emit = defineEmits(['edit'])

const month = ref(monthKey(nowDateKey()))
const filterAccount = ref('all')
const keyword = ref('')

const summary = computed(() => monthSummary(month.value))

const filtered = computed(() => {
  return store.txs
    .filter((t) => monthKey(t.date) === month.value)
    .filter((t) => filterAccount.value === 'all'
      || t.accountId === filterAccount.value
      || t.toAccountId === filterAccount.value)
    .filter((t) => !keyword.value
      || (t.payee + t.note + (t.tags || []).join(' ')).toLowerCase().includes(keyword.value.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date))
})

/** 按日分组 */
const groups = computed(() => {
  const map = new Map()
  for (const t of filtered.value) {
    const day = t.date.slice(0, 10)
    if (!map.has(day)) map.set(day, [])
    map.get(day).push(t)
  }
  return [...map.entries()].map(([day, list]) => ({
    day,
    expense: list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    income: list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0),
    list
  }))
})

function txCategoryIcon(t) {
  return categoryById(t.categoryId)?.icon || '📌'
}
function txTitle(t) {
  if (t.type === 'transfer') {
    const from = accountById(t.accountId)?.name || '?'
    const to = accountById(t.toAccountId)?.name || '?'
    return `${from} → ${to}`
  }
  return t.payee || categoryById(t.categoryId)?.name || '账目'
}
function txSub(t) {
  if (t.type === 'transfer') return '转账'
  const parts = [categoryById(t.categoryId)?.name, t.note].filter(Boolean)
  return parts.join(' · ')
}
function accountBadge(t) {
  const acc = accountById(t.accountId)
  if (!acc) return ''
  return acc.type === 'wechat' ? '微信' : acc.type === 'alipay' ? '支付宝' : acc.name
}
</script>

<template>
  <header class="head">
    <div>
      <h1 class="head__title serif">账目</h1>
      <p class="head__sub">{{ store.txs.length }} 笔记录 · 数据仅存于本机与你的仓库</p>
    </div>
  </header>

  <!-- 月份切换 -->
  <div class="monthnav">
    <button class="btn btn--ghost" @click="month = addMonths(month, -1)">‹</button>
    <div class="monthnav__label serif">{{ monthLabel(month) }}</div>
    <button class="btn btn--ghost" @click="month = addMonths(month, 1)">›</button>
  </div>

  <!-- 月度概览 -->
  <section class="card card--gold overview">
    <div class="overview__item">
      <span class="overview__label">收入</span>
      <b class="num amt-in">+{{ fmtMoney(summary.income) }}</b>
    </div>
    <div class="overview__divider"></div>
    <div class="overview__item">
      <span class="overview__label">支出</span>
      <b class="num">{{ fmtMoney(summary.expense) }}</b>
    </div>
    <div class="overview__divider"></div>
    <div class="overview__item">
      <span class="overview__label">结余</span>
      <b class="num" :class="summary.net >= 0 ? 'amt-in' : ''" :style="summary.net < 0 ? 'color: var(--ink-red)' : ''">
        {{ summary.net >= 0 ? '+' : '' }}{{ fmtMoney(summary.net) }}
      </b>
    </div>
  </section>

  <!-- 来源筛选 -->
  <div class="chips">
    <button class="chip" :class="{ 'chip--on': filterAccount === 'all' }" @click="filterAccount = 'all'">全部来源</button>
    <button
      v-for="a in store.accounts" :key="a.id"
      class="chip" :class="{ 'chip--on': filterAccount === a.id }"
      @click="filterAccount = a.id"
    ><DataIcon :icon="ACCOUNT_META[a.type]?.icon || ':acc-other'" :size="14" /> {{ a.name }}</button>
  </div>

  <div class="search-wrap">
    <AppIcon name="search" :size="16" class="search-wrap__icon" />
    <input v-model="keyword" class="input search" placeholder="搜索备注 / 商户 / 标签…" />
  </div>

  <!-- 明细 -->
  <section v-for="g in groups" :key="g.day" class="daygroup">
    <div class="daygroup__head">
      <span>{{ fmtDay(g.day) }} {{ weekLabel(g.day) }}</span>
      <span class="num daygroup__sum">
        <template v-if="g.expense">支 {{ fmtMoney(g.expense) }}</template>
        <template v-if="g.expense && g.income"> · </template>
        <template v-if="g.income"><span class="amt-in">收 {{ fmtMoney(g.income) }}</span></template>
      </span>
    </div>
    <div class="card list">
      <button v-for="t in g.list" :key="t.id" class="tx" @click="emit('edit', { tx: t })">
        <span class="tx__icon">
          <AppIcon v-if="t.type === 'transfer'" name="transfer" :size="17" />
          <DataIcon v-else :icon="txCategoryIcon(t)" :size="18" />
        </span>
        <span class="tx__body">
          <span class="tx__title">{{ txTitle(t) }}</span>
          <span class="tx__sub">
            <span v-if="accountBadge(t)" class="badge-src">{{ accountBadge(t) }}</span>
            {{ txSub(t) }}
          </span>
        </span>
        <span class="tx__amount num" :class="t.type === 'income' ? 'amt-in' : 'amt-out'">
          {{ t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄ ' : '-' }}{{ fmtMoney(t.amount) }}
        </span>
      </button>
    </div>
  </section>

  <div v-if="!groups.length" class="empty">
    <div class="empty__icon serif">墨</div>
    <p>{{ keyword || filterAccount !== 'all' ? '没有符合条件的账目' : '本月还没有账目' }}</p>
    <p class="empty__hint">点击「记一笔」开始，或在设置中导入微信 / 支付宝账单</p>
  </div>
</template>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 14px; }
.head__title { font-size: 26px; letter-spacing: 8px; margin: 0; }
.head__sub { color: var(--text-faint); font-size: 12.5px; margin: 4px 0 0; }

.monthnav { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 14px; }
.monthnav__label { font-size: 17px; letter-spacing: 3px; min-width: 110px; text-align: center; }

.overview { display: flex; align-items: stretch; padding: 18px 16px; margin-bottom: 14px; }
.overview__item { flex: 1; display: flex; flex-direction: column; gap: 6px; align-items: center; }
.overview__label { font-size: 12px; color: var(--text-dim); letter-spacing: 2px; }
.overview__item b { font-size: clamp(15px, 2.4vw, 19px); font-weight: 600; }
.overview__divider { width: 1px; background: var(--gold-line); opacity: 0.5; }

.chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 10px; scrollbar-width: none; }
.chips::-webkit-scrollbar { display: none; }
.search-wrap { position: relative; margin: 2px 0 18px; }
.search-wrap .search { padding-left: 38px; }
.search-wrap__icon {
  position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
  color: var(--text-faint); pointer-events: none;
}

.daygroup { margin-bottom: 18px; }
.daygroup__head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12.5px; color: var(--text-dim); padding: 0 4px 8px;
}
.daygroup__sum { color: var(--text-faint); font-size: 12px; }

.list { padding: 4px 6px; }
.tx {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 11px 10px; background: none; border: none; border-radius: var(--radius-s);
  cursor: pointer; color: var(--text); font-family: inherit; text-align: left;
  transition: background 0.12s;
}
.tx:hover { background: var(--card-2); }
.tx__icon {
  width: 38px; height: 38px; border-radius: 12px; flex: none;
  display: flex; align-items: center; justify-content: center; font-size: 18px;
  background: var(--card-2); border: 1px solid var(--line);
}
.tx__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.tx__title { font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tx__sub { font-size: 12px; color: var(--text-faint); display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; overflow: hidden; }
.tx__amount { font-size: 15.5px; font-weight: 600; flex: none; }

.empty { text-align: center; padding: 60px 20px; color: var(--text-dim); }
.empty__icon {
  width: 72px; height: 72px; margin: 0 auto 14px; border-radius: 24px;
  display: flex; align-items: center; justify-content: center;
  font-size: 34px; color: var(--gold);
  background: var(--gold-soft); border: 1px solid var(--gold-line);
}
.empty p { margin: 4px 0; }
.empty__hint { font-size: 12.5px; color: var(--text-faint); }

@media (min-width: 900px) {
  .chips { flex-wrap: wrap; }
}
</style>

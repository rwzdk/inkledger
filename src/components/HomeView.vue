<script setup>
import { ref, computed } from 'vue'
import { store, showToast, monthSummary, accountById, categoryById, budgetStatus, upcomingBills, monthlyFixed, payRecurring } from '../store.js'
import { fmtMoney, monthKey, monthLabel, addMonths, fmtDay, weekLabel, nowDateKey, dueLabel, daysFromToday, ACCOUNT_META } from '../lib/format.js'
import AppIcon from './AppIcon.vue'
import DataIcon from './DataIcon.vue'

const emit = defineEmits(['edit'])

const month = ref(monthKey(nowDateKey()))
const filterAccount = ref('all')
const filterType = ref('all')
const keyword = ref('')

const summary = computed(() => monthSummary(month.value))

const budgetRows = computed(() => budgetStatus(month.value))
const budgetTotal = computed(() => budgetRows.value.reduce(
  (acc, b) => ({ amount: acc.amount + b.budget, spent: acc.spent + b.spent }),
  { amount: 0, spent: 0 }
))
const budgetPct = (b) => Math.min(100, (b.spent / b.budget) * 100).toFixed(1)

/** 周期账单:30 天内待缴(当前月视图也顺带展示当月已过的) */
const bills = computed(() => upcomingBills(30))
const fixedMonthly = computed(() => monthlyFixed())
function payBill(id) {
  const tx = payRecurring(id)
  if (tx) showToast(`已入账 ${fmtMoney(tx.amount)} · ${tx.payee}`)
}

const filtered = computed(() => {
  return store.txs
    .filter((t) => monthKey(t.date) === month.value)
    .filter((t) => filterType.value === 'all' || t.type === filterType.value)
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

  <!-- 月度预算 -->
  <section v-if="budgetRows.length" class="card budget">
    <div class="budget__head">
      <span class="budget__title">月度预算</span>
      <span class="num budget__sum">已用 {{ fmtMoney(budgetTotal.spent) }} / {{ fmtMoney(budgetTotal.amount) }}</span>
    </div>
    <div class="budget__bar">
      <i :class="{ 'budget__bar--over': budgetTotal.spent > budgetTotal.amount }"
         :style="{ width: Math.min(100, budgetTotal.spent / budgetTotal.amount * 100).toFixed(1) + '%' }"></i>
    </div>
    <div class="budget__cats">
      <div v-for="b in budgetRows" :key="b.categoryId" class="budget__cat">
        <span class="budget__cat-icon"><DataIcon :icon="b.icon" :size="13" /></span>
        <span class="budget__cat-name">{{ b.name }}</span>
        <div class="budget__cat-bar">
          <i :class="{ 'budget__bar--over': b.remain < 0 }" :style="{ width: budgetPct(b) + '%' }"></i>
        </div>
        <span class="num budget__cat-val" :class="{ 'budget__cat-val--over': b.remain < 0 }">
          {{ b.remain >= 0 ? '余 ' + fmtMoney(b.remain) : '超 ' + fmtMoney(-b.remain) }}
        </span>
      </div>
    </div>
  </section>

  <!-- 周期账单提醒 -->
  <section v-if="bills.length" class="card bills">
    <div class="bills__head">
      <span class="bills__title">近期账单</span>
      <span class="bills__fixed" v-if="fixedMonthly">每月固定 <span class="num">≈¥{{ fmtMoney(fixedMonthly) }}</span></span>
    </div>
    <div v-for="b in bills" :key="b.id" class="bill">
      <span class="bill__main">
        <b>{{ b.name }}</b>
        <small class="num bill__amount">¥{{ fmtMoney(b.amount) }}</small>
      </span>
      <span class="bill__due" :class="{ 'bill__due--over': daysFromToday(b.nextDate) < 0, 'bill__due--soon': daysFromToday(b.nextDate) <= 3 }">
        {{ dueLabel(b.nextDate) }} · {{ b.nextDate.slice(5).replace('-', '/') }}
      </span>
      <button class="btn btn--ghost btn--sm" @click="payBill(b.id)">缴账</button>
    </div>
  </section>

  <!-- 类型 + 来源筛选 -->
  <div class="chips">
    <button
      v-for="ft in [['all', '全部'], ['expense', '支出'], ['income', '收入'], ['transfer', '转账']]" :key="ft[0]"
      class="chip" :class="{ 'chip--on': filterType === ft[0] }" @click="filterType = ft[0]"
    >{{ ft[1] }}</button>
    <span class="chips__gap"></span>
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

.budget { padding: 16px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 11px; }
.budget__head { display: flex; align-items: baseline; justify-content: space-between; }
.budget__title { font-size: 13px; letter-spacing: 2px; color: var(--text-dim); }
.budget__sum { font-size: 12.5px; color: var(--text-faint); }
.budget__bar { height: 8px; border-radius: 4px; background: var(--card-2); overflow: hidden; }
.budget__bar i { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--gold), var(--gold-deep)); transition: width 0.3s; }
.budget__bar--over { background: linear-gradient(90deg, var(--ink-red), #b95555) !important; }
.budget__cats { display: flex; flex-direction: column; gap: 8px; }
.budget__cat { display: grid; grid-template-columns: 18px 64px 1fr 92px; align-items: center; gap: 8px; }
.budget__cat-icon { display: flex; color: var(--text-dim); }
.budget__cat-name { font-size: 12.5px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.budget__cat-bar { height: 5px; border-radius: 3px; background: var(--card-2); overflow: hidden; }
.budget__cat-bar i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--gold), var(--gold-deep)); }
.budget__cat-val { font-size: 12px; text-align: right; color: var(--text-faint); }
.budget__cat-val--over { color: var(--ink-red); }

.bills { padding: 14px 16px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 4px; }
.bills__head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
.bills__title { font-size: 13px; letter-spacing: 2px; color: var(--text-dim); }
.bills__fixed { font-size: 12px; color: var(--text-faint); }
.bills__fixed .num { color: var(--text-dim); }
.bill { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); }
.bill__main { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; }
.bill__main b { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bill__amount { font-size: 12.5px; color: var(--text-dim); }
.bill__due { flex: none; font-size: 12px; color: var(--text-faint); }
.bill__due--soon { color: var(--gold); }
.bill__due--over { color: var(--ink-red); }

.chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 10px; scrollbar-width: none; }
.chips::-webkit-scrollbar { display: none; }
.chips__gap { flex: none; width: 1px; background: var(--line-strong); margin: 4px 2px; }
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

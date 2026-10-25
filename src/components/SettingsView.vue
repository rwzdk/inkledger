<script setup>
import { ref, computed } from 'vue'
import {
  store, showToast, upsertAccount, removeAccount, upsertCategory, removeCategory, setBudget, budgetOf,
  upsertRecurring, removeRecurring,
  importFromText, importFromRows, exportJSON, importJSON, clearAll, loadSample, balanceOf,
  syncToGitHub, defaultRepoName
} from '../store.js'
import { getUser } from '../lib/github.js'
import { isXlsx, parseXlsxRows } from '../lib/xlsx.js'
import { fmtMoney, CYCLES, dueLabel, daysFromToday, nowDateKey, ACCOUNT_META } from '../lib/format.js'
import { decodeBuffer, buildTxCsv } from '../lib/csv.js'
import { CATEGORY_ICON_KEYS } from '../lib/icons.js'
import AppIcon from './AppIcon.vue'
import DataIcon from './DataIcon.vue'

/* —— 主题 —— */
function setTheme(t) {
  store.settings.theme = t
  document.documentElement.dataset.theme = t
}

/* —— 账单导入 —— */
const importing = ref(false)
async function onBillFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  importing.value = true
  try {
    const buf = await file.arrayBuffer()
    // 微信新版导出为 xlsx，旧版邮件导出为 CSV，按 zip 魔数自动分流
    const res = isXlsx(buf)
      ? importFromRows(await parseXlsxRows(buf))
      : importFromText(decodeBuffer(buf))
    const srcName = res.platform === 'wechat' ? '微信' : '支付宝'
    showToast(`已从${srcName}账单导入 ${res.txs.length} 笔（跳过 ${res.skipped} 笔重复/无效）`
      + (res.createdAccounts.length ? `，新增来源账户 ${res.createdAccounts.length} 个` : ''))
  } catch (err) {
    showToast('导入失败：' + err.message)
  } finally {
    importing.value = false
  }
}

/* —— GitHub 同步 —— */
const tokenInput = ref(store.settings.github.token)
const verifying = ref(false)
const syncing = ref(false)
const loginHint = computed(() => store.settings.github.login ? `已连接 ${store.settings.github.login}` : '未连接')
const lastSyncLabel = computed(() => store.settings.lastSync
  ? new Date(store.settings.lastSync).toLocaleString('zh-CN')
  : '从未同步')

async function verifyToken() {
  if (!tokenInput.value.trim()) { showToast('请先填写 Token'); return }
  verifying.value = true
  try {
    const who = await getUser(tokenInput.value.trim())
    store.settings.github.token = tokenInput.value.trim()
    store.settings.github.login = who.login
    if (!store.settings.github.repo) store.settings.github.repo = defaultRepoName(who.login)
    showToast(`已连接 GitHub：${who.login}`)
  } catch (err) {
    showToast(err.message)
  } finally { verifying.value = false }
}

async function doSync() {
  if (!store.settings.github.token) { showToast('请先填写并校验 GitHub Token'); return }
  syncing.value = true
  try {
    const r = await syncToGitHub()
    showToast(`同步完成 → ${r.login}/${r.repo}`)
  } catch (err) {
    showToast('同步失败：' + (err.message || '网络异常'))
  } finally { syncing.value = false }
}

/* —— 账户管理 —— */
const accForm = ref(null)
function newAccount() { accForm.value = { id: '', name: '', type: 'bank', initialBalance: 0 } }
function saveAccount() {
  if (!accForm.value.name.trim()) { showToast('请填写账户名'); return }
  upsertAccount({ ...accForm.value, name: accForm.value.name.trim() })
  accForm.value = null
}

/* —— 分类管理 —— */
const catKind = ref('expense')
const catForm = ref(null)
function newCategory() { catForm.value = { id: '', name: '', icon: ':other', kind: catKind.value, keywords: [] } }
const catKeywordInput = ref('')
function addCatKeyword() {
  const k = catKeywordInput.value.trim()
  if (k && !catForm.value.keywords.includes(k)) catForm.value.keywords.push(k)
  catKeywordInput.value = ''
}
function saveCategory() {
  if (!catForm.value.name.trim()) { showToast('请填写分类名'); return }
  upsertCategory({ ...catForm.value, name: catForm.value.name.trim() })
  catForm.value = null
}

/* —— 预算 —— */
function onBudgetChange(categoryId, e) {
  setBudget(categoryId, e.target.value)
  e.target.value = budgetOf(categoryId) || ''
  showToast(budgetOf(categoryId) ? '预算已保存' : '已清除预算')
}
const totalBudget = computed(() => {
  const sum = store.categories.reduce((s, c) => s + (c.kind === 'expense' ? budgetOf(c.id) : 0), 0)
  return sum ? fmtMoney(sum) : ''
})

/* —— 周期账单 —— */
const cycleKeys = Object.keys(CYCLES)
const recForm = ref(null)
function newRecurring() {
  const fallbackCat = store.categories.find((c) => c.kind === 'expense' && c.isFallback) || store.categories.find((c) => c.kind === 'expense')
  recForm.value = {
    id: '', name: '', amount: '', cycle: 'monthly', active: true,
    categoryId: fallbackCat?.id || null,
    accountId: store.accounts[0]?.id || null,
    nextDate: nowDateKey()
  }
}
function saveRecurring() {
  const f = recForm.value
  const amount = Number(f.amount)
  if (!f.name.trim()) { showToast('请填写账单名称'); return }
  if (!Number.isFinite(amount) || amount <= 0) { showToast('请填写正确的金额'); return }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.nextDate)) { showToast('请选择下次扣费日'); return }
  upsertRecurring({ ...f, name: f.name.trim(), amount: Math.round(amount * 100) / 100 })
  recForm.value = null
  showToast('周期账单已保存')
}

/* —— CSV 导出 —— */
function downloadTxCsv() {
  const catName = (id) => store.categories.find((c) => c.id === id)?.name || ''
  const accName = (id) => store.accounts.find((a) => a.id === id)?.name || ''
  const typeLabel = (t) => (t === 'income' ? '收入' : t === 'transfer' ? '转账' : '支出')
  const csv = buildTxCsv(
    [...store.txs].sort((a, b) => b.date.localeCompare(a.date)),
    { categoryName: catName, accountName: accName, typeLabel }
  )
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `inkledger-账目-${nowDateKey()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  showToast(`已导出 ${store.txs.length} 笔账目`)
}

/* —— 数据管理 —— */
function downloadExport() {
  const blob = new Blob([exportJSON()], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `inkledger-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}
async function onBackupFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try { importJSON(await file.text()) } catch (err) { showToast('导入失败：' + err.message) }
}
function doClear() {
  if (confirm('确定清空全部账目？账户与分类会恢复默认（该操作不影响已同步到 GitHub 的数据）')) clearAll()
}
</script>

<template>
  <header class="head">
    <h1 class="head__title serif">设置</h1>
  </header>

  <!-- 账单导入 -->
  <div class="sec-title">微信 / 支付宝账单导入</div>
  <section class="card">
    <p class="hint">
      在微信「我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单」中选择「用于个人对账」，收到邮件后下载 CSV 上传至此；
      支付宝在「我的 → 账单 → ... — 开具交易流水证明 / 对账单」导出。导入会自动识别来源账户、按关键词归类，并跳过重复账目。
    </p>
    <label class="btn btn--gold upload">
      {{ importing ? '解析中…' : '选择账单 CSV 文件' }}
      <input type="file" accept=".csv,text/csv" :disabled="importing" @change="onBillFile" hidden />
    </label>
  </section>

  <!-- GitHub 同步 -->
  <div class="sec-title">GitHub 同步</div>
  <section class="card">
    <p class="hint">
      账本数据以一个 JSON 文件存放在<strong>你自己的私有仓库</strong>中，本站不保存任何数据。
      需要 GitHub Personal Access Token（建议 Fine-grained，仅授权仓库读写）。
    </p>
    <label class="field">
      <span class="field__label">Personal Access Token（仅保存在本机浏览器）</span>
      <input v-model="tokenInput" type="password" class="input" placeholder="ghp_ / github_pat_…" autocomplete="off" />
    </label>
    <div class="row">
      <label class="field" style="flex: 1">
        <span class="field__label">数据仓库（不存在会自动创建私有仓库）</span>
        <input v-model="store.settings.github.repo" class="input" placeholder="your-name-inkledger-data" />
      </label>
    </div>
    <div class="row row--end">
      <span class="status">{{ loginHint }} · 上次同步：{{ lastSyncLabel }}</span>
    </div>
    <div class="row">
      <button class="btn" :disabled="verifying" @click="verifyToken">{{ verifying ? '校验中…' : '校验并保存' }}</button>
      <button class="btn btn--gold" :disabled="syncing" @click="doSync">{{ syncing ? '同步中…' : '立即同步' }}</button>
      <a class="btn btn--ghost" href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener">获取 Token ↗</a>
    </div>
  </section>

  <!-- 账户管理 -->
  <div class="sec-title">账户（消费来源）</div>
  <section class="card">
    <div v-for="a in store.accounts" :key="a.id" class="row-line">
      <span class="row-line__icon"><DataIcon :icon="ACCOUNT_META[a.type]?.icon || ':acc-other'" :size="18" /></span>
      <span class="row-line__body">
        <b>{{ a.name }}</b>
        <small>{{ ACCOUNT_META[a.type]?.label || '其他' }} · 余额 <span class="num">{{ fmtMoney(balanceOf(a.id)) }}</span></small>
      </span>
      <button class="btn btn--ghost btn--sm" @click="accForm = { ...a }">编辑</button>
    </div>
    <button class="btn upload-block" @click="newAccount">＋ 新增账户</button>
  </section>

  <!-- 分类管理 -->
  <div class="sec-title">分类</div>
  <section class="card">
    <div class="seg">
      <button class="seg__item" :class="{ 'seg__item--on': catKind === 'expense' }" @click="catKind = 'expense'">支出</button>
      <button class="seg__item" :class="{ 'seg__item--on': catKind === 'income' }" @click="catKind = 'income'">收入</button>
    </div>
    <div v-for="c in store.categories.filter((c) => c.kind === catKind)" :key="c.id" class="row-line">
      <span class="row-line__icon"><DataIcon :icon="c.icon" :size="18" /></span>
      <span class="row-line__body">
        <b>{{ c.name }}</b>
        <small>{{ c.keywords?.length ? c.keywords.slice(0, 6).join(' / ') + (c.keywords.length > 6 ? ' …' : '') : '无自动归类关键词' }}</small>
      </span>
      <button class="btn btn--ghost btn--sm" @click="catForm = { ...c, keywords: [...(c.keywords || [])] }">编辑</button>
    </div>
    <button class="btn upload-block" @click="newCategory">＋ 新增分类</button>
  </section>

  <!-- 预算管理 -->
  <div class="sec-title">月度预算</div>
  <section class="card">
    <p class="hint">为支出分类设置每月额度，首页与统计会展示执行进度；留空或 0 表示不设预算。</p>
    <div v-for="c in store.categories.filter((c) => c.kind === 'expense')" :key="'b-' + c.id" class="row-line row-line--budget">
      <span class="row-line__icon"><DataIcon :icon="c.icon" :size="18" /></span>
      <span class="row-line__body"><b>{{ c.name }}</b></span>
      <div class="budget-input">
        <span class="budget-input__unit num">¥</span>
        <input
          class="input num" type="number" min="0" step="10" inputmode="decimal"
          placeholder="—"
          :value="budgetOf(c.id) || ''"
          @change="onBudgetChange(c.id, $event)"
        />
        <span class="budget-input__unit2">/月</span>
      </div>
    </div>
    <p class="hint budget-sum" v-if="totalBudget">合计月预算 <b class="num">¥{{ totalBudget }}</b></p>
  </section>

  <!-- 周期账单 -->
  <div class="sec-title">周期账单 / 订阅</div>
  <section class="card">
    <p class="hint">房租、会员、话费等固定扣费:到期会显示在首页「近期账单」,点「缴账」一键入账并自动顺延下期。</p>
    <div v-for="r in store.recurring" :key="r.id" class="row-line row-line--rec">
      <span class="row-line__body">
        <b>{{ r.name }} <small v-if="!r.active" class="rec-off">已停用</small></b>
        <small>
          {{ CYCLES[r.cycle]?.label }} ¥{{ fmtMoney(r.amount) }} · 下次 {{ r.nextDate }}
          <em :class="{ 'rec-due--over': daysFromToday(r.nextDate) < 0 && r.active }">{{ r.active ? dueLabel(r.nextDate) : '' }}</em>
        </small>
      </span>
      <button class="btn btn--ghost btn--sm" @click="recForm = { ...r }">编辑</button>
    </div>
    <button class="btn upload-block" @click="newRecurring">＋ 新增周期账单</button>
  </section>

  <!-- 数据管理 -->
  <div class="sec-title">数据</div>
  <section class="card">
    <div class="row wrap">
      <button class="btn" @click="downloadExport">导出备份 JSON</button>
      <button class="btn" @click="downloadTxCsv">导出账目 CSV</button>
      <label class="btn">导入备份
        <input type="file" accept=".json" @change="onBackupFile" hidden />
      </label>
      <button class="btn" @click="loadSample">载入示例数据</button>
      <button class="btn btn--danger" @click="doClear">清空账目</button>
    </div>
    <p class="hint">数据保存在浏览器 localStorage，清除浏览器数据前请先同步或导出备份。</p>
  </section>

  <!-- 外观 -->
  <div class="sec-title">外观</div>
  <section class="card row">
    <button class="btn btn--ico" :class="{ 'btn--on': store.settings.theme === 'dark' }" @click="setTheme('dark')"><AppIcon name="moon" :size="15" /> 夜墨</button>
    <button class="btn btn--ico" :class="{ 'btn--on': store.settings.theme === 'light' }" @click="setTheme('light')"><AppIcon name="sun" :size="15" /> 宣纸</button>
  </section>

  <p class="about serif">墨账 InkLedger · v1.4 · 静态部署 · 数据自持</p>

  <!-- 账户编辑弹层 -->
  <Teleport to="body">
    <div v-if="accForm" class="overlay" @click.self="accForm = null">
      <div class="sheet">
        <h3 class="sheet__title">{{ accForm.id ? '编辑账户' : '新增账户' }}
          <button class="sheet__close" @click="accForm = null">✕</button></h3>
        <label class="field"><span class="field__label">名称</span>
          <input v-model="accForm.name" class="input" placeholder="如：招商银行储蓄卡(1234)" /></label>
        <label class="field" style="margin-top: 12px"><span class="field__label">类型</span>
          <select v-model="accForm.type" class="select">
            <option v-for="(m, k) in ACCOUNT_META" :key="k" :value="k">{{ m.label }}</option>
          </select></label>
        <label class="field" style="margin-top: 12px"><span class="field__label">初始余额</span>
          <input v-model="accForm.initialBalance" class="input num" type="number" step="0.01" /></label>
        <div class="row row--end" style="margin-top: 18px">
          <template v-if="accForm.id">
            <button class="btn btn--danger" @click="removeAccount(accForm.id) && (accForm = null)">删除</button>
            <span style="flex: 1"></span>
          </template>
          <button class="btn" @click="accForm = null">取消</button>
          <button class="btn btn--gold" @click="saveAccount">保存</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 周期账单编辑弹层 -->
  <Teleport to="body">
    <div v-if="recForm" class="overlay" @click.self="recForm = null">
      <div class="sheet">
        <h3 class="sheet__title">{{ recForm.id ? '编辑周期账单' : '新增周期账单' }}
          <button class="sheet__close" @click="recForm = null">✕</button></h3>
        <div class="row">
          <label class="field" style="flex: 1"><span class="field__label">名称</span>
            <input v-model="recForm.name" class="input" placeholder="如：视频会员 / 房租" /></label>
          <label class="field" style="width: 120px"><span class="field__label">金额(¥)</span>
            <input v-model="recForm.amount" class="input num" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" /></label>
        </div>
        <div class="fields-grid">
          <label class="field"><span class="field__label">周期</span>
            <select v-model="recForm.cycle" class="select">
              <option v-for="k in cycleKeys" :key="k" :value="k">{{ CYCLES[k].label }}</option>
            </select></label>
          <label class="field"><span class="field__label">下次扣费日</span>
            <input v-model="recForm.nextDate" class="input num" type="date" /></label>
          <label class="field"><span class="field__label">分类</span>
            <select v-model="recForm.categoryId" class="select">
              <option v-for="c in store.categories.filter((c) => c.kind === 'expense')" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select></label>
          <label class="field"><span class="field__label">扣费账户</span>
            <select v-model="recForm.accountId" class="select">
              <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select></label>
          <label class="field"><span class="field__label">状态</span>
            <select v-model="recForm.active" class="select">
              <option :value="true">启用</option>
              <option :value="false">停用</option>
            </select></label>
        </div>
        <div class="row row--end" style="margin-top: 18px">
          <template v-if="recForm.id">
            <button class="btn btn--danger" @click="removeRecurring(recForm.id) || (recForm = null)">删除</button>
            <span style="flex: 1"></span>
          </template>
          <button class="btn" @click="recForm = null">取消</button>
          <button class="btn btn--gold" @click="saveRecurring">保存</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 分类编辑弹层 -->
  <Teleport to="body">
    <div v-if="catForm" class="overlay" @click.self="catForm = null">
      <div class="sheet">
        <h3 class="sheet__title">{{ catForm.id ? '编辑分类' : '新增分类' }}
          <button class="sheet__close" @click="catForm = null">✕</button></h3>
        <div class="row">
          <label class="field" style="flex: 1"><span class="field__label">名称</span>
            <input v-model="catForm.name" class="input" placeholder="如：宠物" /></label>
        </div>
        <div class="field" style="margin-top: 12px">
          <span class="field__label">图标</span>
          <div class="icon-picker">
            <button
              v-for="k in CATEGORY_ICON_KEYS" :key="k"
              type="button"
              class="icon-picker__item"
              :class="{ 'icon-picker__item--on': catForm.icon === ':' + k }"
              @click="catForm.icon = ':' + k"
            ><AppIcon :name="k" :size="18" /></button>
          </div>
          <small v-if="!CATEGORY_ICON_KEYS.some((k) => catForm.icon === ':' + k)" class="icon-picker__hint">
            当前为自定义图标 {{ catForm.icon }},从上方选择可替换为线性图标
          </small>
        </div>
        <label class="field" style="margin-top: 12px"><span class="field__label">自动归类关键词（导入账单时按商户/商品匹配）</span>
          <div class="tags-row">
            <span v-for="k in catForm.keywords" :key="k" class="tag" @click="catForm.keywords = catForm.keywords.filter((x) => x !== k)">{{ k }} ✕</span>
            <input v-model="catKeywordInput" class="input tags-input" placeholder="回车添加，如：盒马" @keydown.enter.prevent="addCatKeyword" />
          </div></label>
        <div class="row row--end" style="margin-top: 18px">
          <template v-if="catForm.id">
            <button class="btn btn--danger" @click="removeCategory(catForm.id) && (catForm = null)">删除</button>
            <span style="flex: 1"></span>
          </template>
          <button class="btn" @click="catForm = null">取消</button>
          <button class="btn btn--gold" @click="saveCategory">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.head__title { font-size: 26px; letter-spacing: 8px; margin: 0 0 14px; }
.hint { color: var(--text-dim); font-size: 13px; line-height: 1.7; margin: 0 0 14px; }
.hint strong { color: var(--gold); }
.row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.row--end { justify-content: flex-end; }
.row--end .status { flex: 1; }
.status { font-size: 12px; color: var(--text-faint); margin: 10px 0; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-size: 12px; color: var(--text-dim); letter-spacing: 1px; }
.upload { display: inline-flex; align-items: center; gap: 6px; }
.upload-block { width: 100%; margin-top: 10px; }

.row-line { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.row-line:last-of-type { border-bottom: none; }
.row-line--budget { padding: 7px 0; }
.row-line--budget .row-line__body { flex: 0 0 auto; }
.budget-input { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.budget-input .input { width: 96px; text-align: right; padding: 6px 8px; }
.budget-input__unit { color: var(--text-faint); font-size: 13px; }
.budget-input__unit2 { color: var(--text-faint); font-size: 12px; }
.budget-sum { margin: 12px 0 0; text-align: right; }
.budget-sum b { color: var(--gold); font-weight: 600; }

.row-line--rec { padding: 9px 0; }
.rec-off { color: var(--text-faint); font-size: 11px; border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; margin-left: 4px; }
.row-line--rec em { font-style: normal; color: var(--text-faint); margin-left: 4px; }
.rec-due--over { color: var(--ink-red) !important; }

.fields-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
@media (max-width: 480px) { .fields-grid { grid-template-columns: 1fr; } }
.row-line__icon {
  width: 36px; height: 36px; border-radius: 10px; flex: none;
  display: flex; align-items: center; justify-content: center; font-size: 17px;
  background: var(--card-2); border: 1px solid var(--line);
}
.row-line__body { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.row-line__body b { font-size: 14.5px; font-weight: 600; }
.row-line__body small { color: var(--text-faint); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.btn--sm { padding: 5px 12px; font-size: 12.5px; }

.seg { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: var(--card-2); border-radius: var(--radius-s); padding: 4px; margin-bottom: 10px; }
.seg__item { border: none; background: none; color: var(--text-dim); padding: 7px 0; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13.5px; }
.seg__item--on { background: var(--gold-soft); color: var(--gold); font-weight: 600; }

.tags-row { display: flex; flex-wrap: wrap; gap: 8px; }
.tags-row .tag { cursor: pointer; }
.tags-input { flex: 1; min-width: 130px; width: auto; }

.icon-picker { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.icon-picker__item {
  display: flex; align-items: center; justify-content: center;
  padding: 8px 0; border-radius: var(--radius-s);
  border: 1px solid var(--line); background: var(--card-2);
  color: var(--text-dim); cursor: pointer;
  transition: all 0.12s;
}
.icon-picker__item:hover { color: var(--text); border-color: var(--line-strong); }
.icon-picker__item--on { border-color: var(--gold-line); background: var(--gold-soft); color: var(--gold); }
.icon-picker__hint { color: var(--text-faint); font-size: 12px; margin-top: 6px; }

.btn--on { border-color: var(--gold-line); color: var(--gold); background: var(--gold-soft); }
.about { text-align: center; color: var(--text-faint); font-size: 13px; letter-spacing: 3px; margin: 34px 0 6px; }
</style>

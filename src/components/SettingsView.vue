<script setup>
import { ref, computed } from 'vue'
import {
  store, showToast, upsertAccount, removeAccount, upsertCategory, removeCategory,
  importFromText, exportJSON, importJSON, clearAll, loadSample, balanceOf,
  syncToGitHub, defaultRepoName
} from '../store.js'
import { getUser } from '../lib/github.js'
import { fmtMoney, ACCOUNT_META } from '../lib/format.js'
import { decodeBuffer } from '../lib/csv.js'

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
    const text = decodeBuffer(await file.arrayBuffer())
    const res = importFromText(text)
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
function newCategory() { catForm.value = { id: '', name: '', icon: '📌', kind: catKind.value, keywords: [] } }
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
      <span class="row-line__icon">{{ ACCOUNT_META[a.type]?.icon || '📦' }}</span>
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
      <span class="row-line__icon">{{ c.icon }}</span>
      <span class="row-line__body">
        <b>{{ c.name }}</b>
        <small>{{ c.keywords?.length ? c.keywords.slice(0, 6).join(' / ') + (c.keywords.length > 6 ? ' …' : '') : '无自动归类关键词' }}</small>
      </span>
      <button class="btn btn--ghost btn--sm" @click="catForm = { ...c, keywords: [...(c.keywords || [])] }">编辑</button>
    </div>
    <button class="btn upload-block" @click="newCategory">＋ 新增分类</button>
  </section>

  <!-- 数据管理 -->
  <div class="sec-title">数据</div>
  <section class="card">
    <div class="row wrap">
      <button class="btn" @click="downloadExport">导出备份 JSON</button>
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
    <button class="btn" :class="{ 'btn--on': store.settings.theme === 'dark' }" @click="setTheme('dark')">🌙 夜墨</button>
    <button class="btn" :class="{ 'btn--on': store.settings.theme === 'light' }" @click="setTheme('light')">☀️ 宣纸</button>
  </section>

  <p class="about serif">墨账 InkLedger · v1.0 · 静态部署 · 数据自持</p>

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
            <option v-for="(m, k) in ACCOUNT_META" :key="k" :value="k">{{ m.icon }} {{ m.label }}</option>
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

  <!-- 分类编辑弹层 -->
  <Teleport to="body">
    <div v-if="catForm" class="overlay" @click.self="catForm = null">
      <div class="sheet">
        <h3 class="sheet__title">{{ catForm.id ? '编辑分类' : '新增分类' }}
          <button class="sheet__close" @click="catForm = null">✕</button></h3>
        <div class="row">
          <label class="field" style="width: 90px"><span class="field__label">图标</span>
            <input v-model="catForm.icon" class="input" style="text-align: center; font-size: 18px" /></label>
          <label class="field" style="flex: 1"><span class="field__label">名称</span>
            <input v-model="catForm.name" class="input" placeholder="如：宠物" /></label>
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

.btn--on { border-color: var(--gold-line); color: var(--gold); background: var(--gold-soft); }
.about { text-align: center; color: var(--text-faint); font-size: 13px; letter-spacing: 3px; margin: 34px 0 6px; }
</style>

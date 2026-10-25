/**
 * 全局状态：本地优先（localStorage），可同步到 GitHub 私有仓库
 */
import { reactive, watch } from 'vue'
import { uid, toLocalISO, monthKey, nowDateKey, addDays, addMonths, advanceCycle, CYCLES } from './lib/format.js'
import { monthDistance } from './lib/budget.js'
import { importBill, importRows } from './lib/importer.js'
import { getUser, ensureRepo, readData, writeData } from './lib/github.js'

const KEY = 'inkledger:v1'

/* —— 默认账户：按消费来源 —— */
const seedAccounts = [
  { id: 'acc-wechat', name: '微信零钱', type: 'wechat', initialBalance: 0, importGeneric: true },
  { id: 'acc-alipay', name: '支付宝余额', type: 'alipay', initialBalance: 0, importGeneric: true },
  { id: 'acc-cash', name: '现金', type: 'cash', initialBalance: 0 },
  { id: 'acc-bank', name: '银行卡', type: 'bank', initialBalance: 0 }
].map((a) => ({ ...a, createdAt: Date.now(), updatedAt: Date.now() }))

/* —— 默认分类:keywords 用于账单导入自动归类;icon 为图标注册表键(lib/icons.js) —— */
const seedCategories = [
  ['餐饮', ':food', 'expense', ['美团', '饿了么', '肯德基', '麦当劳', '星巴克', '瑞幸', '餐厅', '面馆', '外卖', '烧烤', '奶茶', '蜜雪', '喜茶', '食品', '食堂', '饭店']],
  ['交通出行', ':transport', 'expense', ['地铁', '公交', '滴滴', '打车', '出租车', '12306', '铁路', '航空', '机票', '高德', '哈啰', '单车', '加油', '停车']],
  ['购物', ':shopping', 'expense', ['淘宝', '天猫', '京东', '拼多多', '苏宁', '唯品会', '超市', '便利店', '711', '全家', '罗森']],
  ['水果生鲜', ':grocery', 'expense', ['买菜', '水果', '生鲜', '叮咚', '盒马', '山姆', '朴朴']],
  ['日用家居', ':household', 'expense', ['日用', '家居', '百货', '保洁', '收纳']],
  ['居住水电', ':housing', 'expense', ['房租', '水费', '电费', '燃气', '物业', '暖气', '宽带', '水电']],
  ['通讯', ':telecom', 'expense', ['话费', '移动', '联通', '电信', '流量', '运营商']],
  ['娱乐影音', ':media', 'expense', ['游戏', 'Steam', '视频会员', '爱奇艺', '腾讯视频', '优酷', 'B站', '哔哩', '电影', '猫眼', '淘票票', 'KTV', '网抑', '网易云']],
  ['数字服务', ':digital', 'expense', ['会员', '订阅', '云服务', 'Apple', 'App Store', '软件', '域名', '服务器']],
  ['服饰美容', ':fashion', 'expense', ['优衣库', 'ZARA', '衣服', '服饰', '美妆', '理发', '护肤', '洗剪吹']],
  ['医疗健康', ':health', 'expense', ['药房', '药店', '医院', '挂号', '体检', '诊所', '医药']],
  ['教育学习', ':education', 'expense', ['教育', '课程', '培训', '书本', '考试', '书店']],
  ['人情往来', ':gifting', 'expense', ['红包', '转账', '份子', '礼物', '随礼']],
  ['宠物', ':pet', 'expense', ['宠物', '猫', '狗', '宠物医院', '猫粮', '狗粮']],
  ['旅行', ':travel', 'expense', ['酒店', '民宿', '旅行', '旅游', '携程', '去哪儿', '飞猪', '景区']],
  ['其他支出', ':other', 'expense', []],
  ['工资薪酬', ':salary', 'income', ['工资', '薪酬', '薪水', '月薪', '奖金', '年终奖']],
  ['兼职外快', ':sidegig', 'income', ['兼职', '外快', '稿费', '劳务']],
  ['理财收益', ':invest', 'income', ['利息', '收益', '分红', '理财', '基金', '股票', '余额宝']],
  ['收到的红包', ':redpacket', 'income', ['红包', '亲属卡', '转账']],
  ['退款返还', ':refund', 'income', ['退款', '退货', '返现', '报销']],
  ['其他收入', ':other', 'income', []]
].map(([name, icon, kind, keywords], i) => ({
  id: `cat-${kind}-${i}`,
  name, icon, kind, keywords,
  isFallback: name.startsWith('其他'),
  createdAt: Date.now(),
  updatedAt: Date.now()
}))

/* 旧版默认 emoji 图标 → 线性图标键:仅当用户未改动过该分类图标时静默升级 */
const ICON_UPGRADE = {
  '餐饮': ['🍜', ':food'], '交通出行': ['🚇', ':transport'], '购物': ['🛒', ':shopping'],
  '水果生鲜': ['🥬', ':grocery'], '日用家居': ['🧻', ':household'], '居住水电': ['🏠', ':housing'],
  '通讯': ['📱', ':telecom'], '娱乐影音': ['🎮', ':media'], '数字服务': ['☁️', ':digital'],
  '服饰美容': ['👔', ':fashion'], '医疗健康': ['💊', ':health'], '教育学习': ['📚', ':education'],
  '人情往来': ['🧧', ':gifting'], '宠物': ['🐾', ':pet'], '旅行': ['🧳', ':travel'],
  '其他支出': ['📌', ':other'], '工资薪酬': ['💰', ':salary'], '兼职外快': ['🧰', ':sidegig'],
  '理财收益': ['📈', ':invest'], '收到的红包': ['🧧', ':redpacket'], '退款返还': ['↩️', ':refund'],
  '其他收入': ['📌', ':other']
}

function upgradeIcons(categories = []) {
  for (const c of categories) {
    const pair = ICON_UPGRADE[c.name]
    if (pair && c.icon === pair[0]) c.icon = pair[1]
  }
  return categories
}

function defaultState() {
  return {
    txs: [],
    accounts: JSON.parse(JSON.stringify(seedAccounts)),
    categories: JSON.parse(JSON.stringify(seedCategories)),
    budgets: [],
    recurring: [],
    goals: [],
    settings: {
      theme: 'dark',
      github: { token: '', login: '', repo: '' },
      lastSync: null
    }
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultState()
    const saved = JSON.parse(raw)
    const base = defaultState()
    return {
      txs: saved.txs || [],
      accounts: saved.accounts?.length ? saved.accounts : base.accounts,
      categories: saved.categories?.length ? upgradeIcons(saved.categories) : base.categories,
      budgets: Array.isArray(saved.budgets) ? saved.budgets : [],
      recurring: Array.isArray(saved.recurring) ? saved.recurring : [],
      goals: Array.isArray(saved.goals) ? saved.goals : [],
      settings: { ...base.settings, ...saved.settings, github: { ...base.settings.github, ...saved.settings?.github } }
    }
  } catch {
    return defaultState()
  }
}

export const store = reactive({ ...load() })

export function persist() {
  localStorage.setItem(KEY, JSON.stringify({
    txs: store.txs,
    accounts: store.accounts,
    categories: store.categories,
    budgets: store.budgets,
    recurring: store.recurring,
    goals: store.goals,
    settings: store.settings
  }))
}
watch(store, persist, { deep: true })

/* —— 轻提示 —— */
export const toast = reactive({ msg: '', ts: 0 })
let toastTimer = null
export function showToast(msg) {
  toast.msg = msg
  toast.ts = Date.now()
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.msg = ''), 2600)
}

/* —— 交易 —— */
export function addTx(tx) {
  store.txs.push({ ...tx, id: tx.id || uid(), updatedAt: Date.now() })
}
export function updateTx(id, patch) {
  const t = store.txs.find((t) => t.id === id)
  if (t) Object.assign(t, patch, { updatedAt: Date.now() })
}
export function removeTx(id) {
  store.txs = store.txs.filter((t) => t.id !== id)
}
export function existingSourceKeys() {
  return new Set(store.txs.map((t) => t.sourceKey).filter(Boolean))
}

/* —— 账户 —— */
export function upsertAccount(acc) {
  const i = store.accounts.findIndex((a) => a.id === acc.id)
  const item = { ...acc, updatedAt: Date.now() }
  if (i >= 0) store.accounts[i] = item
  else store.accounts.push({ ...item, id: acc.id || uid(), createdAt: Date.now() })
}
export function removeAccount(id) {
  if (store.txs.some((t) => t.accountId === id)) {
    showToast('该账户下仍有账目，无法删除')
    return false
  }
  store.accounts = store.accounts.filter((a) => a.id !== id)
  return true
}

/* —— 分类 —— */
export function upsertCategory(cat) {
  const i = store.categories.findIndex((c) => c.id === cat.id)
  const item = { ...cat, updatedAt: Date.now() }
  if (i >= 0) store.categories[i] = item
  else store.categories.push({ ...item, id: cat.id || uid(), createdAt: Date.now() })
}
export function removeCategory(id) {
  if (store.txs.some((t) => t.categoryId === id)) {
    showToast('该分类下仍有账目，无法删除')
    return false
  }
  store.categories = store.categories.filter((c) => c.id !== id)
  store.budgets = store.budgets.filter((b) => b.id !== id)
  return true
}/* —— 预算:分类月度预算(b.id 即 categoryId,amount 为每月额度) —— */
export function setBudget(categoryId, amount) {
  const v = Math.max(0, Math.round((Number(amount) || 0) * 100) / 100)
  const i = store.budgets.findIndex((b) => b.id === categoryId)
  if (!v) {
    if (i >= 0) store.budgets.splice(i, 1)
    return
  }
  const prev = i >= 0 ? store.budgets[i] : {}
  // 保留 carryover/startMonth 等扩展字段,改额度不重置结转基线
  const item = { ...prev, id: categoryId, amount: v, updatedAt: Date.now() }
  if (i >= 0) store.budgets[i] = item
  else store.budgets.push(item)
}
/** 信封结转开关:启用即以当月为基线;停用回到单月口径 */
export function toggleCarryover(categoryId, on) {
  const b = store.budgets.find((x) => x.id === categoryId)
  if (!b) return
  if (on) {
    b.carryover = true
    b.startMonth = monthKey(nowDateKey())
  } else {
    delete b.carryover
    delete b.startMonth
  }
  b.updatedAt = Date.now()
}
export const budgetOf = (categoryId) => store.budgets.find((b) => b.id === categoryId)?.amount || 0

/** 某月各分类预算执行情况(信封口径见 lib/budget.js;按剩余比例升序,最紧张的在前) */
export function budgetStatus(mKey) {
  // 先按 分类 聚合当月支出,避免三层循环
  const spentBy = new Map()
  for (const t of txsOfMonth(mKey)) {
    if (t.type !== 'expense' || !t.categoryId) continue
    if (!spentBy.has(t.categoryId)) spentBy.set(t.categoryId, 0)
    spentBy.set(t.categoryId, spentBy.get(t.categoryId) + t.amount)
  }
  // 窗口累计(信封用):分类 → Map(月 → 支出),一次遍历全部账目
  const windowSpent = new Map()
  for (const b of store.budgets) {
    if (b.carryover && b.startMonth) {
      const cat = categoryById(b.id)
      if (cat && cat.kind === 'expense') windowSpent.set(b.id, new Map())
    }
  }
  if (windowSpent.size) {
    for (const t of store.txs) {
      if (t.type !== 'expense' || !t.categoryId) continue
      const map = windowSpent.get(t.categoryId)
      if (!map) continue
      const b = store.budgets.find((x) => x.id === t.categoryId)
      if (!b?.startMonth || monthKey(t.date) < b.startMonth) continue
      const m = monthKey(t.date)
      map.set(m, (map.get(m) || 0) + t.amount)
    }
  }
  const rows = []
  for (const b of store.budgets) {
    const cat = categoryById(b.id)
    if (!cat || cat.kind !== 'expense') continue
    const spentM = spentBy.get(b.id) || 0
    let eff
    if (b.carryover && b.startMonth) {
      const map = windowSpent.get(b.id) || new Map()
      // 与 lib/budget.js 的 envelopeOf 同口径:窗口内逐月累计 + 当月
      const months = monthDistance(b.startMonth, mKey)
      if (months <= 1) {
        eff = { budget: b.amount, spent: spentM, months: 1 }
      } else {
        let windowSpentSum = 0
        let cur = b.startMonth
        for (let i = 0; i < months - 1; i++) {
          windowSpentSum += map.get(cur) || 0
          cur = addMonths(cur, 1)
        }
        eff = { budget: b.amount * months, spent: windowSpentSum + spentM, months }
      }
    } else {
      eff = { budget: b.amount, spent: spentM, months: 1 }
    }
    rows.push({
      categoryId: b.id, name: cat.name, icon: cat.icon,
      budget: eff.budget, spent: eff.spent, remain: eff.budget - eff.spent,
      carryover: !!(b.carryover && b.startMonth) && eff.months > 1
    })
  }
  // 按剩余比例升序;额度为 0 的脏数据兜底排最后
  return rows.sort((a, b) => (a.budget > 0 ? a.remain / a.budget : 1) - (b.budget > 0 ? b.remain / b.budget : 1))
}

/* —— 周期账单/订阅:cycle 为 monthly | quarterly | yearly,nextDate 为 'YYYY-MM-DD' —— */
export function upsertRecurring(r) {
  const i = store.recurring.findIndex((x) => x.id === r.id)
  const item = { active: true, ...r, updatedAt: Date.now() }
  if (i >= 0) store.recurring[i] = item
  else store.recurring.push({ ...item, id: r.id || uid(), createdAt: Date.now() })
}
export function removeRecurring(id) {
  store.recurring = store.recurring.filter((r) => r.id !== id)
}

/** 待缴账单:active 且 30 天内到期(含逾期),按到期日排序 */
export function upcomingBills(days = 30) {
  const today = nowDateKey()
  return store.recurring
    .filter((r) => r.active && r.nextDate <= addDays(today, days))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
}

/** 活跃周期账单折算的每月固定支出 */
export function monthlyFixed() {
  let sum = 0
  for (const r of store.recurring) {
    if (!r.active) continue
    sum += r.amount * (CYCLES[r.cycle]?.perMonth || 1)
  }
  return Math.round(sum * 100) / 100
}

/** 一键缴账:入账一笔并推进 nextDate(顺带追平逾期周期) */
export function payRecurring(id) {
  const r = store.recurring.find((x) => x.id === id)
  if (!r) return null
  const cat = categoryById(r.categoryId) || store.categories.find((c) => c.isFallback && c.kind === 'expense')
  const acc = accountById(r.accountId) || store.accounts[0]
  const tx = {
    id: uid(),
    type: 'expense',
    amount: r.amount,
    categoryId: cat?.id || null,
    accountId: acc?.id || null,
    date: toLocalISO(),
    payee: r.name,
    note: '周期账单',
    tags: [],
    source: 'recurring',
    updatedAt: Date.now()
  }
  store.txs.push(tx)
  let next = r.nextDate
  while (next <= nowDateKey()) next = advanceCycle(next, r.cycle)
  r.nextDate = next
  r.updatedAt = Date.now()
  return tx
}

/* —— 储蓄目标:纯进度追踪,不计入账户余额与总资产 —— */
export function upsertGoal(g) {
  const i = store.goals.findIndex((x) => x.id === g.id)
  const item = {
    ...g,
    target: Math.max(0, Math.round((Number(g.target) || 0) * 100) / 100),
    saved: Math.max(0, Math.round((Number(g.saved) || 0) * 100) / 100),
    updatedAt: Date.now()
  }
  if (i >= 0) store.goals[i] = item
  else store.goals.push({ ...item, id: g.id || uid(), createdAt: Date.now() })
}
export function removeGoal(id) {
  store.goals = store.goals.filter((g) => g.id !== id)
}
/** 存入:仅累加目标进度,不影响账户余额;仅接受正数 */
export function contributeGoal(id, amount) {
  const g = store.goals.find((x) => x.id === id)
  if (!g) return null
  const v = Math.round((Number(amount) || 0) * 100) / 100
  if (!(v > 0)) return null
  g.saved = Math.round(((Number(g.saved) || 0) + v) * 100) / 100
  g.updatedAt = Date.now()
  return g
}

/** 标签排行:当月支出按标签聚合(一笔多标签分别计入);含笔数 */
export function tagsOfMonth(mKey) {
  const map = new Map()
  for (const t of txsOfMonth(mKey)) {
    if (t.type !== 'expense') continue
    const tags = (t.tags || []).map((s) => String(s).trim()).filter(Boolean)
    if (!tags.length) continue
    for (const tag of tags) {
      if (!map.has(tag)) map.set(tag, { amount: 0, count: 0 })
      map.get(tag).amount += t.amount
      map.get(tag).count += 1
    }
  }
  return [...map.entries()].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.amount - a.amount)
}

/** 全库标签频次(标签输入自动补全用,Top N) */
export function allTags(topN = 30) {
  const freq = new Map()
  for (const t of store.txs) {
    for (const tag of (t.tags || []).map((s) => String(s).trim()).filter(Boolean)) {
      freq.set(tag, (freq.get(tag) || 0) + 1)
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([tag]) => tag)
}

/* —— 查询 —— */
export const accountById = (id) => store.accounts.find((a) => a.id === id)
export const categoryById = (id) => store.categories.find((c) => c.id === id)

export function txsOfMonth(mKey) {
  return store.txs.filter((t) => monthKey(t.date) === mKey)
}

export function monthSummary(mKey) {
  let income = 0, expense = 0
  for (const t of txsOfMonth(mKey)) {
    if (t.type === 'income') income += t.amount
    else if (t.type === 'expense') expense += t.amount
  }
  return { income, expense, net: income - expense }
}

/** 账户余额 = 初始 + 收入 - 支出 + 转入 - 转出 */
export function balanceOf(accountId) {
  const acc = accountById(accountId)
  if (!acc) return 0
  let v = Number(acc.initialBalance) || 0
  for (const t of store.txs) {
    if (t.type === 'income' && t.accountId === accountId) v += t.amount
    else if (t.type === 'expense' && t.accountId === accountId) v -= t.amount
    else if (t.type === 'transfer') {
      if (t.accountId === accountId) v -= t.amount
      else if (t.toAccountId === accountId) v += t.amount
    }
  }
  return v
}

/* —— 账单导入 —— */
export function importFromText(text) {
  const res = importBill(text, {
    accounts: store.accounts,
    categories: store.categories,
    existingKeys: existingSourceKeys()
  })
  for (const a of res.createdAccounts) store.accounts.push(a)
  store.txs.push(...res.txs)
  return res
}

/** xlsx 等结构化行数组的导入入口 */
export function importFromRows(rows) {
  const res = importRows(rows, {
    accounts: store.accounts,
    categories: store.categories,
    existingKeys: existingSourceKeys()
  })
  for (const a of res.createdAccounts) store.accounts.push(a)
  store.txs.push(...res.txs)
  return res
}

/* —— 数据管理 —— */
export function exportJSON() {
  return JSON.stringify({
    app: 'inkledger', version: 1, exportedAt: new Date().toISOString(),
    txs: store.txs, accounts: store.accounts, categories: store.categories,
    budgets: store.budgets, recurring: store.recurring, goals: store.goals
  }, null, 2)
}
export function importJSON(text) {
  const data = JSON.parse(text)
  if (!Array.isArray(data.txs) || !Array.isArray(data.accounts)) throw new Error('文件格式不正确')
  store.txs = data.txs
  store.accounts = data.accounts
  store.categories = data.categories?.length ? data.categories : defaultState().categories
  store.budgets = (Array.isArray(data.budgets) ? data.budgets : []).filter((b) => Number(b?.amount) > 0)
  store.recurring = Array.isArray(data.recurring) ? data.recurring : []
  store.goals = Array.isArray(data.goals) ? data.goals : []
  showToast('数据已导入')
}
export function clearAll() {
  const base = defaultState()
  store.txs = []
  store.accounts = base.accounts
  store.categories = base.categories
  store.budgets = []
  store.recurring = []
  store.goals = []
  showToast('已清空全部账目')
}

/* —— 合并（同步用）：按 id 合并，updatedAt 新者胜 —— */
export function mergeCloud(local, cloud) {
  if (!cloud) return {
    txs: local.txs, accounts: local.accounts, categories: local.categories,
    budgets: local.budgets || [], recurring: local.recurring || [], goals: local.goals || []
  }
  const mergeArr = (a = [], b = []) => {
    const map = new Map()
    for (const item of [...a, ...b]) {
      const prev = map.get(item.id)
      if (!prev || (item.updatedAt || 0) >= (prev.updatedAt || 0)) map.set(item.id, item)
    }
    return [...map.values()]
  }
  return {
    txs: mergeArr(local.txs, cloud.txs),
    accounts: mergeArr(local.accounts, cloud.accounts),
    categories: mergeArr(local.categories, cloud.categories),
    budgets: mergeArr(local.budgets || [], cloud.budgets || []),
    recurring: mergeArr(local.recurring || [], cloud.recurring || []),
    goals: mergeArr(local.goals || [], cloud.goals || [])
  }
}

/* —— GitHub 同步 —— */
export function defaultRepoName(login) {
  return `${login}-inkledger-data`
}

export async function syncToGitHub() {
  const { token, login, repo } = store.settings.github
  if (!token) throw new Error('请先在设置中填写 GitHub Token')
  const who = await getUser(token)
  const owner = login || who.login
  const repoName = repo || defaultRepoName(owner)
  await ensureRepo(token, owner, repoName)

  const cloud = await readData(token, owner, repoName)
  const merged = mergeCloud(
    { txs: store.txs, accounts: store.accounts, categories: store.categories, budgets: store.budgets, recurring: store.recurring, goals: store.goals },
    cloud.data
  )
  store.txs = merged.txs
  store.accounts = merged.accounts
  store.categories = merged.categories
  store.budgets = merged.budgets
  store.recurring = merged.recurring
  store.goals = merged.goals

  await writeData(token, owner, repoName, {
    app: 'inkledger', version: 1, syncedAt: new Date().toISOString(),
    txs: merged.txs, accounts: merged.accounts, categories: merged.categories,
    budgets: merged.budgets, recurring: merged.recurring, goals: merged.goals
  }, cloud.sha)

  store.settings.github = { token, login: owner, repo: repoName }
  store.settings.lastSync = new Date().toISOString()
  return { login: owner, repo: repoName, created: !!cloud.data }
}

/* —— 示例数据（演示用） —— */
export function loadSample() {
  const cat = (name) => store.categories.find((c) => c.name === name)?.id
  const acc = (name) => store.accounts.find((a) => a.name === name)?.id
  const payees = {
    '餐饮': [['美团平台商户', '午餐'], ['瑞幸咖啡', '生椰拿铁'], ['麦当劳', '套餐']],
    '交通出行': [['地铁乘车码', '通勤'], ['滴滴出行', '快车']],
    '购物': [['京东平台商户', '日用品'], ['拼多多商户', '收纳盒']],
    '水果生鲜': [['盒马鲜生', '水果']],
    '娱乐影音': [['哔哩哔哩', '大会员'], ['猫眼电影', '电影票']],
    '居住水电': [['国家电网', '电费'], ['自来水公司', '水费']]
  }
  const txs = []
  const now = new Date()
  for (let m = 2; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const days = m === 0 ? now.getDate() : 28
    for (let day = 1; day <= days; day += 1) {
      if (Math.random() < 0.55) {
        const cName = Object.keys(payees)[Math.floor(Math.random() * Object.keys(payees).length)]
        const [payee, item] = payees[cName][Math.floor(Math.random() * payees[cName].length)]
        const dt = new Date(d.getFullYear(), d.getMonth(), day, 9 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60))
        if (dt > now) continue
        txs.push({
          id: uid(),
          type: 'expense',
          amount: Math.round((5 + Math.random() * 160) * 100) / 100,
          categoryId: cat(cName),
          accountId: Math.random() < 0.6 ? acc('微信零钱') : acc('支付宝余额'),
          date: toLocalISO(dt),
          payee, note: item, tags: ['示例'],
          source: 'manual', updatedAt: Date.now()
        })
      }
    }
    // 每月工资
    txs.push({
      id: uid(), type: 'income', amount: 18500,
      categoryId: cat('工资薪酬'), accountId: acc('银行卡'),
      date: toLocalISO(new Date(d.getFullYear(), d.getMonth(), 10, 10, 0)),
      payee: '工资', note: '月薪', tags: ['示例'], source: 'manual', updatedAt: Date.now()
    })
  }
  store.txs.push(...txs)
  // 演示预算:让首页预算卡片有内容可看
  const demoBudgets = { '餐饮': 1200, '交通出行': 300, '购物': 500, '居住水电': 600, '娱乐影音': 200 }
  for (const [name, amount] of Object.entries(demoBudgets)) {
    const id = store.categories.find((c) => c.name === name)?.id
    if (id) setBudget(id, amount)
  }
  // 演示周期账单:相对今天错开,保证近期总有待缴项
  const demoRecurring = [
    ['视频会员', 25, 'monthly', '娱乐影音', 2],
    ['手机话费', 39, 'monthly', '通讯', 9],
    ['云服务器', 138, 'yearly', '数字服务', 21]
  ]
  for (const [name, amount, cycle, catName, inDays] of demoRecurring) {
    upsertRecurring({
      id: uid(), name, amount, cycle, active: true,
      categoryId: store.categories.find((c) => c.name === catName)?.id || null,
      accountId: acc('微信零钱') || store.accounts[0]?.id,
      nextDate: addDays(nowDateKey(), inDays)
    })
  }
  // 演示储蓄目标
  upsertGoal({ id: uid(), name: '旅行基金', target: 8000, saved: 5200, deadline: addMonths(monthKey(nowDateKey()), 5) + '-01' })
  upsertGoal({ id: uid(), name: '新手机', target: 6000, saved: 1500, deadline: addMonths(monthKey(nowDateKey()), 8) + '-01' })
  showToast(`已生成 ${txs.length} 笔示例账目，可在设置中一键清空`)
}

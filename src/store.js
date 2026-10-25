/**
 * 全局状态：本地优先（localStorage），可同步到 GitHub 私有仓库
 */
import { reactive, watch } from 'vue'
import { uid, toLocalISO, monthKey } from './lib/format.js'
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
  return true
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
    txs: store.txs, accounts: store.accounts, categories: store.categories
  }, null, 2)
}
export function importJSON(text) {
  const data = JSON.parse(text)
  if (!Array.isArray(data.txs) || !Array.isArray(data.accounts)) throw new Error('文件格式不正确')
  store.txs = data.txs
  store.accounts = data.accounts
  store.categories = data.categories?.length ? data.categories : defaultState().categories
  showToast('数据已导入')
}
export function clearAll() {
  const base = defaultState()
  store.txs = []
  store.accounts = base.accounts
  store.categories = base.categories
  showToast('已清空全部账目')
}

/* —— 合并（同步用）：按 id 合并，updatedAt 新者胜 —— */
export function mergeCloud(local, cloud) {
  if (!cloud) return { txs: local.txs, accounts: local.accounts, categories: local.categories }
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
    categories: mergeArr(local.categories, cloud.categories)
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
    { txs: store.txs, accounts: store.accounts, categories: store.categories },
    cloud.data
  )
  store.txs = merged.txs
  store.accounts = merged.accounts
  store.categories = merged.categories

  await writeData(token, owner, repoName, {
    app: 'inkledger', version: 1, syncedAt: new Date().toISOString(),
    txs: merged.txs, accounts: merged.accounts, categories: merged.categories
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
  showToast(`已生成 ${txs.length} 笔示例账目，可在设置中一键清空`)
}

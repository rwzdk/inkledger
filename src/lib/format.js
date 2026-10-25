/** 通用格式化与小工具 */

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 本地时间 → 'YYYY-MM-DDTHH:mm'（避免 UTC 偏移问题） */
export function toLocalISO(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function nowDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 'YYYY-MM-DDT..' → 'MM月DD日' */
export function fmtDay(iso) {
  return iso.slice(5, 7) + '月' + iso.slice(8, 10) + '日'
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六']
export function weekLabel(iso) {
  const d = new Date(iso.length <= 10 ? iso + 'T00:00' : iso)
  return '周' + (WEEK[d.getDay()] ?? '')
}

/** 'YYYY-MM-DDT..' → 'YYYY-MM' */
export const monthKey = (iso) => iso.slice(0, 7)

/** 相对月份偏移，如 addMonths('2026-01', -1) → '2025-12' */
export function addMonths(key, delta) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export function monthLabel(key) {
  const [y, m] = key.split('-')
  return `${y}年${Number(m)}月`
}

export function monthRange(key) {
  const [y, m] = key.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 1)
  const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return [fmt(start), fmt(end)]
}

/** 'YYYY-MM-DD' 偏移 N 天 → 'YYYY-MM-DD' */
export function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}

/** 距今天数:今天为 0,过去为负 */
export function daysFromToday(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((new Date(y, m - 1, d) - today) / 86400000)
}

/** 周期账单的下次扣费日:保持日号,月末自动收敛(如 31 → 28/29/30) */
export function advanceCycle(dateKey, cycle) {
  const months = cycle === 'yearly' ? 12 : cycle === 'quarterly' ? 3 : 1
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(y, m - 1 + months, 1)
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate()
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(Math.min(d, lastDay))}`
}

/** 周期元信息 */
export const CYCLES = {
  monthly: { label: '每月', perMonth: 1 },
  quarterly: { label: '每季', perMonth: 1 / 3 },
  yearly: { label: '每年', perMonth: 1 / 12 }
}

/** 临近账单日文案 */
export function dueLabel(dateKey) {
  const n = daysFromToday(dateKey)
  if (n === 0) return '今天'
  if (n === 1) return '明天'
  if (n === 2) return '后天'
  if (n < 0) return `逾期${-n}天`
  return `${n}天后`
}

/** 金额显示：千分位 + 两位小数 */
export function fmtMoney(n, { sign = '' } = {}) {
  const v = Math.abs(Number(n) || 0)
  const s = v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (n < 0 ? '-' : sign) + s
}

export const fmtPct = (n) => `${(n * 100).toFixed(1)}%`

/** 账户类型 → 展示信息(icon 为图标注册表键,见 lib/icons.js) */
export const ACCOUNT_META = {
  wechat: { icon: ':wechat', label: '微信' },
  alipay: { icon: ':alipay', label: '支付宝' },
  cash: { icon: ':cash', label: '现金' },
  bank: { icon: ':bank', label: '银行卡' },
  credit: { icon: ':credit', label: '信用卡' },
  other: { icon: ':acc-other', label: '其他' }
}

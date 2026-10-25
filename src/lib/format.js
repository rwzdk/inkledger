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

/** 金额显示：千分位 + 两位小数 */
export function fmtMoney(n, { sign = '' } = {}) {
  const v = Math.abs(Number(n) || 0)
  const s = v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (n < 0 ? '-' : sign) + s
}

export const fmtPct = (n) => `${(n * 100).toFixed(1)}%`

/** 账户类型 → 展示信息 */
export const ACCOUNT_META = {
  wechat: { icon: '💬', label: '微信' },
  alipay: { icon: '🅰️', label: '支付宝' },
  cash: { icon: '💵', label: '现金' },
  bank: { icon: '🏦', label: '银行卡' },
  credit: { icon: '💳', label: '信用卡' },
  other: { icon: '📦', label: '其他' }
}

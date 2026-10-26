/**
 * 微信 / 支付宝账单 CSV 导入与自动归类
 * 纯函数实现，便于测试；不依赖 Vue
 */
import { parseCSV } from './csv.js'
import { uid } from './format.js'
import { applyRules } from './rules.js'

const idxOf = (headers, ...names) => {
  for (const n of names) {
    const i = headers.findIndex((h) => h.trim() === n || h.trim().includes(n))
    if (i >= 0) return i
  }
  return -1
}

const cleanAmount = (s) => {
  const n = parseFloat(String(s).replace(/[¥￥$,，\s]/g, ''))
  return Number.isFinite(n) ? Math.abs(n) : NaN
}

/** 从表格中定位表头行（首列为「交易时间」），返回 {platform, headers, rows} */
export function detectBill(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const first = (rows[i][0] || '').trim()
    if (first !== '交易时间') continue
    const headers = rows[i].map((h) => (h || '').trim())
    if (headers.some((h) => h.includes('支付方式'))) return { platform: 'wechat', headers, rows: rows.slice(i + 1) }
    if (headers.some((h) => h.includes('收/付款方式'))) return { platform: 'alipay', headers, rows: rows.slice(i + 1) }
  }
  return null
}

/** 单元格清洗：去空白；微信/支付宝导出用 "/" 表示空 */
const cleanCell = (s) => {
  const v = String(s ?? '').trim()
  return v === '/' ? '' : v
}

/** Excel 序列日期（如 46296.8853）→ 'YYYY-MM-DD HH:mm:ss'（按 UTC 取位避免时区漂移） */
export function excelSerialToTime(serial) {
  const d = new Date(Math.round((Number(serial) - 25569) * 86400000))
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

const normTimeCell = (v) => (/^\d+(\.\d+)?$/.test(v) ? excelSerialToTime(v) : v)

/** 表格行 → 统一结构的原始账单 */
function normalizeRow(platform, headers, row) {
  const get = (row, idx) => cleanCell(row[idx])
  if (platform === 'wechat') {
    return {
      time: normTimeCell(get(row, idxOf(headers, '交易时间'))),
      type: get(row, idxOf(headers, '交易类型')),
      payee: get(row, idxOf(headers, '交易对方')),
      item: get(row, idxOf(headers, '商品')),
      direction: get(row, idxOf(headers, '收/支')),
      amount: cleanAmount(row[idxOf(headers, '金额')] || ''),
      // 部分收入（如红包）支付方式为空，实际入账零钱
      method: get(row, idxOf(headers, '支付方式')) || '零钱',
      status: get(row, idxOf(headers, '当前状态')),
      orderNo: get(row, idxOf(headers, '交易单号'))
    }
  }
  return {
    time: normTimeCell(get(row, idxOf(headers, '交易时间'))),
    type: get(row, idxOf(headers, '交易分类')),
    payee: get(row, idxOf(headers, '交易对方')),
    item: get(row, idxOf(headers, '商品说明')),
    direction: get(row, idxOf(headers, '收/支')),
    amount: cleanAmount(row[idxOf(headers, '金额')] || ''),
    method: get(row, idxOf(headers, '收/付款方式')),
    status: get(row, idxOf(headers, '交易状态')),
    orderNo: get(row, idxOf(headers, '交易订单号'))
  }
}

/** 解析微信/支付宝导出的 CSV 文本 → 统一账单行 */
export function parseBill(text) {
  const rows = parseCSV(text)
  const bill = detectBill(rows)
  if (!bill) throw new Error('未识别出微信 / 支付宝账单表头（需要包含「交易时间」列的导出文件）')
  return {
    platform: bill.platform,
    records: bill.rows
      .map((r) => normalizeRow(bill.platform, bill.headers, r))
      .filter((r) => r.time && /^\d{4}-\d{2}-\d{2}/.test(r.time) && Number.isFinite(r.amount))
  }
}

const BANK_RE = /(储蓄卡|信用卡|银行卡|零钱通|余额宝|花呗|云闪付|数字人民币|银行)/

/** 泛化支付方式名 → 映射到已有默认账户（零钱 → 微信零钱） */
const GENERIC = { 零钱: 'wechat', 余额: 'alipay', 支付宝余额: 'alipay' }

function accountTypeOf(method) {
  if (method.includes('零钱')) return 'wechat'
  if (method.includes('支付宝') || method.includes('余额宝') || method.includes('花呗') || method === '余额') return 'alipay'
  if (method.includes('信用卡')) return 'credit'
  if (method.includes('储蓄卡') || method.includes('银行') || /\d{4}\)?$/.test(method)) return 'bank'
  return 'other'
}

/** 支付方式 → 账户；无法匹配时自动建账（来源自动归集） */
export function resolveAccount(method, accounts) {
  const name = (method || '').trim() || '未识别来源'
  const tail = (name.match(/(\d{4})\)?$/) || [])[1]

  // 同名账户直接用
  let acc = accounts.find((a) => a.name === name)
  if (acc) return { account: acc, created: false }
  // 银行卡尾号相同 → 视为同一账户
  if (tail) {
    acc = accounts.find((a) => {
      const t = (a.name.match(/(\d{4})\)?$/) || [])[1]
      return t === tail && ['bank', 'credit'].includes(a.type)
    })
    if (acc) return { account: acc, created: false }
  }
  if (GENERIC[name]) {
    acc = accounts.find((a) => a.type === GENERIC[name] && a.importGeneric)
    if (acc) return { account: acc, created: false }
  }
  if (!BANK_RE.test(name)) {
    // 其余泛化名称按类型映射到已有账户
    const type = accountTypeOf(name)
    acc = accounts.find((a) => a.type === type && a.importGeneric)
    if (acc) return { account: acc, created: false }
  }
  const created = {
    id: uid(),
    name,
    type: accountTypeOf(name),
    initialBalance: 0,
    importGeneric: ['零钱', '余额'].includes(name.replace(/（.*）/, '')),
    createdAt: Date.now()
  }
  return { account: created, created: true }
}

/** 关键词打分自动分类 */
export function autoCategory(payee, item, type, kind, categories) {
  const text = `${payee} ${item} ${type}`
  let best = null
  let bestScore = 0
  for (const c of categories) {
    if (c.kind !== kind || !c.keywords?.length) continue
    let score = 0
    for (const kw of c.keywords) {
      if (kw && text.includes(kw)) score += kw.length * 2
    }
    if (score > bestScore) { bestScore = score; best = c }
  }
  return best || categories.find((c) => c.kind === kind && c.isFallback)
}

/** 时间 '2026-10-01 12:30:11' → '2026-10-01T12:30' */
function normTime(t) {
  return t.replace(' ', 'T').slice(0, 16)
}

/**
 * 导入主入口（CSV 文本）
 * @param ctx {accounts, categories, existingKeys, rules?} 当前数据上下文;rules 为用户自定义归类规则,优先于关键词打分
 * @returns {txs, createdAccounts, skipped, platform}
 */
export function importBill(text, ctx) {
  return importRows(parseCSV(text), ctx)
}

/**
 * 导入主入口（二维行数组，xlsx 等结构化来源使用）
 */
export function importRows(rows, ctx) {
  const bill = detectBill(rows)
  if (!bill) throw new Error('未识别出微信 / 支付宝账单表头（需要包含「交易时间」列的导出文件）')
  const records = bill.rows
    .map((r) => normalizeRow(bill.platform, bill.headers, r))
    .filter((r) => r.time && /^\d{4}-\d{2}-\d{2}/.test(r.time) && Number.isFinite(r.amount))
  const accounts = [...ctx.accounts]
  const createdAccounts = []
  const txs = []
  let skipped = 0
  const platform = bill.platform

  for (const r of records) {
    const kind = r.direction === '收入' ? 'income' : r.direction === '支出' ? 'expense' : null
    if (!kind || r.amount <= 0) { skipped++; continue }

    const sourceKey = `${platform}:${r.orderNo || r.time + r.amount + r.payee}`
    if (ctx.existingKeys.has(sourceKey)) { skipped++; continue }

    const { account, created } = resolveAccount(r.method, accounts)
    if (created) { accounts.push(account); createdAccounts.push(account) }

    // 用户规则优先,未命中再走关键词打分
    const cat = applyRules(r.payee, r.item, r.type, kind, ctx.rules, ctx.categories)
      || autoCategory(r.payee, r.item, r.type, kind, ctx.categories)
    const refunded = r.status.includes('退款')

    txs.push({
      id: uid(),
      type: kind,
      amount: r.amount,
      categoryId: cat?.id || null,
      accountId: account.id,
      date: normTime(r.time),
      payee: r.payee || r.item,
      note: [r.item !== r.payee ? r.item : '', refunded ? '已退款' : ''].filter(Boolean).join(' · '),
      tags: [platform === 'wechat' ? '微信' : '支付宝'],
      source: platform,
      sourceKey,
      updatedAt: Date.now()
    })
  }
  return { txs, createdAccounts, skipped, platform }
}

/**
 * 净值推导 —— 纯计算,便于测试
 * 从账目按月重放各账户余额,生成月度净值点;当前时点与 balanceOf 完全同口径(全部账目、不按月末截断)。
 * 账户自其创建月(createdAt)起纳入;无 createdAt 的老账户从头纳入。
 * 空月不归零,结转上月余额。
 */
import { monthKey, addMonths } from './format.js'

function toEpochMonth(ms) {
  if (!ms) return null
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 重放截止某时刻的各账户余额;asOf 传 'YYYY-MM-DD' 按日期截断,传 null 计入全部(与 balanceOf 一致) */
export function replayBalances(txs, accounts, asOf = null) {
  const acc = new Map(accounts.map((a) => [a.id, Number(a.initialBalance) || 0]))
  for (const t of txs) {
    if (asOf && t.date.slice(0, 10) >= asOf) continue
    if (t.type === 'income' && acc.has(t.accountId)) acc.set(t.accountId, acc.get(t.accountId) + t.amount)
    else if (t.type === 'expense' && acc.has(t.accountId)) acc.set(t.accountId, acc.get(t.accountId) - t.amount)
    else if (t.type === 'transfer') {
      if (acc.has(t.accountId)) acc.set(t.accountId, acc.get(t.accountId) - t.amount)
      if (acc.has(t.toAccountId)) acc.set(t.toAccountId, acc.get(t.toAccountId) + t.amount)
    }
  }
  return acc
}

/** 月度净值序列:从最早的账户创建月/账目月到 endMonth(含) */
export function netWorthSeries(txs, accounts, endMonth) {
  const createdMonth = new Map(
    accounts.map((a) => [a.id, toEpochMonth(a.createdAt)])
  )
  // 起始月 = 最早账目月与最早账户创建月的较早者
  let start = null
  for (const t of txs) {
    const m = monthKey(t.date)
    if (!start || m < start) start = m
  }
  for (const m of createdMonth.values()) {
    if (m && (!start || m < start)) start = m
  }
  if (!start) start = endMonth

  // 初始余额:窗口起点已存在的账户直接带入;此后在各自创建月带入
  const balances = new Map(
    accounts.map((a) => {
      const cm = createdMonth.get(a.id)
      const atStart = !cm || cm <= start
      return [a.id, atStart ? Number(a.initialBalance) || 0 : 0]
    })
  )

  // 按月分桶账户增量
  const deltaByMonth = new Map()
  for (const t of txs) {
    const m = monthKey(t.date)
    if (!deltaByMonth.has(m)) deltaByMonth.set(m, [])
    deltaByMonth.get(m).push(t)
  }

  const points = []
  let cur = start
  let guard = 0
  while (cur <= endMonth && guard++ < 1200) {
    const txsThisMonth = deltaByMonth.get(cur) || []
    for (const t of txsThisMonth) {
      if (t.type === 'income' && balances.has(t.accountId)) balances.set(t.accountId, balances.get(t.accountId) + t.amount)
      else if (t.type === 'expense' && balances.has(t.accountId)) balances.set(t.accountId, balances.get(t.accountId) - t.amount)
      else if (t.type === 'transfer') {
        if (balances.has(t.accountId)) balances.set(t.accountId, balances.get(t.accountId) - t.amount)
        if (balances.has(t.toAccountId)) balances.set(t.toAccountId, balances.get(t.toAccountId) + t.amount)
      }
    }
    // 本月新纳入的账户:带入初始余额(窗口起点已带入的不再重复)
    for (const a of accounts) {
      const cm = createdMonth.get(a.id)
      if (cm === cur && cm > start) {
        balances.set(a.id, (balances.get(a.id) || 0) + (Number(a.initialBalance) || 0))
      }
    }
    let total = 0
    for (const a of accounts) {
      const cm = createdMonth.get(a.id)
      if (!cm || cm <= cur) total += balances.get(a.id) || 0
    }
    points.push({ month: cur, total: Math.round(total * 100) / 100 })
    cur = addMonths(cur, 1)
  }
  return points
}

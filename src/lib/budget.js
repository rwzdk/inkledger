/**
 * 信封式预算结转 —— 纯计算,便于测试
 * 信封口径:自基线月(startMonth)至目标月(mKey),每月额度累加,减去窗口内(基线月起至目标月)已花合计;
 * 目标月早于基线月时退回单月口径(信封 = 当月额度)。
 */

/** 基线月到目标月的月数(含两端);目标月早于基线月返回 0 */
export function monthDistance(startMonth, mKey) {
  const [sy, sm] = startMonth.split('-').map(Number)
  const [ty, tm] = mKey.split('-').map(Number)
  return (ty - sy) * 12 + (tm - sm) + 1
}

/**
 * 计算信封口径的执行情况
 * @param amount    每月额度
 * @param startMonth 结转基线月 'YYYY-MM'
 * @param mKey      目标月 'YYYY-MM'
 * @param spentOf   (monthKey) => 该月支出
 */
export function envelopeOf(amount, startMonth, mKey, spentOf) {
  const months = monthDistance(startMonth, mKey)
  if (months <= 1) {
    // 单月口径(含同月与目标月早于基线月两种情况)
    const spent = spentOf(mKey)
    return { envelope: amount, spent, remain: amount - spent, months: 1 }
  }
  let windowSpent = 0
  // 逐月累计基线月..目标月前一个月的支出
  let cur = startMonth
  for (let i = 0; i < months - 1; i++) {
    windowSpent += spentOf(cur)
    const [y, m] = cur.split('-').map(Number)
    const d = new Date(y, m - 1 + 1, 1)
    cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const spentM = spentOf(mKey)
  const envelope = amount * months
  const spent = windowSpent + spentM
  return { envelope, spent, remain: envelope - spent, months }
}

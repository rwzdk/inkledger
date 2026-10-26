/**
 * 自定义自动归类规则 —— 纯函数,便于测试
 * 规则按数组顺序生效:第一条 enabled 且命中的规则胜出;
 * 命中后仍需分类存在且 kind 与账单方向一致,否则视同未命中。
 */

/** 匹配文本与 autoCategory 同构:payee、item、type 空格连接,统一小写(英文商户名友好) */
function matchText(payee, item, type) {
  return `${payee} ${item} ${type}`.toLowerCase()
}

/**
 * 应用用户规则;无命中返回 null
 * @param rules [{id, match, categoryId, enabled}]
 * @param categories 分类数组(用于校验目标分类存在且 kind 一致)
 */
export function applyRules(payee, item, type, kind, rules, categories) {
  const text = matchText(payee, item, type)
  for (const r of rules || []) {
    if (!r.enabled) continue
    const kw = String(r.match || '').trim().toLowerCase()
    if (!kw) continue
    if (!text.includes(kw)) continue
    const cat = categories.find((c) => c.id === r.categoryId && c.kind === kind)
    if (cat) return cat
  }
  return null
}

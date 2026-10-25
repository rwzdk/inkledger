/** 健壮的 CSV 解析：支持引号包裹、字段内逗号/换行、\r\n、BOM */

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // 去 BOM
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

/** 以 GBK 解码（微信/支付宝老版本导出的账单常见 GBK 编码） */
export function decodeBuffer(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (utf8.includes('交易时间') || utf8.includes('交易') || !utf8.includes('�')) return utf8
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return utf8
  }
}

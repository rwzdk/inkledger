/**
 * 极简 xlsx → 二维行 解析器（零依赖）
 * 仅面向微信/支付宝导出的账单工作簿：单工作表、共享字符串、无公式。
 * zip 解压用浏览器原生 DecompressionStream('deflate-raw')，XML 用 DOMParser。
 */

/** xlsx 是 zip 容器，魔数 PK\x03\x04 */
export function isXlsx(buffer) {
  return buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer, 0, 4)[0] === 0x50 && new Uint8Array(buffer, 0, 4)[1] === 0x4b
    : false
}

async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([u8]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 解析 zip 中央目录 → Map(文件名 → Uint8Array) */
async function unzip(buffer) {
  const u8 = new Uint8Array(buffer)
  const dv = new DataView(buffer)

  // 从尾部找 EOCD
  let eocd = -1
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('xlsx 解析失败：非有效的 zip 容器')

  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const entries = new Map()

  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOff = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen

    // 本地头里的 nameLen/extraLen 才是数据段的真实偏移
    const lNameLen = dv.getUint16(localOff + 26, true)
    const lExtraLen = dv.getUint16(localOff + 28, true)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = u8.subarray(dataStart, dataStart + compSize)
    entries.set(name, method === 0 ? raw : await inflateRaw(raw))
  }
  return entries
}

const colIndex = (ref) => {
  let n = 0
  for (const ch of ref) {
    if (ch >= 'A' && ch <= 'Z') n = n * 26 + (ch.charCodeAt(0) - 64)
    else break
  }
  return n - 1
}

const unescapeXml = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// 不依赖 DOMParser：xlsx 的 sheet XML 为机器生成、结构规整，用正则可靠提取，
// 同时保证浏览器与 Node（测试）行为一致
const parseSheet = (xmlText, shared) => {
  const rows = []
  for (const rowMatch of xmlText.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = []
    for (const cMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cMatch[1]
      const inner = cMatch[2] ?? ''
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1] ?? ''
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] ?? ''
      let text = ''
      if (type === 's') {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
        text = v !== undefined ? shared[Number(v)] ?? '' : ''
      } else if (type === 'inlineStr') {
        text = (inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] ?? ''
      } else {
        text = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? ''
      }
      cells[colIndex(ref)] = unescapeXml(text ?? '')
    }
    rows.push(Array.from(cells, (x) => x ?? ''))
  }
  return rows
}

const parseSharedStrings = (xmlText) =>
  [...xmlText.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))

/** xlsx ArrayBuffer → 二维字符串行（取第一个工作表） */
export async function parseXlsxRows(buffer) {
  const entries = await unzip(buffer)
  const sheetName = [...entries.keys()].find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n))
    ?? [...entries.keys()].find((n) => /^xl\/worksheets\/.*\.xml$/.test(n))
  if (!sheetName) throw new Error('xlsx 解析失败：未找到工作表')
  const sharedEntry = entries.get('xl/sharedStrings.xml')
  const shared = sharedEntry ? parseSharedStrings(new TextDecoder().decode(sharedEntry)) : []
  return parseSheet(new TextDecoder().decode(entries.get(sheetName)), shared)
}

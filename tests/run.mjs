/** 导入器测试：node tests/run.mjs */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { importBill, importRows, parseBill, detectBill } from '../src/lib/importer.js'
import { parseCSV } from '../src/lib/csv.js'
import { isXlsx, parseXlsxRows } from '../src/lib/xlsx.js'

const dir = dirname(fileURLToPath(import.meta.url))
let failed = 0
const ok = (cond, name) => {
  if (cond) console.log('  ✓', name)
  else { failed++; console.error('  ✗', name) }
}

const accounts = [
  { id: 'acc-wechat', name: '微信零钱', type: 'wechat', importGeneric: true },
  { id: 'acc-alipay', name: '支付宝余额', type: 'alipay', importGeneric: true },
  { id: 'acc-cash', name: '现金', type: 'cash' }
]
const categories = [
  { id: 'c1', name: '餐饮', kind: 'expense', keywords: ['美团', '瑞幸', '饿了么'] },
  { id: 'c2', name: '交通出行', kind: 'expense', keywords: ['地铁', '滴滴'] },
  { id: 'c3', name: '人情往来', kind: 'expense', keywords: ['转账', '红包'] },
  { id: 'c4', name: '其他支出', kind: 'expense', keywords: [], isFallback: true },
  { id: 'i1', name: '收到的红包', kind: 'income', keywords: ['红包'] },
  { id: 'i2', name: '工资薪酬', kind: 'income', keywords: ['工资'] },
  { id: 'i3', name: '其他收入', kind: 'income', keywords: [], isFallback: true }
]

console.log('\n[parseCSV]')
const rows = parseCSV('a,b,c\n"x,y",z,\n1,"2\n3",4')
ok(rows[0].length === 3, '基本行')
ok(rows[1][0] === 'x,y' && rows[1][1] === 'z', '引号内逗号')
ok(rows[2][1] === '2\n3' && rows[2][2] === '4', '引号内换行')

console.log('\n[微信账单]')
const wechatText = readFileSync(join(dir, 'fixtures/wechat.csv'), 'utf8')
const wb = parseBill(wechatText)
ok(wb.platform === 'wechat', '识别为微信账单')
ok(wb.records.length === 6, `解析 6 行原始记录（实际 ${wb.records.length}）`)

const r1 = importBill(wechatText, { accounts, categories, existingKeys: new Set() })
ok(r1.platform === 'wechat', '微信：平台正确')
ok(r1.txs.length === 5, `微信：5 笔有效（收入1+支出4），实际 ${r1.txs.length}`)
ok(r1.skipped === 1, '微信：跳过 1 笔不计收支')
ok(r1.txs.filter((t) => t.type === 'expense').length === 4, '微信：4 笔支出')
ok(r1.txs.find((t) => t.payee === '张三')?.type === 'income', '微信：红包识别为收入')
ok(r1.txs.find((t) => t.payee === '美团平台商户')?.categoryId === 'c1', '微信：美团→餐饮')
ok(r1.txs.find((t) => t.payee === '地铁乘车码')?.categoryId === 'c2', '微信：地铁→交通')
ok(r1.txs.find((t) => t.payee === '李四')?.categoryId === 'c3', '微信：转账→人情往来')
ok(r1.txs.find((t) => t.payee === '瑞幸咖啡')?.note.includes('退款'), '微信：退款状态写入备注')
const newAccs = r1.createdAccounts.map((a) => a.name)
ok(newAccs.includes('招商银行储蓄卡(1234)'), `微信：自动建银行账户（${newAccs}）`)
ok(newAccs.includes('零钱通'), '微信：自动建零钱通账户')
ok(!newAccs.includes('零钱'), '微信：零钱映射到已有「微信零钱」账户')
ok(r1.txs.find((t) => t.payee === '张三')?.accountId === 'acc-wechat', '微信：零钱支付记入微信零钱账户')
ok(r1.txs.every((t) => t.sourceKey?.startsWith('wechat:')), '微信：sourceKey 前缀')

console.log('\n[微信账单去重]')
const keysAfter = new Set(r1.txs.map((t) => t.sourceKey))
const r2 = importBill(wechatText, { accounts, categories, existingKeys: keysAfter })
ok(r2.txs.length === 0, '重复导入 0 笔')

console.log('\n[支付宝账单]')
const alipayText = readFileSync(join(dir, 'fixtures/alipay.csv'), 'utf8')
const ab = parseBill(alipayText)
ok(ab.platform === 'alipay', '识别为支付宝账单')
const r3 = importBill(alipayText, { accounts, categories, existingKeys: new Set() })
ok(r3.txs.length === 4, `支付宝：4 笔有效（3支出+1收入），实际 ${r3.txs.length}`)
ok(r3.txs.find((t) => t.payee === '饿了么')?.categoryId === 'c1', '支付宝：饿了么→餐饮')
ok(r3.txs.find((t) => t.payee === '滴滴出行')?.categoryId === 'c2', '支付宝：滴滴→交通')
ok(r3.txs.find((t) => t.payee === '某某科技公司')?.type === 'income', '支付宝：工资→收入')
const aliAccs = r3.createdAccounts.map((a) => `${a.name}:${a.type}`)
ok(aliAccs.includes('中国银行(9876):bank'), `支付宝：建银行账户（${aliAccs}）`)
ok(aliAccs.includes('花呗:alipay'), '支付宝：花呗→alipay 类型')

console.log('\n[坏文件]')
let threw = false
try { parseBill('随便,一个\n1,2') } catch { threw = true }
ok(threw, '非账单文件抛出友好错误')

console.log('\n[微信 xlsx 账单（新版导出格式）]')
const xlsxBuf = readFileSync(join(dir, 'fixtures/wechat-bill.xlsx'))
ok(isXlsx(xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength)), 'zip 魔数识别为 xlsx')
const xlsxRows = await parseXlsxRows(xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength))
ok(xlsxRows.length === 24, `xlsx 解析出 24 行（含 15 行说明+表头+8 数据），实际 ${xlsxRows.length}`)
ok(xlsxRows[15][0] === '交易时间', 'xlsx 表头行定位正确')

const rx = importRows(xlsxRows, { accounts: JSON.parse(JSON.stringify(accounts)), categories, existingKeys: new Set() })
ok(rx.platform === 'wechat', 'xlsx：识别为微信账单')
ok(rx.txs.length === 6, `xlsx：6 笔有效（4支出+2收入，重复表头被预过滤），实际 ${rx.txs.length}`)
ok(rx.skipped === 1, `xlsx：跳过 1 笔中性提现，实际 ${rx.skipped}`)
const tRed = rx.txs.find((t) => t.payee.includes('张三'))
ok(tRed && tRed.payee === '发给张三  联系电话13800000000', 'xlsx：商户名保留（含尾随空格）')
const tPdd = rx.txs.find((t) => t.payee.includes('拼多多'))
ok(tPdd?.type === 'income' && tPdd?.accountId === 'acc-wechat', 'xlsx：支付方式"/"的红包收入记入微信零钱')
const tRefund = rx.txs.find((t) => t.payee === '美团')
ok(tRefund?.note.includes('已退款'), 'xlsx：全额退款标注')
ok(!tRed.note.includes('/'), 'xlsx：商品"/"不进入备注')
const tBank = rx.txs.find((t) => t.payee === '地铁乘车码')
const bankAcc = rx.createdAccounts.find((a) => /1234/.test(a.name))
ok(!!bankAcc && tBank?.accountId === bankAcc.id, 'xlsx：银行卡按名称建户且储蓄卡支付复用（与提现行同尾号）')
ok(rx.txs.filter((t) => t.accountId === 'acc-wechat').length === 5, 'xlsx：零钱支付 5 笔（含"/"默认零钱）')
const xKeys = new Set(rx.txs.map((t) => t.sourceKey))
const rx2 = importRows(xlsxRows, { accounts, categories, existingKeys: xKeys })
ok(rx2.txs.length === 0, 'xlsx：重复导入 0 笔')

if (failed) {
  console.error(`\n✗ ${failed} 个断言失败\n`)
  process.exit(1)
}
console.log('\n✓ 全部通过\n')

/** 单元测试：node tests/run.mjs（导入器/CSV/XLSX + 预算信封/净值推导） */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { importBill, importRows, parseBill, detectBill } from '../src/lib/importer.js'
import { applyRules } from '../src/lib/rules.js'
import { parseCSV } from '../src/lib/csv.js'
import { isXlsx, parseXlsxRows } from '../src/lib/xlsx.js'
import { monthDistance, envelopeOf } from '../src/lib/budget.js'
import { netWorthSeries, replayBalances } from '../src/lib/networth.js'

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

console.log('\n[budget.monthDistance]')
ok(monthDistance('2026-03', '2026-03') === 1, '同月距离为 1（含两端）')
ok(monthDistance('2025-11', '2026-02') === 4, '跨年 2025-11→2026-02 为 4 个月（含两端）')
ok(monthDistance('2026-03', '2026-02') === 0, '目标月早 1 个月返回 0')
ok(monthDistance('2026-03', '2026-01') === -1, '目标月早 2 个月返回 -1')

console.log('\n[budget.envelopeOf]')
const envSame = envelopeOf(500, '2026-03', '2026-03', (m) => (m === '2026-03' ? 120 : 0))
ok(envSame.envelope === 500 && envSame.spent === 120 && envSame.remain === 380 && envSame.months === 1,
  `同月：信封=额度 500，余 500-120=380（实际 ${JSON.stringify(envSame)}）`)

// 跨年：基线 2025-11 → 目标 2026-02 共 4 个月（11/12/1/2），额度 400/月
// 窗口支出 = 11月100 + 12月0 + 1月50 + 当月2月200 = 350；信封 1600，余 1250
const envCross = envelopeOf(400, '2025-11', '2026-02', (m) => ({ '2025-11': 100, '2026-01': 50, '2026-02': 200 }[m] || 0))
ok(envCross.months === 4 && envCross.envelope === 1600,
  `跨年：4 个月信封 400×4=1600（实际 months=${envCross.months} envelope=${envCross.envelope}）`)
ok(envCross.spent === 350 && envCross.remain === 1250,
  `跨年：支出 100+0+50+200=350，余 1250（实际 spent=${envCross.spent} remain=${envCross.remain}）`)

// 目标月早于基线月：退回单月口径（信封=当月额度，只看目标月支出）
const envBack = envelopeOf(500, '2026-03', '2026-01', (m) => (m === '2026-01' ? 80 : 0))
ok(envBack.envelope === 500 && envBack.spent === 80 && envBack.remain === 420 && envBack.months === 1,
  `目标早 2 个月（distance=-1）：退回单月口径（实际 ${JSON.stringify(envBack)}）`)
const envBack0 = envelopeOf(500, '2026-03', '2026-02', (m) => (m === '2026-02' ? 80 : 0))
ok(envBack0.envelope === 500 && envBack0.spent === 80 && envBack0.remain === 420 && envBack0.months === 1,
  `目标早 1 个月（distance=0）：同样单月口径（实际 ${JSON.stringify(envBack0)}）`)

// 窗口累计：基线 2026-01 → 目标 2026-03，1月300/2月200/3月100，额度 500/月
// 信封 = 500×3 = 1500；总支出 = 300+200+100 = 600；余 = 900
const envWin = envelopeOf(500, '2026-01', '2026-03', (m) => ({ '2026-01': 300, '2026-02': 200, '2026-03': 100 }[m] || 0))
ok(envWin.months === 3 && envWin.envelope === 1500,
  `三月窗口：信封 500×3=1500（实际 months=${envWin.months} envelope=${envWin.envelope}）`)
ok(envWin.spent === 600 && envWin.remain === 900,
  `三月窗口：支出 300+200+100=600，余 900（实际 spent=${envWin.spent} remain=${envWin.remain}）`)

// 无支出月份：spentOf 全为 0，不扣减
const envNone = envelopeOf(500, '2026-01', '2026-02', () => 0)
ok(envNone.envelope === 1000 && envNone.spent === 0 && envNone.remain === 1000 && envNone.months === 2,
  `无支出：信封 1000 支出 0 余 1000（实际 ${JSON.stringify(envNone)}）`)

console.log('\n[networth.replayBalances]')
const nwAccounts = [
  { id: 'acc-a', name: '甲', type: 'cash', initialBalance: 1000 },
  { id: 'acc-b', name: '乙', type: 'bank', initialBalance: 50 }
]
const nwTxs = [
  { type: 'income', accountId: 'acc-a', amount: 200, date: '2026-01-05' },
  { type: 'expense', accountId: 'acc-a', amount: 300, date: '2026-01-10' },
  { type: 'income', accountId: 'ghost', amount: 500, date: '2026-01-15' },
  { type: 'transfer', accountId: 'acc-b', toAccountId: 'ghost', amount: 30, date: '2026-01-20' },
  { type: 'expense', accountId: 'ghost', amount: 70, date: '2026-01-25' },
  { type: 'transfer', accountId: 'acc-a', toAccountId: 'acc-b', amount: 100, date: '2026-02-01' }
]
// asOf=null 计入全部：甲=1000+200-300-100=800；乙=50-30+100=120；ghost 相关账目忽略
const balAll = replayBalances(nwTxs, nwAccounts, null)
ok(balAll.get('acc-a') === 800, `全部账目：甲 1000+200-300-100=800（实际 ${balAll.get('acc-a')}）`)
ok(balAll.get('acc-b') === 120, `全部账目：乙 50-30+100=120（transfer 两腿，实际 ${balAll.get('acc-b')}）`)
ok(!balAll.has('ghost'), '指向不存在账户的账目被忽略（不产生 ghost 键）')
// asOf='2026-02-01'：排除 date≥2026-02-01（仅 2-1 转账）：甲=900，乙=50-30=20
const balFeb = replayBalances(nwTxs, nwAccounts, '2026-02-01')
ok(balFeb.get('acc-a') === 900 && balFeb.get('acc-b') === 20,
  `asOf 2026-02-01：甲 900 乙 20（实际 甲=${balFeb.get('acc-a')} 乙=${balFeb.get('acc-b')}）`)
// asOf='2026-01-20'：再排除 1-20 转账出腿：甲=900，乙=50
const balJan = replayBalances(nwTxs, nwAccounts, '2026-01-20')
ok(balJan.get('acc-a') === 900 && balJan.get('acc-b') === 50,
  `asOf 2026-01-20：甲 900 乙 50（实际 甲=${balJan.get('acc-a')} 乙=${balJan.get('acc-b')}）`)

console.log('\n[networth.netWorthSeries]')
const ptsEmpty = netWorthSeries([], [], '2026-03')
ok(ptsEmpty.length === 1 && ptsEmpty[0].month === '2026-03' && ptsEmpty[0].total === 0,
  `空账目+空账户 → 单点 {2026-03, 0}（实际 ${JSON.stringify(ptsEmpty)}）`)

// 单账户存量不归零：无账目时点值为 initialBalance 而非 0
const ptsStock = netWorthSeries([], [{ id: 'acc-a', name: '甲', type: 'cash', initialBalance: 1000 }], '2026-03')
ok(ptsStock.length === 1 && ptsStock[0].month === '2026-03' && ptsStock[0].total === 1000,
  `单账户无账目 → 点值 1000 而非 0（实际 ${JSON.stringify(ptsStock)}）`)

// 无账目月份存量结转：0 余额且 2026-01 建档的账户拉长窗口起点，三个月均结转 1000
const ptsCarry = netWorthSeries([], [
  { id: 'acc-a', name: '甲', type: 'cash', initialBalance: 1000 },
  { id: 'acc-z', name: 'Z', type: 'cash', initialBalance: 0, createdAt: new Date(2026, 0, 5).getTime() }
], '2026-03')
ok(ptsCarry.length === 3 && ptsCarry.map((p) => p.month).join() === '2026-01,2026-02,2026-03' && ptsCarry.every((p) => p.total === 1000),
  `无账目月份结转：2026-01..03 均为 1000 不归零（实际 ${JSON.stringify(ptsCarry)}）`)

// 收入/支出逐月累计：1月收500→1500，2月支200→1300，3月无账目结转1300
const flowPts = netWorthSeries([
  { type: 'income', accountId: 'acc-a', amount: 500, date: '2026-01-10' },
  { type: 'expense', accountId: 'acc-a', amount: 200, date: '2026-02-05' }
], [{ id: 'acc-a', name: '甲', type: 'cash', initialBalance: 1000 }], '2026-03')
ok(flowPts.map((p) => p.total).join() === '1500,1300,1300',
  `收支累计：1000+500=1500 → -200=1300 → 结转 1300（实际 ${flowPts.map((p) => p.total).join()}）`)

// transfer 净值中性：两腿同月对消，总额不变并结转
const trPts = netWorthSeries(
  [{ type: 'transfer', accountId: 'acc-a', toAccountId: 'acc-b', amount: 300, date: '2026-02-10' }],
  [
    { id: 'acc-a', name: '甲', type: 'cash', initialBalance: 1000 },
    { id: 'acc-b', name: '乙', type: 'bank', initialBalance: 50 }
  ], '2026-03')
ok(trPts.length === 2 && trPts[0].month === '2026-02' && trPts[0].total === 1050 && trPts[1].total === 1050,
  `转账中性：1000+50=1050，次月结转仍 1050（实际 ${JSON.stringify(trPts)}）`)

// createdAt：创建月前不计入净值，创建月（含）起计入并带上 initialBalance
const crPts = netWorthSeries(
  [{ type: 'income', accountId: 'acc-old', amount: 500, date: '2026-01-10' }],
  [
    { id: 'acc-old', name: '老户', type: 'cash', initialBalance: 1000 },
    { id: 'acc-new', name: '新户', type: 'bank', initialBalance: 700, createdAt: new Date(2026, 1, 15).getTime() }
  ], '2026-03')
ok(crPts[0].month === '2026-01' && crPts[0].total === 1500, `创建月前：仅老户 1000+500=1500（实际 ${crPts[0]?.total}）`)
ok(crPts[1].month === '2026-02' && crPts[1].total === 2200, `创建月起：1500+新户700=2200（实际 ${crPts[1]?.total}）`)
ok(crPts[2].month === '2026-03' && crPts[2].total === 2200, `创建后结转：仍 2200（实际 ${crPts[2]?.total}）`)

// 跨年连续：2025-11 → 2026-02 生成 4 个连续月点
const cyPts = netWorthSeries(
  [{ type: 'income', accountId: 'acc-a', amount: 250, date: '2025-11-20' }],
  [{ id: 'acc-a', name: '甲', type: 'cash', initialBalance: 100 }], '2026-02')
ok(cyPts.length === 4 && cyPts.map((p) => p.month).join() === '2025-11,2025-12,2026-01,2026-02',
  `跨年 4 点且月份连续（实际 ${cyPts.map((p) => p.month).join()}）`)
ok(cyPts.every((p) => p.total === 350), `每月 100+250=350 结转（实际 ${cyPts.map((p) => p.total).join()}）`)

console.log('\n[rules.applyRules]')
ok(applyRules('美团平台商户', '午餐', '商户消费', 'expense',
  [{ id: 'ar1', match: '美团', categoryId: 'c2', enabled: false }], categories) === null,
  'enabled=false 的规则跳过（即使关键词命中）')
ok(applyRules('美团平台商户', '', '', 'expense',
  [{ id: 'ar2', match: '美团', categoryId: 'c2', enabled: true }], categories)?.id === 'c2',
  'match 命中 payee')
ok(applyRules('某商户', '美团外卖', '', 'expense',
  [{ id: 'ar3', match: '美团', categoryId: 'c2', enabled: true }], categories)?.id === 'c2',
  'match 命中 item')
ok(applyRules('某商户', '', '商户消费-美团', 'expense',
  [{ id: 'ar4', match: '商户消费', categoryId: 'c2', enabled: true }], categories)?.id === 'c2',
  'match 命中 type')
ok(applyRules('美团平台商户', '', '', 'expense',
  [{ id: 'ar5', match: '美团', categoryId: 'deleted-cat', enabled: true }], categories) === null,
  '悬空 categoryId（分类已删）→ null')
ok(applyRules('美团平台商户', '', '', 'income',
  [{ id: 'ar6', match: '美团', categoryId: 'c2', enabled: true }], categories) === null,
  'kind 不符（规则指向支出分类，账单 income）→ null')
ok(applyRules('美团平台商户', '', '', 'expense', [
  { id: 'ar7', match: '美团', categoryId: 'c2', enabled: true },
  { id: 'ar8', match: '美团', categoryId: 'c3', enabled: true }
], categories)?.id === 'c2',
  '多条命中：第一条（c2）胜出而非后一条')
ok(applyRules('美团平台商户', '', '', 'expense', [
  { id: 'ar9', match: '美团', categoryId: 'i1', enabled: true }, // 命中文案但 i1 为收入分类，kind 校验不过
  { id: 'ar10', match: '美团', categoryId: 'c3', enabled: true }
], categories)?.id === 'c3',
  '前一条 kind 校验不过视同未命中，顺延到后一条（c3）')
ok(applyRules('美团平台商户', '', '', 'expense',
  [{ id: 'ar11', match: '   ', categoryId: 'c2', enabled: true }], categories) === null,
  '空白 match 的启用规则不命中任何文本')

console.log('\n[importRows × 自定义规则]')
// 最小微信账单（表头 + 2 笔：美团支出 / 张三红包收入）；支付方式均为零钱 → 复用 acc-wechat
const wechatMini = parseCSV([
  '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
  '2026-10-01 12:00:00,商户消费,美团平台商户,午餐-外卖,支出,¥35.50,零钱,支付成功,TR001,,',
  '2026-10-02 19:00:00,微信红包,张三,,收入,¥88.88,零钱,已存入零钱,TR002,,'
].join('\n'))
// 最小支付宝账单（1 笔饿了么支出；支付宝余额 → 复用 acc-alipay）
const alipayMini = parseCSV([
  '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注',
  '2026-10-03 12:00:00,餐饮美食,饿了么,e@x.com,午餐外卖,支出,28.00,支付宝余额,交易成功,TR101,,'
].join('\n'))

// 老调用方兼容：不传 ctx.rules 不抛错，行为与关键词打分一致
let noRulesErr = null
let rNoRules = null
try {
  rNoRules = importRows(wechatMini, { accounts, categories, existingKeys: new Set() })
} catch (e) { noRulesErr = e }
ok(noRulesErr === null, '不传 ctx.rules：不抛错')
ok(rNoRules?.txs.length === 2, `不传 rules：2 笔有效（实际 ${rNoRules?.txs?.length}）`)
ok(rNoRules?.txs.find((t) => t.payee === '美团平台商户')?.categoryId === 'c1',
  '不传 rules：美团按关键词 → 餐饮 c1')
ok(rNoRules?.txs.find((t) => t.payee === '张三')?.categoryId === 'i1',
  '不传 rules：红包按关键词 → 收到的红包 i1')

// 规则优先于关键词：关键词「美团」本会命中 c1，规则改判 c2
const rPrio = importRows(wechatMini, {
  accounts, categories, existingKeys: new Set(),
  rules: [{ id: 'pr1', match: '美团', categoryId: 'c2', enabled: true }]
})
ok(rPrio.txs.find((t) => t.payee === '美团平台商户')?.categoryId === 'c2',
  '微信：规则命中商户名 → c2（关键词本会判 c1，规则优先）')
const rPrioAli = importRows(alipayMini, {
  accounts, categories, existingKeys: new Set(),
  rules: [{ id: 'pr2', match: '饿了么', categoryId: 'c3', enabled: true }]
})
ok(rPrioAli.txs.find((t) => t.payee === '饿了么')?.categoryId === 'c3',
  '支付宝：饿了么规则改判 c3（关键词本会判 c1）')

// 规则 kind 与账单收/支方向不符：不命中，回退关键词
const rKindMiss = importRows(wechatMini, {
  accounts, categories, existingKeys: new Set(),
  rules: [{ id: 'km1', match: '美团', categoryId: 'i1', enabled: true }] // i1 为收入分类，账单为支出
})
ok(rKindMiss.txs.find((t) => t.payee === '美团平台商户')?.categoryId === 'c1',
  '规则指向收入分类而账单为支出 → 回退关键词 c1')

// 空 match 的启用规则不吞掉所有账单
const rEmpty = importRows(wechatMini, {
  accounts, categories, existingKeys: new Set(),
  rules: [{ id: 'em1', match: '', categoryId: 'c2', enabled: true }]
})
ok(rEmpty.txs.length === 2, `空 match 规则：2 笔照常导入（实际 ${rEmpty.txs.length}）`)
ok(rEmpty.txs.find((t) => t.payee === '美团平台商户')?.categoryId === 'c1',
  '空 match 规则：美团仍按关键词 → c1')
ok(rEmpty.txs.find((t) => t.payee === '张三')?.categoryId === 'i1',
  '空 match 规则：红包仍按关键词 → i1')

if (failed) {
  console.error(`\n✗ ${failed} 个断言失败\n`)
  process.exit(1)
}
console.log('\n✓ 全部通过\n')

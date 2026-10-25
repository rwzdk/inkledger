<script setup>
import { ref, computed, watch } from 'vue'
import { store, addTx, updateTx, removeTx, showToast } from '../store.js'
import { fmtMoney, toLocalISO } from '../lib/format.js'

const props = defineProps({ init: Object })
const emit = defineEmits(['close'])

const isNew = computed(() => !props.init?.id)
// 注意：props.init 可能是 store 中的响应式代理，structuredClone 会抛
// DataCloneError，账目数据本身是纯 JSON，用 JSON 深拷贝即可
const form = ref({
  type: 'expense',
  amount: '',
  categoryId: null,
  accountId: store.accounts[0]?.id,
  toAccountId: store.accounts[1]?.id,
  date: toLocalISO().slice(0, 16),
  payee: '',
  note: '',
  tags: [],
  ...JSON.parse(JSON.stringify(props.init || {}))
})
form.value.amount = props.init ? String(props.init.amount ?? '') : ''

const tagInput = ref('')
const types = [
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' },
  { key: 'transfer', label: '转账' }
]

const catsOfKind = computed(() =>
  form.value.type === 'transfer' ? [] : store.categories.filter((c) => c.kind === form.value.type)
)

watch(() => form.value.type, () => { form.value.categoryId = null })

function addTag() {
  const t = tagInput.value.trim()
  if (t && !form.value.tags.includes(t)) form.value.tags.push(t)
  tagInput.value = ''
}

function save() {
  const amount = parseFloat(form.value.amount)
  if (!Number.isFinite(amount) || amount <= 0) { showToast('请输入正确的金额'); return }
  if (form.value.type === 'transfer' && form.value.accountId === form.value.toAccountId) {
    showToast('转出与转入账户不能相同'); return
  }
  const data = {
    ...form.value,
    amount: Math.round(amount * 100) / 100,
    date: form.value.date.replace(' ', 'T').slice(0, 16)
  }
  if (isNew.value) {
    addTx(data)
    showToast('已记账 ' + fmtMoney(data.amount))
  } else {
    updateTx(data.id, data)
    showToast('已更新')
  }
  emit('close')
}

function del() {
  if (props.init?.id && confirm('确定删除这笔账目？')) {
    removeTx(props.init.id)
    showToast('已删除')
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="emit('close')">
      <div class="sheet">
        <h3 class="sheet__title">
          {{ isNew ? '记一笔' : '编辑账目' }}
          <button class="sheet__close" @click="emit('close')">✕</button>
        </h3>

        <!-- 类型 -->
        <div class="seg">
          <button
            v-for="t in types" :key="t.key"
            class="seg__item" :class="{ 'seg__item--on': form.type === t.key }"
            @click="form.type = t.key"
          >{{ t.label }}</button>
        </div>

        <!-- 金额 -->
        <div class="amount-box" :class="{ 'amount-box--in': form.type === 'income' }">
          <span class="amount-box__currency serif">{{ form.type === 'income' ? '＋' : form.type === 'transfer' ? '⇄' : '－' }} ¥</span>
          <input
            v-model="form.amount" class="amount-box__input num" type="number" inputmode="decimal"
            step="0.01" min="0" placeholder="0.00" autofocus
          />
        </div>

        <!-- 分类 -->
        <div v-if="form.type !== 'transfer'" class="catgrid">
          <button
            v-for="c in catsOfKind" :key="c.id"
            class="catgrid__item" :class="{ 'catgrid__item--on': form.categoryId === c.id }"
            @click="form.categoryId = c.id"
          >
            <span class="catgrid__icon">{{ c.icon }}</span>
            <span>{{ c.name }}</span>
          </button>
        </div>

        <!-- 账户 -->
        <div class="fields">
          <label class="field">
            <span class="field__label">{{ form.type === 'transfer' ? '转出账户' : '来源账户' }}</span>
            <select v-model="form.accountId" class="select">
              <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <label v-if="form.type === 'transfer'" class="field">
            <span class="field__label">转入账户</span>
            <select v-model="form.toAccountId" class="select">
              <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">时间</span>
            <input v-model="form.date" class="input num" type="datetime-local" />
          </label>
        </div>

        <label class="field" style="margin-top: 12px">
          <span class="field__label">{{ form.type === 'income' ? '来源' : '商户 / 对方' }}</span>
          <input v-model="form.payee" class="input" :placeholder="form.type === 'income' ? '如：公司工资' : '如：美团 · 超市 · 滴滴'" />
        </label>

        <label class="field" style="margin-top: 12px">
          <span class="field__label">备注</span>
          <input v-model="form.note" class="input" placeholder="选填" />
        </label>

        <label class="field" style="margin-top: 12px">
          <span class="field__label">标签</span>
          <div class="tags-row">
            <span v-for="t in form.tags" :key="t" class="tag" @click="form.tags = form.tags.filter((x) => x !== t)">#{{ t }} ✕</span>
            <input v-model="tagInput" class="input tags-input" placeholder="回车添加" @keydown.enter.prevent="addTag" />
          </div>
        </label>

        <div class="actions">
          <button v-if="!isNew" class="btn btn--danger" @click="del">删除</button>
          <span style="flex: 1"></span>
          <button class="btn" @click="emit('close')">取消</button>
          <button class="btn btn--gold" @click="save">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.seg {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
  background: var(--card-2); border-radius: var(--radius-s); padding: 4px; margin-bottom: 16px;
}
.seg__item {
  border: none; background: none; color: var(--text-dim); padding: 8px 0;
  border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 14px;
  transition: all 0.15s;
}
.seg__item--on { background: var(--gold-soft); color: var(--gold); font-weight: 600; }

.amount-box {
  display: flex; align-items: baseline; gap: 6px;
  border-bottom: 1px solid var(--gold-line); padding: 4px 4px 12px; margin-bottom: 16px;
}
.amount-box__currency { color: var(--gold); font-size: 22px; }
.amount-box__input {
  flex: 1; background: none; border: none; outline: none; color: var(--text);
  font-size: 34px; font-weight: 600; min-width: 0;
}
.amount-box--in .amount-box__currency { color: var(--gold); }

.catgrid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px;
}
@media (min-width: 480px) { .catgrid { grid-template-columns: repeat(6, 1fr); } }
.catgrid__item {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 9px 4px; border-radius: var(--radius-s);
  border: 1px solid var(--line); background: var(--card-2);
  color: var(--text-dim); font-size: 12px; cursor: pointer; font-family: inherit;
  transition: all 0.12s;
}
.catgrid__item:hover { color: var(--text); }
.catgrid__item--on { border-color: var(--gold-line); background: var(--gold-soft); color: var(--gold); }
.catgrid__icon { font-size: 20px; }

.fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field__label { font-size: 12px; color: var(--text-dim); letter-spacing: 1px; }

.tags-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tags-row .tag { cursor: pointer; }
.tags-input { flex: 1; min-width: 120px; width: auto; }

.actions { display: flex; gap: 10px; margin-top: 20px; }
</style>

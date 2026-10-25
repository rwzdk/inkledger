<script setup>
import { ref } from 'vue'
import { store, toast } from './store.js'
import HomeView from './components/HomeView.vue'
import StatsView from './components/StatsView.vue'
import SettingsView from './components/SettingsView.vue'
import TxEditor from './components/TxEditor.vue'
import AppIcon from './components/AppIcon.vue'

const view = ref('home')
const editing = ref(null)      // null 关闭；{} 新建；{tx} 编辑

// 深链：#stats / #settings / #add / #light（可与 #demo 组合，如 #demo/light/stats）
const hash = location.hash
if (hash.includes('stats')) view.value = 'stats'
else if (hash.includes('settings')) view.value = 'settings'
if (hash.includes('add')) editing.value = {}
if (hash.includes('light') && store.settings.theme !== 'light') {
  store.settings.theme = 'light'
  document.documentElement.dataset.theme = 'light'
}
const views = [
  { key: 'home', icon: 'ledger', label: '账目' },
  { key: 'stats', icon: 'stats', label: '统计' },
  { key: 'add', icon: 'pen', label: '记一笔' },
  { key: 'settings', icon: 'settings', label: '设置' }
]

function switchTo(key) {
  if (key === 'add') { editing.value = {}; return }
  view.value = key
}
function setTheme(t) {
  store.settings.theme = t
  document.documentElement.dataset.theme = t
}
</script>

<template>
  <nav class="sidenav">
    <div class="sidenav__brand"><em></em>墨账</div>
    <button
      v-for="v in views.filter((v) => v.key !== 'add')"
      :key="v.key"
      class="sidenav__item"
      :class="{ 'sidenav__item--on': view === v.key }"
      @click="switchTo(v.key)"
    >
      <span class="sidenav__ico"><AppIcon :name="v.icon" :size="18" /></span>{{ v.label }}
    </button>
    <button class="sidenav__item" @click="switchTo('add')">
      <span class="sidenav__ico"><AppIcon name="pen" :size="18" /></span>记一笔
    </button>
    <div style="flex: 1"></div>
    <button
      class="sidenav__item"
      @click="setTheme(store.settings.theme === 'dark' ? 'light' : 'dark')"
    >
      <span class="sidenav__ico"><AppIcon :name="store.settings.theme === 'dark' ? 'sun' : 'moon'" :size="18" /></span>
      {{ store.settings.theme === 'dark' ? '宣纸模式' : '夜墨模式' }}
    </button>
  </nav>

  <main class="shell">
    <HomeView v-if="view === 'home'" @edit="editing = $event" />
    <StatsView v-else-if="view === 'stats'" @edit="editing = $event" />
    <SettingsView v-else />
  </main>

  <nav class="tabbar">
    <button
      v-for="v in views"
      :key="v.key"
      class="tabbar__item"
      :class="{
        'tabbar__item--on': (v.key === 'add') ? false : view === v.key,
        'tabbar__item--gold': v.key === 'add'
      }"
      @click="switchTo(v.key)"
    >
      <span class="tabbar__icon"><AppIcon :name="v.icon" :size="v.key === 'add' ? 24 : 21" /></span>
      <span v-if="v.key !== 'add'">{{ v.label }}</span>
    </button>
  </nav>

  <TxEditor v-if="editing" :init="editing.tx" @close="editing = null" />

  <div v-if="toast.msg" class="toast num" :key="toast.ts">{{ toast.msg }}</div>
</template>

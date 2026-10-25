import { createApp } from 'vue'
import App from './App.vue'
import { store, loadSample } from './store.js'
import './styles/main.css'

document.documentElement.dataset.theme = store.settings.theme || 'dark'

// 演示模式：地址带 #demo 且无数据时载入示例（README 在线体验入口）
if (location.hash.includes('demo') && store.txs.length === 0) loadSample()

const app = createApp(App)
app.mount('#app')

// PWA：仅生产构建注册 Service Worker
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}

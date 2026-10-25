/* 墨账 InkLedger Service Worker —— 离线可用的静态外壳缓存 */
const VERSION = 'inkledger-v1.5'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './favicon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// 同源 GET：网络优先、失败回缓存；静态资源回退到缓存以支持离线
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {})
        return res
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  )
})

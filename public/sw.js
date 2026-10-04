/* 輕量更新用 SW：導航與 version.json 一律先打網路，避免主畫面捷徑卡舊 HTML */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin
  if (!sameOrigin) return

  const isNav = req.mode === 'navigate' || req.destination === 'document'
  const isVersion = url.pathname.endsWith('/version.json')
  if (!isNav && !isVersion) return

  event.respondWith(
    fetch(req, { cache: 'no-store' }).catch(() => fetch(req)),
  )
})

/* 導航／version.json：network-first（避免卡舊 HTML）
 * 立繪等圖片：cache-first 存本機（更新程式時保留） */
const IMAGE_CACHE = 'tower-annals-images-v1'

function isImageAsset(url) {
  const p = url.pathname
  return (
    p.includes('/assets/portraits/') ||
    p.endsWith('/hero.jpg') ||
    p.includes('/icons/') ||
    p.endsWith('/apple-touch-icon.jpg') ||
    p.endsWith('/favicon.svg') ||
    p.endsWith('/icons.svg')
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== IMAGE_CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  const isNav = req.mode === 'navigate' || req.destination === 'document'
  const isVersion = url.pathname.endsWith('/version.json')

  if (isNav || isVersion) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => fetch(req)))
    return
  }

  if (!isImageAsset(url)) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(IMAGE_CACHE)
      const hit = await cache.match(req)
      if (hit) return hit
      try {
        const res = await fetch(req)
        if (res && res.ok) await cache.put(req, res.clone())
        return res
      } catch (err) {
        const fallback = await cache.match(req)
        if (fallback) return fallback
        throw err
      }
    })(),
  )
})

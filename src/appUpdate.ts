import { assetUrl } from './game/util'

/** 建置時寫入；與 public/version.json 對齊 */
export const APP_VERSION = __APP_VERSION__

/** 與 public/sw.js 同一名稱：程式更新時不要清掉立繪本機快取 */
export const IMAGE_CACHE_NAME = 'tower-annals-images-v1'

const RELOAD_FLAG = 'tower-annals-update-reload'
const URL_BUST = '_app'

export type UpdateCheckResult = 'current' | 'reloading' | 'error' | 'blocked'

function stripBustParam() {
  try {
    const url = new URL(location.href)
    if (!url.searchParams.has(URL_BUST)) return
    url.searchParams.delete(URL_BUST)
    const next = url.pathname + url.search + url.hash
    history.replaceState(null, '', next)
  } catch {
    /* ignore */
  }
}

/** 清掉殼層快取，但保留立繪本機庫 */
async function clearRuntimeCaches() {
  if (!('caches' in window)) return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== IMAGE_CACHE_NAME).map((k) => caches.delete(k)))
  } catch {
    /* ignore */
  }
}

async function pingServiceWorkers() {
  if (!('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.update()))
  } catch {
    /* ignore */
  }
}

/**
 * 向伺服器拉取 version.json（不快取）。
 * 若與目前 bundle 版本不同 → 清殼層快取並強制換頁一次（立繪快取保留）。
 */
export async function checkAppUpdate(opts?: {
  manual?: boolean
}): Promise<UpdateCheckResult> {
  try {
    const url = assetUrl(`version.json?_=${Date.now()}`)
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit' })
    if (!res.ok) throw new Error(`version ${res.status}`)
    const data = (await res.json()) as { version?: string }
    const remote = typeof data.version === 'string' ? data.version : ''
    if (!remote || remote === APP_VERSION) {
      sessionStorage.removeItem(RELOAD_FLAG)
      stripBustParam()
      return 'current'
    }

    if (sessionStorage.getItem(RELOAD_FLAG) === remote) {
      return opts?.manual ? 'blocked' : 'current'
    }
    sessionStorage.setItem(RELOAD_FLAG, remote)

    await clearRuntimeCaches()
    await pingServiceWorkers()

    const next = new URL(location.href)
    next.searchParams.set(URL_BUST, remote)
    location.replace(next.toString())
    return 'reloading'
  } catch {
    return 'error'
  }
}

export type WarmProgress = {
  done: number
  total: number
  saved: number
  skipped: number
  failed: number
}

/** 把指定圖片 URL 寫入本機 Cache（已有則略過）；可回報進度 */
export async function warmImageCache(
  urls: string[],
  onProgress?: (p: WarmProgress) => void,
): Promise<WarmProgress> {
  const unique = [...new Set(urls.map((u) => u.split('?')[0]).filter(Boolean))]
  const total = unique.length
  const progress: WarmProgress = { done: 0, total, saved: 0, skipped: 0, failed: 0 }
  const report = () => onProgress?.({ ...progress })

  if (!('caches' in window) || !total) {
    report()
    return progress
  }

  try {
    const cache = await caches.open(IMAGE_CACHE_NAME)
    report()
    for (const url of unique) {
      try {
        if (await cache.match(url)) {
          progress.skipped += 1
        } else {
          const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' })
          if (!res.ok) {
            progress.failed += 1
          } else {
            await cache.put(url, res.clone())
            progress.saved += 1
          }
        }
      } catch {
        progress.failed += 1
      }
      progress.done += 1
      report()
    }
  } catch {
    progress.failed += total - progress.done
    progress.done = total
    report()
  }
  return progress
}

/** 背景預載主視覺＋常用路徑（不阻塞進遊戲） */
export function scheduleImageWarmup(extraUrls: string[] = []) {
  const run = () => {
    void warmImageCache([assetUrl('hero.jpg'), assetUrl('apple-touch-icon.jpg'), ...extraUrls])
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2500 })
  } else {
    window.setTimeout(run, 800)
  }
}

/** 註冊 SW：圖片本機快取 + HTML 更新檢查 */
export function registerUpdateWorker() {
  if (!('serviceWorker' in navigator)) return
  const base = import.meta.env.BASE_URL || '/'
  const swUrl = `${base}sw.js`
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(swUrl, { scope: base }).catch(() => {
      /* 本機 file:// 等環境可忽略 */
    })
  })
}

export function startAutoUpdateChecks() {
  registerUpdateWorker()
  void checkAppUpdate()
  scheduleImageWarmup()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkAppUpdate()
  })
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) void checkAppUpdate()
  })
}

import { assetUrl } from './game/util'

/** 建置時寫入；與 public/version.json 對齊 */
export const APP_VERSION = __APP_VERSION__

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

async function clearRuntimeCaches() {
  if (!('caches' in window)) return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
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
 * 若與目前 bundle 版本不同 → 清快取並強制換頁一次，讓主畫面捷徑吃到新 HTML。
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

    // 已為同一遠端版本重載過仍卡住 → 避免無限重整
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

/** 註冊輕量 SW：導航／version.json 走 network-first，避免卡住舊 index.html */
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkAppUpdate()
  })
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) void checkAppUpdate()
  })
}

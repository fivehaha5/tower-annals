import './realm-ui/style.css'
import { startAutoUpdateChecks } from './appUpdate'
import { renderHub, renderRealm } from './realm-ui/render'
import { bootRealm, getState as getRealmState, subscribe as subscribeRealm, tickAutoBattle } from './realm/state'
import { saveRealm } from './realm/save'

type AppMode = 'hub' | 'idle' | 'realm'

const MODE_KEY = 'tower-annals-app-mode'
const app = document.querySelector<HTMLElement>('#app')!

/** 鍵盤未開時記住的穩定高度，避免 iOS 彈鍵盤把整頁壓成一條 */
let stableAppHeight = 0
let idleCleanup: (() => void) | null = null
let realmCleanup: (() => void) | null = null
let realmAutoTimer: number | null = null

function isEditingInput(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio' && type !== 'file'
  }
  return !!el.isContentEditable
}

function syncAppHeight() {
  const vv = window.visualViewport
  const layoutH = Math.round(window.innerHeight)
  const visualH = Math.round(vv?.height ?? layoutH)
  const editing = isEditingInput()
  const candidate = Math.max(visualH, layoutH)

  if (!editing) {
    if (!stableAppHeight || visualH >= stableAppHeight * 0.85) {
      stableAppHeight = candidate
    }
    const applied = visualH >= stableAppHeight * 0.75 ? visualH : stableAppHeight
    document.documentElement.style.setProperty('--app-height', `${applied}px`)
    document.documentElement.style.setProperty(
      '--app-offset-top',
      `${vv ? Math.round(vv.offsetTop) : 0}px`,
    )
    return
  }

  if (!stableAppHeight) stableAppHeight = candidate
  document.documentElement.style.setProperty('--app-height', `${stableAppHeight}px`)
  document.documentElement.style.setProperty('--app-offset-top', '0px')
}

function onFocusIn(ev: FocusEvent) {
  const t = ev.target as HTMLElement | null
  if (!t) return
  const tag = t.tagName
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !t.isContentEditable) return
  syncAppHeight()
  requestAnimationFrame(() => {
    try {
      t.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } catch {
      /* ignore */
    }
  })
}

function onFocusOut() {
  window.setTimeout(syncAppHeight, 80)
  window.setTimeout(syncAppHeight, 320)
}

syncAppHeight()
window.addEventListener('resize', syncAppHeight)
window.visualViewport?.addEventListener('resize', syncAppHeight)
window.visualViewport?.addEventListener('scroll', syncAppHeight)
document.addEventListener('focusin', onFocusIn)
document.addEventListener('focusout', onFocusOut)

startAutoUpdateChecks()

function rememberMode(next: AppMode) {
  try {
    if (next === 'hub') localStorage.removeItem(MODE_KEY)
    else localStorage.setItem(MODE_KEY, next)
  } catch {
    /* ignore */
  }
}

function stopRealm() {
  if (realmCleanup) {
    realmCleanup()
    realmCleanup = null
  }
  if (realmAutoTimer != null) {
    window.clearInterval(realmAutoTimer)
    realmAutoTimer = null
  }
  const p = getRealmState().player
  if (p) saveRealm(getRealmState())
}

function stopIdle() {
  if (idleCleanup) {
    idleCleanup()
    idleCleanup = null
  }
}

function showHub() {
  stopIdle()
  stopRealm()
  rememberMode('hub')
  document.title = '雙界入口'
  renderHub(app, (game) => {
    if (game === 'idle') void launchIdle()
    else launchRealm()
  })
}

function launchRealm() {
  stopIdle()
  stopRealm()
  rememberMode('realm')
  document.title = '幻域征途'
  bootRealm()
  const paint = () => renderRealm(app)
  paint()
  realmCleanup = subscribeRealm(paint)
  realmAutoTimer = window.setInterval(() => {
    if (getRealmState().autoBattle && getRealmState().battle && !getRealmState().battle?.over) {
      tickAutoBattle()
    }
  }, 700)
}

async function launchIdle() {
  stopIdle()
  stopRealm()
  rememberMode('idle')
  document.title = '異塔編年'
  await import('./ui/style.css')
  const { bootState, saveLocal } = await import('./game/save')
  const { applyOfflineOnBoot, gameTick, getState, subscribe } = await import('./game/state')
  const { render } = await import('./ui/render')
  const { TICK_MS, GAME_NAME } = await import('./game/util')

  document.title = GAME_NAME
  bootState()
  render(app)
  const unsub = subscribe((kind) => render(app, kind))

  const tickId = window.setInterval(() => {
    if (!getState().starterDone) return
    gameTick()
  }, TICK_MS)

  const saveId = window.setInterval(() => {
    if (!getState().starterDone) return
    saveLocal(getState())
  }, 10000)

  const onVis = () => {
    if (document.visibilityState === 'visible' && getState().starterDone) {
      applyOfflineOnBoot()
      syncAppHeight()
    } else if (getState().starterDone) {
      saveLocal(getState())
    }
  }
  document.addEventListener('visibilitychange', onVis)

  // 在異塔設定頁無法回 hub 時，提供快捷：連點標題列可回入口（同時在 console 說明）
  const hubHotkey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') showHub()
  }
  window.addEventListener('keydown', hubHotkey)

  idleCleanup = () => {
    unsub()
    window.clearInterval(tickId)
    window.clearInterval(saveId)
    document.removeEventListener('visibilitychange', onVis)
    window.removeEventListener('keydown', hubHotkey)
  }
}

window.addEventListener('realm:hub', () => showHub())

// 恢復上次選擇，方便重整後繼續
try {
  const saved = localStorage.getItem(MODE_KEY) as AppMode | null
  if (saved === 'realm') launchRealm()
  else if (saved === 'idle') void launchIdle()
  else showHub()
} catch {
  showHub()
}

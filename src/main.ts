import './ui/style.css'
import { startAutoUpdateChecks } from './appUpdate'
import { bootState, saveLocal } from './game/save'
import { applyOfflineOnBoot, gameTick, getState, subscribe } from './game/state'
import { render } from './ui/render'
import { TICK_MS } from './game/util'

/** 鍵盤未開時記住的穩定高度，避免 iOS 彈鍵盤把整頁壓成一條 */
let stableAppHeight = 0

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

/**
 * 以實際可視高度鎖定版面。
 * 輸入時不跟 visualViewport 縮水（否則會整 UI 擠到鍵盤上方、中間留黑）。
 */
function syncAppHeight() {
  const vv = window.visualViewport
  const layoutH = Math.round(window.innerHeight)
  const visualH = Math.round(vv?.height ?? layoutH)
  const editing = isEditingInput()
  const candidate = Math.max(visualH, layoutH)

  if (!editing) {
    // 非輸入：跟瀏覽器 chrome；若高度仍接近穩定值則更新基準
    if (!stableAppHeight || visualH >= stableAppHeight * 0.85) {
      stableAppHeight = candidate
    }
    const applied =
      visualH >= stableAppHeight * 0.75 ? visualH : stableAppHeight
    document.documentElement.style.setProperty('--app-height', `${applied}px`)
    document.documentElement.style.setProperty(
      '--app-offset-top',
      `${vv ? Math.round(vv.offsetTop) : 0}px`,
    )
    return
  }

  // 輸入中：鎖住彈鍵盤前的高度，鍵盤改為覆蓋而非壓扁版面
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

const app = document.querySelector<HTMLElement>('#app')!
bootState()
render(app)
subscribe((kind) => render(app, kind))

window.setInterval(() => {
  if (!getState().starterDone) return
  gameTick()
}, TICK_MS)

window.setInterval(() => {
  if (!getState().starterDone) return
  saveLocal(getState())
}, 10000)

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && getState().starterDone) {
    applyOfflineOnBoot()
    syncAppHeight()
  } else if (getState().starterDone) {
    saveLocal(getState())
  }
})

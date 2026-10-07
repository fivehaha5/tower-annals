import './ui/style.css'
import { startAutoUpdateChecks } from '../appUpdate'
import { boot, flushSave, gameTick, subscribe } from './state'
import { TICK_MS } from './util'
import { render } from './ui/render'

let stableAppHeight = 0

function isEditingInput(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio'
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
    if (!stableAppHeight || visualH >= stableAppHeight * 0.85) stableAppHeight = candidate
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
  syncAppHeight()
  const t = ev.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
    window.setTimeout(() => {
      t.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 80)
  }
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
boot()
render(app)
subscribe((kind) => render(app, kind))

window.setInterval(() => gameTick(), TICK_MS)

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave()
})
window.addEventListener('pagehide', () => flushSave())

import './ui/style.css'
import { boot, gameTick, subscribe } from './state'
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

syncAppHeight()
window.addEventListener('resize', syncAppHeight)
window.visualViewport?.addEventListener('resize', syncAppHeight)
window.visualViewport?.addEventListener('scroll', syncAppHeight)

const app = document.querySelector<HTMLElement>('#app')!
boot()
render(app)
subscribe(() => render(app))

window.setInterval(() => gameTick(), TICK_MS)

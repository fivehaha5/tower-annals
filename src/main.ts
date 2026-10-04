import './ui/style.css'
import { startAutoUpdateChecks } from './appUpdate'
import { bootState, saveLocal } from './game/save'
import { applyOfflineOnBoot, gameTick, getState, subscribe } from './game/state'
import { render } from './ui/render'
import { TICK_MS } from './game/util'

/** 以實際可視高度鎖定版面，避免手機底欄懸空／頂部被狀態列壓住 */
function syncAppHeight() {
  const h = Math.round(window.visualViewport?.height ?? window.innerHeight)
  document.documentElement.style.setProperty('--app-height', `${h}px`)
}
syncAppHeight()
window.addEventListener('resize', syncAppHeight)
window.visualViewport?.addEventListener('resize', syncAppHeight)
window.visualViewport?.addEventListener('scroll', syncAppHeight)

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
  } else if (getState().starterDone) {
    saveLocal(getState())
  }
})

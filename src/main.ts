import './ui/style.css'
import { bootState, saveLocal } from './game/save'
import { applyOfflineOnBoot, gameTick, getState, subscribe } from './game/state'
import { render } from './ui/render'
import { TICK_MS } from './game/util'

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

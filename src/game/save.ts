import type { GameState } from './types'
import { SAVE_KEY, SAVE_VERSION } from './util'
import { createNewState, hydrate, normalizeState } from './state'

export function saveLocal(state: GameState) {
  const payload = { ...state, lastSave: Date.now(), pendingOffline: null }
  localStorage.setItem(SAVE_KEY, JSON.stringify(payload))
}

export function hasLocalSave(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return false
    const data = JSON.parse(raw) as GameState
    return !!(data.version && data.version <= SAVE_VERSION && data.starterDone)
  } catch {
    return false
  }
}

export function loadLocal(): GameState | null {
  const raw = localStorage.getItem(SAVE_KEY)
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as GameState
    if (!data.version || data.version > SAVE_VERSION) return null
    data.pendingOffline = null
    return normalizeState(data)
  } catch {
    return null
  }
}

export function exportSave(state: GameState): string {
  const payload = { ...state, lastSave: Date.now(), pendingOffline: null }
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
}

export function importSave(code: string): GameState | null {
  try {
    const json = decodeURIComponent(escape(atob(code.trim())))
    const data = JSON.parse(json) as GameState
    if (!data.resources || !data.roster) return null
    data.pendingOffline = null
    return normalizeState(data)
  } catch {
    return null
  }
}

export function downloadSaveFile(state: GameState) {
  const blob = new Blob([JSON.stringify({ ...state, pendingOffline: null }, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `異塔編年-存檔-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function uploadSaveFile(file: File): Promise<GameState | null> {
  const text = await file.text()
  try {
    const data = JSON.parse(text) as GameState
    if (!data.resources || !data.roster) return null
    data.pendingOffline = null
    return normalizeState(data)
  } catch {
    return null
  }
}

/** 開機一律進標題畫面；有存檔則由「繼續遊戲」載入 */
export function bootState(): GameState {
  const fresh = createNewState()
  hydrate(fresh)
  return fresh
}

import type { GameState, Player } from './types'
import { REALM_SAVE_KEY, REALM_SAVE_VERSION, syncVitals } from './util'

type SaveBlob = {
  v: number
  player: Player
  autoBattle: boolean
  savedAt: number
}

export function hasRealmSave(): boolean {
  try {
    return !!localStorage.getItem(REALM_SAVE_KEY)
  } catch {
    return false
  }
}

export function loadRealmSave(): SaveBlob | null {
  try {
    const raw = localStorage.getItem(REALM_SAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SaveBlob
    if (!data?.player || data.v !== REALM_SAVE_VERSION) return null
    syncVitals(data.player)
    return data
  } catch {
    return null
  }
}

export function saveRealm(state: GameState): void {
  if (!state.player) return
  const blob: SaveBlob = {
    v: REALM_SAVE_VERSION,
    player: state.player,
    autoBattle: state.autoBattle,
    savedAt: Date.now(),
  }
  try {
    localStorage.setItem(REALM_SAVE_KEY, JSON.stringify(blob))
  } catch {
    /* ignore quota */
  }
}

export function clearRealmSave(): void {
  try {
    localStorage.removeItem(REALM_SAVE_KEY)
  } catch {
    /* ignore */
  }
}

export function exportRealmSave(state: GameState): string {
  return JSON.stringify(
    {
      v: REALM_SAVE_VERSION,
      player: state.player,
      autoBattle: state.autoBattle,
      savedAt: Date.now(),
    },
    null,
    2,
  )
}

export function importRealmSave(raw: string): SaveBlob | null {
  try {
    const data = JSON.parse(raw) as SaveBlob
    if (!data?.player) return null
    syncVitals(data.player)
    return data
  } catch {
    return null
  }
}

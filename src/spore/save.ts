import type { GameState, Player } from './types'
import { SAVE_KEY, SAVE_VERSION } from './util'

type Blob = {
  v: number
  player: Player
  savedAt: number
}

export function hasSave(): boolean {
  try {
    return !!localStorage.getItem(SAVE_KEY)
  } catch {
    return false
  }
}

export function loadSave(): Blob | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Blob
    if (!data?.player || data.v !== SAVE_VERSION) return null
    return data
  } catch {
    return null
  }
}

export function writeSave(state: GameState): void {
  if (!state.player) return
  const blob: Blob = {
    v: SAVE_VERSION,
    player: { ...state.player, lastTick: Date.now() },
    savedAt: Date.now(),
  }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(blob))
  } catch {
    /* ignore */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    /* ignore */
  }
}

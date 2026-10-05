import { BOSS_CHARACTERS, GODKING_CHARACTERS } from './data/characters'
import { uniqueSkillsBySource } from './data/skills'
import { cycleDropRate, cycleFromFloor } from './balance'
import type { DropSettings, GameState, IdleMode, LootDrop } from './types'
import {
  LOOT_COST_CRYSTAL,
  LOOT_COST_SKILLBOOK_AIM,
  emptyLootCost,
  type LootCost,
} from './util'

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function poolChars(mode: 'boss' | 'godking') {
  return mode === 'boss' ? BOSS_CHARACTERS : GODKING_CHARACTERS
}

function poolSkills(mode: 'boss' | 'godking') {
  return uniqueSkillsBySource(mode)
}

function floorOf(state: GameState, mode: 'boss' | 'godking'): number {
  const max = Math.max(1, state.floors[mode] ?? 1)
  const farm = state.farmFloor?.[mode] ?? max
  return Math.max(1, Math.min(farm, max))
}

/** 定向消耗隨輪迴遞增 */
export function aimLootCost(mode: 'boss' | 'godking', floor: number): LootCost {
  const cycle = cycleFromFloor(mode, floor)
  return {
    crystal: LOOT_COST_CRYSTAL * cycle,
    skillbook: LOOT_COST_SKILLBOOK_AIM + Math.floor((cycle - 1) * 8),
  }
}

/**
 * 首勝：必掉角色卡＋獨特技能各一（免費）
 * 空刷 aim=none：免費，依輪迴機率掉
 * 定向：同時消耗水晶＋技能卡，必掉；資源不足 → aimCancelled（呼叫端應終止定向）
 */
export function rollClearLoot(state: GameState, mode: IdleMode): {
  loot: LootDrop
  cost: LootCost
  aimCancelled?: boolean
} {
  if (mode !== 'boss' && mode !== 'godking') {
    return { loot: {}, cost: emptyLootCost() }
  }

  const key = mode
  const isFirst = !state.firstWin[key]
  const settings: DropSettings = state.dropSettings[key]
  const chars = poolChars(key)
  const skills = poolSkills(key)
  const floor = floorOf(state, key)
  const aimed = settings.aim === 'character' || settings.aim === 'skill'

  if (isFirst) {
    return {
      loot: {
        characterId: pick(chars).id,
        skillId: pick(skills).id,
        guaranteed: true,
      },
      cost: emptyLootCost(),
    }
  }

  if (!aimed) {
    const loot: LootDrop = {}
    const rate = cycleDropRate(key, floor)
    if (Math.random() < rate) loot.characterId = pick(chars).id
    if (Math.random() < rate) loot.skillId = pick(skills).id
    return { loot, cost: emptyLootCost() }
  }

  const cost = aimLootCost(key, floor)
  const canPay =
    state.resources.crystal >= cost.crystal && state.resources.skillbook >= cost.skillbook
  if (!canPay) {
    return { loot: {}, cost: emptyLootCost(), aimCancelled: true }
  }

  const loot: LootDrop = { paid: true, guaranteed: true }

  if (settings.aim === 'character') {
    loot.characterId =
      settings.targetId && chars.some((c) => c.id === settings.targetId)
        ? settings.targetId
        : pick(chars).id
  } else {
    loot.skillId =
      settings.targetId && skills.some((s) => s.id === settings.targetId)
        ? settings.targetId
        : pick(skills).id
  }

  return { loot, cost }
}

export function currentCycleDropInfo(state: GameState, mode: 'boss' | 'godking') {
  const floor = floorOf(state, mode)
  const cycle = cycleFromFloor(mode, floor)
  return {
    floor,
    cycle,
    rate: cycleDropRate(mode, floor),
    aimCost: aimLootCost(mode, floor),
  }
}

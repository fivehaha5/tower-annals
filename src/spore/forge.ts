import { GEAR, RARITY_ORDER, rarityWeightsAt } from './data/gear'
import type { OwnedGear, Player, Rarity, Stats } from './types'
import { uid } from './util'

function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return items[items.length - 1]
  let r = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

function rollAffix(rarity: Rarity): Partial<Stats> {
  const ri = RARITY_ORDER.indexOf(rarity)
  const rolls = 1 + Math.floor(ri / 2)
  const keys: (keyof Stats)[] = ['atk', 'def', 'hp', 'spd', 'crit']
  const out: Partial<Stats> = {}
  for (let i = 0; i < rolls; i++) {
    const k = keys[Math.floor(Math.random() * keys.length)]
    const amt =
      k === 'hp'
        ? 4 + ri * 6 + Math.floor(Math.random() * 8)
        : 1 + ri + Math.floor(Math.random() * (2 + ri))
    out[k] = (out[k] ?? 0) + amt
  }
  return out
}

/** 裝備等級帶：1–20／21–60／61–MAX；MAX 起始 100，科技抬高 */
export function equipMaxLevel(player: Player): number {
  const base = 100
  const bonus = player.tech?.pw_maxlv?.rank ?? 0
  return base + bonus * 5
}

/**
 * 鍛造時隨機裝備等級。
 * 帶依爐級解鎖；剛解鎖偏低，約升兩爐可滿當前帶；下階段 min＝上階段 max。
 */
export function rollEquipLevel(forgeLevel: number, maxLevel: number): number {
  let bandMin: number
  let bandMax: number
  if (forgeLevel <= 4) {
    bandMin = 1
    bandMax = 20
  } else if (forgeLevel <= 8) {
    bandMin = 21
    bandMax = 60
  } else {
    bandMin = 61
    bandMax = maxLevel
  }

  // 剛解鎖該帶：上限感覺約落在帶寬前段；升兩爐後可滿帶
  const bandStartForge = forgeLevel <= 4 ? 1 : forgeLevel <= 8 ? 5 : 9
  const stepsInBand = Math.max(0, forgeLevel - bandStartForge)
  const unlockCap =
    stepsInBand >= 2
      ? bandMax
      : Math.floor(bandMin + (bandMax - bandMin) * (0.35 + stepsInBand * 0.3))

  const hi = Math.max(bandMin, Math.min(bandMax, unlockCap))
  return bandMin + Math.floor(Math.random() * (hi - bandMin + 1))
}

/** @param playerOrLevel Player（正式）或爐級數字（模擬腳本兼容） */
export function rollGear(playerOrLevel: Player | number): OwnedGear {
  const forgeLevel =
    typeof playerOrLevel === 'number' ? playerOrLevel : playerOrLevel.forgeLevel
  const maxLevel =
    typeof playerOrLevel === 'number' ? 100 : equipMaxLevel(playerOrLevel)
  const weights = rarityWeightsAt(forgeLevel)
  const rarity = pickWeighted(RARITY_ORDER, weights)
  let pool = GEAR.filter((g) => g.rarity === rarity && g.forgeMin <= forgeLevel)
  // 空池降級：往下找仍有權重的稀有
  if (!pool.length) {
    for (let i = RARITY_ORDER.indexOf(rarity); i >= 0; i--) {
      if (weights[i] <= 0) continue
      pool = GEAR.filter((g) => g.rarity === RARITY_ORDER[i] && g.forgeMin <= forgeLevel)
      if (pool.length) break
    }
  }
  const def = pool[Math.floor(Math.random() * pool.length)] ?? GEAR[0]
  return {
    uid: uid(),
    defId: def.id,
    level: rollEquipLevel(forgeLevel, maxLevel),
    affix: rollAffix(def.rarity),
  }
}

/** 單次鍛造耗錘（科技可降低，最少 1） */
export function forgeHammerCost(player: Player): number {
  const base = 1
  const delta = (player.tech?.fg_ham_cost?.rank ?? 0) * -1
  return Math.max(1, base + delta)
}

export function freeForgeChance(player: Player): number {
  return (player.tech?.fg_free?.rank ?? 0) * 4
}

export type ForgeResult =
  | { ok: true; gear: OwnedGear; cost: number; free: boolean }
  | { ok: false; reason: string }

export function tryForge(player: Player): ForgeResult {
  const cost = forgeHammerCost(player)
  const free = Math.random() * 100 < freeForgeChance(player)
  if (!free && player.hammer < cost) {
    return { ok: false, reason: `錘不足（需要 ${cost}）` }
  }
  return { ok: true, gear: rollGear(player), cost: free ? 0 : cost, free }
}

/** 升爐：僅耗金幣（對齊 FM）；科技可減費用。數字參數＝舊模擬兼容。 */
export function forgeUpgradeCost(
  playerOrLevel: Player | number,
): { coin: number; hammer?: number } {
  const lv = typeof playerOrLevel === 'number' ? playerOrLevel : playerOrLevel.forgeLevel
  const base = 40 + lv * 35 + lv * lv * 4
  const pct =
    typeof playerOrLevel === 'number' ? 0 : (playerOrLevel.tech?.fg_cost?.rank ?? 0) * 8
  return {
    coin: Math.max(10, Math.floor(base * (1 - pct / 100))),
    hammer: 0,
  }
}

export function decomposeValue(g: OwnedGear): number {
  const def = GEAR.find((x) => x.id === g.defId)
  if (!def) return 1
  const ri = RARITY_ORDER.indexOf(def.rarity)
  return 5 + ri * 12 + Math.floor(g.level * 0.5)
}

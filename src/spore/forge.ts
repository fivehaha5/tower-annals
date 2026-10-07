import { GEAR, RARITY_ORDER, RARITY_WEIGHT_BY_FORGE } from './data/gear'
import type { OwnedGear, Rarity, Stats } from './types'
import { lampCost, uid } from './util'

function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0)
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

function poolFor(rarity: Rarity, forgeLevel: number) {
  return GEAR.filter((g) => g.rarity === rarity && g.forgeMin <= forgeLevel)
}

/** 抽中空池稀有時降級到該爐可出的最高稀有，避免「史詩權重→木棒」 */
export function rollGear(forgeLevel: number): OwnedGear {
  const idx = Math.min(RARITY_WEIGHT_BY_FORGE.length - 1, Math.max(0, forgeLevel - 1))
  const weights = RARITY_WEIGHT_BY_FORGE[idx].map((w, i) =>
    poolFor(RARITY_ORDER[i], forgeLevel).length ? w : 0,
  )
  const weightSum = weights.reduce((a, b) => a + b, 0)
  let rarity: Rarity =
    weightSum > 0 ? pickWeighted(RARITY_ORDER, weights) : '普通'

  let pool = poolFor(rarity, forgeLevel)
  while (!pool.length) {
    const ri = RARITY_ORDER.indexOf(rarity)
    if (ri <= 0) {
      pool = GEAR.filter((g) => g.forgeMin <= forgeLevel)
      break
    }
    rarity = RARITY_ORDER[ri - 1]
    pool = poolFor(rarity, forgeLevel)
  }

  const def = pool[Math.floor(Math.random() * pool.length)] ?? GEAR[0]
  return {
    uid: uid(),
    defId: def.id,
    level: 1 + Math.floor(Math.random() * Math.min(5, 1 + Math.floor(forgeLevel / 2))),
    affix: rollAffix(def.rarity),
  }
}

export type PullResult =
  | { ok: true; gear: OwnedGear; cost: number }
  | { ok: false; reason: string }

export function canPull(oil: number, forgeLevel: number): PullResult {
  const cost = lampCost(forgeLevel)
  if (oil < cost) return { ok: false, reason: `神燈油不足（需要 ${cost}）` }
  return { ok: true, gear: rollGear(forgeLevel), cost }
}

export function forgeUpgradeCost(level: number): { hammer: number; coin: number } {
  return {
    hammer: 5 + level * 4,
    coin: 40 + level * 35,
  }
}

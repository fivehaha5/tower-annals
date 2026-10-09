/**
 * 菇燈鍛造 headless 模擬核心（加速版）
 * 重用 src/spore 真實公式；決策間隔內批次推進戰鬥。
 */
import {
  clearRewardMult,
  oilRegenEvery,
  progressStep,
} from '../src/spore/combat.ts'
import { CLASS_MAP } from '../src/spore/data/classes.ts'
import { GEAR_MAP, RARITY_ORDER } from '../src/spore/data/gear.ts'
import { PETS, PET_MAP } from '../src/spore/data/pets.ts'
import { stageOf } from '../src/spore/data/stages.ts'
import { forgeUpgradeCost, rollGear } from '../src/spore/forge.ts'
import type { ClassId, OwnedGear, Player, Slot } from '../src/spore/types.ts'
import {
  BAG_CAP,
  LEVEL_CAP,
  TICK_MS,
  createPlayer,
  forgeXpToLevel,
  gearCombatScore,
  lampCost,
  powerScore,
  sellValue,
  xpToLevel,
} from '../src/spore/util.ts'

export type SpendPolicy =
  | 'idle'
  | 'pull_greedy'
  | 'balanced'
  | 'forge_first'
  | 'enhance_first'
  | 'optimal'
  | 'agent'

export type ClassPolicy = 'stay_novice' | 'warrior' | 'archer' | 'mage' | 'best_power'

export interface SimConfig {
  hours: number
  seed?: number
  spend: SpendPolicy
  classPolicy: ClassPolicy
  stallRatio?: number
  autoPet?: boolean
  bagCap?: number
  decideEvery?: number
}

export interface SimSnapshot {
  hours: number
  stage: number
  level: number
  classId: ClassId
  forgeLevel: number
  power: number
  enemyPower: number
  ratio: number
  coin: number
  hammer: number
  lampOil: number
  totalPulls: number
  equippedSlots: number
  avgEquipLevel: number
  bestRarity: string
  petId: string | null
  clears: number
  pulls: number
  forgeUpgrades: number
  enhances: number
  sells: number
  stalledTicks: number
}

export interface SimResult {
  config: SimConfig
  final: SimSnapshot
  timeline: SimSnapshot[]
  maxStallHours: number
  milestones: Record<string, number | null>
}

export class Rng {
  private s: number
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1
  }
  next(): number {
    let x = this.s
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.s = x >>> 0
    return this.s / 4294967296
  }
}

function rarityIndex(r: string): number {
  return RARITY_ORDER.indexOf(r as (typeof RARITY_ORDER)[number])
}

export function enemyPowerOf(stage: number): number {
  const st = stageOf(stage)
  return Math.floor(st.hp * 0.4 + st.atk * 5 + st.def * 3)
}

function equipScore(g: OwnedGear): number {
  return gearCombatScore(g)
}

function maybeAutoEquip(player: Player, gear: OwnedGear): void {
  const def = GEAR_MAP[gear.defId]
  if (!def) return
  const curUid = player.equips[def.slot]
  if (!curUid) {
    player.equips[def.slot] = gear.uid
    return
  }
  const cur = player.bag.find((b) => b.uid === curUid)
  if (!cur || equipScore(gear) > equipScore(cur)) {
    player.equips[def.slot] = gear.uid
  }
}

function levelUpLoop(player: Player): void {
  while (player.level < LEVEL_CAP && player.xp >= xpToLevel(player.level)) {
    player.xp -= xpToLevel(player.level)
    player.level += 1
  }
}

function unlockPets(player: Player): void {
  // v2：寵物改走副本券召喚；模擬仍依戰力把已擁有寵物掛上
  void player
}

function bestPetId(player: Player): string | null {
  let best: string | null = null
  let bestBonus = -1
  for (const owned of player.ownedPets ?? []) {
    const p = PET_MAP[owned.id]
    if (!p) continue
    const id = owned.id
    const bonus =
      (p.bonus.atk ?? 0) * 4 +
      (p.bonus.def ?? 0) * 3 +
      (p.bonus.hp ?? 0) * 0.35 +
      (p.bonus.spd ?? 0) * 2 +
      (p.bonus.crit ?? 0) * 3
    if (bonus > bestBonus) {
      bestBonus = bonus
      best = id
    }
  }
  return best
}

function pickClass(player: Player, policy: ClassPolicy): ClassId {
  if (policy === 'stay_novice') return 'novice'
  if (policy === 'warrior' || policy === 'archer' || policy === 'mage') return policy
  // powerScore 權重 atk*4 為主：法師成長最高，其次弓、戰
  const order: ClassId[] = ['mage', 'archer', 'warrior', 'novice']
  for (const id of order) {
    const c = CLASS_MAP[id]
    if (c && player.level >= c.unlockLevel) return id
  }
  return player.classId
}

function tryChangeClass(player: Player, policy: ClassPolicy): void {
  const want = pickClass(player, policy)
  if (player.level < (CLASS_MAP[want]?.unlockLevel ?? 99)) return
  player.classId = want
}

export function enhanceCost(level: number): number {
  return 3 + level * 2
}

function equippedUids(player: Player): Set<string> {
  const s = new Set<string>()
  for (const u of Object.values(player.equips)) if (u) s.add(u)
  return s
}

interface Counters {
  clears: number
  pulls: number
  forgeUpgrades: number
  enhances: number
  sells: number
  stalledTicks: number
}

function snapshot(player: Player, hours: number, counters: Counters, power: number): SimSnapshot {
  const enemyPower = enemyPowerOf(player.stage)
  const eq = equippedUids(player)
  let avgEquipLevel = 0
  let nEq = 0
  let bestRarity = '普通'
  for (const g of player.bag) {
    if (!eq.has(g.uid)) continue
    avgEquipLevel += g.level
    nEq += 1
    const r = GEAR_MAP[g.defId]?.rarity ?? '普通'
    if (rarityIndex(r) > rarityIndex(bestRarity)) bestRarity = r
  }
  return {
    hours: +hours.toFixed(3),
    stage: player.stage,
    level: player.level,
    classId: player.classId,
    forgeLevel: player.forgeLevel,
    power,
    enemyPower,
    ratio: power / Math.max(1, enemyPower),
    coin: Math.floor(player.coin),
    hammer: Math.floor(player.hammer),
    lampOil: Math.floor(player.lampOil),
    totalPulls: player.totalPulls,
    equippedSlots: nEq,
    avgEquipLevel: nEq ? +(avgEquipLevel / nEq).toFixed(2) : 0,
    bestRarity,
    petId: player.petIds?.[0] ?? null,
    clears: counters.clears,
    pulls: counters.pulls,
    forgeUpgrades: counters.forgeUpgrades,
    enhances: counters.enhances,
    sells: counters.sells,
    stalledTicks: counters.stalledTicks,
  }
}

function withMathRandom<T>(rng: Rng, fn: () => T): T {
  const orig = Math.random
  Math.random = () => rng.next()
  try {
    return fn()
  } finally {
    Math.random = orig
  }
}

function tryPull(player: Player, rng: Rng, counters: Counters, times = 1): void {
  for (let i = 0; i < times; i++) {
    const cost = lampCost(player.forgeLevel)
    if (player.lampOil < cost) break
    player.lampOil -= cost
    const gear = withMathRandom(rng, () => rollGear(player.forgeLevel))
    player.bag.push(gear)
    player.totalPulls += 1
    player.forgeXp += 1
    while (player.forgeXp >= forgeXpToLevel(player.forgeLevel)) {
      player.forgeXp -= forgeXpToLevel(player.forgeLevel)
      player.forgeLevel += 1
    }
    maybeAutoEquip(player, gear)
    counters.pulls += 1
  }
}

function tryUpgradeForge(player: Player, counters: Counters): boolean {
  const cost = forgeUpgradeCost(player.forgeLevel)
  if (player.coin < cost.coin) return false
  // v2：升爐只耗金；hammer 欄位保留兼容
  player.coin -= cost.coin
  player.forgeLevel += 1
  counters.forgeUpgrades += 1
  return true
}

function tryEnhanceBest(player: Player, counters: Counters, maxTimes = 3): number {
  let n = 0
  const eq = equippedUids(player)
  const candidates = player.bag.filter((g) => eq.has(g.uid)).sort((a, b) => a.level - b.level)
  for (const g of candidates) {
    if (n >= maxTimes) break
    const cost = enhanceCost(g.level)
    if (player.hammer < cost) continue
    player.hammer -= cost
    g.level += 1
    counters.enhances += 1
    n += 1
  }
  return n
}

function trimBag(player: Player, bagCap: number, counters: Counters): void {
  const eq = equippedUids(player)
  while (player.bag.length > bagCap) {
    let junk: OwnedGear | null = null
    let junkScore = Infinity
    for (const g of player.bag) {
      if (eq.has(g.uid)) continue
      const sc = equipScore(g)
      if (sc < junkScore) {
        junkScore = sc
        junk = g
      }
    }
    if (!junk) break
    player.coin += sellValue(junk)
    player.bag = player.bag.filter((b) => b.uid !== junk!.uid)
    counters.sells += 1
  }
}

function fillEmptySlots(player: Player): void {
  const slots: Slot[] = ['weapon', 'hat', 'armor', 'gloves', 'boots', 'mount']
  for (const slot of slots) {
    if (player.equips[slot]) continue
    let best: OwnedGear | null = null
    let bestSc = -1
    for (const g of player.bag) {
      if (GEAR_MAP[g.defId]?.slot !== slot) continue
      const sc = equipScore(g)
      if (sc > bestSc) {
        bestSc = sc
        best = g
      }
    }
    if (best) player.equips[slot] = best.uid
  }
}

function decideSpend(
  player: Player,
  policy: SpendPolicy,
  ratio: number,
  stallRatio: number,
  rng: Rng,
  counters: Counters,
): void {
  const stalled = ratio < stallRatio
  fillEmptySlots(player)

  if (policy === 'idle') return

  if (policy === 'pull_greedy') {
    tryPull(player, rng, counters, 20)
    return
  }

  if (policy === 'forge_first') {
    while (tryUpgradeForge(player, counters)) {
      /* */
    }
    tryPull(player, rng, counters, 10)
    tryEnhanceBest(player, counters, 2)
    return
  }

  if (policy === 'enhance_first') {
    tryEnhanceBest(player, counters, 8)
    tryPull(player, rng, counters, 8)
    tryUpgradeForge(player, counters)
    return
  }

  if (policy === 'balanced') {
    tryPull(player, rng, counters, 5)
    tryEnhanceBest(player, counters, 3)
    tryUpgradeForge(player, counters)
    tryPull(player, rng, counters, 5)
    return
  }

  if (policy === 'optimal') {
    if (stalled) {
      tryEnhanceBest(player, counters, 6)
      tryPull(player, rng, counters, 15)
      let guard = 0
      while (guard++ < 4 && tryUpgradeForge(player, counters)) {
        /* */
      }
      tryEnhanceBest(player, counters, 4)
    } else {
      if (player.lampOil > lampCost(player.forgeLevel) * 8) tryPull(player, rng, counters, 3)
      if (player.hammer > forgeUpgradeCost(player.forgeLevel).hammer * 1.5) {
        tryUpgradeForge(player, counters)
      }
      tryEnhanceBest(player, counters, 1)
    }
    return
  }

  if (policy === 'agent') {
    const stage = player.stage
    if (stage < 10) {
      tryPull(player, rng, counters, 12)
      tryEnhanceBest(player, counters, 2)
    } else if (stalled || ratio < 0.95) {
      tryEnhanceBest(player, counters, 8)
      tryPull(player, rng, counters, 20)
      let guard = 0
      while (guard++ < 5 && tryUpgradeForge(player, counters)) {
        /* */
      }
      tryEnhanceBest(player, counters, 4)
    } else if (stage < 40) {
      tryPull(player, rng, counters, 4)
      if (rng.next() < 0.35) tryUpgradeForge(player, counters)
      tryEnhanceBest(player, counters, 2)
    } else {
      while (tryUpgradeForge(player, counters)) {
        /* */
      }
      tryPull(player, rng, counters, 8)
      tryEnhanceBest(player, counters, 3)
    }
  }
}

/**
 * 批次推進 nTicks 戰鬥（對齊 gameTick 獎勵；用期望隨機因子加速）
 */
function battleBatch(
  player: Player,
  rng: Rng,
  fromTick: number,
  nTicks: number,
  counters: Counters,
  power: number,
): void {
  let left = nTicks
  let tick = fromTick
  while (left > 0) {
    const enemyPower = enemyPowerOf(player.stage)
    const ratio = power / Math.max(1, enemyPower)
    const base = progressStep(ratio, player.classId)
    const mult = 0.85 + rng.next() * 0.3
    const step = base * mult

    // ratio&lt;0.5：硬牆，本批次不推進但仍可緩慢產油以便投資破局
    if (step <= 0) {
      counters.stalledTicks += left
      const regenEvery = oilRegenEvery(ratio)
      let oilGain = 0
      const end = tick + left
      for (let t = tick; t < end; t++) if (t % regenEvery === 0) oilGain += 1
      player.lampOil += oilGain
      tick += left
      left = 0
      continue
    }

    const need = 1 - player.stageProgress
    const ticksToClear = Math.max(1, Math.ceil(need / step))
    const used = Math.min(left, ticksToClear)
    if (ratio < 0.8) counters.stalledTicks += used

    const regenEvery = oilRegenEvery(ratio)
    let oilGain = 0
    const end = tick + used
    for (let t = tick; t < end; t++) if (t % regenEvery === 0) oilGain += 1
    player.lampOil += oilGain

    if (used < ticksToClear) {
      player.stageProgress += step * used
      tick += used
      left = 0
    } else {
      const stage = stageOf(player.stage)
      const rewardMult = clearRewardMult(ratio)
      player.stageProgress = 0
      player.coin += Math.floor(stage.coin * rewardMult)
      let hammer = Math.floor(stage.hammer * rewardMult)
      let oil = Math.floor((1 + Math.floor(player.forgeLevel / 3)) * rewardMult)
      player.xp += Math.floor(stage.xp * Math.max(0.5, rewardMult))

      player.hammer += hammer
      player.lampOil += oil
      player.stage += 1
      levelUpLoop(player)
      unlockPets(player)
      counters.clears += 1
      tick += used
      left -= used
    }
  }
}

const MILESTONE_STAGES = [5, 10, 15, 20, 30, 40, 50, 60, 80, 100]

export function runSim(config: SimConfig): SimResult {
  const rng = new Rng(config.seed ?? 42)
  const player = withMathRandom(rng, () => createPlayer('Sim菇', 'novice'))
  const counters: Counters = {
    clears: 0,
    pulls: 0,
    forgeUpgrades: 0,
    enhances: 0,
    sells: 0,
    stalledTicks: 0,
  }
  const stallRatio = config.stallRatio ?? 0.85
  const bagCap = config.bagCap ?? 48
  const decideEvery = config.decideEvery ?? 8
  const autoPet = config.autoPet ?? true

  const totalTicks = Math.max(1, Math.floor((config.hours * 3600 * 1000) / TICK_MS))
  const timeline: SimSnapshot[] = []
  const milestones: Record<string, number | null> = {}
  for (const s of MILESTONE_STAGES) milestones[`stage_${s}`] = null
  milestones.level_10 = null
  milestones.class_change = null

  let maxStallRun = 0
  let curStallRun = 0
  const sampleEvery = Math.max(decideEvery, Math.floor(totalTicks / 40))

  let t = 0
  let power = powerScore(player)
  let dirty = true

  while (t < totalTicks) {
    const hours = (t * TICK_MS) / 3600_000
    if (dirty) {
      power = powerScore(player)
      dirty = false
    }
    const ratio = power / Math.max(1, enemyPowerOf(player.stage))

    tryChangeClass(player, config.classPolicy)
    if (player.classId !== 'novice' && milestones.class_change == null) {
      milestones.class_change = +hours.toFixed(3)
      dirty = true
    }
    if (autoPet) {
      const bp = bestPetId(player)
      if (bp && !(player.petIds ?? []).includes(bp)) {
        player.petIds = [bp]
        dirty = true
      }
    }
    const pullsBefore = counters.pulls
    const enhBefore = counters.enhances
    const forgeBefore = counters.forgeUpgrades
    const levelBefore = player.level
    decideSpend(player, config.spend, ratio, stallRatio, rng, counters)
    trimBag(player, bagCap, counters)
    if (
      counters.pulls !== pullsBefore ||
      counters.enhances !== enhBefore ||
      counters.forgeUpgrades !== forgeBefore ||
      player.level !== levelBefore
    ) {
      dirty = true
    }
    if (dirty) {
      power = powerScore(player)
      dirty = false
    }

    const chunk = Math.min(decideEvery, totalTicks - t)
    const stageBefore = player.stage
    const levelBeforeBat = player.level
    battleBatch(player, rng, t, chunk, counters, power)
    if (player.stage !== stageBefore || player.level !== levelBeforeBat) dirty = true
    if (dirty) {
      power = powerScore(player)
      dirty = false
    }

    const ratioAfter = power / Math.max(1, enemyPowerOf(player.stage))
    if (ratioAfter < 0.8) {
      curStallRun += chunk
      maxStallRun = Math.max(maxStallRun, curStallRun)
    } else {
      curStallRun = 0
    }

    for (const s of MILESTONE_STAGES) {
      const key = `stage_${s}`
      if (milestones[key] == null && player.stage >= s) milestones[key] = +hours.toFixed(3)
    }
    if (milestones.level_10 == null && player.level >= 10) milestones.level_10 = +hours.toFixed(3)

    if (t % sampleEvery < chunk || t + chunk >= totalTicks) {
      timeline.push(snapshot(player, hours, counters, power))
    }
    t += chunk
  }

  if (dirty) power = powerScore(player)
  return {
    config,
    final: snapshot(player, config.hours, counters, power),
    timeline,
    maxStallHours: +((maxStallRun * TICK_MS) / 3600_000).toFixed(3),
    milestones,
  }
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  if (lo === hi) return sorted[lo]
  const w = i - lo
  return sorted[lo] * (1 - w) + sorted[hi] * w
}

export function summarizeStages(stages: number[]): {
  mean: number
  p10: number
  p50: number
  p90: number
  min: number
  max: number
} {
  const s = [...stages].sort((a, b) => a - b)
  const mean = stages.reduce((a, b) => a + b, 0) / Math.max(1, stages.length)
  return {
    mean: +mean.toFixed(2),
    p10: +percentile(s, 0.1).toFixed(2),
    p50: +percentile(s, 0.5).toFixed(2),
    p90: +percentile(s, 0.9).toFixed(2),
    min: s[0] ?? 0,
    max: s[s.length - 1] ?? 0,
  }
}

export { forgeUpgradeCost, lampCost, stageOf, powerScore, xpToLevel }

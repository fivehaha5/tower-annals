import { CLASS_MAP } from './data/classes'
import { GEAR_MAP, SLOT_LABEL } from './data/gear'
import { PET_MAP } from './data/pets'
import type { ClassId, OwnedGear, Player, Slot, Stats } from './types'

export const GAME_NAME = '菇燈鍛造'
export const SAVE_KEY = 'sporeforge-save-v1'
export const SAVE_VERSION = 1
export const LEVEL_CAP = 80
export const OFFLINE_CAP_SEC = 8 * 3600
export const TICK_MS = 500
/** 背包上限；超出時自動賣掉最弱未裝備件 */
export const BAG_CAP = 48

export function uid(prefix = 'g'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n))
}

export function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) < 10000) return String(Math.floor(n))
  if (Math.abs(n) < 1e6) return `${(n / 1e3).toFixed(1)}K`
  return `${(n / 1e6).toFixed(2)}M`
}

export function xpToLevel(level: number): number {
  if (level >= LEVEL_CAP) return Infinity
  return Math.floor(30 + level * 22 + level * level * 4)
}

export function forgeXpToLevel(level: number): number {
  return Math.floor(20 + level * 18 + level * level * 3)
}

export function lampCost(forgeLevel: number): number {
  return Math.max(1, Math.floor(1 + forgeLevel * 0.35))
}

export function createPlayer(name: string, classId: ClassId = 'novice'): Player {
  const now = Date.now()
  const starter = makeStarterGear()
  return {
    name: name.trim().slice(0, 10) || '小菇菇',
    classId,
    level: 1,
    xp: 0,
    stage: 1,
    stageProgress: 0,
    coin: 50,
    hammer: 8,
    lampOil: 20,
    forgeLevel: 1,
    forgeXp: 0,
    bag: starter,
    equips: {
      weapon: starter[0]?.uid,
      armor: starter[1]?.uid,
    },
    petId: 'spore_bug',
    unlockedPets: ['spore_bug'],
    totalPulls: 0,
    createdAt: now,
    lastTick: now,
  }
}

function makeStarterGear(): OwnedGear[] {
  return [
    { uid: uid(), defId: 'weapon_0', level: 1, affix: { atk: 1 } },
    { uid: uid(), defId: 'armor_0', level: 1, affix: { hp: 5 } },
  ]
}

export function emptyStats(): Stats {
  return { atk: 0, def: 0, hp: 0, spd: 0, crit: 0 }
}

export function addStats(a: Stats, b: Partial<Stats>): Stats {
  return {
    atk: a.atk + (b.atk ?? 0),
    def: a.def + (b.def ?? 0),
    hp: a.hp + (b.hp ?? 0),
    spd: a.spd + (b.spd ?? 0),
    crit: a.crit + (b.crit ?? 0),
  }
}

export function classStats(player: Player): Stats {
  const cls = CLASS_MAP[player.classId]
  const lv = player.level - 1
  return {
    atk: Math.floor(cls.base.atk + cls.growth.atk * lv),
    def: Math.floor(cls.base.def + cls.growth.def * lv),
    hp: Math.floor(cls.base.hp + cls.growth.hp * lv),
    spd: Math.floor(cls.base.spd + cls.growth.spd * lv),
    crit: Math.floor(cls.base.crit + cls.growth.crit * lv),
  }
}

export function gearPower(g: OwnedGear): Stats {
  const def = GEAR_MAP[g.defId]
  if (!def) return emptyStats()
  const lvMult = 1 + (g.level - 1) * 0.08
  const s = emptyStats()
  for (const k of Object.keys(def.base) as (keyof Stats)[]) {
    s[k] += Math.floor((def.base[k] ?? 0) * lvMult)
  }
  for (const k of Object.keys(g.affix) as (keyof Stats)[]) {
    s[k] += g.affix[k] ?? 0
  }
  return s
}

export function totalStats(player: Player): Stats {
  let s = classStats(player)
  for (const slot of Object.keys(player.equips) as Slot[]) {
    const u = player.equips[slot]
    if (!u) continue
    const g = player.bag.find((b) => b.uid === u)
    if (g) s = addStats(s, gearPower(g))
  }
  if (player.petId && PET_MAP[player.petId]) {
    s = addStats(s, PET_MAP[player.petId].bonus)
  }
  // forge passive
  s.atk += player.forgeLevel
  s.def += Math.floor(player.forgeLevel * 0.5)
  return s
}

export function statsPower(s: Stats): number {
  return Math.floor(s.atk * 4 + s.def * 3 + s.hp * 0.35 + s.spd * 2 + s.crit * 3)
}

export function powerScore(player: Player): number {
  return statsPower(totalStats(player))
}

/** 單件裝備戰力貢獻（自動裝備／背包清理共用） */
export function gearCombatScore(g: OwnedGear): number {
  return statsPower(gearPower(g))
}

export function sellValue(g: OwnedGear): number {
  const def = GEAR_MAP[g.defId]
  if (!def) return 1
  const order = ['普通', '優秀', '精良', '史詩', '傳說', '神話']
  return 5 + order.indexOf(def.rarity) * 12 + g.level * 2
}

export function gearLine(g: OwnedGear): string {
  const def = GEAR_MAP[g.defId]
  if (!def) return '未知'
  return `${SLOT_LABEL[def.slot]} · ${def.rarity} · +${g.level}`
}

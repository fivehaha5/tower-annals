import type { ClassId, Player, Stats } from './types'
import { CLASS_MAP } from './data/classes'
import { ITEM_MAP } from './data/items'

export const REALM_NAME = '幻域征途'
export const REALM_SAVE_KEY = 'realm-quest-save-v1'
export const REALM_SAVE_VERSION = 1
export const LEVEL_CAP = 50

export function uid(prefix = 'i'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function xpToLevel(level: number): number {
  if (level >= LEVEL_CAP) return Infinity
  return Math.floor(40 + level * 28 + level * level * 6)
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '∞'
  if (Math.abs(n) < 10000) return String(Math.floor(n))
  if (Math.abs(n) < 1e6) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1e6).toFixed(2)}M`
}

export function starterWeapon(classId: ClassId): string {
  if (classId === 'mage') return 'staff_bud'
  if (classId === 'ranger') return 'bow_reed'
  return 'sword_wood'
}

export function createPlayer(name: string, classId: ClassId): Player {
  const cls = CLASS_MAP[classId]
  const weapon = starterWeapon(classId)
  return {
    name: name.trim().slice(0, 10) || '無名旅人',
    classId,
    level: 1,
    xp: 0,
    gold: 80,
    hp: cls.base.hp,
    mp: cls.base.mp,
    zoneId: 'town_cangluan',
    equips: { weapon: undefined, armor: undefined, accessory: undefined },
    bag: [
      { uid: uid('eq'), defId: weapon, qty: 1 },
      { uid: uid('eq'), defId: 'armor_cloth', qty: 1 },
      { uid: uid('it'), defId: 'potion_hp', qty: 5 },
      { uid: uid('it'), defId: 'potion_mp', qty: 3 },
    ],
    questProgress: { q_welcome: 0 },
    doneQuests: [],
    activeQuests: ['q_welcome'],
    unlockedZones: ['town_cangluan', 'field_moss'],
    skillLevels: {},
    potionsUsed: 0,
    kills: {},
    createdAt: Date.now(),
  }
}

export function baseStats(player: Player): Stats {
  const cls = CLASS_MAP[player.classId]
  const lv = player.level - 1
  return {
    hp: Math.floor(cls.base.hp + cls.growth.hp * lv),
    mp: Math.floor(cls.base.mp + cls.growth.mp * lv),
    atk: Math.floor(cls.base.atk + cls.growth.atk * lv),
    def: Math.floor(cls.base.def + cls.growth.def * lv),
    spd: Math.floor(cls.base.spd + cls.growth.spd * lv),
    crit: Math.floor(cls.base.crit + cls.growth.crit * lv),
  }
}

export function equipStats(player: Player): Stats {
  const total: Stats = { hp: 0, mp: 0, atk: 0, def: 0, spd: 0, crit: 0 }
  for (const slot of ['weapon', 'armor', 'accessory'] as const) {
    const u = player.equips[slot]
    if (!u) continue
    const owned = player.bag.find((b) => b.uid === u)
    if (!owned) continue
    const def = ITEM_MAP[owned.defId]
    if (!def?.stats) continue
    for (const k of Object.keys(total) as (keyof Stats)[]) {
      total[k] += def.stats[k] ?? 0
    }
  }
  return total
}

export function fullStats(player: Player): Stats {
  const a = baseStats(player)
  const b = equipStats(player)
  return {
    hp: a.hp + b.hp,
    mp: a.mp + b.mp,
    atk: a.atk + b.atk,
    def: a.def + b.def,
    spd: a.spd + b.spd,
    crit: a.crit + b.crit,
  }
}

export function syncVitals(player: Player): void {
  const s = fullStats(player)
  player.hp = clamp(player.hp, 0, s.hp)
  player.mp = clamp(player.mp, 0, s.mp)
}

export function bagQty(player: Player, defId: string): number {
  return player.bag.filter((b) => b.defId === defId).reduce((n, b) => n + b.qty, 0)
}

export function addItem(player: Player, defId: string, qty = 1): void {
  const def = ITEM_MAP[defId]
  if (!def) return
  if (def.stackable || def.kind === 'consumable' || def.kind === 'material' || def.kind === 'quest') {
    const stack = player.bag.find((b) => b.defId === defId)
    if (stack) {
      stack.qty += qty
      return
    }
  }
  for (let i = 0; i < qty; i++) {
    player.bag.push({ uid: uid('it'), defId, qty: 1 })
  }
}

export function removeItem(player: Player, defId: string, qty = 1): boolean {
  let left = qty
  for (const b of [...player.bag]) {
    if (b.defId !== defId || left <= 0) continue
    const take = Math.min(b.qty, left)
    b.qty -= take
    left -= take
    if (b.qty <= 0) {
      player.bag = player.bag.filter((x) => x.uid !== b.uid)
      for (const slot of ['weapon', 'armor', 'accessory'] as const) {
        if (player.equips[slot] === b.uid) player.equips[slot] = undefined
      }
    }
  }
  return left <= 0
}

export function removeUid(player: Player, itemUid: string, qty = 1): boolean {
  const b = player.bag.find((x) => x.uid === itemUid)
  if (!b || b.qty < qty) return false
  b.qty -= qty
  if (b.qty <= 0) {
    player.bag = player.bag.filter((x) => x.uid !== itemUid)
    for (const slot of ['weapon', 'armor', 'accessory'] as const) {
      if (player.equips[slot] === itemUid) player.equips[slot] = undefined
    }
  }
  return true
}

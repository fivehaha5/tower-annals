import { CLASS_MAP } from './data/classes'
import { GEAR_MAP, SLOT_LABEL } from './data/gear'
import { PET_MAP } from './data/pets'
import { SKILL_MAP } from './data/skills'
import type {
  ClassId,
  DungeonId,
  OwnedGear,
  OwnedPet,
  OwnedSkill,
  Player,
  Slot,
  Stats,
  TechProgress,
} from './types'

export const GAME_NAME = '菇燈鍛造'
export const SAVE_KEY = 'sporeforge-save-v1'
export const SAVE_VERSION = 2
export const LEVEL_CAP = 80
export const OFFLINE_CAP_SEC = 8 * 3600
export const TICK_MS = 500
/** 兼容舊模擬腳本；正式規則為無背包 */
export const BAG_CAP = 0

/** 兼容舊腳本：鍛造改耗錘後此函式僅作參考 */
export function lampCost(forgeLevel: number): number {
  return Math.max(1, Math.floor(1 + forgeLevel * 0.35))
}

export function sellValue(g: OwnedGear): number {
  const def = GEAR_MAP[g.defId]
  if (!def) return 1
  const order = ['普通', '優秀', '精良', '史詩', '傳說', '神話']
  return 5 + order.indexOf(def.rarity) * 12 + Math.floor(g.level * 0.5)
}

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

export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function emptyTech(): Record<string, TechProgress> {
  return {}
}

function defaultKeys(): Record<DungeonId, number> {
  return { hammer: 2, skill: 2, pet: 2, research: 2 }
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
    coin: 80,
    hammer: 12,
    lampOil: 0,
    skillTicket: 0,
    petTicket: 0,
    techPoint: 0,
    forgeLevel: 1,
    forgeXp: 0,
    bag: starter,
    equips: {
      weapon: starter[0]?.uid,
      armor: starter[1]?.uid,
    },
    petIds: ['pet_0'],
    ownedPets: [{ id: 'pet_0', level: 1, fragments: 0 }],
    ownedSkills: [],
    equippedSkills: [],
    skillSummonLevel: 1,
    skillSummonXp: 0,
    petSummonLevel: 1,
    petSummonXp: 0,
    hatchSlots: [
      { petId: null, readyAt: null },
      { petId: null, readyAt: null },
    ],
    tech: emptyTech(),
    dungeonKeys: defaultKeys(),
    dungeonKeyDay: todayKey(),
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

/** 舊存檔遷移到 v2 結構 */
export function migratePlayer(raw: Record<string, unknown>): Player {
  const base = createPlayer(String(raw.name ?? '小菇菇'), (raw.classId as ClassId) ?? 'novice')
  const bag = Array.isArray(raw.bag) ? (raw.bag as OwnedGear[]) : base.bag
  const equips = (raw.equips as Player['equips']) ?? base.equips
  // 無背包：只保留已裝備件
  const equippedUids = new Set(Object.values(equips).filter(Boolean) as string[])
  const keptBag = bag.filter((g) => equippedUids.has(g.uid))

  const oldPetId = typeof raw.petId === 'string' ? raw.petId : null
  const unlocked = Array.isArray(raw.unlockedPets) ? (raw.unlockedPets as string[]) : []
  let ownedPets: OwnedPet[] = Array.isArray(raw.ownedPets)
    ? (raw.ownedPets as OwnedPet[])
    : []
  if (!ownedPets.length) {
    // 舊寵物 id → 新池映射（盡量對得上）
    const mapOld: Record<string, string> = {
      spore_bug: 'pet_0',
      flower_deer: 'pet_2',
      lamp_thief: 'pet_4',
      iron_boar: 'pet_6',
      star_moth: 'pet_7',
    }
    const ids = new Set<string>()
    for (const id of unlocked) ids.add(mapOld[id] ?? 'pet_0')
    if (oldPetId) ids.add(mapOld[oldPetId] ?? 'pet_0')
    if (!ids.size) ids.add('pet_0')
    ownedPets = [...ids].map((id) => ({ id, level: 1, fragments: 0 }))
  }
  const petIds: string[] = Array.isArray(raw.petIds)
    ? (raw.petIds as string[]).slice(0, 3)
    : [mapPet(oldPetId)].filter(Boolean) as string[]
  if (!petIds.length && ownedPets[0]) petIds.push(ownedPets[0].id)

  return {
    ...base,
    name: String(raw.name ?? base.name).slice(0, 10),
    classId: (raw.classId as ClassId) ?? 'novice',
    level: Number(raw.level) || 1,
    xp: Number(raw.xp) || 0,
    stage: Number(raw.stage) || 1,
    stageProgress: Number(raw.stageProgress) || 0,
    coin: Number(raw.coin) || 0,
    hammer: Number(raw.hammer) || 0,
    lampOil: Number(raw.lampOil) || 0,
    skillTicket: Number(raw.skillTicket) || 0,
    petTicket: Number(raw.petTicket) || 0,
    techPoint: Number(raw.techPoint) || 0,
    forgeLevel: Number(raw.forgeLevel) || 1,
    forgeXp: Number(raw.forgeXp) || 0,
    bag: keptBag.length ? keptBag : base.bag,
    equips: keptBag.length ? equips : base.equips,
    petIds,
    ownedPets,
    ownedSkills: Array.isArray(raw.ownedSkills) ? (raw.ownedSkills as OwnedSkill[]) : [],
    equippedSkills: Array.isArray(raw.equippedSkills) ? (raw.equippedSkills as string[]) : [],
    skillSummonLevel: Number(raw.skillSummonLevel) || 1,
    skillSummonXp: Number(raw.skillSummonXp) || 0,
    petSummonLevel: Number(raw.petSummonLevel) || 1,
    petSummonXp: Number(raw.petSummonXp) || 0,
    hatchSlots: Array.isArray(raw.hatchSlots)
      ? (raw.hatchSlots as Player['hatchSlots'])
      : base.hatchSlots,
    tech: (raw.tech as Record<string, TechProgress>) ?? {},
    dungeonKeys: {
      ...defaultKeys(),
      ...((raw.dungeonKeys as Record<DungeonId, number>) ?? {}),
    },
    dungeonKeyDay: String(raw.dungeonKeyDay ?? todayKey()),
    totalPulls: Number(raw.totalPulls) || 0,
    createdAt: Number(raw.createdAt) || Date.now(),
    lastTick: Number(raw.lastTick) || Date.now(),
  }
}

function mapPet(old: string | null): string | null {
  if (!old) return 'pet_0'
  const map: Record<string, string> = {
    spore_bug: 'pet_0',
    flower_deer: 'pet_2',
    lamp_thief: 'pet_4',
    iron_boar: 'pet_6',
    star_moth: 'pet_7',
    pet_0: 'pet_0',
  }
  return map[old] ?? 'pet_0'
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

export function scaleStats(s: Partial<Stats>, pct: number): Partial<Stats> {
  const out: Partial<Stats> = {}
  for (const k of Object.keys(s) as (keyof Stats)[]) {
    out[k] = Math.floor((s[k] ?? 0) * (1 + pct / 100))
  }
  return out
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

export function techRank(player: Player, id: string): number {
  return player.tech?.[id]?.rank ?? 0
}

export function gearPower(g: OwnedGear, player?: Player): Stats {
  const def = GEAR_MAP[g.defId]
  if (!def) return emptyStats()
  const lvMult = 1 + (g.level - 1) * 0.08
  let s = emptyStats()
  for (const k of Object.keys(def.base) as (keyof Stats)[]) {
    s[k] += Math.floor((def.base[k] ?? 0) * lvMult)
  }
  for (const k of Object.keys(g.affix) as (keyof Stats)[]) {
    s[k] += g.affix[k] ?? 0
  }
  if (player) {
    const atkPct = techRank(player, 'pw_atk') * 6
    const hpPct = techRank(player, 'pw_hp') * 6
    const mountPct = techRank(player, 'pw_mount') * 8
    if (def.slot === 'weapon' || def.slot === 'gloves') {
      s.atk = Math.floor(s.atk * (1 + atkPct / 100))
    }
    if (def.slot === 'hat' || def.slot === 'armor' || def.slot === 'boots') {
      s.hp = Math.floor(s.hp * (1 + hpPct / 100))
    }
    if (def.slot === 'mount') {
      s.atk = Math.floor(s.atk * (1 + mountPct / 100))
      s.hp = Math.floor(s.hp * (1 + mountPct / 100))
    }
  }
  return s
}

export function totalStats(player: Player): Stats {
  let s = classStats(player)
  for (const slot of Object.keys(player.equips) as Slot[]) {
    const u = player.equips[slot]
    if (!u) continue
    const g = player.bag.find((b) => b.uid === u)
    if (g) s = addStats(s, gearPower(g, player))
  }

  const petPct = techRank(player, 'sp_pet') * 8
  for (const pid of player.petIds ?? []) {
    const owned = player.ownedPets?.find((p) => p.id === pid)
    const def = PET_MAP[pid]
    if (!def || !owned) continue
    const lvMult = 1 + (owned.level - 1) * 0.06
    const bonus = scaleStats(
      {
        atk: Math.floor((def.bonus.atk ?? 0) * lvMult),
        def: Math.floor((def.bonus.def ?? 0) * lvMult),
        hp: Math.floor((def.bonus.hp ?? 0) * lvMult),
        spd: Math.floor((def.bonus.spd ?? 0) * lvMult),
        crit: Math.floor((def.bonus.crit ?? 0) * lvMult),
      },
      petPct,
    )
    s = addStats(s, bonus)
  }

  const skPct = techRank(player, 'sp_sk_pas') * 8
  for (const sid of player.equippedSkills ?? []) {
    const owned = player.ownedSkills?.find((x) => x.id === sid)
    const def = SKILL_MAP[sid]
    if (!def || !owned) continue
    const lvMult = 1 + (owned.level - 1) * 0.05
    const bonus = scaleStats(
      {
        atk: Math.floor((def.bonus.atk ?? 0) * lvMult),
        hp: Math.floor((def.bonus.hp ?? 0) * lvMult),
      },
      skPct,
    )
    s = addStats(s, bonus)
  }

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

export function gearCombatScore(g: OwnedGear, player?: Player): number {
  return statsPower(gearPower(g, player))
}

export function gearLine(g: OwnedGear): string {
  const def = GEAR_MAP[g.defId]
  if (!def) return '未知'
  return `${SLOT_LABEL[def.slot]} · ${def.rarity} · Lv.${g.level}`
}

export function offlineCapSec(player: Player): number {
  const pct = techRank(player, 'fg_off_cap') * 12
  return Math.floor(OFFLINE_CAP_SEC * (1 + pct / 100))
}

import type { PetDef, Rarity } from '../types'
import { RARITY_ORDER } from './gear'

const PET_POOL: { name: string; blurb: string; rarity: Rarity; atk: number; hp: number; extra?: Partial<{ def: number; spd: number; crit: number }> }[] = [
  { name: '孢子蟲', blurb: '新手村最常見的小夥伴。', rarity: '普通', atk: 3, hp: 10 },
  { name: '苔蘚蛙', blurb: '黏答答的防禦小幫手。', rarity: '普通', atk: 2, hp: 14, extra: { def: 2 } },
  { name: '鮮花鹿', blurb: '減傷小幫手，推圖更穩。', rarity: '優秀', atk: 4, hp: 24, extra: { def: 4 } },
  { name: '燈芯貓', blurb: '夜視靈敏，暴擊微升。', rarity: '優秀', atk: 6, hp: 18, extra: { crit: 2 } },
  { name: '偷燈鼠', blurb: '偶爾多掉一點錘。', rarity: '精良', atk: 7, hp: 22, extra: { spd: 4, crit: 3 } },
  { name: '菇傘狐', blurb: '靈巧突進。', rarity: '精良', atk: 9, hp: 26, extra: { spd: 3 } },
  { name: '鐵甲豬', blurb: '衝撞開路，攻防兼具。', rarity: '史詩', atk: 12, hp: 40, extra: { def: 8 } },
  { name: '星螢蛾', blurb: '高暴擊伴隨。', rarity: '史詩', atk: 14, hp: 32, extra: { crit: 6, spd: 4 } },
  { name: '龍脊幼獸', blurb: '傳說級坐鎮。', rarity: '傳說', atk: 20, hp: 55, extra: { def: 6, crit: 4 } },
  { name: '虛空孢影', blurb: '神話級影子寵物。', rarity: '神話', atk: 30, hp: 80, extra: { spd: 8, crit: 10 } },
]

const WEIGHT: Record<Rarity, number> = {
  普通: 36,
  優秀: 26,
  精良: 18,
  史詩: 12,
  傳說: 6,
  神話: 2,
}

export const PETS: PetDef[] = PET_POOL.map((p, i) => ({
  id: `pet_${i}`,
  name: p.name,
  blurb: p.blurb,
  rarity: p.rarity,
  weight: WEIGHT[p.rarity],
  bonus: { atk: p.atk, hp: p.hp, ...(p.extra ?? {}) },
}))

export const PET_MAP = Object.fromEntries(PETS.map((p) => [p.id, p])) as Record<string, PetDef>

export function petSummonWeights(level: number): number[] {
  const lv = Math.max(1, level)
  return [
    Math.max(0, 48 - lv * 2.8),
    Math.max(0, 28 - lv * 1.0),
    Math.max(0, 10 + lv * 0.7),
    Math.max(0, 3 + lv * 0.8),
    Math.max(0, lv >= 10 ? 1 + (lv - 9) * 0.5 : 0),
    Math.max(0, lv >= 18 ? 0.4 + (lv - 17) * 0.35 : 0),
  ]
}

export function petSummonXpNeed(level: number): number {
  return 16 + level * 6
}

export function hatchSeconds(rarity: Rarity, speedPct: number): number {
  const base = [40, 55, 75, 100, 140, 200][RARITY_ORDER.indexOf(rarity)] ?? 60
  return Math.max(8, Math.floor(base * (1 - speedPct / 100)))
}

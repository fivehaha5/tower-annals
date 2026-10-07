import type { PetDef } from '../types'

export const PETS: PetDef[] = [
  {
    id: 'spore_bug',
    name: '孢子蟲',
    blurb: '新手村最常見的小夥伴。',
    bonus: { atk: 3, hp: 10 },
    unlockStage: 1,
  },
  {
    id: 'flower_deer',
    name: '鮮花鹿',
    blurb: '減傷小幫手，推圖更穩。',
    bonus: { def: 6, hp: 30 },
    unlockStage: 8,
  },
  {
    id: 'lamp_thief',
    name: '偷燈鼠',
    blurb: '偶爾多掉一點錘與油。',
    bonus: { spd: 4, crit: 3 },
    unlockStage: 18,
  },
  {
    id: 'iron_boar',
    name: '鐵甲豬',
    blurb: '衝撞開路，攻擊與防禦兼具。',
    bonus: { atk: 10, def: 8, hp: 40 },
    unlockStage: 35,
  },
  {
    id: 'star_moth',
    name: '星螢蛾',
    blurb: '高暴擊伴隨，爆發好看。',
    bonus: { atk: 14, crit: 8, spd: 5 },
    unlockStage: 55,
  },
]

export const PET_MAP = Object.fromEntries(PETS.map((p) => [p.id, p])) as Record<string, PetDef>

import type { ClassId, Stats } from '../types'

export interface ClassDef {
  id: ClassId
  name: string
  blurb: string
  color: string
  unlockLevel: number
  base: Stats
  growth: Stats
}

export const CLASSES: ClassDef[] = [
  {
    id: 'novice',
    name: '菇勇者',
    blurb: '剛被騎士嘲諷過的小菇菇。拿起第一把武器，從這裡開始翻身。',
    color: '#6bc46d',
    unlockLevel: 1,
    base: { atk: 12, def: 6, hp: 100, spd: 8, crit: 5 },
    growth: { atk: 2.0, def: 1.0, hp: 14, spd: 0.5, crit: 0.2 },
  },
  {
    id: 'warrior',
    name: '戰士',
    blurb: '厚甲硬砍。高生命與防禦，適合穩穩推圖。',
    color: '#c47a3a',
    unlockLevel: 10,
    base: { atk: 14, def: 12, hp: 140, spd: 7, crit: 4 },
    growth: { atk: 2.2, def: 1.8, hp: 20, spd: 0.4, crit: 0.2 },
  },
  {
    id: 'archer',
    name: '弓箭手',
    blurb: '遠距點射。高速度與暴擊，輸出乾脆。',
    color: '#3a9c6a',
    unlockLevel: 10,
    base: { atk: 16, def: 7, hp: 110, spd: 12, crit: 12 },
    growth: { atk: 2.5, def: 1.0, hp: 14, spd: 1.0, crit: 0.6 },
  },
  {
    id: 'mage',
    name: '法師',
    blurb: '孢子法術。高攻擊，身板偏脆，爆發強。',
    color: '#4a8fd4',
    unlockLevel: 10,
    base: { atk: 20, def: 5, hp: 90, spd: 9, crit: 8 },
    growth: { atk: 3.0, def: 0.7, hp: 11, spd: 0.6, crit: 0.4 },
  },
]

export const CLASS_MAP = Object.fromEntries(CLASSES.map((c) => [c.id, c])) as Record<
  ClassId,
  ClassDef
>

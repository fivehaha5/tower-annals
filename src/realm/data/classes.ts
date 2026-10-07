import type { ClassDef } from '../types'

export const CLASSES: ClassDef[] = [
  {
    id: 'swordsman',
    name: '劍士',
    title: '蒼鋼守望',
    blurb: '以盾與刃站在最前線。高生命、穩防禦，適合正面硬仗。',
    color: '#3d9b8f',
    base: { hp: 120, mp: 40, atk: 14, def: 10, spd: 8, crit: 5 },
    growth: { hp: 18, mp: 4, atk: 2.2, def: 1.8, spd: 0.6, crit: 0.3 },
    skillIds: ['slash', 'guard_break', 'iron_will'],
  },
  {
    id: 'mage',
    name: '法師',
    title: '星火詠者',
    blurb: '以符文點燃戰場。高魔力輸出，脆皮但一掃成片。',
    color: '#5b7cfa',
    base: { hp: 80, mp: 90, atk: 18, def: 5, spd: 9, crit: 8 },
    growth: { hp: 10, mp: 10, atk: 3.2, def: 0.8, spd: 0.7, crit: 0.5 },
    skillIds: ['firebolt', 'frost_nova', 'arcane_surge'],
  },
  {
    id: 'ranger',
    name: '遊俠',
    title: '風徑追影',
    blurb: '在林間與廢墟間遊走。均衡屬性，擅長暴擊與風箏。',
    color: '#c9783a',
    base: { hp: 100, mp: 55, atk: 16, def: 7, spd: 12, crit: 12 },
    growth: { hp: 14, mp: 6, atk: 2.6, def: 1.2, spd: 1.1, crit: 0.8 },
    skillIds: ['aimed_shot', 'poison_arrow', 'shadow_step'],
  },
]

export const CLASS_MAP = Object.fromEntries(CLASSES.map((c) => [c.id, c])) as Record<
  string,
  ClassDef
>

import type { RelicDef } from '../types'

/** 質數轉生解鎖的遺物（裝在職業出戰格） */
export const RELICS: RelicDef[] = [
  {
    id: 'relic_r2',
    name: '二轉·裂隙鏡',
    needRebirth: 2,
    desc: '護盾上限 +8%',
    effect: { shieldCap: 0.08 },
  },
  {
    id: 'relic_r3',
    name: '三轉·回潮環',
    needRebirth: 3,
    desc: '過量治療 25% 轉為護盾',
    effect: { overhealToShield: 0.25 },
  },
  {
    id: 'relic_r5',
    name: '五轉·鋒骨釘',
    needRebirth: 5,
    desc: '攻擊 +6%',
    effect: { atk: 0.06 },
  },
  {
    id: 'relic_r7',
    name: '七轉·鎮層印',
    needRebirth: 7,
    desc: '防禦 +8%',
    effect: { def: 0.08 },
  },
  {
    id: 'relic_r11',
    name: '十一轉·無屬刃胚',
    needRebirth: 11,
    desc: '真實傷害加成 +10%',
    effect: { trueDamageBonus: 0.1 },
  },
  {
    id: 'relic_r13',
    name: '十三轉·永念燈',
    needRebirth: 13,
    desc: '治療效果 +12%',
    effect: { heal: 0.12 },
  },
]

export const RELIC_MAP = Object.fromEntries(RELICS.map((r) => [r.id, r])) as Record<
  string,
  RelicDef
>

export function relicsUnlockedByRebirth(rebirth: number): RelicDef[] {
  return RELICS.filter((r) => rebirth >= r.needRebirth)
}

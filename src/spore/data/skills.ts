import type { Rarity, SkillDef } from '../types'
import { RARITY_ORDER } from './gear'

const SKILL_NAMES: Record<Rarity, string[]> = {
  普通: ['彈射孢', '輕敲', '泥巴甩'],
  優秀: ['藤鞭', '菇盾', '迅步'],
  精良: ['孢子雲', '燈焰斬', '癒合苔'],
  史詩: ['炸彈', '雷鳴錘', '星塵箭'],
  傳說: ['虛空裂隙', '神燈爆', '龍脊衝擊'],
  神話: ['終焉孢爆', '不滅燈芯'],
}

const BASE_BONUS: Record<Rarity, { atk: number; hp: number }> = {
  普通: { atk: 2, hp: 8 },
  優秀: { atk: 4, hp: 16 },
  精良: { atk: 7, hp: 28 },
  史詩: { atk: 12, hp: 48 },
  傳說: { atk: 20, hp: 80 },
  神話: { atk: 32, hp: 130 },
}

const WEIGHT: Record<Rarity, number> = {
  普通: 40,
  優秀: 28,
  精良: 16,
  史詩: 10,
  傳說: 5,
  神話: 1,
}

function makeSkills(): SkillDef[] {
  const list: SkillDef[] = []
  for (const rarity of RARITY_ORDER) {
    const names = SKILL_NAMES[rarity]
    names.forEach((name, i) => {
      const b = BASE_BONUS[rarity]
      list.push({
        id: `sk_${rarity}_${i}`,
        name,
        blurb: `${rarity}技能：提升基礎攻／血。`,
        rarity,
        bonus: { atk: b.atk, hp: b.hp },
        weight: WEIGHT[rarity],
      })
    })
  }
  return list
}

export const SKILLS: SkillDef[] = makeSkills()
export const SKILL_MAP = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<string, SkillDef>

/** 召喚等級 → 稀有權重（低階隨等級降至 0） */
export function skillSummonWeights(level: number): number[] {
  const lv = Math.max(1, level)
  // 普通、優秀、精良、史詩、傳說、神話
  const w = [
    Math.max(0, 50 - lv * 3),
    Math.max(0, 30 - lv * 1.2),
    Math.max(0, 8 + lv * 0.8),
    Math.max(0, 2 + lv * 0.9),
    Math.max(0, lv >= 8 ? 1 + (lv - 7) * 0.6 : 0),
    Math.max(0, lv >= 15 ? 0.5 + (lv - 14) * 0.4 : 0),
  ]
  return w
}

export function skillSummonXpNeed(level: number): number {
  return 20 + level * 8
}

export function skillUpgradeCost(level: number): number {
  return 2 + level
}

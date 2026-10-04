import type { RelicDef, Role } from '../types'

/**
 * 職業特化遺物：同一轉生門檻各職解鎖不同效果。
 * 僅能裝在對應職業出戰格。
 */
export const RELICS: RelicDef[] = [
  // —— 戰士 ——
  {
    id: 'relic_w_r2',
    role: 'warrior',
    name: '二轉·壁壘核',
    needRebirth: 2,
    desc: '護盾上限 +12%',
    effect: { shieldCap: 0.12 },
  },
  {
    id: 'relic_w_r3',
    role: 'warrior',
    name: '三轉·鎮骨甲',
    needRebirth: 3,
    desc: '防禦 +12%',
    effect: { def: 0.12 },
  },
  {
    id: 'relic_w_r5',
    role: 'warrior',
    name: '五轉·裂陣刃',
    needRebirth: 5,
    desc: '攻擊 +10%',
    effect: { atk: 0.1 },
  },
  {
    id: 'relic_w_r7',
    role: 'warrior',
    name: '七轉·不動碑',
    needRebirth: 7,
    desc: '防禦 +8%、護盾上限 +8%',
    effect: { def: 0.08, shieldCap: 0.08 },
  },
  {
    id: 'relic_w_r11',
    role: 'warrior',
    name: '十一轉·貫層釘',
    needRebirth: 11,
    desc: '真實傷害 +14%、攻擊 +4%',
    effect: { trueDamageBonus: 0.14, atk: 0.04 },
  },
  {
    id: 'relic_w_r13',
    role: 'warrior',
    name: '十三轉·王骸冠',
    needRebirth: 13,
    desc: '攻擊 +8%、防禦 +8%',
    effect: { atk: 0.08, def: 0.08 },
  },

  // —— 法師 ——
  {
    id: 'relic_m_r2',
    role: 'mage',
    name: '二轉·弧光匣',
    needRebirth: 2,
    desc: '技能威力 +10%',
    effect: { skillPower: 0.1 },
  },
  {
    id: 'relic_m_r3',
    role: 'mage',
    name: '三轉·虛燃芯',
    needRebirth: 3,
    desc: '攻擊 +9%',
    effect: { atk: 0.09 },
  },
  {
    id: 'relic_m_r5',
    role: 'mage',
    name: '五轉·斷律筆',
    needRebirth: 5,
    desc: '真實傷害 +12%',
    effect: { trueDamageBonus: 0.12 },
  },
  {
    id: 'relic_m_r7',
    role: 'mage',
    name: '七轉·疊算環',
    needRebirth: 7,
    desc: '技能威力 +12%、攻擊 +5%',
    effect: { skillPower: 0.12, atk: 0.05 },
  },
  {
    id: 'relic_m_r11',
    role: 'mage',
    name: '十一轉·無相焰',
    needRebirth: 11,
    desc: '真實傷害 +16%、技能威力 +6%',
    effect: { trueDamageBonus: 0.16, skillPower: 0.06 },
  },
  {
    id: 'relic_m_r13',
    role: 'mage',
    name: '十三轉·終章鏡',
    needRebirth: 13,
    desc: '攻擊 +10%、技能威力 +10%',
    effect: { atk: 0.1, skillPower: 0.1 },
  },

  // —— 牧師 ——
  {
    id: 'relic_p_r2',
    role: 'priest',
    name: '二轉·泉念珠',
    needRebirth: 2,
    desc: '治療效果 +14%',
    effect: { heal: 0.14 },
  },
  {
    id: 'relic_p_r3',
    role: 'priest',
    name: '三轉·溢潮杯',
    needRebirth: 3,
    desc: '過量治療 35% 轉為護盾',
    effect: { overhealToShield: 0.35 },
  },
  {
    id: 'relic_p_r5',
    role: 'priest',
    name: '五轉·守護鈴',
    needRebirth: 5,
    desc: '護盾上限 +14%',
    effect: { shieldCap: 0.14 },
  },
  {
    id: 'relic_p_r7',
    role: 'priest',
    name: '七轉·慈律杖',
    needRebirth: 7,
    desc: '治療 +12%、護盾上限 +6%',
    effect: { heal: 0.12, shieldCap: 0.06 },
  },
  {
    id: 'relic_p_r11',
    role: 'priest',
    name: '十一轉·聖潮輪',
    needRebirth: 11,
    desc: '治療 +10%、過量治療 20% 轉盾',
    effect: { heal: 0.1, overhealToShield: 0.2 },
  },
  {
    id: 'relic_p_r13',
    role: 'priest',
    name: '十三轉·永祈冠',
    needRebirth: 13,
    desc: '治療 +16%、護盾上限 +10%',
    effect: { heal: 0.16, shieldCap: 0.1 },
  },
]

export const RELIC_MAP = Object.fromEntries(RELICS.map((r) => [r.id, r])) as Record<
  string,
  RelicDef
>

/** 舊版通用遺物 → 對應職業特化（讀檔相容） */
const LEGACY_RELIC_MAP: Record<string, Partial<Record<Role, string>>> = {
  relic_r2: { warrior: 'relic_w_r2', mage: 'relic_m_r2', priest: 'relic_p_r2' },
  relic_r3: { warrior: 'relic_w_r3', mage: 'relic_m_r3', priest: 'relic_p_r3' },
  relic_r5: { warrior: 'relic_w_r5', mage: 'relic_m_r5', priest: 'relic_p_r5' },
  relic_r7: { warrior: 'relic_w_r7', mage: 'relic_m_r7', priest: 'relic_p_r7' },
  relic_r11: { warrior: 'relic_w_r11', mage: 'relic_m_r11', priest: 'relic_p_r11' },
  relic_r13: { warrior: 'relic_w_r13', mage: 'relic_m_r13', priest: 'relic_p_r13' },
}

export function migrateLegacyRelicId(id: string | undefined, role: Role): string | undefined {
  if (!id) return undefined
  if (RELIC_MAP[id]) return RELIC_MAP[id].role === role ? id : undefined
  return LEGACY_RELIC_MAP[id]?.[role]
}

export function relicsUnlockedByRebirth(rebirth: number, role?: Role): RelicDef[] {
  return RELICS.filter(
    (r) => rebirth >= r.needRebirth && (role === undefined || r.role === role),
  )
}

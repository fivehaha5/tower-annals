import type { GearDef, Rarity, Slot, Stats } from '../types'

export const SLOTS: Slot[] = ['weapon', 'hat', 'armor', 'gloves', 'boots', 'mount']

export const SLOT_LABEL: Record<Slot, string> = {
  weapon: '武器',
  hat: '頭飾',
  armor: '衣服',
  gloves: '手套',
  boots: '鞋子',
  mount: '坐騎',
}

export const RARITY_ORDER: Rarity[] = ['普通', '優秀', '精良', '史詩', '傳說', '神話']

export const RARITY_COLOR: Record<Rarity, string> = {
  普通: '#9aa3a0',
  優秀: '#6bc46d',
  精良: '#5aa8ff',
  史詩: '#c07bff',
  傳說: '#ffb84d',
  神話: '#ff6b8a',
}

/**
 * 鍛造爐稀有權重：升爐後低階降至 0%（對齊 FM shot-03）。
 * 索引 0 = 爐 Lv1；超出用最後一列。
 */
export const RARITY_WEIGHT_BY_FORGE: number[][] = [
  // 1
  [70, 30, 0, 0, 0, 0],
  // 2
  [50, 35, 15, 0, 0, 0],
  // 3
  [35, 35, 22, 8, 0, 0],
  // 4
  [20, 32, 28, 15, 5, 0],
  // 5 — 普通開始被擠
  [8, 28, 30, 22, 10, 2],
  // 6 — 普通 → 0
  [0, 22, 32, 26, 14, 6],
  // 7
  [0, 12, 30, 28, 20, 10],
  // 8 — 優秀 → 0
  [0, 0, 26, 32, 26, 16],
  // 9
  [0, 0, 16, 32, 30, 22],
  // 10 — 精良開始降
  [0, 0, 6, 30, 34, 30],
  // 11 — 精良 → 0
  [0, 0, 0, 28, 36, 36],
  // 12+
  [0, 0, 0, 18, 40, 42],
]

const NAMES: Record<Slot, string[]> = {
  weapon: ['木棒', '鐵劍', '菇刃', '星輝杖', '龍脊弓', '虛空大劍'],
  hat: ['布帽', '皮盔', '菇冠', '符文帽', '星冕', '神話盔'],
  armor: ['破布衣', '皮甲', '菇甲', '鱗片衣', '星織袍', '不滅甲'],
  gloves: ['布手套', '皮護手', '菇拳套', '符紋手套', '星火手', '虛空手甲'],
  boots: ['草鞋', '皮靴', '菇靴', '疾風靴', '星軌靴', '虛空步'],
  mount: ['木輪車', '野菇驢', '孢子鹿', '鐵甲豬', '星螢獸', '虛空坐騎'],
}

function makeGear(): GearDef[] {
  const list: GearDef[] = []
  for (const slot of SLOTS) {
    RARITY_ORDER.forEach((rarity, ri) => {
      const name = NAMES[slot][ri] ?? `${rarity}${SLOT_LABEL[slot]}`
      const mult = 1 + ri * 0.85
      const base: Partial<Stats> = {}
      if (slot === 'weapon') {
        base.atk = Math.round(6 * mult)
        base.crit = Math.round(1 * mult)
      } else if (slot === 'hat') {
        base.hp = Math.round(18 * mult)
        base.def = Math.round(2 * mult)
      } else if (slot === 'armor') {
        base.def = Math.round(5 * mult)
        base.hp = Math.round(28 * mult)
      } else if (slot === 'gloves') {
        base.atk = Math.round(3 * mult)
        base.spd = Math.round(1 * mult)
      } else if (slot === 'boots') {
        base.spd = Math.round(3 * mult)
        base.def = Math.round(2 * mult)
      } else {
        base.atk = Math.round(4 * mult)
        base.hp = Math.round(20 * mult)
        base.spd = Math.round(2 * mult)
      }
      list.push({
        id: `${slot}_${ri}`,
        name,
        slot,
        rarity,
        base,
        forgeMin: Math.max(1, ri),
      })
    })
  }
  return list
}

export const GEAR: GearDef[] = makeGear()
export const GEAR_MAP = Object.fromEntries(GEAR.map((g) => [g.id, g])) as Record<string, GearDef>

export function rarityWeightsAt(forgeLevel: number): number[] {
  const idx = Math.min(RARITY_WEIGHT_BY_FORGE.length - 1, Math.max(0, forgeLevel - 1))
  return [...RARITY_WEIGHT_BY_FORGE[idx]]
}

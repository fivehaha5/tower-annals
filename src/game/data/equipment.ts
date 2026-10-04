import type { EquipDef, EquipSlot, Role, Stats } from '../types'
import { RARITY_ORDER } from '../util'
import { EQUIP_TIER_SCALE } from '../balance'

export const EQUIP_SLOTS: EquipSlot[] = [
  'weapon',
  'helmet',
  'chest',
  'legs',
  'gloves',
  'ring',
  'necklace',
]

export const EQUIP_SLOT_LABEL: Record<EquipSlot, string> = {
  weapon: '武器',
  helmet: '頭盔',
  chest: '胸甲',
  legs: '護腿',
  gloves: '手甲',
  ring: '戒指',
  necklace: '項鍊',
}

const NAMES: Record<EquipSlot, Record<Role, string[]>> = {
  weapon: {
    warrior: ['裂塔刃', '衛戍巨劍', '熔金戰斧', '斷層長刀'],
    mage: ['異晶法杖', '雷弧魔導', '霜核權杖', '虛空書卷'],
    priest: ['聖律權杖', '光帷念珠', '潮汐念珠', '淨罪十字架'],
  },
  helmet: {
    warrior: ['鐵衛盔', '熔紋盔', '斷層面甲', '塔心冠'],
    mage: ['符文風帽', '雷篆冠', '虛律鏡盔', '異史頭環'],
    priest: ['聖律兜帽', '光帷冕', '潮燈笠', '守夜冠'],
  },
  chest: {
    warrior: ['塔衛胸甲', '熔紋戰鎧', '深層板甲', '指揮官披甲'],
    mage: ['符文法袍', '賽博禮裝', '星史長袍', '折疊外衣'],
    priest: ['聖堂祭服', '守夜法衣', '光織長袍', '暗潮外袍'],
  },
  legs: {
    warrior: ['衛戍護腿', '熔線脛甲', '裂層護膝', '鐵凰腿甲'],
    mage: ['法陣長褲', '霜核裹腿', '虛空綁腿', '編年裙甲'],
    priest: ['聖律護腿', '光帷脛衣', '潮汐綁腿', '安魂裙'],
  },
  gloves: {
    warrior: ['破軍手甲', '鐵壁護手', '裂空拳套', '塔衛腕鎧'],
    mage: ['雷弧手套', '霜核指套', '虛律手帷', '熔晶腕箍'],
    priest: ['祈願手套', '光帷護手', '連禱腕帶', '淨罪手甲'],
  },
  ring: {
    warrior: ['戰意指環', '破軍戒', '鐵壁環', '塔芯戒'],
    mage: ['法陣戒', '精華環', '異界戒', '折光戒'],
    priest: ['祈願戒', '回響環', '聖痕戒', '魂燈戒'],
  },
  necklace: {
    warrior: ['衛戍項鍊', '熔金頸飾', '斷層墜', '指揮官鏈'],
    mage: ['符文項鍊', '雷篆墜', '虛空鏈', '晶棺墜'],
    priest: ['聖律項鍊', '光帷墜', '潮燈鏈', '永念墜'],
  },
}

function rarityForTier(tier: number): EquipDef['rarity'] {
  const i = Math.min(RARITY_ORDER.length - 1, Math.floor(tier / 2))
  return RARITY_ORDER[i]
}

function bonusFor(slot: EquipSlot, scale: number): Partial<Stats> {
  switch (slot) {
    case 'weapon':
      return { atk: Math.floor(22 * scale), shield: Math.floor(4 * scale) }
    case 'helmet':
      return { hp: Math.floor(45 * scale), def: Math.floor(10 * scale) }
    case 'chest':
      return { hp: Math.floor(90 * scale), def: Math.floor(14 * scale) }
    case 'legs':
      return { hp: Math.floor(55 * scale), def: Math.floor(11 * scale), shield: Math.floor(8 * scale) }
    case 'gloves':
      return { atk: Math.floor(12 * scale), def: Math.floor(6 * scale) }
    case 'ring':
      return { atk: Math.floor(10 * scale), shield: Math.floor(18 * scale) }
    case 'necklace':
      return { hp: Math.floor(40 * scale), shield: Math.floor(28 * scale), atk: Math.floor(6 * scale) }
  }
}

export function makeEquipDef(role: Role, slot: EquipSlot, tier: number): EquipDef {
  const pool = NAMES[slot][role]
  const name = `${pool[tier % pool.length]} · T${tier}`
  const rarity = rarityForTier(tier)
  const scale = 1 + tier * EQUIP_TIER_SCALE
  return {
    id: `${role}_${slot}_t${tier}`,
    name,
    role,
    slot,
    tier,
    rarity,
    bonus: bonusFor(slot, scale),
  }
}

export function parseEquipDefId(defId: string): { role: Role; slot: EquipSlot; tier: number } | null {
  const m = defId.match(/^(warrior|mage|priest)_(weapon|helmet|chest|legs|gloves|ring|necklace)_t(\d+)$/)
  if (!m) return null
  return { role: m[1] as Role, slot: m[2] as EquipSlot, tier: Number(m[3]) }
}

/** 舊三部位 → 新七部位 */
export function migrateLegacyEquipDefId(defId: string): string {
  return defId
    .replace(/_armor_t/, '_chest_t')
    .replace(/_accessory_t/, '_ring_t')
}

export function equipShopList(maxTier: number): EquipDef[] {
  const roles: Role[] = ['warrior', 'mage', 'priest']
  const out: EquipDef[] = []
  for (let t = 0; t <= maxTier; t++) {
    for (const role of roles) {
      for (const slot of EQUIP_SLOTS) out.push(makeEquipDef(role, slot, t))
    }
  }
  return out
}

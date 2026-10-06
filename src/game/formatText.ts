import { EQUIP_LEVEL_SCALE, SKILL_KIND_COOLDOWN_TURNS } from './balance'
import { makeEquipDef, parseEquipDefId } from './data/equipment'
import type { OwnedEquip, SkillDef, SkillEffect, Stats } from './types'
import { rarityMult } from './util'

/** 倍率顯示：1.25 → 「125%」；整數百分比不帶小數 */
export function pctLabel(v: number): string {
  const p = v * 100
  const rounded = Math.abs(p - Math.round(p)) < 0.05 ? Math.round(p) : Math.round(p * 10) / 10
  return `${rounded}%`
}

/** 係數顯示：1.25 → 「×1.25」 */
export function multLabel(v: number): string {
  const s = v.toFixed(2).replace(/\.?0+$/, '')
  return `×${s}`
}

function effectTag(e: SkillEffect): string {
  const v = e.value
  switch (e.id) {
    case 'chargeShield':
      return `次數盾${Math.floor(v ?? 1)}層`
    case 'overhealToShield':
      return `過量治療${pctLabel(v ?? 0)}轉盾`
    case 'trueDamage':
      return `真實傷害${pctLabel(v ?? 0)}`
    case 'pierceShield':
      return `穿盾${pctLabel(v ?? 0)}`
    case 'fogBreak':
      return '破霧'
    case 'antiHealCut':
      return '禁療'
    case 'darkAmp':
      return `暗傷+${pctLabel(v ?? 0)}`
    case 'shieldLeech':
      return `護盾吸血${pctLabel(v ?? 0)}`
    case 'gateBreak':
      return '破門禁'
    case 'mirrorCast':
      return `鏡寫再施${pctLabel(v ?? 0)}`
    case 'balanceHeal':
      return `低血額外療${pctLabel(v ?? 0)}`
    case 'poisonTick':
      return `毒傷${pctLabel(v ?? 0)}/回合`
    case 'vsBoss':
      return `對王階+${pctLabel(v ?? 0)}`
    default:
      return e.id
  }
}

/** 攻／盾／療係數一行（含屬性、CD） */
export function skillPowerLine(def: SkillDef): string {
  const bits: string[] = []
  if (def.power > 0) bits.push(`攻${multLabel(def.power)}`)
  if (def.shieldPower > 0) bits.push(`盾${multLabel(def.shieldPower)}`)
  if (def.healPower > 0) bits.push(`療${multLabel(def.healPower)}`)
  bits.push(def.element)
  bits.push(`CD${SKILL_KIND_COOLDOWN_TURNS}`)
  if (def.source === 'antiKing' || def.effects?.some((e) => e.id === 'vsBoss')) {
    bits.push('克制王階')
  }
  return bits.join(' · ')
}

/** 特殊效果標籤（次數盾、真實傷害、對王階等） */
export function skillSpecialLine(def: SkillDef): string {
  if (!def.effects?.length) return ''
  return def.effects.map(effectTag).join('、')
}

/**
 * 技能效果短描述：一句話＋關鍵數值。
 * 優先用 data.desc（應已含機制語意），再補係數／特效數字。
 */
export function skillEffectLine(def: SkillDef): string {
  const power = skillPowerLine(def)
  const special = skillSpecialLine(def)
  const base = (def.desc || '').trim()
  if (base && special) return `${base}（${power}；${special}）`
  if (base) return `${base}（${power}）`
  if (special) return `${power}；${special}`
  return power
}

/** 裝備基礎／實戰屬性一行 */
export function equipStatLine(bonus: Partial<Stats>): string {
  const bits: string[] = []
  if (bonus.atk) bits.push(`攻+${bonus.atk}`)
  if (bonus.hp) bits.push(`血+${bonus.hp}`)
  if (bonus.def) bits.push(`防+${bonus.def}`)
  if (bonus.shield) bits.push(`盾+${bonus.shield}`)
  return bits.length ? bits.join(' ') : '無屬性'
}

/** 含強化等級與品質倍率後的裝備實戰數值（enhanceLevel 缺省則用本體舊 level） */
export function ownedEquipStatLine(owned: OwnedEquip, enhanceLevel?: number): string {
  const p = parseEquipDefId(owned.defId)
  if (!p) return '—'
  const def = makeEquipDef(p.role, p.slot, p.tier)
  const lv = enhanceLevel ?? owned.level ?? 0
  const scale = (1 + lv * EQUIP_LEVEL_SCALE) * rarityMult(owned.rarity)
  const bonus: Partial<Stats> = {
    hp: Math.floor((def.bonus.hp ?? 0) * scale),
    atk: Math.floor((def.bonus.atk ?? 0) * scale),
    def: Math.floor((def.bonus.def ?? 0) * scale),
    shield: Math.floor((def.bonus.shield ?? 0) * scale),
  }
  return equipStatLine(bonus)
}

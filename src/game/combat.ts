import { CHAR_MAP } from './data/characters'
import { EQUIP_SLOTS, makeEquipDef, parseEquipDefId } from './data/equipment'
import { RELIC_MAP } from './data/relics'
import { SKILL_MAP } from './data/skills'
import { buildEnemy } from './enemies'
import { rollClearLoot } from './drops'
import { roleRebirthBonus } from './mechanics'
import type {
  BattleSnapshot,
  Element,
  GameState,
  LootDrop,
  OwnedCharacter,
  OwnedSkill,
  Resources,
  Role,
  SkillKind,
  Stats,
} from './types'
import {
  addStats,
  ascendMult,
  defaultFormation,
  defaultSkillCastOrder,
  elementMult,
  emptyLootCost,
  emptyStats,
  maxEquipTierForRebirth,
  rarityMult,
  rebirthMult,
  scaleStats,
  type LootCost,
} from './util'
import { EQUIP_LEVEL_SCALE, SKILL_LEVEL_SCALE, UNIQUE_SKILL_BONUS } from './balance'

const ROLES: Role[] = ['warrior', 'mage', 'priest']

export function getOwned(state: GameState, uid?: string): OwnedCharacter | undefined {
  if (!uid) return undefined
  return state.roster.find((c) => c.uid === uid)
}

export function getSkillItem(state: GameState, skillUid?: string): OwnedSkill | undefined {
  if (!skillUid) return undefined
  return state.skillItems?.find((s) => s.uid === skillUid)
}

export function getLoadout(state: GameState, role: Role) {
  return state.loadouts?.[role]
}

export function getRoleCharacter(state: GameState, role: Role): OwnedCharacter | undefined {
  return getOwned(state, state.loadouts?.[role]?.characterUid)
}

export function getEquippedSkill(
  state: GameState,
  role: Role,
  kind: SkillKind,
): OwnedSkill | undefined {
  return getSkillItem(state, state.loadouts?.[role]?.skills?.[kind])
}

export function getTeam(state: GameState): OwnedCharacter[] {
  const order = state.formation?.length ? state.formation : defaultFormation()
  return order
    .map((role) => getRoleCharacter(state, role))
    .filter((c): c is OwnedCharacter => !!c)
}

export function getTeamRoles(state: GameState): { role: Role; ch: OwnedCharacter }[] {
  const order = state.formation?.length ? state.formation : defaultFormation()
  const out: { role: Role; ch: OwnedCharacter }[] = []
  for (const role of order) {
    const ch = getRoleCharacter(state, role)
    if (ch) out.push({ role, ch })
  }
  return out
}

export function workBoostMult(ch: OwnedCharacter): number {
  return 1 + (ch.boost ?? 0) * 0.25
}

function relicEffects(state: GameState, role: Role) {
  const id = state.loadouts?.[role]?.relicId
  return id ? RELIC_MAP[id]?.effect : undefined
}

export function calcCharStats(state: GameState, ch: OwnedCharacter): Stats {
  const def = CHAR_MAP[ch.defId]
  if (!def) return emptyStats()
  const role = def.role
  const loadout = state.loadouts?.[role]
  const wearing = loadout?.characterUid === ch.uid

  let s = addStats(def.base, {
    hp: def.growth.hp * (ch.level - 1),
    atk: def.growth.atk * (ch.level - 1),
    def: def.growth.def * (ch.level - 1),
    shield: def.growth.shield * (ch.level - 1),
  })
  s = scaleStats(s, rarityMult(ch.rarity))
  s = scaleStats(s, ascendMult(ch.ascend ?? 0))
  s = scaleStats(s, rebirthMult(ch.rebirth ?? 0))

  // 裝備僅在出戰格且由該角色出戰時生效
  if (wearing && loadout) {
    for (const slot of EQUIP_SLOTS) {
      const eu = loadout.equips[slot]
      if (!eu) continue
      const owned = state.equips.find((e) => e.uid === eu)
      if (!owned) continue
      const parsed = parseEquipDefId(owned.defId)
      if (!parsed || parsed.role !== role) continue
      if (parsed.tier > maxEquipTierForRebirth(ch.rebirth ?? 0)) continue
      const equip = makeEquipDef(role, parsed.slot, parsed.tier)
      const lvlBonus = 1 + owned.level * EQUIP_LEVEL_SCALE
      const rBonus = rarityMult(owned.rarity)
      s = addStats(s, {
        hp: Math.floor((equip.bonus.hp ?? 0) * lvlBonus * rBonus),
        atk: Math.floor((equip.bonus.atk ?? 0) * lvlBonus * rBonus),
        def: Math.floor((equip.bonus.def ?? 0) * lvlBonus * rBonus),
        shield: Math.floor((equip.bonus.shield ?? 0) * lvlBonus * rBonus),
      })
    }
    const relic = relicEffects(state, role)
    if (relic?.atk) s = scaleStats(s, 1 + relic.atk)
    if (relic?.def) s = scaleStats(s, 1 + relic.def)
    if (relic?.shieldCap) s.shield = Math.floor(s.shield * (1 + relic.shieldCap))
  }

  const ofRole = state.roster.filter((c) => CHAR_MAP[c.defId]?.role === role)
  const bonus = roleRebirthBonus(ofRole)
  if (bonus > 0) s = scaleStats(s, 1 + bonus)

  const dexBonus = 1 + state.dex.length * 0.005
  return scaleStats(s, dexBonus)
}

export function teamPower(state: GameState): number {
  return getTeam(state).reduce((sum, ch) => {
    const s = calcCharStats(state, ch)
    return sum + Math.floor(s.hp * 0.3 + s.shield * 0.25 + s.atk * 8 + s.def * 4)
  }, 0)
}

export function teamTotals(state: GameState): Stats {
  return getTeam(state).reduce((acc, ch) => addStats(acc, calcCharStats(state, ch)), emptyStats())
}

function skillStrength(sk: OwnedSkill | undefined): number {
  if (!sk) return 0.35
  const uniqueBonus = SKILL_MAP[sk.skillId]?.unique ? UNIQUE_SKILL_BONUS : 1
  return (1 + sk.level * SKILL_LEVEL_SCALE) * rarityMult(sk.rarity) * uniqueBonus
}

export function farmFloorOf(state: GameState): number {
  const mode = state.idleMode
  const max = Math.max(1, state.floors[mode] ?? 1)
  const farm = state.farmFloor?.[mode] ?? max
  return Math.max(1, Math.min(farm, max))
}

export function createBattle(state: GameState): BattleSnapshot {
  const floor = farmFloorOf(state)
  const enemy = buildEnemy(state.idleMode, floor)
  const totals = teamTotals(state)
  return {
    teamHp: totals.hp,
    teamMaxHp: totals.hp,
    teamShield: totals.shield,
    teamMaxShield: totals.shield,
    enemy,
    log: '掛機戰鬥中…',
    winning: teamPower(state) >= enemy.power * 0.85,
    chargeShield: 0,
  }
}

function applyDamage(
  hp: number,
  shield: number,
  dmg: number,
  pierce = 0,
): { hp: number; shield: number } {
  let sh = shield
  let h = hp
  let left = Math.max(0, dmg)
  const pierceAmt = Math.floor(left * Math.min(1, Math.max(0, pierce)))
  left -= pierceAmt
  h = Math.max(0, h - pierceAmt)
  if (sh > 0) {
    const absorb = Math.min(sh, left)
    sh -= absorb
    left -= absorb
  }
  h = Math.max(0, h - left)
  return { hp: h, shield: sh }
}

function hasEffect(skillId: string, id: string): number {
  const eff = SKILL_MAP[skillId]?.effects?.find((e) => e.id === id)
  return eff ? (eff.value ?? 1) : 0
}

export function battleTick(state: GameState): {
  cleared: boolean
  resources: Partial<Resources>
  loot: LootDrop
  lootCost: LootCost
  aimCancelled?: boolean
} {
  if (!state.battle) state.battle = createBattle(state)
  const b = state.battle
  const teamEntries = getTeamRoles(state)
  if (teamEntries.length === 0) {
    b.log = '尚未編成隊伍'
    return { cleared: false, resources: {}, loot: {}, lootCost: emptyLootCost() }
  }

  const castOrder = state.skillCastOrder?.length
    ? state.skillCastOrder
    : defaultSkillCastOrder()
  let dealt = 0
  let healed = 0
  let shielded = 0
  let trueDealt = 0
  let overhealRatio = 0
  let antiHeal = false
  let fogBreak = false
  let darkAmp = 0
  let shieldLeech = 0
  let pierce = 0
  let mirror = 0

  for (const { role, ch } of teamEntries) {
    const stats = calcCharStats(state, ch)
    const relic = relicEffects(state, role)
    if (relic?.overhealToShield) overhealRatio = Math.max(overhealRatio, relic.overhealToShield)
    if (relic?.trueDamageBonus) trueDealt += stats.atk * relic.trueDamageBonus * 0.3
    if (relic?.heal) healed += stats.atk * 0.05 * relic.heal

    for (const kind of castOrder) {
      const owned = getEquippedSkill(state, role, kind)
      const skill = owned ? SKILL_MAP[owned.skillId] : undefined
      if (!skill) continue
      const str = skillStrength(owned)
      let mult = elementMult(skill.element as Element, b.enemy.element)
      if (hasEffect(skill.id, 'fogBreak')) fogBreak = true
      if (hasEffect(skill.id, 'trueDamage')) {
        const tv = hasEffect(skill.id, 'trueDamage')
        trueDealt += stats.atk * skill.power * str * tv
        mult = 1
      }
      if (b.enemy.mechanic === 'fogLayer' && skill.element !== '水' && !fogBreak) {
        mult *= 0.65
      }
      if (hasEffect(skill.id, 'darkAmp') && skill.element === '暗') {
        darkAmp = Math.max(darkAmp, hasEffect(skill.id, 'darkAmp'))
        mult *= 1 + darkAmp
      }
      dealt += stats.atk * skill.power * str * mult * (kind === 'attack' ? 1 : 0.55)
      let h = stats.atk * skill.healPower * str
      if (relic?.heal) h *= 1 + relic.heal
      if (hasEffect(skill.id, 'balanceHeal') && b.teamHp < b.teamMaxHp * 0.5) {
        h *= 1 + hasEffect(skill.id, 'balanceHeal')
      }
      healed += h
      shielded +=
        stats.shield * 0.04 * skill.shieldPower * str +
        stats.atk * skill.shieldPower * 0.12 * str +
        (kind === 'defense' ? stats.def * 0.35 * str : 0)
      const cs = hasEffect(skill.id, 'chargeShield')
      if (cs) b.chargeShield = (b.chargeShield ?? 0) + Math.floor(cs)
      if (hasEffect(skill.id, 'overhealToShield')) {
        overhealRatio = Math.max(overhealRatio, hasEffect(skill.id, 'overhealToShield'))
      }
      if (hasEffect(skill.id, 'antiHealCut')) antiHeal = true
      if (hasEffect(skill.id, 'pierceShield')) {
        pierce = Math.max(pierce, hasEffect(skill.id, 'pierceShield'))
      }
      if (hasEffect(skill.id, 'shieldLeech')) {
        shieldLeech = Math.max(shieldLeech, hasEffect(skill.id, 'shieldLeech'))
      }
      if (hasEffect(skill.id, 'mirrorCast')) mirror = Math.max(mirror, hasEffect(skill.id, 'mirrorCast'))
      if (hasEffect(skill.id, 'gateBreak') && b.enemy.gateCharges) {
        b.enemy.gateCharges = Math.max(0, (b.enemy.gateCharges ?? 0) - 1)
      }
    }
  }

  if (mirror > 0) {
    dealt *= 1 + mirror * 0.35
    healed *= 1 + mirror * 0.35
    shielded *= 1 + mirror * 0.35
  }

  // Boss 機制：編譯錯位
  if (b.enemy.mechanic === 'compileShift') {
    const pool: Element[] = ['火', '水', '雷', '光', '暗']
    b.enemy.element = pool[Math.floor(Math.random() * pool.length)]
  }

  let enemyDefFactor = 1 + b.enemy.atk * 0.0016
  if (b.enemy.mechanic === 'stoneSkin') enemyDefFactor *= 1.15
  if (b.enemy.mechanic === 'mountainSpine') enemyDefFactor *= 1.25

  let dmgToEnemy = Math.floor(dealt / enemyDefFactor) + Math.floor(trueDealt)
  if (b.enemy.mechanic === 'gateBlock' && (b.enemy.gateCharges ?? 0) > 0) {
    b.enemy.gateCharges! -= 1
    dmgToEnemy = 0
  }
  if (b.enemy.mechanic === 'pureLaw') dmgToEnemy = Math.floor(dmgToEnemy * 0.88)

  const er = applyDamage(b.enemy.hp, b.enemy.shield, dmgToEnemy, pierce)
  b.enemy.hp = er.hp
  b.enemy.shield = er.shield

  if (b.enemy.mechanic === 'goldLeech' && !antiHeal && dmgToEnemy > 0) {
    b.enemy.hp = Math.min(b.enemy.maxHp, b.enemy.hp + Math.floor(dmgToEnemy * 0.08))
  }
  if (b.enemy.mechanic === 'dreamHeal') {
    b.enemy.hp = Math.min(b.enemy.maxHp, b.enemy.hp + Math.floor(b.enemy.maxHp * 0.01))
  }
  if (b.enemy.mechanic === 'venomHeart') {
    // 毒反噬：小幅扣我方（下面 incoming 已算）
  }

  let healAmt = Math.floor(healed)
  if (b.enemy.mechanic === 'eternalNight') healAmt = Math.floor(healAmt * 0.5)
  const beforeHp = b.teamHp
  b.teamHp = Math.min(b.teamMaxHp, b.teamHp + healAmt)
  const overflow = healAmt - (b.teamHp - beforeHp)
  let shAdd = Math.floor(shielded)
  if (overflow > 0 && overhealRatio > 0) shAdd += Math.floor(overflow * overhealRatio)
  if (shieldLeech > 0 && dmgToEnemy > 0) shAdd += Math.floor(dmgToEnemy * shieldLeech)
  b.teamShield = Math.min(b.teamMaxShield * 1.5, b.teamShield + shAdd)

  if (b.enemy.mechanic === 'lawCrush') {
    b.teamShield = Math.max(0, b.teamShield - Math.floor(b.teamMaxShield * 0.04))
  }

  const captainRole = state.captainRole ?? 'warrior'
  const captain =
    getRoleCharacter(state, captainRole) ?? teamEntries[0]?.ch
  const captainEl = captain ? CHAR_MAP[captain.defId].element : '光'
  let enemyAtk = b.enemy.atk
  if (b.enemy.mechanic === 'ramCharge') enemyAtk = Math.floor(enemyAtk * 1.2)
  if (b.enemy.mechanic === 'solarBurn') enemyAtk = Math.floor(enemyAtk * 1.1)
  let enemyMult = elementMult(b.enemy.element, captainEl)
  if (b.enemy.mechanic === 'aquaField') enemyMult *= 1.1
  let incoming = Math.floor(enemyAtk * enemyMult * (0.85 + Math.random() * 0.3))
  if (b.enemy.mechanic === 'tideShell' && b.enemy.shield > b.enemy.maxShield * 0.4) {
    // 敵方減傷已在 defFactor；此處略增敵壓
    incoming = Math.floor(incoming * 1.05)
  }
  if (b.enemy.mechanic === 'scaleJudgment') {
    const ratio = b.teamHp / Math.max(1, b.teamMaxHp)
    if (ratio < 0.4) incoming = Math.floor(incoming * 1.15)
  }
  if (b.enemy.mechanic === 'starPierce') {
    // 部分無視護盾
    const pierceIn = Math.floor(incoming * 0.2)
    b.teamHp = Math.max(0, b.teamHp - pierceIn)
    incoming -= pierceIn
  }
  if (b.enemy.mechanic === 'mirrorTwin' && dmgToEnemy > 0) {
    incoming += Math.floor(dmgToEnemy * 0.12)
  }
  if (b.enemy.mechanic === 'venomHeart') {
    incoming += Math.floor(b.teamMaxHp * 0.008)
  }

  // 次數盾
  if ((b.chargeShield ?? 0) > 0 && incoming > 0) {
    b.chargeShield! -= 1
    incoming = Math.floor(incoming * 0.15)
  }

  const mitigated = Math.floor(incoming * (100 / (100 + teamTotals(state).def * 0.15)))
  const tr = applyDamage(b.teamHp, b.teamShield, mitigated)
  b.teamHp = tr.hp
  b.teamShield = tr.shield
  b.log = `造成 ${dmgToEnemy} 傷害 · 受到 ${mitigated} 傷害`
  b.winning = b.teamHp > 0 && teamPower(state) >= b.enemy.power * 0.7

  if (b.enemy.hp <= 0) {
    const resources = clearRewards(state)
    const { loot, cost, aimCancelled } = rollClearLoot(state, state.idleMode)
    return { cleared: true, resources, loot, lootCost: cost, aimCancelled }
  }

  if (b.teamHp <= 0) {
    state.battle = createBattle(state)
    state.battle.log = '隊伍倒下，重整再戰（無懲罰）'
    return { cleared: false, resources: {}, loot: {}, lootCost: emptyLootCost() }
  }

  return { cleared: false, resources: {}, loot: {}, lootCost: emptyLootCost() }
}

export function clearRewards(state: GameState): Partial<Resources> {
  const floor = farmFloorOf(state)
  const mainCrystalBase = Math.floor(12 + floor * 2.0)
  const mainMiniBonus = floor % 10 === 0 ? Math.floor(mainCrystalBase * 1.55) : 0

  if (state.idleMode === 'main') {
    return {
      crystal: mainCrystalBase + mainMiniBonus,
      gold: Math.max(1, Math.floor(2 + floor / 14)),
    }
  }
  if (state.idleMode === 'blueprint') {
    const mainEquivalent = mainCrystalBase + Math.floor(mainCrystalBase * 1.55)
    return {
      crystal: Math.max(1, Math.floor(mainEquivalent * 0.22)),
      blueprint: Math.floor(4 + floor * 0.45),
      forge: Math.max(0, Math.floor(floor * 0.08)),
    }
  }
  if (state.idleMode === 'boss') {
    return {
      crystal: Math.floor(mainCrystalBase * 1.8),
      gold: Math.floor(10 + floor * 2.5),
      soul: Math.max(1, Math.floor(1 + floor * 0.35)),
    }
  }
  return {
    crystal: Math.floor(mainCrystalBase * 2.4),
    gold: Math.floor(18 + floor * 4),
    soul: Math.max(2, Math.floor(2 + floor * 0.8)),
    essence: Math.max(1, Math.floor(floor * 0.4)),
    skillbook: Math.max(1, Math.floor(floor * 0.25)),
  }
}

export function fightingUids(state: GameState): Set<string> {
  const set = new Set<string>()
  for (const role of ROLES) {
    const u = state.loadouts?.[role]?.characterUid
    if (u) set.add(u)
  }
  return set
}

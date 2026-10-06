import { CHAR_MAP } from './data/characters'
import { EQUIP_SLOTS, makeEquipDef, parseEquipDefId } from './data/equipment'
import { RELIC_MAP } from './data/relics'
import { SKILL_MAP } from './data/skills'
import { buildEnemy } from './enemies'
import { rollClearLoot } from './drops'
import { roleRebirthBonus } from './mechanics'
import type {
  BattleFloater,
  BattleSnapshot,
  Element,
  EquipSlot,
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
  ROLE_LABEL,
  scaleStats,
  type LootCost,
} from './util'
import {
  BASIC_ATTACK_POWER,
  BERSERK_AFTER_ROUNDS,
  BERSERK_BURN_BASE,
  BERSERK_BURN_GROW,
  BERSERK_DMG_GROW,
  BERSERK_DMG_MULT,
  BOSS_CLEAR_KING_BADGE,
  BOSS_CLEAR_KING_BADGE_BONUS,
  BOSS_FAIL_KING_BADGE_CHANCE,
  CP_UNDERDOG_MITIGATION_EXP,
  ENEMY_DEF_ANCHOR_BONUS,
  ENEMY_DEF_ANCHOR_POWER,
  EQUIP_LEVEL_SCALE,
  FRONTIER_PUSH_MULT,
  SINGLE_SKILL_FOCUS,
  SKILL_CP_WEIGHT,
  SKILL_KIND_COOLDOWN_TURNS,
  UNIQUE_SKILL_BONUS,
  boostWorkBonus,
  skillLevelPowerBonus,
} from './balance'

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

/** 出戰格角色強化等級（換人保留）；未出戰則用角色本體等級 */
export function getCharEnhanceLevel(state: GameState, ch: OwnedCharacter): number {
  const role = CHAR_MAP[ch.defId]?.role
  if (!role) return Math.max(1, ch.level ?? 1)
  const lo = state.loadouts?.[role]
  if (lo?.characterUid === ch.uid) {
    return Math.max(1, lo.charLevel ?? ch.level ?? 1)
  }
  return Math.max(1, ch.level ?? 1)
}

/** 出戰格部位裝備強化等級（換裝保留） */
export function getEquipEnhanceLevel(state: GameState, role: Role, slot: EquipSlot): number {
  const lo = state.loadouts?.[role]
  return Math.max(0, lo?.equipLevels?.[slot] ?? 0)
}

/** 出戰格技能強化等級（換技保留） */
export function getSkillEnhanceLevel(state: GameState, role: Role, kind: SkillKind): number {
  const lo = state.loadouts?.[role]
  return Math.max(1, lo?.skillLevels?.[kind] ?? 1)
}

export function findRoleWearingEquip(
  state: GameState,
  equipUid: string,
): { role: Role; slot: EquipSlot } | null {
  for (const role of ROLES) {
    const equips = state.loadouts?.[role]?.equips ?? {}
    for (const slot of EQUIP_SLOTS) {
      if (equips[slot] === equipUid) return { role, slot }
    }
  }
  return null
}

export function findRoleWearingSkill(
  state: GameState,
  skillUid: string,
): { role: Role; kind: SkillKind } | null {
  const kinds: SkillKind[] = ['attack', 'defense', 'support']
  for (const role of ROLES) {
    const skills = state.loadouts?.[role]?.skills ?? {}
    for (const kind of kinds) {
      if (skills[kind] === skillUid) return { role, kind }
    }
  }
  return null
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
  return 1 + boostWorkBonus(ch.boost ?? 0)
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
  const charLv = getCharEnhanceLevel(state, ch)

  let s = addStats(def.base, {
    hp: def.growth.hp * (charLv - 1),
    atk: def.growth.atk * (charLv - 1),
    def: def.growth.def * (charLv - 1),
    shield: def.growth.shield * (charLv - 1),
  })
  s = scaleStats(s, rarityMult(ch.rarity))
  s = scaleStats(s, ascendMult(ch.ascend ?? 0))
  s = scaleStats(s, rebirthMult(ch.rebirth ?? 0))
  // 增效對戰鬥屬性：前期弱、後期漸強（打工倍率另用 workBoostMult）
  {
    const combatBoost = boostWorkBonus(ch.boost ?? 0) * 0.35
    if (combatBoost > 0) s = scaleStats(s, 1 + combatBoost)
  }

  // 裝備僅在出戰格且由該角色出戰時生效；強化等級綁部位格
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
      const enhance = getEquipEnhanceLevel(state, role, slot)
      const lvlBonus = 1 + enhance * EQUIP_LEVEL_SCALE
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

function skillStrength(sk: OwnedSkill | undefined, enhanceLevel?: number): number {
  if (!sk) return 0.35
  const lv = Math.max(1, enhanceLevel ?? sk.level ?? 1)
  const uniqueBonus = SKILL_MAP[sk.skillId]?.unique ? UNIQUE_SKILL_BONUS : 1
  return (1 + skillLevelPowerBonus(lv)) * rarityMult(sk.rarity) * uniqueBonus
}

/** 與敵方顯示戰力共用：血／盾／攻／防加權 */
export function combatPowerFromStats(s: Stats): number {
  return Math.floor(s.hp * 0.3 + s.shield * 0.25 + s.atk * 8 + s.def * 4)
}

/** 出戰技能爆發倍率估價（含等級／稀有度／單技能補償） */
export function roleSkillBurstScore(state: GameState, role: Role): number {
  const castOrder = state.skillCastOrder?.length
    ? state.skillCastOrder
    : defaultSkillCastOrder()
  let best = BASIC_ATTACK_POWER
  for (const kind of castOrder) {
    const owned = getEquippedSkill(state, role, kind)
    if (!owned) continue
    const skill = SKILL_MAP[owned.skillId]
    if (!skill) continue
    const str = skillStrength(owned, getSkillEnhanceLevel(state, role, kind)) * SINGLE_SKILL_FOCUS
    const kindFactor = kind === 'attack' ? 1 : kind === 'support' ? 0.65 : 0.55
    const score = Math.max(skill.power, 0.35) * str * kindFactor
    if (score > best) best = score
  }
  return best
}

/**
 * 隊伍戰力：角色面板 + 出戰技能爆發。
 * 舊版不算技能，會出現「戰力 1.3M 卻秒殺 3M」的錯覺。
 */
export function teamPower(state: GameState): number {
  return getTeam(state).reduce((sum, ch) => {
    const def = CHAR_MAP[ch.defId]
    if (!def) return sum
    const s = calcCharStats(state, ch)
    const base = combatPowerFromStats(s)
    const burst = roleSkillBurstScore(state, def.role)
    // 普攻基準 ≈0.7；高出的部分視為技能對有效輸出／戰力的貢獻
    const skillCp = Math.floor(s.atk * 8 * Math.max(0, burst - BASIC_ATTACK_POWER) * SKILL_CP_WEIGHT)
    return sum + base + skillCp
  }, 0)
}

/** 敵方減傷：無硬頂，20 萬錨點約 ×15，其後隨戰力續增 */
export function enemyDefenseFactor(enemyPower: number, mechanic?: BattleSnapshot['enemy']['mechanic']): number {
  const p = Math.max(1, enemyPower)
  const scale = Math.pow(p / ENEMY_DEF_ANCHOR_POWER, 0.62)
  let factor = 1 + ENEMY_DEF_ANCHOR_BONUS * scale
  if (mechanic === 'stoneSkin') factor *= 1.15
  if (mechanic === 'mountainSpine') factor *= 1.25
  return factor
}

export function teamTotals(state: GameState): Stats {
  return getTeam(state).reduce((acc, ch) => addStats(acc, calcCharStats(state, ch)), emptyStats())
}

export function farmFloorOf(state: GameState): number {
  const mode = state.idleMode
  const max = Math.max(1, state.floors[mode] ?? 1)
  const farm = state.farmFloor?.[mode] ?? max
  return Math.max(1, Math.min(farm, max))
}

export function createBattle(state: GameState): BattleSnapshot {
  const floor = farmFloorOf(state)
  const mode = state.idleMode
  const enemy = buildEnemy(mode, floor)
  // 沖在解鎖最高層：額外加壓；降層掛機不套用
  const unlocked = Math.max(1, state.floors[mode] ?? 1)
  const atFrontier =
    floor >= unlocked &&
    (mode === 'main' || mode === 'blueprint' || mode === 'skill' || mode === 'hunt')
  if (atFrontier && FRONTIER_PUSH_MULT > 1) {
    const m = FRONTIER_PUSH_MULT
    enemy.hp = Math.max(1, Math.floor(enemy.hp * m))
    enemy.maxHp = enemy.hp
    enemy.shield = Math.floor(enemy.shield * m)
    enemy.maxShield = enemy.shield
    enemy.atk = Math.max(1, Math.floor(enemy.atk * m))
    enemy.power = Math.max(1, Math.floor(enemy.power * m))
  }
  const totals = teamTotals(state)
  return {
    teamHp: totals.hp,
    teamMaxHp: totals.hp,
    teamShield: totals.shield,
    teamMaxShield: totals.shield,
    enemy,
    log: atFrontier ? '掛機戰鬥中…（前沿加壓）' : '掛機戰鬥中…',
    winning: teamPower(state) >= enemy.power * 0.85,
    chargeShield: 0,
    actIndex: 0,
    roundDmgToEnemy: 0,
    floaters: [],
    skillCds: {},
    roundsElapsed: 0,
    berserk: false,
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

/**
 * 戰鬥節拍：每 tick 僅一名隊員依陣型左→右出手；三人皆出手後敵方攻擊一次。
 * 隊員出手時只施放一個就緒技能（依施法優先序）；同種類有短冷卻，全在 CD 則普攻。
 */
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
    b.floaters = []
    return { cleared: false, resources: {}, loot: {}, lootCost: emptyLootCost() }
  }

  const partyN = teamEntries.length
  const cycle = partyN + 1 // 最後一步為敵方
  let act = b.actIndex ?? 0
  if (act < 0 || act >= cycle) act = 0
  b.floaters = []

  if (act < partyN) {
    resolvePartyAction(state, b, teamEntries[act]!)
  } else {
    resolveEnemyAction(state, b, teamEntries)
  }

  b.actIndex = (act + 1) % cycle
  if (b.actIndex === 0) b.roundDmgToEnemy = 0

  b.winning = b.teamHp > 0 && teamPower(state) >= b.enemy.power * 0.7

  if (b.enemy.hp <= 0) {
    const resources = clearRewards(state)
    const { loot, cost, aimCancelled } = rollClearLoot(state, state.idleMode)
    return { cleared: true, resources, loot, lootCost: cost, aimCancelled }
  }

  if (b.teamHp <= 0) {
    const floor = farmFloorOf(state)
    // 戰敗懲罰：水晶告急時免罰，打斷死亡螺旋；後期仍有感
    const broke = state.resources.crystal < 40
    const crystalLoss = broke
      ? 0
      : Math.min(
          state.resources.crystal,
          Math.floor(2 + floor * 0.18 + Math.max(0, floor - 100) * 0.18),
        )
    const goldLoss = broke
      ? 0
      : Math.min(state.resources.gold, Math.max(0, Math.floor(floor / 70)))
    state.resources.crystal -= crystalLoss
    state.resources.gold -= goldLoss
    const failGains: Partial<Resources> = {}
    if (
      (state.idleMode === 'boss' || state.idleMode === 'godking') &&
      Math.random() < BOSS_FAIL_KING_BADGE_CHANCE
    ) {
      failGains.kingBadge = 1
    }
    state.battle = createBattle(state)
    const lossTip =
      crystalLoss || goldLoss
        ? `（損失 ${crystalLoss} 水晶${goldLoss ? `、${goldLoss} 金鑽` : ''}）`
        : ''
    const badgeTip = failGains.kingBadge ? ' · 拾得破王徽' : ''
    state.battle.log = `隊伍倒下，重整再戰${lossTip}${badgeTip}`
    if (crystalLoss || goldLoss) {
      state.pendingToast = `戰敗懲罰：-${crystalLoss} 水晶${goldLoss ? `、-${goldLoss} 金鑽` : ''}`
    } else if (failGains.kingBadge) {
      state.pendingToast = '戰敗拾得破王徽 ×1'
    }
    return { cleared: false, resources: failGains, loot: {}, lootCost: emptyLootCost() }
  }

  return { cleared: false, resources: {}, loot: {}, lootCost: emptyLootCost() }
}

const SKILL_KINDS: SkillKind[] = ['attack', 'defense', 'support']

function roleSkillCds(
  b: BattleSnapshot,
  role: Role,
): Partial<Record<SkillKind, number>> {
  b.skillCds ??= {}
  b.skillCds[role] ??= {}
  return b.skillCds[role]!
}

/** 推進該角色其餘技能冷卻（剛施放的種類本回合不扣） */
function advanceRoleSkillCds(
  cds: Partial<Record<SkillKind, number>>,
  justCast?: SkillKind,
) {
  for (const kind of SKILL_KINDS) {
    if (kind === justCast) continue
    const left = cds[kind] ?? 0
    if (left <= 0) {
      delete cds[kind]
      continue
    }
    const next = left - 1
    if (next <= 0) delete cds[kind]
    else cds[kind] = next
  }
}

function pickReadySkill(
  state: GameState,
  role: Role,
  cds: Partial<Record<SkillKind, number>>,
): { kind: SkillKind; owned: OwnedSkill } | undefined {
  const castOrder = state.skillCastOrder?.length
    ? state.skillCastOrder
    : defaultSkillCastOrder()
  for (const kind of castOrder) {
    if ((cds[kind] ?? 0) > 0) continue
    const owned = getEquippedSkill(state, role, kind)
    if (!owned || !SKILL_MAP[owned.skillId]) continue
    return { kind, owned }
  }
  return undefined
}

function resolvePartyAction(
  state: GameState,
  b: BattleSnapshot,
  entry: { role: Role; ch: OwnedCharacter },
) {
  const { role, ch } = entry
  const cds = roleSkillCds(b, role)
  const picked = pickReadySkill(state, role, cds)

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
  let actionLabel = '普攻'

  const stats = calcCharStats(state, ch)
  const relic = relicEffects(state, role)
  const skillPow = 1 + (relic?.skillPower ?? 0)
  if (relic?.overhealToShield) overhealRatio = Math.max(overhealRatio, relic.overhealToShield)
  if (relic?.trueDamageBonus) {
    trueDealt += stats.atk * relic.trueDamageBonus * 0.3
  }
  if (relic?.heal) {
    healed += stats.atk * 0.05 * relic.heal
  }

  if (picked) {
    const { kind, owned } = picked
    const skill = SKILL_MAP[owned.skillId]!
    actionLabel = skill.name
    const str = skillStrength(owned, getSkillEnhanceLevel(state, role, kind)) * skillPow * SINGLE_SKILL_FOCUS
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
    // 克制王階：對 isBoss（王塔／神王等）敵人額外倍率
    const vsBoss = hasEffect(skill.id, 'vsBoss')
    if (vsBoss > 0 && b.enemy.isBoss) {
      const bossMult = 1 + vsBoss
      dealt *= bossMult
      trueDealt *= bossMult
    }
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
    cds[kind] = SKILL_KIND_COOLDOWN_TURNS
  } else {
    // 就緒技能皆在冷卻或未裝備 → 普攻，戰鬥仍前進
    const el = CHAR_MAP[ch.defId]?.element ?? '光'
    const mult = elementMult(el, b.enemy.element)
    dealt += stats.atk * BASIC_ATTACK_POWER * mult
  }

  advanceRoleSkillCds(cds, picked?.kind)

  if (mirror > 0) {
    const m = 1 + mirror * 0.35
    dealt *= m
    healed *= m
    shielded *= m
    trueDealt *= m
  }

  let enemyDefFactor = enemyDefenseFactor(b.enemy.power, b.enemy.mechanic)

  let dmgToEnemy = Math.floor(dealt / enemyDefFactor) + Math.floor(trueDealt)
  // 真實傷害仍吃戰力差距軟閘，避免純真傷無視高戰力怪
  const tp = Math.max(1, teamPower(state))
  const cpRatio = b.enemy.power / tp
  if (cpRatio > 1.1) {
    dmgToEnemy = Math.floor(dmgToEnemy / Math.pow(cpRatio / 1.1, CP_UNDERDOG_MITIGATION_EXP))
  }
  if (b.enemy.mechanic === 'gateBlock' && (b.enemy.gateCharges ?? 0) > 0) {
    b.enemy.gateCharges! -= 1
    dmgToEnemy = 0
  }
  if (b.enemy.mechanic === 'pureLaw') dmgToEnemy = Math.floor(dmgToEnemy * 0.88)

  const er = applyDamage(b.enemy.hp, b.enemy.shield, dmgToEnemy, pierce)
  b.enemy.hp = er.hp
  b.enemy.shield = er.shield
  b.roundDmgToEnemy = (b.roundDmgToEnemy ?? 0) + dmgToEnemy

  if (b.enemy.mechanic === 'goldLeech' && !antiHeal && dmgToEnemy > 0) {
    b.enemy.hp = Math.min(b.enemy.maxHp, b.enemy.hp + Math.floor(dmgToEnemy * 0.08))
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

  const floaters: BattleFloater[] = []
  if (dmgToEnemy > 0) {
    floaters.push({ role, text: `${ROLE_LABEL[role]} -${dmgToEnemy}`, kind: 'dmg' })
  }
  if (healAmt > 0) {
    floaters.push({ role, text: `${ROLE_LABEL[role]} +${healAmt}`, kind: 'heal' })
  }
  if (shAdd > 0) {
    floaters.push({ role, text: `${ROLE_LABEL[role]} 盾+${shAdd}`, kind: 'shield' })
  }
  b.floaters = floaters
  if (floaters.length > 0) b.floaterSeq = (b.floaterSeq ?? 0) + 1

  const bits: string[] = [`${ROLE_LABEL[role]}·${actionLabel}`]
  if (dmgToEnemy > 0) bits.push(`造成 ${dmgToEnemy}`)
  if (healAmt > 0) bits.push(`治療 ${healAmt}`)
  if (shAdd > 0) bits.push(`護盾 +${shAdd}`)
  b.log = bits.join(' · ')
}

function resolveEnemyAction(
  state: GameState,
  b: BattleSnapshot,
  teamEntries: { role: Role; ch: OwnedCharacter }[],
) {
  // Boss 機制：編譯錯位（每輪敵方回合改屬性）
  if (b.enemy.mechanic === 'compileShift') {
    const pool: Element[] = ['火', '水', '雷', '光', '暗']
    b.enemy.element = pool[Math.floor(Math.random() * pool.length)]
  }

  if (b.enemy.mechanic === 'dreamHeal') {
    b.enemy.hp = Math.min(b.enemy.maxHp, b.enemy.hp + Math.floor(b.enemy.maxHp * 0.01))
  }

  if (b.enemy.mechanic === 'lawCrush') {
    b.teamShield = Math.max(0, b.teamShield - Math.floor(b.teamMaxShield * 0.04))
  }

  const captainRole = state.captainRole ?? 'warrior'
  const captain = getRoleCharacter(state, captainRole) ?? teamEntries[0]?.ch
  const captainEl = captain ? CHAR_MAP[captain.defId].element : '光'
  let enemyAtk = b.enemy.atk
  if (b.enemy.mechanic === 'ramCharge') enemyAtk = Math.floor(enemyAtk * 1.2)
  if (b.enemy.mechanic === 'solarBurn') enemyAtk = Math.floor(enemyAtk * 1.1)
  let enemyMult = elementMult(b.enemy.element, captainEl)
  if (b.enemy.mechanic === 'aquaField') enemyMult *= 1.1
  let incoming = Math.floor(enemyAtk * enemyMult * (0.85 + Math.random() * 0.3))
  if (b.enemy.mechanic === 'tideShell' && b.enemy.shield > b.enemy.maxShield * 0.4) {
    incoming = Math.floor(incoming * 1.05)
  }
  if (b.enemy.mechanic === 'scaleJudgment') {
    const ratio = b.teamHp / Math.max(1, b.teamMaxHp)
    if (ratio < 0.4) incoming = Math.floor(incoming * 1.15)
  }
  if (b.enemy.mechanic === 'starPierce') {
    const pierceIn = Math.floor(incoming * 0.2)
    b.teamHp = Math.max(0, b.teamHp - pierceIn)
    incoming -= pierceIn
  }
  const roundDmg = b.roundDmgToEnemy ?? 0
  if (b.enemy.mechanic === 'mirrorTwin' && roundDmg > 0) {
    incoming += Math.floor(roundDmg * 0.12)
  }
  if (b.enemy.mechanic === 'venomHeart') {
    incoming += Math.floor(b.teamMaxHp * 0.008)
  }

  // 完整回合結束時累計；≥20 觸發暴走
  const rounds = (b.roundsElapsed ?? 0) + 1
  b.roundsElapsed = rounds
  if (rounds >= BERSERK_AFTER_ROUNDS) {
    b.berserk = true
    const over = rounds - (BERSERK_AFTER_ROUNDS - 1)
    incoming = Math.floor(incoming * (BERSERK_DMG_MULT + (over - 1) * BERSERK_DMG_GROW))
    b.teamShield = Math.floor(b.teamShield * 0.65)
    const burn = Math.floor(b.teamMaxHp * (BERSERK_BURN_BASE + (over - 1) * BERSERK_BURN_GROW))
    b.teamHp = Math.max(0, b.teamHp - burn)
  }

  if ((b.chargeShield ?? 0) > 0 && incoming > 0) {
    b.chargeShield! -= 1
    incoming = Math.floor(incoming * 0.15)
  }

  // 防禦減傷：保留有效減傷，但高防不再把傷害壓到可忽略
  const teamDef = teamTotals(state).def
  const mitigated = Math.max(
    Math.floor(incoming * 0.12),
    Math.floor(incoming * (110 / (110 + teamDef * 0.055))),
  )
  const tr = applyDamage(b.teamHp, b.teamShield, mitigated)
  b.teamHp = tr.hp
  b.teamShield = tr.shield
  b.floaters = []
  b.log = b.berserk
    ? `敵方暴走 · 受到 ${mitigated} 傷害（第 ${rounds} 回合）`
    : `敵方反擊 · 受到 ${mitigated} 傷害`
}

export function clearRewards(state: GameState): Partial<Resources> {
  const floor = farmFloorOf(state)
  // 主塔水晶／微量精華：支撐升級＋技能升級平滑曲線
  const mainCrystalBase = Math.floor(30 + floor * 3.35)
  const mainMiniBonus = floor % 10 === 0 ? Math.floor(mainCrystalBase * 1.25) : 0

  if (state.idleMode === 'main') {
    return {
      crystal: mainCrystalBase + mainMiniBonus,
      gold: Math.max(1, Math.floor(2 + floor / 16)),
      blueprint: Math.max(0, Math.floor(1 + floor * 0.12)),
      essence: Math.max(0, Math.floor(1 + floor * 0.08)),
    }
  }
  if (state.idleMode === 'blueprint') {
    const mainEquivalent = mainCrystalBase + Math.floor(mainCrystalBase * 1.2)
    return {
      crystal: Math.max(1, Math.floor(mainEquivalent * 0.28)),
      blueprint: Math.floor(14 + floor * 1.35),
      forge: Math.max(0, Math.floor(2 + floor * 0.14)),
    }
  }
  if (state.idleMode === 'skill') {
    // 同名技能本由 grantSkillDungeonBooks 發放；此處僅附帶資源
    return {
      crystal: Math.max(1, Math.floor(mainCrystalBase * 0.32)),
      essence: Math.max(1, Math.floor(4 + floor * 0.22)),
    }
  }
  if (state.idleMode === 'hunt') {
    const mini = floor % 5 === 0
    return {
      kingBadge: Math.floor(3 + floor * 0.5) + (mini ? Math.floor(3 + floor * 0.3) : 0),
      crystal: Math.max(1, Math.floor(mainCrystalBase * 0.22)),
    }
  }
  if (state.idleMode === 'boss') {
    return {
      crystal: Math.floor(mainCrystalBase * 1.45),
      gold: Math.floor(6 + floor * 1.6),
      soul: Math.max(1, Math.floor(1 + floor * 0.22)),
      kingBadge:
        BOSS_CLEAR_KING_BADGE + (Math.random() < BOSS_CLEAR_KING_BADGE_BONUS ? 1 : 0),
    }
  }
  if (state.idleMode === 'godking') {
    return {
      crystal: Math.floor(mainCrystalBase * 1.9),
      gold: Math.floor(10 + floor * 2.4),
      soul: Math.max(1, Math.floor(1 + floor * 0.5)),
      essence: Math.max(1, Math.floor(floor * 0.28)),
      skillbook: Math.max(1, Math.floor(floor * 0.22)),
      kingBadge:
        BOSS_CLEAR_KING_BADGE + (Math.random() < BOSS_CLEAR_KING_BADGE_BONUS ? 1 : 0),
    }
  }
  return {
    crystal: Math.floor(mainCrystalBase * 1.9),
    gold: Math.floor(10 + floor * 2.4),
    soul: Math.max(1, Math.floor(1 + floor * 0.5)),
    essence: Math.max(1, Math.floor(floor * 0.28)),
    skillbook: Math.max(1, Math.floor(floor * 0.22)),
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

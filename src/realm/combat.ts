import { MONSTER_MAP } from './data/monsters'
import { SKILL_MAP } from './data/skills'
import { CLASS_MAP } from './data/classes'
import { ITEM_MAP } from './data/items'
import type { BattleState, CombatAction, Combatant, Player, SkillDef } from './types'
import { clamp, fullStats } from './util'

function rollCrit(crit: number): boolean {
  return Math.random() * 100 < clamp(crit, 0, 60)
}

function hitDamage(atk: number, def: number, power: number, crit: number): { dmg: number; crit: boolean } {
  const raw = atk * power
  const mitigated = Math.max(1, Math.floor(raw - def * 0.55 + (Math.random() * 4 - 2)))
  const isCrit = rollCrit(crit)
  return { dmg: isCrit ? Math.floor(mitigated * 1.55) : mitigated, crit: isCrit }
}

export function playerCombatant(player: Player): Combatant {
  const s = fullStats(player)
  return {
    name: player.name,
    level: player.level,
    hp: player.hp,
    maxHp: s.hp,
    mp: player.mp,
    maxMp: s.mp,
    atk: s.atk,
    def: s.def,
    spd: s.spd,
    crit: s.crit,
  }
}

export function monsterCombatant(monsterId: string): Combatant | null {
  const m = MONSTER_MAP[monsterId]
  if (!m) return null
  const scale = 1 + (m.level - 1) * 0.02
  return {
    name: m.name,
    level: m.level,
    hp: Math.floor(m.hp * scale),
    maxHp: Math.floor(m.hp * scale),
    mp: 0,
    maxMp: 0,
    atk: Math.floor(m.atk * scale),
    def: Math.floor(m.def * scale),
    spd: m.spd,
    crit: 5 + Math.floor(m.level / 5),
    monsterId: m.id,
  }
}

export function startBattle(player: Player, monsterId: string): BattleState | null {
  const enemy = monsterCombatant(monsterId)
  if (!enemy) return null
  const p = playerCombatant(player)
  return {
    player: p,
    enemy,
    log: [`遭遇 ${enemy.name}（Lv.${enemy.level}）！`],
    turn: 1,
    over: false,
  }
}

export function classSkills(player: Player): SkillDef[] {
  const ids = CLASS_MAP[player.classId].skillIds
  return ids.map((id) => SKILL_MAP[id]).filter(Boolean)
}

function finishVictory(battle: BattleState): void {
  const m = battle.enemy.monsterId ? MONSTER_MAP[battle.enemy.monsterId] : null
  const drops: string[] = []
  if (m && Math.random() < m.dropChance && m.dropIds.length) {
    drops.push(m.dropIds[Math.floor(Math.random() * m.dropIds.length)])
  }
  // small chance of herbs in moss zone fights
  if (m && (m.id === 'slime' || m.id === 'wolf_pup') && Math.random() < 0.45) {
    drops.push('herb_moss')
  }
  battle.over = true
  battle.victory = true
  battle.rewards = {
    xp: m?.xp ?? 10,
    gold: m?.gold ?? 5,
    drops,
  }
  battle.log.push(`戰勝了 ${battle.enemy.name}！`)
}

function finishDefeat(battle: BattleState): void {
  battle.over = true
  battle.victory = false
  battle.log.push('你被擊敗了……意識退回蒼瀾城。')
}

function enemyTurn(battle: BattleState): void {
  if (battle.over) return
  const { dmg, crit } = hitDamage(battle.enemy.atk, battle.player.def, 1, battle.enemy.crit)
  battle.player.hp = clamp(battle.player.hp - dmg, 0, battle.player.maxHp)
  battle.log.push(
    `${battle.enemy.name} 攻擊，造成 ${dmg} 傷害${crit ? '（暴擊）' : ''}。`,
  )
  if (battle.player.hp <= 0) finishDefeat(battle)
}

export function applyCombatAction(
  battle: BattleState,
  player: Player,
  action: CombatAction,
): BattleState {
  if (battle.over) return battle
  const next: BattleState = {
    ...battle,
    player: { ...battle.player },
    enemy: { ...battle.enemy },
    log: [...battle.log],
  }

  const skills = classSkills(player)

  if (action === 'flee') {
    const chance = clamp(0.35 + (next.player.spd - next.enemy.spd) * 0.03, 0.2, 0.75)
    if (Math.random() < chance) {
      next.over = true
      next.fled = true
      next.log.push('你成功逃離戰鬥。')
      return next
    }
    next.log.push('逃跑失敗！')
    enemyTurn(next)
    next.turn += 1
    return next
  }

  if (action === 'potion') {
    const pot = player.bag.find((b) => {
      const d = ITEM_MAP[b.defId]
      return d?.kind === 'consumable' && (d.healHp || d.healMp) && b.qty > 0
    })
    if (!pot) {
      next.log.push('沒有可用的藥水。')
      return next
    }
    const def = ITEM_MAP[pot.defId]
    if (def.healHp) {
      const before = next.player.hp
      next.player.hp = clamp(next.player.hp + def.healHp, 0, next.player.maxHp)
      next.log.push(`使用 ${def.name}，回復 ${next.player.hp - before} 生命。`)
    }
    if (def.healMp) {
      const before = next.player.mp
      next.player.mp = clamp(next.player.mp + def.healMp, 0, next.player.maxMp)
      next.log.push(`使用 ${def.name}，回復 ${next.player.mp - before} 魔力。`)
    }
    next.pendingPotionUid = pot.uid
    enemyTurn(next)
    next.turn += 1
    return next
  }

  let power = 1
  let skill: SkillDef | undefined
  if (action === 'attack') {
    next.log.push(`${next.player.name} 發動普通攻擊。`)
  } else {
    const idx = action === 'skill0' ? 0 : action === 'skill1' ? 1 : 2
    skill = skills[idx]
    if (!skill) {
      next.log.push('技能不存在。')
      return next
    }
    if (player.level < skill.unlockLevel) {
      next.log.push(`${skill.name} 尚未解鎖（需要 Lv.${skill.unlockLevel}）。`)
      return next
    }
    if (next.player.mp < skill.mpCost) {
      next.log.push(`魔力不足，無法施放 ${skill.name}。`)
      return next
    }
    next.player.mp -= skill.mpCost
    power = skill.power
    next.log.push(`${next.player.name} 施放【${skill.name}】！`)
    if (skill.heal) {
      const heal = Math.floor(next.player.maxHp * skill.heal)
      next.player.hp = clamp(next.player.hp + heal, 0, next.player.maxHp)
      next.log.push(`回復了 ${heal} 點生命。`)
      enemyTurn(next)
      next.turn += 1
      return next
    }
  }

  const pierce = skill?.tag === 'slash' && skill.id === 'guard_break'
  const def = pierce ? Math.floor(next.enemy.def * 0.4) : next.enemy.def
  const critBonus = skill?.id === 'aimed_shot' ? 15 : 0
  const { dmg, crit } = hitDamage(next.player.atk, def, power, next.player.crit + critBonus)
  next.enemy.hp = clamp(next.enemy.hp - dmg, 0, next.enemy.maxHp)
  next.log.push(`造成 ${dmg} 傷害${crit ? '（暴擊）' : ''}。`)

  if (next.enemy.hp <= 0) {
    finishVictory(next)
    return next
  }

  // speed check: sometimes double turn
  if (next.player.spd >= next.enemy.spd + 8 && Math.random() < 0.2) {
    next.log.push('你的速度壓制敵人，獲得追加行動！')
    next.turn += 1
    return next
  }

  enemyTurn(next)
  next.turn += 1
  return next
}

export function pickAutoAction(battle: BattleState, player: Player): CombatAction {
  if (battle.player.hp < battle.player.maxHp * 0.35) {
    const hasPot = player.bag.some((b) => ITEM_MAP[b.defId]?.healHp && b.qty > 0)
    if (hasPot) return 'potion'
  }
  const skills = classSkills(player)
  for (let i = skills.length - 1; i >= 0; i--) {
    const s = skills[i]
    if (player.level >= s.unlockLevel && battle.player.mp >= s.mpCost && s.power > 0) {
      return (`skill${i}` as CombatAction)
    }
  }
  return 'attack'
}

import type { Element, EnemySnapshot, IdleMode, Stats } from './types'
import { BOSS_CHARACTERS, GODKING_CHARACTERS } from './data/characters'
import {
  ENEMY_ATK_FROM_POWER,
  ENEMY_HP_FROM_POWER,
  ENEMY_SHIELD_FROM_POWER,
  bossEnemyPower,
  godkingEnemyPower,
  mainEnemyPower,
  skillDungeonPowerSeed,
} from './balance'
import { BOSS_MECHANIC_BY_CHAR } from './mechanics'
import { portraitPath } from './util'

/** 與隊伍戰力同一套加權；敵方以攻推估等效防 */
export function enemyDisplayPower(stats: Pick<Stats, 'hp' | 'shield' | 'atk'> & { def?: number }): number {
  const def = stats.def ?? Math.floor(stats.atk * 0.45)
  return Math.floor(stats.hp * 0.3 + stats.shield * 0.25 + stats.atk * 8 + def * 4)
}

/** 高難度種子額外生命（log soft），讓數字高的怪真的更肉 */
function hpScaleForSeed(seed: number): number {
  const s = Math.max(1, seed)
  return 1 + Math.log10(1 + s / 25_000) * 0.55
}

const NORMAL_NAMES = [
  '塔層巡邏機',
  '鏽蝕哨兵',
  '歷史殘影',
  '異界浮游體',
  '熔線守衛',
  '斷章靈體',
  '深層蛛影',
  '晶蝕犬',
  '廢墟槍兵',
  '霧都催命使',
]

export const NORMAL_PORTRAITS = [
  'mob_patrol',
  'mob_rust',
  'mob_echo',
  'mob_floater',
  'mob_molten',
  'mob_script',
  'mob_spider',
  'mob_hound',
  'mob_spear',
  'mob_fog',
]

const MINI_BOSS_NAMES = [
  '層衛隊長',
  '晶核監工',
  '鏽塔百夫長',
  '斷章執行者',
  '霧巷霸主',
  '熔線督軍',
]

export const MINI_BOSS_PORTRAITS = [
  'mob_mini_captain',
  'mob_mini_overseer',
  'mob_mini_centurion',
  'mob_script',
  'mob_mini_tyrant',
  'mob_molten',
]

/** 全部小怪／小首領立繪 URL（本機預載用） */
export function allMobPortraitUrls(): string[] {
  const ids = [...new Set([...NORMAL_PORTRAITS, ...MINI_BOSS_PORTRAITS])]
  return ids.map((id) => portraitPath(id))
}

export function enemyElement(floor: number): Element {
  const pool: Element[] = ['火', '水', '雷', '光', '暗']
  return pool[floor % pool.length]
}

/** 主塔／副塔／討伐：小首領；王塔／神王：首領（isBoss） */
export function isBossFloor(mode: IdleMode, floor: number): boolean {
  if (mode === 'boss' || mode === 'godking') return true
  return isMiniBossFloor(mode, floor)
}

export function isMiniBossFloor(mode: IdleMode, floor: number): boolean {
  if (mode === 'blueprint' || mode === 'skill' || mode === 'hunt') {
    return floor > 0 && floor % 5 === 0
  }
  if (mode === 'main') return floor > 0 && floor % 10 === 0
  return false
}

export function enemyName(mode: IdleMode, floor: number): string {
  if (mode === 'boss') {
    const c = BOSS_CHARACTERS[(Math.max(1, floor) - 1) % BOSS_CHARACTERS.length]
    return c.name
  }
  if (mode === 'godking') {
    const c = GODKING_CHARACTERS[(Math.max(1, floor) - 1) % GODKING_CHARACTERS.length]
    return c.name
  }
  if (isMiniBossFloor(mode, floor)) {
    const mini = MINI_BOSS_NAMES[floor % MINI_BOSS_NAMES.length]
    return mode === 'hunt' ? `討伐木樁·${mini}` : `小首領·${mini}`
  }
  if (mode === 'hunt') {
    return `訓練殘影·${NORMAL_NAMES[floor % NORMAL_NAMES.length]}`
  }
  return NORMAL_NAMES[floor % NORMAL_NAMES.length]
}

export function enemyPortrait(mode: IdleMode, floor: number): string | undefined {
  if (mode === 'boss') {
    return BOSS_CHARACTERS[(Math.max(1, floor) - 1) % BOSS_CHARACTERS.length].portrait
  }
  if (mode === 'godking') {
    return GODKING_CHARACTERS[(Math.max(1, floor) - 1) % GODKING_CHARACTERS.length].portrait
  }
  const f = Math.max(1, floor)
  if (isMiniBossFloor(mode, f)) {
    return portraitPath(MINI_BOSS_PORTRAITS[f % MINI_BOSS_PORTRAITS.length])
  }
  return portraitPath(NORMAL_PORTRAITS[f % NORMAL_PORTRAITS.length])
}

/**
 * 目標戰力對齊 balance.ts 里程碑：
 * - 主塔：前期可推進，中後期吃轉生／裝備階
 * - 副塔：一層 ≈ 主塔 ×100 層
 * - 技能本：每層指數加難，掉同名技能本（非通用技能卡）
 * - 討伐訓練：一層 ≈ 主塔 ×16 層（刷破王徽；非 isBoss，不觸發克制王階）
 * - 王塔／神王：獨立指數軸
 */
export function enemyTargetPower(mode: IdleMode, floor: number): number {
  const f = Math.max(1, floor)

  if (mode === 'boss') return bossEnemyPower(f)
  if (mode === 'godking') return godkingEnemyPower(f)
  if (mode === 'blueprint') return enemyTargetPower('main', f * 100)
  // 技能本：陡峭指數（見 skillDungeonPowerSeed）
  if (mode === 'skill') return skillDungeonPowerSeed(f)
  // 討伐訓練：略高於舊技能本倍率，首通王階後掛刷破王徽
  if (mode === 'hunt') return enemyTargetPower('main', Math.max(12, f * 16))
  return mainEnemyPower(f)
}

function statsFromPower(
  seed: number,
  opts: { boss: boolean; mini: boolean },
): Pick<EnemySnapshot, 'hp' | 'maxHp' | 'shield' | 'maxShield' | 'atk' | 'power'> {
  const shieldMult = opts.boss ? 2.2 : opts.mini ? 1.55 : 1
  const hp = Math.max(1, Math.floor(seed * ENEMY_HP_FROM_POWER * hpScaleForSeed(seed)))
  const shield = Math.max(0, Math.floor(seed * ENEMY_SHIELD_FROM_POWER * shieldMult))
  const atk = Math.max(1, Math.floor(seed * ENEMY_ATK_FROM_POWER))
  const power = enemyDisplayPower({ hp, shield, atk })
  return {
    hp,
    maxHp: hp,
    shield,
    maxShield: shield,
    atk,
    power,
  }
}

export function buildEnemy(mode: IdleMode, floor: number): EnemySnapshot {
  const f = Math.max(1, floor)
  const boss = mode === 'boss' || mode === 'godking'
  const mini = isMiniBossFloor(mode, f)
  const power = enemyTargetPower(mode, f)
  const stats = statsFromPower(power, { boss, mini: mini && !boss })

  let mechanic = undefined as EnemySnapshot['mechanic']
  let gateCharges: number | undefined
  let charId: string | undefined
  if (mode === 'boss') {
    charId = BOSS_CHARACTERS[(Math.max(1, f) - 1) % BOSS_CHARACTERS.length].id
  } else if (mode === 'godking') {
    charId = GODKING_CHARACTERS[(Math.max(1, f) - 1) % GODKING_CHARACTERS.length].id
  }
  if (charId) mechanic = BOSS_MECHANIC_BY_CHAR[charId]
  if (mechanic === 'gateBlock') gateCharges = 3

  const el =
    mode === 'boss' || mode === 'godking'
      ? (CHAR_MAP_ELEMENT(charId!) ?? enemyElement(f))
      : enemyElement(f)

  return {
    name: enemyName(mode, f),
    element: el,
    isBoss: boss,
    isMiniBoss: mini && !boss,
    portrait: enemyPortrait(mode, f),
    mechanic,
    gateCharges,
    fogActive: mechanic === 'fogLayer',
    ...stats,
  }
}

function CHAR_MAP_ELEMENT(id: string): Element | undefined {
  const c = [...BOSS_CHARACTERS, ...GODKING_CHARACTERS].find((x) => x.id === id)
  return c?.element
}

/** 主塔第 10000 層戰力（給對照／除錯） */
export function mainFloor10000Power(): number {
  return enemyTargetPower('main', 10000)
}

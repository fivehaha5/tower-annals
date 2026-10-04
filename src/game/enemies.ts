import type { Element, EnemySnapshot, IdleMode } from './types'
import { BOSS_CHARACTERS, GODKING_CHARACTERS } from './data/characters'
import { bossEnemyPower, godkingEnemyPower, mainEnemyPower } from './balance'
import { BOSS_MECHANIC_BY_CHAR } from './mechanics'
import { portraitPath } from './util'

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

const NORMAL_PORTRAITS = [
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

const MINI_BOSS_PORTRAITS = [
  'mob_mini_captain',
  'mob_mini_overseer',
  'mob_mini_centurion',
  'mob_script',
  'mob_mini_tyrant',
  'mob_molten',
]

export function enemyElement(floor: number): Element {
  const pool: Element[] = ['火', '水', '雷', '光', '暗']
  return pool[floor % pool.length]
}

/** 主塔／副塔：每 10／5 層小 Boss；王塔／神王：首領 */
export function isBossFloor(mode: IdleMode, floor: number): boolean {
  if (mode === 'boss' || mode === 'godking') return true
  return isMiniBossFloor(mode, floor)
}

export function isMiniBossFloor(mode: IdleMode, floor: number): boolean {
  if (mode === 'blueprint') return floor > 0 && floor % 5 === 0
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
    return `小首領·${MINI_BOSS_NAMES[floor % MINI_BOSS_NAMES.length]}`
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
 * - 王塔／神王：獨立指數軸
 */
export function enemyTargetPower(mode: IdleMode, floor: number): number {
  const f = Math.max(1, floor)

  if (mode === 'boss') return bossEnemyPower(f)
  if (mode === 'godking') return godkingEnemyPower(f)
  if (mode === 'blueprint') return enemyTargetPower('main', f * 100)
  return mainEnemyPower(f)
}

function statsFromPower(
  power: number,
  opts: { boss: boolean; mini: boolean },
): Pick<EnemySnapshot, 'hp' | 'maxHp' | 'shield' | 'maxShield' | 'atk' | 'power'> {
  const shieldRatio = opts.boss ? 0.65 : opts.mini ? 0.5 : 0.35
  const hp = Math.max(1, Math.floor(power * 1.15))
  const shield = Math.max(0, Math.floor(power * shieldRatio))
  const atk = Math.max(1, Math.floor(power * 0.055))
  // 顯示戰力以目標為準，避免分配誤差讓玩家誤判
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

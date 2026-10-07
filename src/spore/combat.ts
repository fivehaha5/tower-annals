import type { ClassId } from './types'

/** 敵方戰力：與 gameTick / 模擬共用 */
export function enemyPowerOf(hp: number, atk: number, def: number): number {
  return Math.floor(hp * 0.4 + atk * 5 + def * 3)
}

/**
 * 通關進度步幅（每 tick）。
 * ratio&lt;0.5 幾乎不動，避免弱勢地板刷關；中高戰力拉開手感。
 */
export function progressStep(ratio: number, classId: ClassId = 'novice'): number {
  let step: number
  if (ratio < 0.5) step = 0.001
  else if (ratio < 0.8) step = 0.004
  else if (ratio < 1.0) step = 0.015
  else if (ratio < 1.5) step = 0.04
  else if (ratio < 2.0) step = 0.07
  else step = 0.1

  return step * classStepMult(classId)
}

/** 職業影響推進，而不只改戰力分數 */
export function classStepMult(classId: ClassId): number {
  switch (classId) {
    case 'warrior':
      return 1.12
    case 'archer':
      return 1.08
    case 'mage':
      return 1.05
    default:
      return 1
  }
}

/** 弱勢通關減產，避免「越卡越能抽」 */
export function clearRewardMult(ratio: number): number {
  if (ratio < 0.5) return 0.15
  if (ratio < 0.8) return 0.4
  if (ratio < 1) return 0.7
  return 1
}

/** 被動神燈油回復間隔（tick）；弱勢時更慢 */
export function oilRegenEvery(ratio: number): number {
  if (ratio < 0.5) return 24
  if (ratio < 0.8) return 16
  return 8
}

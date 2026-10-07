import type { StageDef } from '../types'

const ENEMIES = [
  '嘲諷騎士學徒',
  '野生史萊姆',
  '林間野狼',
  '盜燈小偷',
  '石膚菇怪',
  '霧沼蟾蜍',
  '礦道蝙蝠',
  '赤岩魔像',
  '廢墟守衛',
  '月影祭司',
  '龍脊翼蜥',
  '虛空先驅',
]

/** 分段關卡倍率：前期爽感、中後期讓裝備能追上 */
export function stageScale(n: number): number {
  const i = Math.max(1, Math.floor(n))
  if (i <= 20) return Math.pow(1.12, i - 1)
  if (i <= 50) return Math.pow(1.12, 19) * Math.pow(1.07, i - 20)
  return Math.pow(1.12, 19) * Math.pow(1.07, 30) * Math.pow(1.055, i - 50)
}

export function stageOf(n: number): StageDef {
  const i = Math.max(1, Math.floor(n))
  const tier = Math.floor((i - 1) / 10)
  const enemy = ENEMIES[tier % ENEMIES.length]
  const scale = stageScale(i)
  return {
    id: i,
    name: `${i} 關 · ${enemy}`,
    enemy,
    hp: Math.floor(40 * scale),
    atk: Math.floor(6 * scale),
    def: Math.floor(2 * scale),
    coin: Math.floor(4 + i * 1.2),
    hammer: i % 3 === 0 ? 1 + Math.floor(i / 15) : 0,
    xp: Math.floor(8 + i * 2.4),
  }
}

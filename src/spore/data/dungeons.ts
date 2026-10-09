import type { DungeonDef, DungeonId } from '../types'

/** 每章 10 關：1-5→5、2-1→11、2-5→15、3-1→21 */
export const DUNGEONS: DungeonDef[] = [
  {
    id: 'hammer',
    name: '錘子小偷',
    rewardLabel: '錘＋金',
    unlockStage: 5,
    unlockLabel: '1-5',
    waves: 1,
    keyMax: 2,
    accent: '#8a9bb0',
  },
  {
    id: 'skill',
    name: '鬼鎮',
    rewardLabel: '技能券',
    unlockStage: 11,
    unlockLabel: '2-1',
    waves: 3,
    keyMax: 2,
    accent: '#6bc46d',
  },
  {
    id: 'pet',
    name: '入侵',
    rewardLabel: '寵物券',
    unlockStage: 15,
    unlockLabel: '2-5',
    waves: 3,
    keyMax: 2,
    accent: '#e0a050',
  },
  {
    id: 'research',
    name: '殭屍狂奔',
    rewardLabel: '科技點',
    unlockStage: 21,
    unlockLabel: '3-1',
    waves: 3,
    keyMax: 2,
    accent: '#e07171',
  },
]

export const DUNGEON_MAP = Object.fromEntries(DUNGEONS.map((d) => [d.id, d])) as Record<
  DungeonId,
  DungeonDef
>

export const DUNGEON_ENEMIES: Record<DungeonId, string[]> = {
  hammer: ['錘子小偷'],
  skill: ['墓園幽魂', '腐骨弓手', '鬼鎮領主'],
  pet: ['入侵斥候', '旗手獸人', '入侵將軍'],
  research: ['腐屍跑者', '毒沼僵屍', '狂奔尸王'],
}

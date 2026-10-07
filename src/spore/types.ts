export type ClassId = 'novice' | 'warrior' | 'archer' | 'mage'
export type Tab = 'battle' | 'forge' | 'bag' | 'hero' | 'more'
export type Screen = 'boot' | 'create' | 'game'
export type Slot = 'weapon' | 'hat' | 'armor' | 'gloves' | 'boots' | 'mount'
export type Rarity = '普通' | '優秀' | '精良' | '史詩' | '傳說' | '神話'

export interface Stats {
  atk: number
  def: number
  hp: number
  spd: number
  crit: number
}

export interface GearDef {
  id: string
  name: string
  slot: Slot
  rarity: Rarity
  base: Partial<Stats>
  /** 鍛造等級下限才可能刷出 */
  forgeMin: number
}

export interface OwnedGear {
  uid: string
  defId: string
  /** 隨機詞條平坦加值（非百分比） */
  affix: Partial<Stats>
  level: number
}

export interface PetDef {
  id: string
  name: string
  blurb: string
  bonus: Partial<Stats>
  unlockStage: number
  /** 鍛造爐等級門檻（與關卡並列） */
  unlockForge: number
  lootBonus?: {
    hammerChance?: number
    oilChance?: number
    oilExtra?: number
  }
}

export interface StageDef {
  id: number
  name: string
  enemy: string
  hp: number
  atk: number
  def: number
  coin: number
  hammer: number
  xp: number
}

export interface Player {
  name: string
  classId: ClassId
  level: number
  xp: number
  stage: number
  /** 當前關卡內進度 0-1，戰鬥推進 */
  stageProgress: number
  coin: number
  hammer: number
  lampOil: number
  forgeLevel: number
  forgeXp: number
  bag: OwnedGear[]
  equips: Partial<Record<Slot, string>>
  petId: string | null
  unlockedPets: string[]
  totalPulls: number
  createdAt: number
  lastTick: number
}

export interface BattleLogLine {
  text: string
  at: number
}

export interface GameState {
  screen: Screen
  tab: Tab
  player: Player | null
  draftName: string
  draftClass: ClassId
  toast: string | null
  lastDrop: string | null
  battleLog: BattleLogLine[]
  forging: boolean
  offlineReport: { seconds: number; coin: number; hammer: number; oil: number } | null
  tick: number
}

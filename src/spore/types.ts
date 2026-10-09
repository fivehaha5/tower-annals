export type ClassId = 'novice' | 'warrior' | 'archer' | 'mage'
/** 底欄：戰鬥（含鍛造）· 地下城 · 養成（技能／寵物／科技）· 更多 — 無公會／Police */
export type Tab = 'battle' | 'dungeon' | 'grow' | 'more'
export type GrowSub = 'skills' | 'pets' | 'tech'
export type TechTreeId = 'forge' | 'power' | 'skillpet'
export type Screen = 'boot' | 'create' | 'game'
export type Slot = 'weapon' | 'hat' | 'armor' | 'gloves' | 'boots' | 'mount'
export type Rarity = '普通' | '優秀' | '精良' | '史詩' | '傳說' | '神話'
export type DungeonId = 'hammer' | 'skill' | 'pet' | 'research'
export type Overlay =
  | null
  | { kind: 'forgeInfo' }
  | { kind: 'autoForge' }
  | { kind: 'forgeResult'; gear: OwnedGear; replaced?: OwnedGear | null }
  | { kind: 'skillRates' }
  | { kind: 'petRates' }
  | { kind: 'skillDetail'; id: string }
  | { kind: 'techTree'; tree: TechTreeId }
  | { kind: 'dungeonBattle'; dungeonId: DungeonId }

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
  /** 鍛造時隨機等級；不可強化 */
  level: number
}

export interface PetDef {
  id: string
  name: string
  blurb: string
  bonus: Partial<Stats>
  rarity: Rarity
  /** 召喚池權重基底 */
  weight: number
}

export interface OwnedPet {
  id: string
  level: number
  fragments: number
}

export interface SkillDef {
  id: string
  name: string
  blurb: string
  rarity: Rarity
  bonus: Partial<Stats>
  weight: number
}

export interface OwnedSkill {
  id: string
  level: number
  fragments: number
}

export interface StageDef {
  id: number
  name: string
  /** 顯示用 章-節，如 1-5 */
  label: string
  enemy: string
  hp: number
  atk: number
  def: number
  coin: number
  hammer: number
  xp: number
}

export interface DungeonDef {
  id: DungeonId
  name: string
  rewardLabel: string
  /** 線性關卡號解鎖（章節×10 制：1-5=5, 2-1=11, 2-5=15, 3-1=21） */
  unlockStage: number
  unlockLabel: string
  waves: number
  keyMax: number
  accent: string
}

export interface TechNodeDef {
  id: string
  tree: TechTreeId
  name: string
  blurb: string
  maxRank: number
  /** 每階基礎研究秒數 */
  baseSeconds: number
  /** 每階藥水費用 */
  baseCost: number
  /** 效果類型 */
  effect: TechEffect
}

export type TechEffect =
  | { kind: 'forgeCostPct'; pct: number }
  | { kind: 'forgeTimePct'; pct: number }
  | { kind: 'dungeonHammerPct'; pct: number }
  | { kind: 'dungeonCoinPct'; pct: number }
  | { kind: 'forgeHammerCost'; delta: number }
  | { kind: 'freeForgeChance'; pct: number }
  | { kind: 'offlineCoinPct'; pct: number }
  | { kind: 'offlineHammerPct'; pct: number }
  | { kind: 'offlineCapPct'; pct: number }
  | { kind: 'equipAtkPct'; pct: number }
  | { kind: 'equipHpPct'; pct: number }
  | { kind: 'mountBonusPct'; pct: number }
  | { kind: 'equipMaxLevel'; delta: number }
  | { kind: 'researchSpeedPct'; pct: number }
  | { kind: 'researchCostPct'; pct: number }
  | { kind: 'skillSummonCostPct'; pct: number }
  | { kind: 'skillPassivePct'; pct: number }
  | { kind: 'petBonusPct'; pct: number }
  | { kind: 'petSummonBonus'; pct: number }
  | { kind: 'hatchSpeedPct'; pct: number }
  | { kind: 'skillTicketPct'; pct: number }
  | { kind: 'techPointPct'; pct: number }

export interface TechProgress {
  /** 已完成階數 0..maxRank */
  rank: number
  /** 研究結束時間戳；null＝未在研究 */
  researchingUntil: number | null
}

export interface HatchSlot {
  petId: string | null
  readyAt: number | null
}

export interface AutoForgeSettings {
  /** 保留的稀有度下限索引（含） */
  minRarityIndex: number
  hammersPerForge: number
  continueOnHit: boolean
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
  /** 兼容舊存檔；新流程鍛造耗錘 */
  lampOil: number
  skillTicket: number
  petTicket: number
  techPoint: number
  forgeLevel: number
  forgeXp: number
  /**
   * 僅存放「目前裝備」的件；未穿＝立即分解，無背包庫存。
   * equips[slot] 指向 bag 內 uid。
   */
  bag: OwnedGear[]
  equips: Partial<Record<Slot, string>>
  /** 出戰寵物（最多 3） */
  petIds: string[]
  ownedPets: OwnedPet[]
  ownedSkills: OwnedSkill[]
  /** 出戰技能（最多 3） */
  equippedSkills: string[]
  skillSummonLevel: number
  skillSummonXp: number
  petSummonLevel: number
  petSummonXp: number
  hatchSlots: HatchSlot[]
  tech: Record<string, TechProgress>
  dungeonKeys: Record<DungeonId, number>
  dungeonKeyDay: string
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
  growSub: GrowSub
  overlay: Overlay
  autoForge: AutoForgeSettings
  player: Player | null
  draftName: string
  draftClass: ClassId
  toast: string | null
  lastDrop: string | null
  battleLog: BattleLogLine[]
  forging: boolean
  autoForging: boolean
  offlineReport: {
    seconds: number
    coin: number
    hammer: number
    oil: number
  } | null
  /** 副本戰鬥狀態 */
  dungeonRun: {
    dungeonId: DungeonId
    wave: number
    progress: number
  } | null
  tick: number
}

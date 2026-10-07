export type ClassId = 'swordsman' | 'mage' | 'ranger'

export type Tab = 'scene' | 'char' | 'bag' | 'quest' | 'chat' | 'more'

export type Screen = 'title' | 'create' | 'game'

export type EquipSlot = 'weapon' | 'armor' | 'accessory'

export type ItemKind = 'equip' | 'consumable' | 'material' | 'quest'

export type CombatAction = 'attack' | 'skill0' | 'skill1' | 'skill2' | 'potion' | 'flee'

export interface Stats {
  hp: number
  mp: number
  atk: number
  def: number
  spd: number
  crit: number
}

export interface ClassDef {
  id: ClassId
  name: string
  title: string
  blurb: string
  color: string
  base: Stats
  growth: Stats
  skillIds: string[]
}

export interface SkillDef {
  id: string
  name: string
  desc: string
  mpCost: number
  power: number
  heal?: number
  unlockLevel: number
  /** 傷害類型標籤 */
  tag: 'slash' | 'magic' | 'pierce' | 'heal' | 'buff'
}

export interface ZoneDef {
  id: string
  name: string
  kind: 'town' | 'field' | 'dungeon'
  levelMin: number
  levelMax: number
  blurb: string
  atmosphere: string
  links: string[]
  monsterIds: string[]
  unlockQuestId?: string
  shop?: boolean
  forge?: boolean
}

export interface MonsterDef {
  id: string
  name: string
  level: number
  hp: number
  atk: number
  def: number
  spd: number
  xp: number
  gold: number
  dropIds: string[]
  dropChance: number
}

export interface ItemDef {
  id: string
  name: string
  kind: ItemKind
  slot?: EquipSlot
  rarity: '普通' | '精良' | '稀有' | '史詩' | '傳說'
  desc: string
  price: number
  sell: number
  stats?: Partial<Stats>
  healHp?: number
  healMp?: number
  stackable?: boolean
}

export interface QuestStep {
  type: 'talk' | 'kill' | 'collect' | 'reach' | 'equip'
  targetId: string
  count: number
  hint: string
}

export interface QuestDef {
  id: string
  name: string
  chapter: string
  desc: string
  steps: QuestStep[]
  rewardXp: number
  rewardGold: number
  rewardItemIds?: string[]
  unlockZoneIds?: string[]
  nextQuestId?: string
  autoAccept?: boolean
}

export interface NpcDef {
  id: string
  name: string
  title: string
  zoneId: string
  lines: string[]
  questIds?: string[]
  shop?: boolean
}

export interface OwnedItem {
  uid: string
  defId: string
  qty: number
}

export interface Equipment {
  weapon?: string
  armor?: string
  accessory?: string
}

export interface Combatant {
  name: string
  level: number
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  atk: number
  def: number
  spd: number
  crit: number
  monsterId?: string
}

export interface BattleState {
  player: Combatant
  enemy: Combatant
  log: string[]
  turn: number
  over: boolean
  victory?: boolean
  fled?: boolean
  rewards?: { xp: number; gold: number; drops: string[] }
  /** 本回合若使用藥水，由 state 層扣背包 */
  pendingPotionUid?: string
}

export interface ChatLine {
  id: string
  channel: '系統' | '世界' | '任務' | '戰鬥'
  text: string
  at: number
}

export interface Player {
  name: string
  classId: ClassId
  level: number
  xp: number
  gold: number
  hp: number
  mp: number
  zoneId: string
  equips: Equipment
  bag: OwnedItem[]
  /** questId -> progress count for current step */
  questProgress: Record<string, number>
  /** completed quest ids */
  doneQuests: string[]
  /** active quest ids */
  activeQuests: string[]
  unlockedZones: string[]
  skillLevels: Record<string, number>
  potionsUsed: number
  kills: Record<string, number>
  createdAt: number
}

export interface GameState {
  screen: Screen
  tab: Tab
  player: Player | null
  /** draft name on create screen */
  draftName: string
  draftClass: ClassId
  battle: BattleState | null
  autoBattle: boolean
  chat: ChatLine[]
  toast: string | null
  modal: ModalState | null
  tick: number
}

export type ModalState =
  | { kind: 'npc'; npcId: string }
  | { kind: 'item'; uid: string }
  | { kind: 'shop' }
  | { kind: 'confirm'; title: string; body: string; action: string }
  | { kind: 'levelup'; level: number }
  | { kind: 'questDone'; questId: string }

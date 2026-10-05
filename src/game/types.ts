export type Role = 'warrior' | 'mage' | 'priest'

export type Element = '火' | '水' | '雷' | '光' | '暗'

export type Rarity =
  | '普通'
  | '稀有'
  | '史詩'
  | '傳奇'
  | '神話'
  | '永恆'
  | '創世'

export type SkillKind = 'attack' | 'defense' | 'support'

export type IdleMode = 'main' | 'blueprint' | 'skill' | 'hunt' | 'boss' | 'godking'

export type WorkJob = 'gold' | 'forge' | 'essence' | 'skillbook' | 'soul'

export type Tab = 'tower' | 'train' | 'gacha' | 'logistics' | 'settings'

export type Screen = 'boot' | 'starter' | 'game'

export type DropAim = 'none' | 'character' | 'skill'

/** 主塔／副塔：沖層推進 or 原地刷資源 */
export type PushMode = 'push' | 'stay'

export type FloorMap = {
  main: number
  blueprint: number
  skill: number
  hunt: number
  boss: number
  godking: number
}

export interface Resources {
  crystal: number
  gold: number
  blueprint: number
  forge: number
  essence: number
  skillbook: number
  soul: number
  /** 破王徽：兌換克制王階技能 */
  kingBadge: number
}

export interface Stats {
  hp: number
  atk: number
  def: number
  shield: number
}

/** 技能／Boss 機制標籤 */
export type SkillEffectId =
  | 'chargeShield'
  | 'overhealToShield'
  | 'trueDamage'
  | 'pierceShield'
  | 'fogBreak'
  | 'antiHealCut'
  | 'darkAmp'
  | 'shieldLeech'
  | 'gateBreak'
  | 'mirrorCast'
  | 'balanceHeal'
  | 'poisonTick'
  /** 對王階（isBoss）敵人傷害加成，value 為倍率增量如 0.35＝+35% */
  | 'vsBoss'

export type BossMechanicId =
  | 'fogLayer'
  | 'goldLeech'
  | 'lawCrush'
  | 'compileShift'
  | 'gateBlock'
  | 'eternalNight'
  | 'ramCharge'
  | 'stoneSkin'
  | 'mirrorTwin'
  | 'tideShell'
  | 'solarBurn'
  | 'pureLaw'
  | 'scaleJudgment'
  | 'venomHeart'
  | 'starPierce'
  | 'mountainSpine'
  | 'aquaField'
  | 'dreamHeal'

export interface SkillEffect {
  id: SkillEffectId
  /** 強度參數（依機制解讀） */
  value?: number
}

export interface SkillDef {
  id: string
  name: string
  role: Role
  kind: SkillKind
  element: Element
  power: number
  shieldPower: number
  healPower: number
  desc: string
  unique?: boolean
  /**
   * boss／godking＝王塔／神王掉落獨特技；
   * antiKing＝克制王階技（首通自選／破王徽兌換；不進王塔／神王獨特池）
   */
  source?: 'boss' | 'godking' | 'antiKing'
  effects?: SkillEffect[]
}

export interface OwnedSkill {
  uid: string
  skillId: string
  level: number
  rarity: Rarity
}

export type EquipSlot =
  | 'weapon'
  | 'helmet'
  | 'chest'
  | 'legs'
  | 'gloves'
  | 'ring'
  | 'necklace'

export interface EquipDef {
  id: string
  name: string
  role: Role
  slot: EquipSlot
  tier: number
  rarity: Rarity
  bonus: Partial<Stats>
}

export interface OwnedEquip {
  uid: string
  defId: string
  level: number
  rarity: Rarity
}

export interface CharacterDef {
  id: string
  name: string
  role: Role
  element: Element
  rarity: Rarity
  base: Stats
  growth: Stats
  /** 預設三槽技能（僅作新手起始參考） */
  skillIds: Record<SkillKind, string>
  portrait: string
  desc: string
  series?: 'gacha' | 'boss' | 'godking-zodiac'
}

export interface OwnedCharacter {
  uid: string
  defId: string
  level: number
  rarity: Rarity
  ascend: number
  boost: number
  rebirth: number
  count: number
  /** @deprecated 已遷移至 RoleLoadout */
  skills?: Partial<Record<SkillKind, string>>
  /** @deprecated 已遷移至 RoleLoadout */
  equips?: Partial<Record<EquipSlot, string>>
  workJob?: WorkJob
  /** 塔下長派遣結束時間戳 */
  dispatchUntil?: number
  dispatchReward?: Partial<Resources>
}

/** 職業出戰格：角色／裝備／技能互相獨立 */
export interface RoleLoadout {
  characterUid?: string
  equips: Partial<Record<EquipSlot, string>>
  skills: Partial<Record<SkillKind, string>>
  relicId?: string
}

export interface RelicDef {
  id: string
  name: string
  /** 僅可裝備於該職業 */
  role: Role
  /** 解鎖所需轉生（質數） */
  needRebirth: number
  desc: string
  /** 被動倍率／效果鍵 */
  effect: {
    shieldCap?: number
    overhealToShield?: number
    atk?: number
    def?: number
    heal?: number
    trueDamageBonus?: number
    /** 該職技能威力加成 */
    skillPower?: number
  }
}

/** 單次回合戰鬥飄字 */
export interface BattleFloater {
  role: Role
  text: string
  kind: 'dmg' | 'heal' | 'shield'
}

export interface DispatchMission {
  id: string
  charUid: string
  endsAt: number
  reward: Partial<Resources>
  label: string
}

export interface LogisticsOrder {
  id: string
  /** 需求資源 */
  reqKey: keyof Resources
  reqAmount: number
  /** 獎勵 */
  rewardKey: keyof Resources
  rewardAmount: number
  /** 可再次刷新時間 */
  refreshAt: number
}

export interface EnemySnapshot {
  name: string
  element: Element
  isBoss: boolean
  isMiniBoss: boolean
  portrait?: string
  power: number
  hp: number
  maxHp: number
  shield: number
  maxShield: number
  atk: number
  mechanic?: BossMechanicId
  /** 門禁剩餘次數等 */
  gateCharges?: number
  fogActive?: boolean
}

export interface BattleSnapshot {
  teamHp: number
  teamMaxHp: number
  teamShield: number
  teamMaxShield: number
  enemy: EnemySnapshot
  log: string
  winning: boolean
  /** 次數盾剩餘 */
  chargeShield?: number
  /**
   * 出手序：0..partyN-1 = 隊伍左→右該格行動；partyN = 敵方回合。
   * 每 battleTick 推進一步。
   */
  actIndex?: number
  /** 本輪隊伍累計對敵傷害（供鏡像等敵方回合結算） */
  roundDmgToEnemy?: number
  /** 本 tick 出手角色的飄字（通常僅一位） */
  floaters?: BattleFloater[]
  /** 遞增序號，供 UI 觸發動畫 */
  floaterSeq?: number
  /**
   * 各職技能種類剩餘冷卻（以該角色出手次數計）。
   * 缺省／0 = 就緒；戰鬥新建時清空，不影響存檔結構。
   */
  skillCds?: Partial<Record<Role, Partial<Record<SkillKind, number>>>>
  /**
   * 已完成的完整回合數（全員左→右＋敵方一擊＝1）。
   * ≥ BERSERK_AFTER_ROUNDS 時敵方暴走。
   */
  roundsElapsed?: number
  /** 敵方是否已進入暴走 */
  berserk?: boolean
}

export interface LootDrop {
  characterId?: string
  skillId?: string
  paid?: boolean
  guaranteed?: boolean
}

export interface OfflineReport {
  seconds: number
  /** 實際離線秒數（可能大於結算上限） */
  rawSeconds?: number
  mode: IdleMode
  gains: Partial<Resources>
  floorsCleared: number
  drops: LootDrop[]
}

export interface DropSettings {
  aim: DropAim
  targetId?: string
}

export interface GameState {
  version: number
  screen: Screen
  tab: Tab
  resources: Resources
  roster: OwnedCharacter[]
  equips: OwnedEquip[]
  skillItems: OwnedSkill[]
  skillRarityDetached?: boolean
  /** 職業出戰三層裝配 */
  loadouts: Record<Role, RoleLoadout>
  /** @deprecated 遷至 loadouts.characterUid */
  slots?: {
    warrior?: string
    mage?: string
    priest?: string
  }
  formation: Role[]
  captainRole: Role
  skillCastOrder: SkillKind[]
  workAcc: number
  dispatches: DispatchMission[]
  orders: LogisticsOrder[]
  relicInventory: string[]
  dex: string[]
  skillBag?: string[]
  floors: FloorMap
  farmFloor: FloorMap
  pushMode: {
    main: PushMode
    blueprint: PushMode
    skill: PushMode
    hunt: PushMode
  }
  idleMode: IdleMode
  battle: BattleSnapshot | null
  lastTick: number
  lastSave: number
  starterDone: boolean
  pendingOffline: OfflineReport | null
  lastLootMsg?: string
  /** UI 一次提示（顯示後清除） */
  pendingToast?: string
  firstWin: {
    boss: boolean
    godking: boolean
  }
  /**
   * 首通王階克制技能自選：僅一次。
   * pending＝待玩家選；done＝已領過（含舊試玩領取遷移）。
   */
  antiKingIntroDone?: boolean
  pendingAntiKingPick?: boolean
  dropSettings: {
    boss: DropSettings
    godking: DropSettings
  }
}

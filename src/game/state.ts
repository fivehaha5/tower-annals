import { CHAR_MAP, GACHA_CHARACTERS, STARTERS } from './data/characters'
import {
  EQUIP_SLOTS,
  makeEquipDef,
  equipShopList,
  migrateLegacyEquipDefId,
  parseEquipDefId,
} from './data/equipment'
import { RELIC_MAP, migrateLegacyRelicId, relicsUnlockedByRebirth } from './data/relics'
import {
  SKILL_MAP,
  antiKingSkills,
  defaultSkills,
  dropSkillRarity,
  shopSkillCatalog,
} from './data/skills'
import {
  battleTick,
  calcCharStats,
  createBattle,
  fightingUids,
  findRoleWearingEquip,
  findRoleWearingSkill,
  getCharEnhanceLevel,
  getOwned,
  getRoleCharacter,
  getSkillItem,
  getTeam,
  teamPower,
  workBoostMult,
} from './combat'
import {
  ANTI_KING_EXCHANGE_COST,
  SKILL_CARD_STARTER_CUSHION,
  SKILL_DUNGEON_COOLDOWN_SEC,
  SKILL_DUNGEON_UNLOCK,
  skillDungeonBookDrops,
} from './balance'
import {
  DISPATCH_OPTIONS,
  WORK_BATCH_SEC,
  collectFinishedDispatches,
  completeOrder,
  ensureOrders,
  isOnDispatch,
  scaleWorkYield,
  startDispatch,
  workStationCap,
  type DispatchOption,
} from './logistics'
import type {
  DropAim,
  GameState,
  IdleMode,
  LootDrop,
  OfflineReport,
  OwnedCharacter,
  OwnedEquip,
  OwnedSkill,
  EquipSlot,
  PushMode,
  Rarity,
  Resources,
  Role,
  RoleLoadout,
  SkillKind,
  WorkJob,
} from './types'
import {
  GAME_NAME,
  GACHA_COST_HUNDRED,
  GACHA_COST_ONE,
  GACHA_COST_TEN,
  GACHA_COST_THOUSAND,
  GODKING_UNLOCK,
  CHAR_LEVEL_MAX,
  FOREGROUND_OFFLINE_THRESHOLD_SEC,
  OFFLINE_CAP_SEC,
  RARITY_ORDER,
  SAVE_VERSION,
  SHOP_RATES,
  TICK_MS,
  addResources,
  charAscendCost,
  charBoostCardCost,
  charLevelCost,
  charRebirthCost,
  defaultFormation,
  defaultSkillCastOrder,
  emptyLoadout,
  emptyResources,
  equipBlueprintCost,
  equipCraftCost,
  equipUpgradeCost,
  rollCraftedEquipRarity,
  maxEquipTierForRebirth,
  rebirthRequiredForEquipTier,
  equipTierFromFloor,
  nextRarity,
  ownedCardShopCost,
  rarityIndex,
  ROLE_LABEL,
  shopSkillCost,
  skillAscendCost,
  skillUpgradeCost,
  uid,
} from './util'

export { GAME_NAME }

let state: GameState
const listeners = new Set<(kind?: EmitKind) => void>()
const KINDS: SkillKind[] = ['attack', 'defense', 'support']
const ROLES: Role[] = ['warrior', 'mage', 'priest']

export type EmitKind = 'tick' | 'ui'

/** 討伐訓練：首通王塔或神王後解鎖 */
export function canUnlockHuntFrom(s: GameState): boolean {
  return !!(s.firstWin?.boss || s.firstWin?.godking)
}

export function canUnlockHunt(): boolean {
  return canUnlockHuntFrom(state)
}

export function getState(): GameState {
  return state
}

export function subscribe(fn: (kind?: EmitKind) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(kind: EmitKind = 'ui') {
  for (const fn of listeners) fn(kind)
}

function createOwned(defId: string): OwnedCharacter {
  return {
    uid: uid('ch'),
    defId,
    level: 1,
    rarity: CHAR_MAP[defId].rarity,
    ascend: 0,
    boost: 0,
    rebirth: 0,
    count: 1,
  }
}

function pushSkillItem(skillId: string, rarity: Rarity, level = 1): OwnedSkill {
  const item: OwnedSkill = { uid: uid('sk'), skillId, level, rarity, books: 0 }
  state.skillItems.push(item)
  return item
}

function ensureLoadoutBasics(role: Role) {
  const lo = state.loadouts[role]
  const defaults = defaultSkills(role)
  for (const kind of KINDS) {
    if (lo.skills[kind] && getSkillItem(state, lo.skills[kind])) continue
    const item = pushSkillItem(defaults[kind], '普通', 1)
    lo.skills[kind] = item.uid
  }
}

function grantCharacter(defId: string): OwnedCharacter {
  const existing = state.roster.find((c) => c.defId === defId)
  if (existing) {
    existing.count = (existing.count ?? 1) + 1
    if (!state.dex.includes(defId)) state.dex.push(defId)
    return existing
  }
  const owned = createOwned(defId)
  state.roster.push(owned)
  if (!state.dex.includes(defId)) state.dex.push(defId)
  return owned
}

function mergeRosterStacks(roster: OwnedCharacter[]): OwnedCharacter[] {
  const map = new Map<string, OwnedCharacter>()
  for (const ch of roster) {
    const prev = map.get(ch.defId)
    if (!prev) {
      ch.count = Math.max(1, ch.count ?? 1)
      map.set(ch.defId, ch)
      continue
    }
    prev.count = (prev.count ?? 1) + Math.max(1, ch.count ?? 1)
    if (ch.level > prev.level) prev.level = ch.level
    if (ch.ascend > prev.ascend) prev.ascend = ch.ascend
    if (ch.boost > prev.boost) prev.boost = ch.boost
    if ((ch.rebirth ?? 0) > (prev.rebirth ?? 0)) prev.rebirth = ch.rebirth ?? 0
    if (!prev.workJob && ch.workJob) prev.workJob = ch.workJob
  }
  return [...map.values()]
}

function emptyLoadouts(): Record<Role, RoleLoadout> {
  return {
    warrior: emptyLoadout(),
    mage: emptyLoadout(),
    priest: emptyLoadout(),
  }
}

export function createNewState(): GameState {
  return {
    version: SAVE_VERSION,
    screen: 'starter',
    tab: 'tower',
    resources: {
      ...emptyResources(),
      crystal: 450,
      gold: 60,
      skillbook: SKILL_CARD_STARTER_CUSHION,
    },
    roster: [],
    equips: [],
    skillItems: [],
    skillRarityDetached: true,
    loadouts: emptyLoadouts(),
    formation: defaultFormation(),
    captainRole: 'warrior',
    skillCastOrder: defaultSkillCastOrder(),
    workAcc: 0,
    dispatches: [],
    orders: [],
    relicInventory: [],
    dex: [],
    floors: { main: 1, blueprint: 1, skill: 1, hunt: 1, boss: 1, godking: 1 },
    farmFloor: { main: 1, blueprint: 1, skill: 1, hunt: 1, boss: 1, godking: 1 },
    pushMode: { main: 'push', blueprint: 'push', skill: 'push', hunt: 'push' },
    idleMode: 'main',
    battle: null,
    lastTick: Date.now(),
    lastSave: Date.now(),
    starterDone: false,
    pendingOffline: null,
    firstWin: { boss: false, godking: false },
    antiKingIntroDone: false,
    pendingAntiKingPick: false,
    skillDungeonCdLeft: 0,
    dropSettings: {
      boss: { aim: 'none' },
      godking: { aim: 'none' },
    },
  }
}

export function hydrate(s: GameState) {
  state = normalizeState(s)
  emit()
}

export function normalizeState(s: GameState): GameState {
  // 僅作廢未知／過新版本；同 key 內舊版可遷移
  if (!s.version || s.version > SAVE_VERSION || !s.firstWin || !s.dropSettings) {
    return createNewState()
  }

  const fromVersion = s.version
  s.version = SAVE_VERSION
  s.resources ??= emptyResources()
  s.resources.crystal ??= 0
  s.resources.gold ??= 0
  s.resources.blueprint ??= 0
  s.resources.forge ??= 0
  s.resources.essence ??= 0
  s.resources.skillbook ??= 0
  s.resources.soul ??= 0
  s.resources.kingBadge ??= 0

  s.skillItems ??= []
  s.loadouts ??= emptyLoadouts()
  for (const role of ROLES) {
    s.loadouts[role] ??= emptyLoadout()
    s.loadouts[role].equips ??= {}
    s.loadouts[role].skills ??= {}
    s.loadouts[role].equipLevels ??= {}
    s.loadouts[role].skillLevels ??= {}
    s.loadouts[role].charLevel ??= 1
  }
  s.formation ??= defaultFormation()
  if (s.formation.length !== 3) s.formation = defaultFormation()
  s.captainRole ??= 'warrior'
  s.skillCastOrder ??= defaultSkillCastOrder()
  s.workAcc ??= 0
  s.dispatches ??= []
  s.orders ??= []
  s.relicInventory ??= []
  s.floors ??= { main: 1, blueprint: 1, skill: 1, hunt: 1, boss: 1, godking: 1 }
  s.floors.skill ??= 1
  s.floors.hunt ??= 1
  s.farmFloor ??= { ...s.floors }
  s.farmFloor.skill ??= s.floors.skill
  s.farmFloor.hunt ??= s.floors.hunt
  s.pushMode ??= { main: 'push', blueprint: 'push', skill: 'push', hunt: 'push' }
  s.pushMode.skill ??= 'push'
  s.pushMode.hunt ??= 'push'
  for (const m of ['main', 'blueprint', 'skill', 'hunt', 'boss', 'godking'] as const) {
    s.floors[m] = Math.max(1, s.floors[m] ?? 1)
    s.farmFloor[m] = Math.max(1, Math.min(s.farmFloor[m] ?? s.floors[m], s.floors[m]))
  }

  // v3→v4：舊「技能書」保留為技能卡；贈送緩衝；補技能本層數
  if (fromVersion < 4) {
    s.resources.skillbook = (s.resources.skillbook ?? 0) + SKILL_CARD_STARTER_CUSHION
    s.floors.skill = Math.max(1, s.floors.skill ?? 1)
    s.farmFloor.skill = Math.max(1, Math.min(s.farmFloor.skill ?? 1, s.floors.skill))
    s.pushMode.skill = s.pushMode.skill ?? 'push'
    if (s.idleMode === ('skill' as IdleMode) && s.floors.main < SKILL_DUNGEON_UNLOCK) {
      s.idleMode = 'main'
    }
  }

  // v4→v5：破王徽／討伐訓練／克制王階正式路徑
  if (fromVersion < 5) {
    s.resources.kingBadge = s.resources.kingBadge ?? 0
    s.floors.hunt = Math.max(1, s.floors.hunt ?? 1)
    s.farmFloor.hunt = Math.max(1, Math.min(s.farmFloor.hunt ?? 1, s.floors.hunt))
    s.pushMode.hunt = s.pushMode.hunt ?? 'push'
  }
  // 舊試玩領取：已持有任一克制技 → 視為已完成首通自選
  const ownedAnti = s.skillItems.some((sk) => SKILL_MAP[sk.skillId]?.source === 'antiKing')
  s.antiKingIntroDone = s.antiKingIntroDone === true || ownedAnti
  s.pendingAntiKingPick = s.antiKingIntroDone ? false : !!s.pendingAntiKingPick
  s.skillDungeonCdLeft = Math.max(0, Math.floor(s.skillDungeonCdLeft ?? 0))
  for (const sk of s.skillItems) {
    sk.books = Math.max(0, Math.floor(sk.books ?? 0))
  }

  // v5→v6：升階改吃同名技能本；將一半通用技能卡轉成已持有技能的同名本
  if (fromVersion < 6) {
    const pool = s.skillItems
    let cards = Math.max(0, Math.floor(s.resources.skillbook ?? 0))
    const convert = Math.floor(cards * 0.5)
    cards -= convert
    if (pool.length && convert > 0) {
      for (let i = 0; i < convert; i++) {
        const sk = pool[i % pool.length]!
        sk.books = (sk.books ?? 0) + 1
      }
    }
    s.resources.skillbook = cards
    s.skillDungeonCdLeft = 0
  }

  if (s.idleMode === ('hunt' as IdleMode) && !canUnlockHuntFrom(s)) {
    s.idleMode = 'main'
  }
  s.roster = mergeRosterStacks((s.roster ?? []).filter((c) => !!CHAR_MAP[c.defId]))
  for (const eq of s.equips ?? []) {
    eq.defId = migrateLegacyEquipDefId(eq.defId)
  }
  s.equips = (s.equips ?? []).filter((eq) => !!parseEquipDefId(eq.defId))

  if (Array.isArray(s.skillBag) && s.skillBag.length) {
    for (const id of s.skillBag) {
      const def = SKILL_MAP[id]
      if (!def) continue
      s.skillItems.push({
        uid: uid('sk'),
        skillId: id,
        level: 1,
        rarity: dropSkillRarity(def),
      })
    }
  }
  s.skillBag = []

  // 暫存：從角色抽出技能／裝備再遷入 loadout
  const pendingByRole: Record<
    Role,
    { skills: Partial<Record<SkillKind, string>>; equips: Partial<Record<EquipSlot, string>> }
  > = {
    warrior: { skills: {}, equips: {} },
    mage: { skills: {}, equips: {} },
    priest: { skills: {}, equips: {} },
  }

  for (const ch of s.roster) {
    ch.ascend ??= 0
    ch.boost ??= 0
    ch.rebirth ??= 0
    ch.level = Math.max(1, Math.min(CHAR_LEVEL_MAX, ch.level ?? 1))
    ch.count = Math.max(1, ch.count ?? 1)
    const role = CHAR_MAP[ch.defId]?.role
    if (!role) continue

    const legacyEq = { ...(ch.equips ?? {}) } as Record<string, string | undefined>
    if (legacyEq.armor && !legacyEq.chest) legacyEq.chest = legacyEq.armor
    if (legacyEq.accessory && !legacyEq.ring) legacyEq.ring = legacyEq.accessory
    const maxTier = maxEquipTierForRebirth(ch.rebirth)
    for (const slot of EQUIP_SLOTS) {
      const eu = legacyEq[slot]
      if (!eu) continue
      if (!s.equips.some((e) => e.uid === eu)) continue
      const parsed = parseEquipDefId(s.equips.find((e) => e.uid === eu)!.defId)
      if (parsed && parsed.tier <= maxTier && !pendingByRole[role].equips[slot]) {
        pendingByRole[role].equips[slot] = eu
      }
    }

    const raw = (ch.skills ?? {}) as Record<string, unknown>
    for (const kind of KINDS) {
      const slot = raw[kind]
      if (typeof slot === 'string') {
        if (s.skillItems.some((i) => i.uid === slot) && !pendingByRole[role].skills[kind]) {
          pendingByRole[role].skills[kind] = slot
        }
      } else if (slot && typeof slot === 'object' && 'skillId' in (slot as object)) {
        const old = slot as { skillId: string; level?: number; rarity?: Rarity }
        const def = SKILL_MAP[old.skillId]
        if (!def) continue
        const rarity = def.unique ? dropSkillRarity(def) : '普通'
        const item: OwnedSkill = {
          uid: uid('sk'),
          skillId: old.skillId,
          level: Math.max(1, old.level ?? 1),
          rarity,
        }
        s.skillItems.push(item)
        if (!pendingByRole[role].skills[kind]) pendingByRole[role].skills[kind] = item.uid
      }
    }

    ch.skills = undefined
    ch.equips = undefined
  }

  // 舊 slots → loadouts.characterUid
  for (const role of ROLES) {
    const fromSlot = s.slots?.[role]
    if (fromSlot && s.roster.some((c) => c.uid === fromSlot)) {
      s.loadouts[role].characterUid ??= fromSlot
    }
    if (!s.loadouts[role].characterUid) {
      const fallback = s.roster.find((c) => CHAR_MAP[c.defId]?.role === role)
      if (fallback) s.loadouts[role].characterUid = fallback.uid
    }
    for (const kind of KINDS) {
      s.loadouts[role].skills[kind] ??= pendingByRole[role].skills[kind]
    }
    for (const slot of EQUIP_SLOTS) {
      s.loadouts[role].equips[slot] ??= pendingByRole[role].equips[slot]
    }
  }
  s.slots = undefined

  if (!s.skillRarityDetached) {
    for (const sk of s.skillItems) {
      const def = SKILL_MAP[sk.skillId]
      if (!def || def.unique) continue
      sk.rarity = '普通'
    }
    s.skillRarityDetached = true
  }

  const validSkill = new Set(s.skillItems.map((i) => i.uid))
  const validEq = new Set(s.equips.map((e) => e.uid))
  for (const role of ROLES) {
    for (const kind of KINDS) {
      const id = s.loadouts[role].skills[kind]
      if (id && !validSkill.has(id)) s.loadouts[role].skills[kind] = undefined
    }
    for (const slot of EQUIP_SLOTS) {
      const id = s.loadouts[role].equips[slot]
      if (id && !validEq.has(id)) s.loadouts[role].equips[slot] = undefined
    }
    // 補基礎技能
    const defaults = defaultSkills(role)
    for (const kind of KINDS) {
      if (s.loadouts[role].skills[kind] && validSkill.has(s.loadouts[role].skills[kind]!)) continue
      const item: OwnedSkill = {
        uid: uid('sk'),
        skillId: defaults[kind],
        level: 1,
        rarity: '普通',
      }
      s.skillItems.push(item)
      s.loadouts[role].skills[kind] = item.uid
      validSkill.add(item.uid)
    }
    // 舊通用遺物 → 職業特化；錯職／未知則清空
    const migrated = migrateLegacyRelicId(s.loadouts[role].relicId, role)
    s.loadouts[role].relicId = migrated
  }

  // v7：強化等級遷至出戰格（僅遷移一次）
  if (!(s as GameState & { loadoutEnhanceMigrated?: boolean }).loadoutEnhanceMigrated) {
    for (const role of ROLES) {
      const lo = s.loadouts[role]
      lo.equipLevels ??= {}
      lo.skillLevels ??= {}
      const ch = s.roster.find((c) => c.uid === lo.characterUid)
      if (ch) lo.charLevel = Math.max(1, ch.level ?? 1)
      else lo.charLevel = Math.max(1, lo.charLevel ?? 1)
      for (const slot of EQUIP_SLOTS) {
        const uidEq = lo.equips[slot]
        if (!uidEq) {
          lo.equipLevels[slot] = Math.max(0, lo.equipLevels[slot] ?? 0)
          continue
        }
        const eq = s.equips.find((e) => e.uid === uidEq)
        lo.equipLevels[slot] = Math.max(0, lo.equipLevels[slot] ?? eq?.level ?? 0)
      }
      for (const kind of KINDS) {
        const uidSk = lo.skills[kind]
        if (!uidSk) {
          lo.skillLevels[kind] = Math.max(1, lo.skillLevels[kind] ?? 1)
          continue
        }
        const sk = s.skillItems.find((i) => i.uid === uidSk)
        lo.skillLevels[kind] = Math.max(1, lo.skillLevels[kind] ?? sk?.level ?? 1)
      }
    }
    ;(s as GameState & { loadoutEnhanceMigrated?: boolean }).loadoutEnhanceMigrated = true
  }

  // 遺物庫：遷移舊 id、清未知，再依各職轉生解鎖
  {
    const nextInv: string[] = []
    for (const id of s.relicInventory) {
      if (RELIC_MAP[id]) {
        if (!nextInv.includes(id)) nextInv.push(id)
        continue
      }
      for (const role of ROLES) {
        const m = migrateLegacyRelicId(id, role)
        if (m && !nextInv.includes(m)) nextInv.push(m)
      }
    }
    s.relicInventory = nextInv
  }
  for (const ch of s.roster) {
    const role = CHAR_MAP[ch.defId]?.role
    if (!role) continue
    for (const r of relicsUnlockedByRebirth(ch.rebirth ?? 0, role)) {
      if (!s.relicInventory.includes(r.id)) s.relicInventory.push(r.id)
    }
  }
  // 裝備中的遺物若不在庫中則補入（合法 id）
  for (const role of ROLES) {
    const id = s.loadouts[role].relicId
    if (id && RELIC_MAP[id]?.role === role && !s.relicInventory.includes(id)) {
      s.relicInventory.push(id)
    }
  }

  ensureOrders(s)

  if (s.starterDone && s.roster.length === 0) {
    s.starterDone = false
    s.screen = 'starter'
  }
  if ((s.tab as string) === 'dex') s.tab = 'train'
  return s
}

export function chooseStarters() {
  const owned = STARTERS.map((id) => createOwned(id))
  state.roster = owned
  state.loadouts = emptyLoadouts()
  state.loadouts.warrior.characterUid = owned[0].uid
  state.loadouts.mage.characterUid = owned[1].uid
  state.loadouts.priest.characterUid = owned[2].uid
  state.dex = [...STARTERS]
  state.skillItems = []
  for (const role of ROLES) ensureLoadoutBasics(role)
  state.formation = defaultFormation()
  state.captainRole = 'warrior'
  state.skillCastOrder = defaultSkillCastOrder()
  state.starterDone = true
  state.screen = 'game'
  state.battle = createBattle(state)
  state.lastTick = Date.now()
  state.lastSave = Date.now()
  ensureOrders(state)
  emit()
}

export function startNewGame(): void {
  const fresh = createNewState()
  state = fresh
  chooseStarters()
}

export function setTab(tab: GameState['tab']) {
  state.tab = tab
  emit()
}

export function setIdleMode(mode: IdleMode) {
  if (mode === 'godking' && state.floors.main < GODKING_UNLOCK) return
  if (mode === 'skill' && state.floors.main < SKILL_DUNGEON_UNLOCK) return
  if (mode === 'hunt' && !canUnlockHunt()) return
  if (state.idleMode !== mode) state.lastLootMsg = undefined
  state.idleMode = mode
  state.farmFloor[mode] = Math.max(1, Math.min(state.farmFloor[mode] ?? 1, state.floors[mode]))
  state.battle = createBattle(state)
  emit()
}

export function setFarmFloor(mode: IdleMode, floor: number) {
  const max = Math.max(1, state.floors[mode])
  const next = Math.max(1, Math.min(Math.floor(floor), max))
  state.farmFloor[mode] = next
  if (state.idleMode === mode) state.battle = createBattle(state)
  emit()
}

export function setPushMode(
  mode: 'main' | 'blueprint' | 'skill' | 'hunt',
  push: PushMode,
) {
  state.pushMode[mode] = push
  emit()
}

function advanceAfterClear(mode: IdleMode) {
  const farm = state.farmFloor[mode]
  const max = state.floors[mode]
  if (mode === 'main' || mode === 'blueprint' || mode === 'skill' || mode === 'hunt') {
    if (state.pushMode[mode] === 'push') {
      if (farm >= max) {
        state.floors[mode] = farm + 1
        state.farmFloor[mode] = state.floors[mode]
      } else {
        state.farmFloor[mode] = farm + 1
      }
    } else if (farm >= max) {
      state.floors[mode] = farm + 1
    }
    return
  }
  if (farm >= max) state.floors[mode] = farm + 1
}

export function setDropAim(mode: 'boss' | 'godking', aim: DropAim, targetId?: string) {
  state.dropSettings[mode] = { aim, targetId }
  emit()
}

function workYieldRaw(job: WorkJob, ch: OwnedCharacter): Partial<Resources> {
  const stats = calcCharStats(state, ch)
  const power = Math.max(
    1,
    Math.floor((stats.atk * 0.05 + ch.level * 0.2 + rarityIndex(ch.rarity)) * workBoostMult(ch)),
  )
  switch (job) {
    case 'gold':
      return { gold: Math.max(1, Math.floor(power * 1.15)) }
    case 'forge':
      return { forge: Math.max(1, Math.floor(power * 0.75)) }
    case 'essence':
      return { essence: Math.max(1, Math.floor(power * 0.8)) }
    case 'skillbook':
      return { skillbook: Math.max(1, Math.floor(power * 0.85)) }
    case 'soul':
      return { soul: Math.max(1, Math.floor(power * 0.22)) }
  }
}

/** 每 WORK_BATCH_SEC 秒結算一批（各工位僅前 N 名有效，超出人數不產） */
function collectWorkBatches(seconds: number): Partial<Resources> {
  state.workAcc = (state.workAcc ?? 0) + seconds
  const batches = Math.floor(state.workAcc / WORK_BATCH_SEC)
  if (batches <= 0) return {}
  state.workAcc -= batches * WORK_BATCH_SEC
  let gains = emptyResources()
  const fighting = fightingUids(state)
  const cap = workStationCap(state.floors.main)
  const jobs: WorkJob[] = ['gold', 'forge', 'essence', 'skillbook', 'soul']
  for (const job of jobs) {
    const workers = state.roster
      .filter((ch) => ch.workJob === job && !fighting.has(ch.uid) && !isOnDispatch(ch))
      .sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0) || b.level - a.level)
      .slice(0, cap)
    for (const ch of workers) {
      const role = CHAR_MAP[ch.defId].role
      const perSec = workYieldRaw(job, ch)
      const perBatch: Partial<Resources> = {}
      for (const [k, v] of Object.entries(perSec) as [keyof Resources, number][]) {
        if (v) perBatch[k] = v * WORK_BATCH_SEC
      }
      const scaled = scaleWorkYield(perBatch, role, job, state.floors.main)
      for (let i = 0; i < batches; i++) gains = addResources(gains, scaled)
    }
  }
  return gains
}

function applyLoot(loot: LootDrop, msgs: string[]) {
  if (loot.characterId && CHAR_MAP[loot.characterId]) {
    const owned = grantCharacter(loot.characterId)
    const stack = owned.count > 1 ? ` ×${owned.count}` : ''
    msgs.push(`角色「${CHAR_MAP[loot.characterId].name}」${stack}`)
  }
  if (loot.skillId && SKILL_MAP[loot.skillId]) {
    const def = SKILL_MAP[loot.skillId]
    pushSkillItem(loot.skillId, dropSkillRarity(def))
    msgs.push(`技能「${def.name}」`)
  }
}

function autoGrantAntiKingIntro(): string | null {
  if (state.antiKingIntroDone) return null
  const owned = new Set(
    state.skillItems.filter((s) => SKILL_MAP[s.skillId]?.source === 'antiKing').map((s) => s.skillId),
  )
  const pool = antiKingSkills().filter((d) => !owned.has(d.id))
  if (!pool.length) {
    state.antiKingIntroDone = true
    state.pendingAntiKingPick = false
    return null
  }
  const roles = new Set(state.formation)
  const preferred = pool.filter((d) => roles.has(d.role))
  const candidates = preferred.length ? preferred : pool
  const def = candidates[Math.floor(Math.random() * candidates.length)]!
  pushSkillItem(def.id, dropSkillRarity(def), 1)
  state.antiKingIntroDone = true
  state.pendingAntiKingPick = false
  return def.name
}

function triggerAntiKingIntro(recordOffline: boolean) {
  if (state.antiKingIntroDone || state.pendingAntiKingPick) return
  if (recordOffline) {
    const name = autoGrantAntiKingIntro()
    if (name) {
      state.pendingToast = `首通王階（離線）：獲得克制技能「${name}」`
    }
    return
  }
  state.pendingAntiKingPick = true
}

export function simulateTicks(ticks: number, recordOffline = false, rawSeconds?: number): OfflineReport | null {
  if (ticks <= 0) return null
  let gains = emptyResources()
  let floorsCleared = 0
  const mode = state.idleMode
  const drops: LootDrop[] = []
  const msgs: string[] = []

  for (let i = 0; i < ticks; i++) {
    // 待選克制技能時暫停爬塔，後勤仍結算
    if (state.pendingAntiKingPick) continue
    // 技能本冷卻：倒數期間不開打
    if (state.idleMode === 'skill' && (state.skillDungeonCdLeft ?? 0) > 0) {
      state.skillDungeonCdLeft = Math.max(0, (state.skillDungeonCdLeft ?? 0) - 1)
      if (state.battle) {
        state.battle.log = `技能本冷卻中 · 剩餘 ${state.skillDungeonCdLeft}s`
        state.battle.floaters = []
      }
      continue
    }
    const result = battleTick(state)
    gains = addResources(gains, result.resources)
    if (result.cleared) {
      if (result.aimCancelled && (mode === 'boss' || mode === 'godking')) {
        state.dropSettings[mode] = { aim: 'none' }
        state.pendingToast =
          '定向資源不足（需水晶與技能卡），已改回空刷'
      }
      if (result.lootCost.crystal || result.lootCost.skillbook) {
        state.resources.crystal -= result.lootCost.crystal
        state.resources.skillbook -= result.lootCost.skillbook
      }
      if (result.loot.characterId || result.loot.skillId) {
        drops.push(result.loot)
        applyLoot(result.loot, msgs)
      }
      if (mode === 'skill') {
        const farm = state.farmFloor.skill ?? state.floors.skill
        const summary = grantSkillDungeonBooks(farm)
        msgs.push(summary)
        state.pendingToast = summary
      }
      if (mode === 'boss' || mode === 'godking') {
        const wasFirst = !state.firstWin[mode]
        if (wasFirst) {
          state.firstWin[mode] = true
          triggerAntiKingIntro(recordOffline)
        }
      }
      advanceAfterClear(mode)
      floorsCleared += 1
      state.battle = createBattle(state)
    }
  }

  gains = addResources(gains, collectWorkBatches(ticks))
  gains = addResources(gains, collectFinishedDispatches(state))

  state.resources = addResources(state.resources, gains)
  state.lastTick = Date.now()
  if (msgs.length) state.lastLootMsg = msgs.slice(-3).join('、')

  if (recordOffline) {
    return (state.pendingOffline = {
      seconds: ticks,
      rawSeconds,
      mode,
      gains,
      floorsCleared,
      drops,
    })
  }
  return null
}

/** 長時間離開／前景大落差：離線結算（含上限與報告） */
function settleAwayTime(now = Date.now(), opts?: { minSec?: number; emitKind?: EmitKind }) {
  const minSec = opts?.minSec ?? 3
  const rawSec = Math.floor((now - state.lastTick) / 1000)
  if (rawSec < minSec) {
    state.lastTick = now
    return false
  }
  const capped = Math.min(rawSec, OFFLINE_CAP_SEC)
  simulateTicks(capped, true, rawSec)
  emit(opts?.emitKind ?? 'ui')
  return true
}

export function gameTick() {
  const now = Date.now()
  const elapsed = now - state.lastTick
  const ticks = Math.floor(elapsed / TICK_MS)
  if (ticks <= 0) return
  // 長時間前景落後（睡眠／節流／長 AFK）→ 離線結算，不再只補 5 秒
  if (ticks >= FOREGROUND_OFFLINE_THRESHOLD_SEC) {
    settleAwayTime(now, { minSec: FOREGROUND_OFFLINE_THRESHOLD_SEC, emitKind: 'ui' })
    return
  }
  simulateTicks(ticks)
  emit('tick')
}

export function applyOfflineOnBoot() {
  settleAwayTime(Date.now())
}

export function dismissOffline() {
  state.pendingOffline = null
  emit()
}

/** 出戰中：升級綁職業格 charLevel；未出戰：升角色本體（打工用） */
function charLevelTarget(ch: OwnedCharacter): { kind: 'loadout'; role: Role } | { kind: 'body' } {
  const role = CHAR_MAP[ch.defId]?.role
  if (role && state.loadouts[role]?.characterUid === ch.uid) return { kind: 'loadout', role }
  return { kind: 'body' }
}

function readCharLevel(ch: OwnedCharacter): number {
  return getCharEnhanceLevel(state, ch)
}

function writeCharLevel(ch: OwnedCharacter, level: number) {
  const target = charLevelTarget(ch)
  const lv = Math.max(1, Math.min(CHAR_LEVEL_MAX, level))
  if (target.kind === 'loadout') {
    state.loadouts[target.role].charLevel = lv
    ch.level = lv // 同步本體，供打工／列表顯示
  } else {
    ch.level = lv
  }
}

export function levelUp(uidStr: string, times = 1): string | null {
  const ch = getOwned(state, uidStr)
  if (!ch) return '找不到角色'
  const want = Math.max(1, Math.floor(times))
  let gained = 0
  for (let i = 0; i < want; i++) {
    const cur = readCharLevel(ch)
    if (cur >= CHAR_LEVEL_MAX) break
    const cost = charLevelCost(cur)
    if (state.resources.crystal < cost) {
      if (gained === 0) return '異界水晶不足'
      break
    }
    state.resources.crystal -= cost
    writeCharLevel(ch, cur + 1)
    gained += 1
  }
  if (gained === 0) return readCharLevel(ch) >= CHAR_LEVEL_MAX ? '已達等級上限，可轉生' : '無法升級'
  state.battle = createBattle(state)
  emit()
  return null
}

export function levelUpMax(uidStr: string): string | null {
  const ch = getOwned(state, uidStr)
  if (!ch) return '找不到角色'
  if (readCharLevel(ch) >= CHAR_LEVEL_MAX) return '已達等級上限，可轉生'
  const before = readCharLevel(ch)
  while (readCharLevel(ch) < CHAR_LEVEL_MAX) {
    const cur = readCharLevel(ch)
    const cost = charLevelCost(cur)
    if (state.resources.crystal < cost) break
    state.resources.crystal -= cost
    writeCharLevel(ch, cur + 1)
  }
  if (readCharLevel(ch) === before) return '異界水晶不足'
  state.battle = createBattle(state)
  emit()
  return null
}

export function rebirthCharacter(uidStr: string): string | null {
  const ch = getOwned(state, uidStr)
  if (!ch) return '找不到角色'
  if (readCharLevel(ch) < CHAR_LEVEL_MAX) return `需達到 Lv.${CHAR_LEVEL_MAX}`
  const cost = charRebirthCost(ch.rebirth ?? 0)
  if (state.resources.crystal < cost.crystal) return '異界水晶不足'
  if (state.resources.gold < cost.gold) return '金鑽不足'
  state.resources.crystal -= cost.crystal
  state.resources.gold -= cost.gold
  ch.rebirth = (ch.rebirth ?? 0) + 1
  writeCharLevel(ch, 1)
  const role = CHAR_MAP[ch.defId]?.role
  for (const r of relicsUnlockedByRebirth(ch.rebirth, role)) {
    if (!state.relicInventory.includes(r.id)) state.relicInventory.push(r.id)
  }
  state.battle = createBattle(state)
  emit()
  return null
}

export function ascendCharacter(uidStr: string) {
  const ch = getOwned(state, uidStr)
  if (!ch) return
  const cost = charAscendCost(ch.ascend)
  if (state.resources.soul < cost) return
  state.resources.soul -= cost
  ch.ascend += 1
  emit()
}

export function boostCharacter(uidStr: string): string | null {
  const ch = getOwned(state, uidStr)
  if (!ch) return '找不到角色'
  const cost = charBoostCardCost(ch.boost ?? 0)
  const stack = Math.max(1, ch.count ?? 1)
  if (stack < cost + 1) return `需要 ${cost} 張多餘同名卡（目前堆疊 x${stack}）`
  ch.count -= cost
  ch.boost += 1
  emit()
  return null
}

/**
 * 單隻一鍵增效：用多餘同名卡連續增效到不夠為止（至少留 1 張）。
 * 回傳實際增效次數；0 表示無法再增效。
 */
export function boostCharacterMax(uidStr: string): { times: number; boost?: number; error?: string } {
  const ch = getOwned(state, uidStr)
  if (!ch) return { times: 0, error: '找不到角色' }
  let times = 0
  for (;;) {
    const cost = charBoostCardCost(ch.boost ?? 0)
    const stack = Math.max(1, ch.count ?? 1)
    if (stack < cost + 1) break
    ch.count -= cost
    ch.boost += 1
    times += 1
  }
  if (times > 0) emit()
  else return { times: 0, error: `同名卡不足（堆疊 x${Math.max(1, ch.count ?? 1)}）` }
  return { times, boost: ch.boost }
}

export function upgradeSkill(skillUid: string): string | null {
  const sk = getSkillItem(state, skillUid)
  if (!sk) return '找不到技能'
  const worn = findRoleWearingSkill(state, skillUid)
  if (!worn) return '請先裝上技能再強化（強化綁在出戰格）'
  const lo = state.loadouts[worn.role]
  lo.skillLevels ??= {}
  const cur = Math.max(1, lo.skillLevels[worn.kind] ?? 1)
  const cost = skillUpgradeCost(cur)
  if (state.resources.essence < cost) return '法術精華不足'
  state.resources.essence -= cost
  lo.skillLevels[worn.kind] = cur + 1
  sk.level = lo.skillLevels[worn.kind]! // 同步舊欄位，避免介面讀到過期值
  state.battle = createBattle(state)
  emit()
  return null
}

/** 技能升階（稀有度）；耗該技能的同名技能本。 */
export function ascendSkill(skillUid: string, _providerCharUid?: string): string | null {
  const sk = getSkillItem(state, skillUid)
  if (!sk) return '找不到技能'
  const next = nextRarity(sk.rarity)
  if (!next) return '技能已滿階'
  const cost = skillAscendCost(sk.rarity)
  const books = sk.books ?? 0
  if (books < cost) return '同名技能本不足'
  sk.books = books - cost
  sk.rarity = next
  emit()
  return null
}

/**
 * 技能本通關：產出數本同名技能本，優先分給出戰技能（其餘隨機），並進入冷卻。
 * 回傳摘要字串供 toast。
 */
export function grantSkillDungeonBooks(floor: number): string {
  const n = skillDungeonBookDrops(floor)
  const items = state.skillItems
  state.skillDungeonCdLeft = SKILL_DUNGEON_COOLDOWN_SEC
  if (!items.length) {
    return `技能本通關，但尚無技能可分配（冷卻 ${SKILL_DUNGEON_COOLDOWN_SEC}s）`
  }
  const equipped: typeof items = []
  for (const role of ROLES) {
    for (const kind of KINDS) {
      const uid = state.loadouts[role]?.skills?.[kind]
      const sk = uid ? getSkillItem(state, uid) : undefined
      if (sk) equipped.push(sk)
    }
  }
  const gained = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const pool = equipped.length && Math.random() < 0.72 ? equipped : items
    const sk = pool[Math.floor(Math.random() * pool.length)]!
    sk.books = (sk.books ?? 0) + 1
    gained.set(sk.uid, (gained.get(sk.uid) ?? 0) + 1)
  }
  const parts: string[] = []
  for (const [uid, amt] of gained) {
    const sk = getSkillItem(state, uid)
    const name = sk ? SKILL_MAP[sk.skillId]?.name ?? '?' : '?'
    parts.push(`${name}+${amt}`)
  }
  return `技能本 ×${n}（${parts.slice(0, 4).join('、')}${parts.length > 4 ? '…' : ''}）· 冷卻 ${SKILL_DUNGEON_COOLDOWN_SEC}s`
}

/** 技能裝到職業出戰格 */
export function equipSkillOnRole(role: Role, skillUid: string): string | null {
  const sk = getSkillItem(state, skillUid)
  if (!sk) return '找不到技能'
  const def = SKILL_MAP[sk.skillId]
  if (!def) return '無效技能'
  if (def.role !== role) return '職業不符'
  for (const r of ROLES) {
    for (const kind of KINDS) {
      if (state.loadouts[r].skills[kind] === skillUid) state.loadouts[r].skills[kind] = undefined
    }
  }
  state.loadouts[role].skills[def.kind] = skillUid
  state.loadouts[role].skillLevels ??= {}
  state.loadouts[role].skillLevels[def.kind] ??= 1
  state.battle = createBattle(state)
  emit()
  return null
}

export function unequipSkillOnRole(role: Role, kind: SkillKind): string | null {
  state.loadouts[role].skills[kind] = undefined
  // 強化等級留在格上，換下一本同槽技能仍沿用
  state.battle = createBattle(state)
  emit()
  return null
}

/** @deprecated 相容舊 UI：依角色職業裝到出戰格 */
export function equipSkillOnCharacter(charUid: string, skillUid: string): string | null {
  const ch = getOwned(state, charUid)
  if (!ch) return '找不到角色'
  return equipSkillOnRole(CHAR_MAP[ch.defId].role, skillUid)
}

export function unequipSkill(charUid: string, kind: SkillKind): string | null {
  const ch = getOwned(state, charUid)
  if (!ch) return '找不到角色'
  return unequipSkillOnRole(CHAR_MAP[ch.defId].role, kind)
}

export function upgradeEquip(equipUid: string): string | null {
  const eq = state.equips.find((e) => e.uid === equipUid)
  if (!eq) return '找不到裝備'
  const worn = findRoleWearingEquip(state, equipUid)
  if (!worn) return '請先裝上裝備再強化（強化綁在出戰格）'
  const lo = state.loadouts[worn.role]
  lo.equipLevels ??= {}
  const cur = Math.max(0, lo.equipLevels[worn.slot] ?? 0)
  const cost = equipUpgradeCost(cur)
  if (state.resources.forge < cost.forge || state.resources.gold < cost.gold) {
    return '熔鍛或金鑽不足'
  }
  state.resources.forge -= cost.forge
  state.resources.gold -= cost.gold
  lo.equipLevels[worn.slot] = cur + 1
  eq.level = lo.equipLevels[worn.slot]! // 同步舊欄位
  state.battle = createBattle(state)
  emit()
  return null
}

/** 後勤打造：藍圖＋熔鍛＋金鑽 → 機率品質 */
export function craftEquip(role: Role, slot: EquipSlot, tier: number): string | null {
  const maxTier = availableEquipTiers()
  if (tier > maxTier) return `目前僅可打造至 T${maxTier}`
  if (tier < 0) return '無效階級'
  const bp = equipBlueprintCost(tier)
  const craft = equipCraftCost(tier)
  if (state.resources.blueprint < bp) return '藍圖不足'
  if (state.resources.forge < craft.forge) return '熔鍛碎片不足'
  if (state.resources.gold < craft.gold) return '金鑽不足'
  state.resources.blueprint -= bp
  state.resources.forge -= craft.forge
  state.resources.gold -= craft.gold
  const def = makeEquipDef(role, slot, tier)
  const rarity = rollCraftedEquipRarity(tier)
  state.equips.push({
    uid: uid('eq'),
    defId: def.id,
    level: 0, // 強化綁出戰格；本體僅品質
    rarity,
  } satisfies OwnedEquip)
  state.pendingToast = `打造完成：${def.name} · ${rarity}`
  emit()
  return null
}

/** @deprecated 已改為後勤打造 craftEquip */
export function buyEquipBlueprint(role: Role, slot: EquipSlot, tier: number): string | null {
  return craftEquip(role, slot, tier)
}

export function clearPendingToast() {
  if (!state.pendingToast) return
  state.pendingToast = undefined
}

/** 裝備裝到職業出戰格 */
export function equipOnRole(role: Role, equipUid: string): string | null {
  const eq = state.equips.find((e) => e.uid === equipUid)
  if (!eq) return '找不到裝備'
  const parsed = parseEquipDefId(eq.defId)
  if (!parsed || parsed.role !== role) return '職業不符'
  const ch = getRoleCharacter(state, role)
  if (!ch) return '該職尚未派出角色'
  const maxTier = maxEquipTierForRebirth(ch.rebirth ?? 0)
  if (parsed.tier > maxTier) {
    const need = rebirthRequiredForEquipTier(parsed.tier)
    return `需轉生至 ${need} 次（質數）才能穿 T${parsed.tier}`
  }
  for (const r of ROLES) {
    for (const s of EQUIP_SLOTS) {
      if (state.loadouts[r].equips[s] === equipUid) state.loadouts[r].equips[s] = undefined
    }
  }
  state.loadouts[role].equips[parsed.slot] = equipUid
  state.loadouts[role].equipLevels ??= {}
  state.loadouts[role].equipLevels[parsed.slot] ??= 0
  state.battle = createBattle(state)
  emit()
  return null
}

/** 卸下職業出戰格某部位裝備 */
export function unequipOnRole(role: Role, slot: EquipSlot): string | null {
  if (!EQUIP_SLOTS.includes(slot)) return '無效部位'
  if (!state.loadouts[role].equips[slot]) return '該部位未穿裝'
  state.loadouts[role].equips[slot] = undefined
  // 強化等級留在部位格上
  state.battle = createBattle(state)
  emit()
  return null
}

export function equipOnCharacter(charUid: string, equipUid: string): string | null {
  const ch = getOwned(state, charUid)
  if (!ch) return '找不到角色'
  return equipOnRole(CHAR_MAP[ch.defId].role, equipUid)
}

export function equipRelicOnRole(role: Role, relicId: string | undefined): string | null {
  if (relicId) {
    if (!state.relicInventory.includes(relicId)) return '尚未解鎖此遺物'
    const def = RELIC_MAP[relicId]
    if (!def) return '無效遺物'
    if (def.role !== role) return `此遺物僅供${ROLE_LABEL[def.role]}裝備`
    for (const r of ROLES) {
      if (state.loadouts[r].relicId === relicId) state.loadouts[r].relicId = undefined
    }
  }
  state.loadouts[role].relicId = relicId
  state.battle = createBattle(state)
  emit()
  return null
}

export function assignWork(charUid: string, job: WorkJob | undefined): string | null {
  const ch = getOwned(state, charUid)
  if (!ch) return '找不到角色'
  if (isOnDispatch(ch)) return '派遣中無法打工'
  if (job) {
    if (fightingUids(state).has(ch.uid)) return '出戰中無法打工'
    const cap = workStationCap(state.floors.main)
    if (ch.workJob !== job) {
      const n = state.roster.filter(
        (c) => c.workJob === job && !fightingUids(state).has(c.uid) && !isOnDispatch(c),
      ).length
      if (n >= cap) return `工位已滿（${cap} 人）`
    }
  }
  ch.workJob = job
  emit()
  return null
}

export function deployCharacter(charUid: string) {
  const ch = getOwned(state, charUid)
  if (!ch) return
  if (isOnDispatch(ch)) return
  const role = CHAR_MAP[ch.defId].role
  state.loadouts[role].characterUid = ch.uid
  state.loadouts[role].charLevel ??= 1 // 換人保留格上等級，不覆蓋
  ch.workJob = undefined
  state.battle = createBattle(state)
  emit()
}

export function setCaptain(role: Role) {
  state.captainRole = role
  state.battle = createBattle(state)
  emit()
}

export function moveFormation(role: Role, dir: -1 | 1) {
  const arr = [...state.formation]
  const i = arr.indexOf(role)
  if (i < 0) return
  const j = i + dir
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  state.formation = arr
  state.battle = createBattle(state)
  emit()
}

export function moveSkillCast(kind: SkillKind, dir: -1 | 1) {
  const arr = [...state.skillCastOrder]
  const i = arr.indexOf(kind)
  if (i < 0) return
  const j = i + dir
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  state.skillCastOrder = arr
  emit()
}

export function beginDispatch(charUid: string, hours: number): string | null {
  const ch = getOwned(state, charUid)
  if (!ch) return '找不到角色'
  const opt = DISPATCH_OPTIONS.find((o) => o.hours === hours) as DispatchOption | undefined
  if (!opt) return '無效派遣時長'
  const err = startDispatch(state, ch, opt, fightingUids(state))
  if (err) return err
  emit()
  return null
}

export function fulfillOrder(orderId: string): string | null {
  const err = completeOrder(state, orderId)
  if (err) return err
  emit()
  return null
}

function rollGachaPick() {
  const weights = GACHA_CHARACTERS.map((c) => ({
    c,
    w: c.rarity === '普通' ? 14 : c.rarity === '史詩' ? 2 : 0.7,
  }))
  const total = weights.reduce((s, x) => s + x.w, 0)
  let r = Math.random() * total
  let pick = weights[0].c
  for (const w of weights) {
    r -= w.w
    if (r <= 0) {
      pick = w.c
      break
    }
  }
  return pick
}

export function gachaCost(times: 1 | 10 | 100 | 1000): number {
  if (times === 10) return GACHA_COST_TEN
  if (times === 100) return GACHA_COST_HUNDRED
  if (times === 1000) return GACHA_COST_THOUSAND
  return GACHA_COST_ONE
}

export function gachaPull(times: 1 | 10 | 100 | 1000): OwnedCharacter[] | null {
  const cost = gachaCost(times)
  if (state.resources.gold < cost) return null
  state.resources.gold -= cost
  const got: OwnedCharacter[] = []
  for (let i = 0; i < times; i++) {
    got.push(grantCharacter(rollGachaPick().id))
  }
  emit()
  return got
}

export function gachaOnce(): OwnedCharacter | null {
  return gachaPull(1)?.[0] ?? null
}

export function shopBuy(resource: keyof Resources, amount: number): string | null {
  const rate = SHOP_RATES[resource]
  if (!rate) return '無法兌換'
  const qty = Math.floor(amount)
  if (qty <= 0) return '數量需大於 0'
  const cost = rate * qty
  if (state.resources.gold < cost) return '金鑽不足'
  state.resources.gold -= cost
  state.resources[resource] += qty
  emit()
  return null
}

export function shopBuyOwnedCard(defId: string, amount = 1): string | null {
  const owned = state.roster.find((c) => c.defId === defId)
  if (!owned) return '僅能兌換已擁有的角色'
  const qty = Math.max(1, Math.floor(amount))
  const unit = ownedCardShopCost(owned.rarity)
  const cost = unit * qty
  if (state.resources.gold < cost) return '金鑽不足'
  state.resources.gold -= cost
  owned.count = Math.max(1, owned.count ?? 1) + qty
  emit()
  return null
}

export function shopBuySkill(skillId: string, rarity: Rarity): string | null {
  const def = SKILL_MAP[skillId]
  if (!def || def.unique) return '無法購買此技能'
  if (rarity !== '普通' && rarity !== '稀有') return '商店僅售最初階與次階'
  const ok = shopSkillCatalog().some((x) => x.def.id === skillId && x.rarity === rarity)
  if (!ok) return '不在商店目錄'
  const cost = shopSkillCost(rarity)
  if (state.resources.gold < cost) return '金鑽不足'
  state.resources.gold -= cost
  pushSkillItem(skillId, rarity, 1)
  emit()
  return null
}

/** 首通王階：自選一枚克制王階技能（僅一次） */
export function pickAntiKingIntro(skillId: string): string | null {
  if (!state.pendingAntiKingPick || state.antiKingIntroDone) return '目前沒有待選的克制技能'
  const def = SKILL_MAP[skillId]
  if (!def || def.source !== 'antiKing') return '無效的克制技能'
  if (state.skillItems.some((s) => s.skillId === skillId)) return '已持有此技能'
  pushSkillItem(skillId, dropSkillRarity(def), 1)
  state.pendingAntiKingPick = false
  state.antiKingIntroDone = true
  state.pendingToast = `首通王階：獲得克制技能「${def.name}」`
  emit()
  return null
}

/** 商店：破王徽＋技能卡（＋少量水晶）兌換未持有的克制王階技能 */
export function shopExchangeAntiKing(skillId: string): string | null {
  const def = SKILL_MAP[skillId]
  if (!def || def.source !== 'antiKing') return '無法兌換此技能'
  if (state.skillItems.some((s) => s.skillId === skillId)) return '已持有此技能'
  const cost = ANTI_KING_EXCHANGE_COST
  if ((state.resources.kingBadge ?? 0) < cost.kingBadge) return '破王徽不足'
  if (state.resources.skillbook < cost.skillbook) return '技能卡不足'
  if (state.resources.crystal < cost.crystal) return '異界水晶不足'
  state.resources.kingBadge -= cost.kingBadge
  state.resources.skillbook -= cost.skillbook
  state.resources.crystal -= cost.crystal
  pushSkillItem(skillId, dropSkillRarity(def), 1)
  state.pendingToast = `兌換成功：克制技能「${def.name}」`
  emit()
  return null
}

export function antiKingExchangeCost() {
  return ANTI_KING_EXCHANGE_COST
}

export function availableEquipTiers(): number {
  return equipTierFromFloor(state.floors.main)
}

export function listShopEquips() {
  return equipShopList(availableEquipTiers())
}

export function snapshotPower() {
  return { team: teamPower(state), teamChars: getTeam(state) }
}

export function canUnlockGodking() {
  return state.floors.main >= GODKING_UNLOCK
}

export function rarityList() {
  return RARITY_ORDER
}

export function countSameCards(defId: string): number {
  const ch = state.roster.find((c) => c.defId === defId)
  return ch ? Math.max(1, ch.count ?? 1) : 0
}

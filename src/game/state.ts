import { CHAR_MAP, GACHA_CHARACTERS, STARTERS } from './data/characters'
import {
  EQUIP_SLOTS,
  makeEquipDef,
  equipShopList,
  migrateLegacyEquipDefId,
  parseEquipDefId,
} from './data/equipment'
import { RELIC_MAP, relicsUnlockedByRebirth } from './data/relics'
import { SKILL_MAP, defaultSkills, dropSkillRarity, shopSkillCatalog } from './data/skills'
import {
  battleTick,
  calcCharStats,
  createBattle,
  fightingUids,
  getOwned,
  getRoleCharacter,
  getSkillItem,
  getTeam,
  teamPower,
  workBoostMult,
} from './combat'
import {
  DISPATCH_OPTIONS,
  WORK_BATCH_SEC,
  collectFinishedDispatches,
  completeOrder,
  ensureOrders,
  isOnDispatch,
  scaleWorkYield,
  startDispatch,
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
  shopSkillCost,
  skillAscendCardCost,
  skillUpgradeCost,
  uid,
} from './util'

export { GAME_NAME }

let state: GameState
const listeners = new Set<(kind?: EmitKind) => void>()
const KINDS: SkillKind[] = ['attack', 'defense', 'support']
const ROLES: Role[] = ['warrior', 'mage', 'priest']

export type EmitKind = 'tick' | 'ui'

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
  const item: OwnedSkill = { uid: uid('sk'), skillId, level, rarity }
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
      crystal: 200,
      gold: 30,
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
    floors: { main: 1, blueprint: 1, boss: 1, godking: 1 },
    farmFloor: { main: 1, blueprint: 1, boss: 1, godking: 1 },
    pushMode: { main: 'push', blueprint: 'push' },
    idleMode: 'main',
    battle: null,
    lastTick: Date.now(),
    lastSave: Date.now(),
    starterDone: false,
    pendingOffline: null,
    firstWin: { boss: false, godking: false },
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
  if (!s.version || s.version < SAVE_VERSION || !s.firstWin || !s.dropSettings) {
    return createNewState()
  }
  s.version = SAVE_VERSION
  s.skillItems ??= []
  s.loadouts ??= emptyLoadouts()
  for (const role of ROLES) {
    s.loadouts[role] ??= emptyLoadout()
    s.loadouts[role].equips ??= {}
    s.loadouts[role].skills ??= {}
  }
  s.formation ??= defaultFormation()
  if (s.formation.length !== 3) s.formation = defaultFormation()
  s.captainRole ??= 'warrior'
  s.skillCastOrder ??= defaultSkillCastOrder()
  s.workAcc ??= 0
  s.dispatches ??= []
  s.orders ??= []
  s.relicInventory ??= []
  s.floors ??= { main: 1, blueprint: 1, boss: 1, godking: 1 }
  s.farmFloor ??= { ...s.floors }
  s.pushMode ??= { main: 'push', blueprint: 'push' }
  for (const m of ['main', 'blueprint', 'boss', 'godking'] as const) {
    s.floors[m] = Math.max(1, s.floors[m] ?? 1)
    s.farmFloor[m] = Math.max(1, Math.min(s.farmFloor[m] ?? s.floors[m], s.floors[m]))
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
    if (s.loadouts[role].relicId && !RELIC_MAP[s.loadouts[role].relicId!]) {
      s.loadouts[role].relicId = undefined
    }
  }

  // 依轉生補遺物庫
  for (const ch of s.roster) {
    for (const r of relicsUnlockedByRebirth(ch.rebirth ?? 0)) {
      if (!s.relicInventory.includes(r.id)) s.relicInventory.push(r.id)
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

export function setPushMode(mode: 'main' | 'blueprint', push: PushMode) {
  state.pushMode[mode] = push
  emit()
}

function advanceAfterClear(mode: IdleMode) {
  const farm = state.farmFloor[mode]
  const max = state.floors[mode]
  if (mode === 'main' || mode === 'blueprint') {
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
      return { skillbook: Math.max(1, Math.floor(power * 0.55)) }
    case 'soul':
      return { soul: Math.max(1, Math.floor(power * 0.22)) }
  }
}

/** 每 WORK_BATCH_SEC 秒結算一批 */
function collectWorkBatches(seconds: number): Partial<Resources> {
  state.workAcc = (state.workAcc ?? 0) + seconds
  const batches = Math.floor(state.workAcc / WORK_BATCH_SEC)
  if (batches <= 0) return {}
  state.workAcc -= batches * WORK_BATCH_SEC
  let gains = emptyResources()
  const fighting = fightingUids(state)
  for (const ch of state.roster) {
    if (!ch.workJob) continue
    if (fighting.has(ch.uid)) continue
    if (isOnDispatch(ch)) continue
    const role = CHAR_MAP[ch.defId].role
    const perSec = workYieldRaw(ch.workJob, ch)
    const perBatch: Partial<Resources> = {}
    for (const [k, v] of Object.entries(perSec) as [keyof Resources, number][]) {
      if (v) perBatch[k] = v * WORK_BATCH_SEC
    }
    const scaled = scaleWorkYield(perBatch, role, ch.workJob, state.floors.main)
    for (let i = 0; i < batches; i++) gains = addResources(gains, scaled)
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

export function simulateTicks(ticks: number, recordOffline = false, rawSeconds?: number): OfflineReport | null {
  if (ticks <= 0) return null
  let gains = emptyResources()
  let floorsCleared = 0
  const mode = state.idleMode
  const drops: LootDrop[] = []
  const msgs: string[] = []

  for (let i = 0; i < ticks; i++) {
    const result = battleTick(state)
    gains = addResources(gains, result.resources)
    if (result.cleared) {
      if (result.aimCancelled && (mode === 'boss' || mode === 'godking')) {
        state.dropSettings[mode] = { aim: 'none' }
        state.pendingToast =
          '定向資源不足（需水晶與技能書），已改回空刷'
      }
      if (result.lootCost.crystal || result.lootCost.skillbook) {
        state.resources.crystal -= result.lootCost.crystal
        state.resources.skillbook -= result.lootCost.skillbook
      }
      if (result.loot.characterId || result.loot.skillId) {
        drops.push(result.loot)
        applyLoot(result.loot, msgs)
      }
      if (mode === 'boss' || mode === 'godking') {
        if (!state.firstWin[mode]) state.firstWin[mode] = true
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

export function levelUp(uidStr: string, times = 1): string | null {
  const ch = getOwned(state, uidStr)
  if (!ch) return '找不到角色'
  const want = Math.max(1, Math.floor(times))
  let gained = 0
  for (let i = 0; i < want; i++) {
    if (ch.level >= CHAR_LEVEL_MAX) break
    const cost = charLevelCost(ch.level)
    if (state.resources.crystal < cost) {
      if (gained === 0) return '異界水晶不足'
      break
    }
    state.resources.crystal -= cost
    ch.level += 1
    gained += 1
  }
  if (gained === 0) return ch.level >= CHAR_LEVEL_MAX ? '已達等級上限，可轉生' : '無法升級'
  emit()
  return null
}

export function levelUpMax(uidStr: string): string | null {
  const ch = getOwned(state, uidStr)
  if (!ch) return '找不到角色'
  if (ch.level >= CHAR_LEVEL_MAX) return '已達等級上限，可轉生'
  const before = ch.level
  while (ch.level < CHAR_LEVEL_MAX) {
    const cost = charLevelCost(ch.level)
    if (state.resources.crystal < cost) break
    state.resources.crystal -= cost
    ch.level += 1
  }
  if (ch.level === before) return '異界水晶不足'
  emit()
  return null
}

export function rebirthCharacter(uidStr: string): string | null {
  const ch = getOwned(state, uidStr)
  if (!ch) return '找不到角色'
  if (ch.level < CHAR_LEVEL_MAX) return `需達到 Lv.${CHAR_LEVEL_MAX}`
  const cost = charRebirthCost(ch.rebirth ?? 0)
  if (state.resources.crystal < cost.crystal) return '異界水晶不足'
  if (state.resources.gold < cost.gold) return '金鑽不足'
  state.resources.crystal -= cost.crystal
  state.resources.gold -= cost.gold
  ch.rebirth = (ch.rebirth ?? 0) + 1
  ch.level = 1
  for (const r of relicsUnlockedByRebirth(ch.rebirth)) {
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
  if ((ch.count ?? 1) < 2) return '需要多餘的同名卡'
  ch.count -= 1
  ch.boost += 1
  emit()
  return null
}

export function upgradeSkill(skillUid: string): string | null {
  const sk = getSkillItem(state, skillUid)
  if (!sk) return '找不到技能'
  const cost = skillUpgradeCost(sk.level)
  if (state.resources.essence < cost) return '法術精華不足'
  state.resources.essence -= cost
  sk.level += 1
  emit()
  return null
}

export function ascendSkill(skillUid: string, providerCharUid?: string): string | null {
  const sk = getSkillItem(state, skillUid)
  if (!sk) return '找不到技能'
  const next = nextRarity(sk.rarity)
  if (!next) return '技能已滿階'
  let provider = providerCharUid ? getOwned(state, providerCharUid) : undefined
  if (!provider) {
    for (const role of ROLES) {
      if (KINDS.some((k) => state.loadouts[role].skills[k] === skillUid)) {
        provider = getRoleCharacter(state, role)
        break
      }
    }
  }
  if (!provider) return '請先將技能裝到出戰格，再用該職出戰角色同名卡升階'
  const cost = skillAscendCardCost(sk.rarity)
  const stack = Math.max(1, provider.count ?? 1)
  if (stack < cost + 1) return `需要 ${cost} 張多餘同名卡（目前堆疊 x${stack}）`
  provider.count -= cost
  sk.rarity = next
  emit()
  return null
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
  state.battle = createBattle(state)
  emit()
  return null
}

export function unequipSkillOnRole(role: Role, kind: SkillKind): string | null {
  state.loadouts[role].skills[kind] = undefined
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
  const cost = equipUpgradeCost(eq.level)
  if (state.resources.forge < cost.forge || state.resources.gold < cost.gold) {
    return '熔鍛或金鑽不足'
  }
  state.resources.forge -= cost.forge
  state.resources.gold -= cost.gold
  eq.level += 1
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
    level: 1,
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
    if (!RELIC_MAP[relicId]) return '無效遺物'
    for (const r of ROLES) {
      if (state.loadouts[r].relicId === relicId) state.loadouts[r].relicId = undefined
    }
  }
  state.loadouts[role].relicId = relicId
  state.battle = createBattle(state)
  emit()
  return null
}

export function assignWork(charUid: string, job: WorkJob | undefined) {
  const ch = getOwned(state, charUid)
  if (!ch) return
  if (isOnDispatch(ch)) return
  ch.workJob = job
  emit()
}

export function deployCharacter(charUid: string) {
  const ch = getOwned(state, charUid)
  if (!ch) return
  if (isOnDispatch(ch)) return
  const role = CHAR_MAP[ch.defId].role
  state.loadouts[role].characterUid = ch.uid
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
    w: c.rarity === '普通' ? 10 : c.rarity === '史詩' ? 4 : 1.5,
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

export function gachaCost(times: 1 | 10 | 100): number {
  if (times === 10) return GACHA_COST_TEN
  if (times === 100) return GACHA_COST_HUNDRED
  return GACHA_COST_ONE
}

export function gachaPull(times: 1 | 10 | 100): OwnedCharacter[] | null {
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

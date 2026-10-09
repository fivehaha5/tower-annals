import { clearRewardMult, enemyPowerOf, oilRegenEvery, progressStep } from './combat'
import { CLASSES, CLASS_MAP } from './data/classes'
import { DUNGEONS, DUNGEON_ENEMIES, DUNGEON_MAP } from './data/dungeons'
import { GEAR_MAP, RARITY_ORDER } from './data/gear'
import { PETS, PET_MAP, hatchSeconds, petSummonWeights, petSummonXpNeed } from './data/pets'
import {
  SKILLS,
  SKILL_MAP,
  skillSummonWeights,
  skillSummonXpNeed,
  skillUpgradeCost,
} from './data/skills'
import { stageOf } from './data/stages'
import { TECH_MAP, TECH_NODES, nodesOfTree } from './data/tech'
import {
  decomposeValue,
  forgeHammerCost,
  forgeUpgradeCost,
  tryForge,
} from './forge'
import { clearSave, hasSave, loadSave, writeSave } from './save'
import type {
  AutoForgeSettings,
  ClassId,
  DungeonId,
  GameState,
  GrowSub,
  OwnedGear,
  Overlay,
  Player,
  Tab,
  TechTreeId,
} from './types'
import {
  GAME_NAME,
  LEVEL_CAP,
  createPlayer,
  forgeXpToLevel,
  gearCombatScore,
  offlineCapSec,
  powerScore,
  techRank,
  todayKey,
  totalStats,
  xpToLevel,
} from './util'

export type EmitKind = 'tick' | 'ui'
type Listener = (kind: EmitKind) => void
const listeners = new Set<Listener>()

let state: GameState = fresh()

function fresh(): GameState {
  return {
    screen: 'boot',
    tab: 'battle',
    growSub: 'skills',
    overlay: null,
    autoForge: { minRarityIndex: 2, hammersPerForge: 1, continueOnHit: false },
    player: null,
    draftName: '',
    draftClass: 'novice',
    toast: null,
    lastDrop: null,
    battleLog: [],
    forging: false,
    autoForging: false,
    offlineReport: null,
    dungeonRun: null,
    tick: 0,
  }
}

export function getState(): GameState {
  return state
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(kind: EmitKind = 'ui'): void {
  for (const fn of listeners) fn(kind)
}

function toast(text: string): void {
  state = { ...state, toast: text }
  window.setTimeout(() => {
    if (state.toast === text) {
      state = { ...state, toast: null }
      emit(state.screen === 'game' && state.player ? 'tick' : 'ui')
    }
  }, 1800)
}

function mutate(fn: (p: Player) => void): void {
  if (!state.player) return
  const player = structuredClone(state.player)
  fn(player)
  state = { ...state, player }
  writeSave(state)
  emit('ui')
}

function pushLog(text: string): void {
  state = {
    ...state,
    battleLog: [...state.battleLog.slice(-40), { text, at: Date.now() }],
  }
}

export function flushSave(): void {
  if (state.player) writeSave(state)
}

function refreshDungeonKeys(player: Player): void {
  const day = todayKey()
  if (player.dungeonKeyDay !== day) {
    player.dungeonKeyDay = day
    for (const d of DUNGEONS) {
      player.dungeonKeys[d.id] = d.keyMax
    }
  }
}

/** 研究完成：直接升階，不用領取 */
function settleResearch(player: Player): void {
  const now = Date.now()
  const speedPct = techRank(player, 'sp_speed') * 10
  for (const node of TECH_NODES) {
    const prog = player.tech[node.id]
    if (!prog?.researchingUntil) continue
    // 速度科技縮短剩餘時間（近似：完成時點提前）
    const adjusted = prog.researchingUntil - (prog.researchingUntil - now) * (speedPct / 200)
    if (now >= Math.min(prog.researchingUntil, adjusted) || now >= prog.researchingUntil) {
      prog.rank = Math.min(node.maxRank, prog.rank + 1)
      prog.researchingUntil = null
      pushLog(`研究完成：${node.name} → ${prog.rank}/${node.maxRank}`)
      toast(`${node.name} 升至 ${prog.rank} 階`)
    }
  }
}

function settleHatch(player: Player): void {
  const now = Date.now()
  for (const slot of player.hatchSlots) {
    if (slot.petId && slot.readyAt && now >= slot.readyAt) {
      const id = slot.petId
      const existing = player.ownedPets.find((p) => p.id === id)
      if (existing) existing.fragments += 1
      else player.ownedPets.push({ id, level: 1, fragments: 0 })
      if (!player.petIds.includes(id) && player.petIds.length < 3) {
        player.petIds.push(id)
      }
      const name = PET_MAP[id]?.name ?? '寵物'
      pushLog(`孵化完成：${name}`)
      toast(`孵化完成 ${name}`)
      slot.petId = null
      slot.readyAt = null
    }
  }
}

export function boot(): void {
  const saved = loadSave()
  if (saved?.player) {
    const player = saved.player
    refreshDungeonKeys(player)
    settleResearch(player)
    settleHatch(player)
    const cap = offlineCapSec(player)
    const elapsed = Math.min(
      cap,
      Math.max(0, Math.floor((Date.now() - (player.lastTick || Date.now())) / 1000)),
    )
    let offlineReport: GameState['offlineReport'] = null
    if (elapsed >= 30) {
      const coinPct = 1 + techRank(player, 'fg_off_coin') * 0.1
      const hamPct = 1 + techRank(player, 'fg_off_ham') * 0.1
      const coin = Math.floor(elapsed * (0.4 + player.stage * 0.05) * coinPct)
      const hammer = Math.floor((elapsed / 90 + player.forgeLevel / 2) * hamPct)
      const oil = Math.floor(elapsed / 50)
      player.coin += coin
      player.hammer += hammer
      player.lampOil += oil
      player.lastTick = Date.now()
      offlineReport = { seconds: elapsed, coin, hammer, oil }
    }
    state = {
      ...fresh(),
      screen: 'game',
      player,
      offlineReport,
      battleLog: [{ text: `歡迎回來，${player.name}。鐵砧還熱著。`, at: Date.now() }],
    }
    writeSave(state)
  } else {
    state = { ...fresh(), screen: 'boot' }
  }
  emit('ui')
}

export function goBoot(): void {
  state = { ...state, screen: 'boot' }
  emit('ui')
}

export function goCreate(): void {
  state = { ...state, screen: 'create', draftName: '', draftClass: 'novice' }
  emit('ui')
}

export function setDraftName(name: string): void {
  state = { ...state, draftName: name }
}

export function setDraftClass(id: ClassId): void {
  state = { ...state, draftClass: id, draftName: state.draftName }
  emit('ui')
}

export function confirmCreate(nameOverride?: string): void {
  const name = (nameOverride ?? state.draftName).trim()
  const player = createPlayer(name, 'novice')
  state = {
    ...state,
    screen: 'game',
    player,
    tab: 'battle',
    battleLog: [
      {
        text: `${player.name} 從新手村出發。點鍛造拿裝、打副本、研究科技！`,
        at: Date.now(),
      },
    ],
  }
  writeSave(state)
  emit('ui')
}

export function continueGame(): void {
  if (!hasSave()) {
    goCreate()
    return
  }
  boot()
}

export function setTab(tab: Tab): void {
  state = { ...state, tab, overlay: null, dungeonRun: tab === 'dungeon' ? state.dungeonRun : null }
  emit('ui')
}

export function setGrowSub(sub: GrowSub): void {
  state = { ...state, growSub: sub, tab: 'grow', overlay: null }
  emit('ui')
}

export function setOverlay(overlay: Overlay): void {
  state = { ...state, overlay }
  emit('ui')
}

export function setAutoForgeSettings(partial: Partial<AutoForgeSettings>): void {
  state = { ...state, autoForge: { ...state.autoForge, ...partial } }
  emit('ui')
}

export function dismissOffline(): void {
  state = { ...state, offlineReport: null }
  writeSave(state)
  emit('ui')
}

/** 確保 bag 只含已裝備件 */
function pruneUnequipped(player: Player): number {
  const equipped = new Set(Object.values(player.equips).filter(Boolean) as string[])
  let coin = 0
  const kept: OwnedGear[] = []
  for (const g of player.bag) {
    if (equipped.has(g.uid)) kept.push(g)
    else coin += decomposeValue(g)
  }
  player.bag = kept
  player.coin += coin
  return coin
}

function applyForgeGear(player: Player, gear: OwnedGear): { replaced: OwnedGear | null } {
  const def = GEAR_MAP[gear.defId]
  if (!def) return { replaced: null }
  const curUid = player.equips[def.slot]
  let replaced: OwnedGear | null = null
  if (curUid) {
    const cur = player.bag.find((b) => b.uid === curUid) ?? null
    if (cur && gearCombatScore(gear, player) > gearCombatScore(cur, player)) {
      replaced = cur
      player.bag = player.bag.filter((b) => b.uid !== cur.uid)
      player.bag.push(gear)
      player.equips[def.slot] = gear.uid
      player.coin += decomposeValue(cur)
    } else if (cur) {
      // 新件較弱：不換裝，新件分解
      player.coin += decomposeValue(gear)
      return { replaced: null }
    } else {
      player.bag.push(gear)
      player.equips[def.slot] = gear.uid
    }
  } else {
    player.bag.push(gear)
    player.equips[def.slot] = gear.uid
  }
  pruneUnequipped(player)
  return { replaced }
}

export function doForge(): void {
  if (!state.player || state.forging) return
  state = { ...state, forging: true }
  emit('ui')

  let resultGear: OwnedGear | null = null
  let replaced: OwnedGear | null = null
  mutate((player) => {
    const res = tryForge(player)
    if (!res.ok) {
      toast(res.reason)
      return
    }
    player.hammer -= res.cost
    player.totalPulls += 1
    player.forgeXp += 1
    while (player.forgeXp >= forgeXpToLevel(player.forgeLevel)) {
      player.forgeXp -= forgeXpToLevel(player.forgeLevel)
      player.forgeLevel += 1
      pushLog(`鍛造爐升至 Lv.${player.forgeLevel}！`)
    }
    const def = GEAR_MAP[res.gear.defId]
    const applied = applyForgeGear(player, res.gear)
    replaced = applied.replaced
    // 若較弱被分解，仍展示結果
    resultGear = res.gear
    const text = `鍛造：${def?.rarity}·${def?.name ?? '裝備'} Lv.${res.gear.level}${
      res.free ? '（免費）' : ''
    }`
    state = { ...state, lastDrop: text }
    pushLog(text)
  })

  state = { ...state, forging: false }
  if (resultGear) {
    state = {
      ...state,
      overlay: { kind: 'forgeResult', gear: resultGear, replaced },
    }
  }
  writeSave(state)
  emit('ui')
}

export function startAutoForge(): void {
  if (!state.player || state.autoForging) return
  state = { ...state, autoForging: true, overlay: null }
  emit('ui')
  runAutoForgeLoop()
}

function runAutoForgeLoop(): void {
  if (!state.player || !state.autoForging) return
  const settings = state.autoForge
  const player = state.player
  const cost = forgeHammerCost(player)
  if (player.hammer < cost * settings.hammersPerForge) {
    state = { ...state, autoForging: false }
    toast('錘不足，自動鍛造停止')
    emit('ui')
    return
  }

  let hit = false
  mutate((p) => {
    for (let i = 0; i < settings.hammersPerForge; i++) {
      const res = tryForge(p)
      if (!res.ok) break
      p.hammer -= res.cost
      p.totalPulls += 1
      p.forgeXp += 1
      while (p.forgeXp >= forgeXpToLevel(p.forgeLevel)) {
        p.forgeXp -= forgeXpToLevel(p.forgeLevel)
        p.forgeLevel += 1
      }
      const def = GEAR_MAP[res.gear.defId]
      const ri = RARITY_ORDER.indexOf(def?.rarity ?? '普通')
      applyForgeGear(p, res.gear)
      pushLog(`自動鍛造：${def?.rarity}·${def?.name} Lv.${res.gear.level}`)
      if (ri >= settings.minRarityIndex) {
        hit = true
        state = {
          ...state,
          lastDrop: `命中 ${def?.rarity}·${def?.name}`,
          overlay: { kind: 'forgeResult', gear: res.gear },
        }
        if (!settings.continueOnHit) break
      }
    }
  })

  if (hit && !settings.continueOnHit) {
    state = { ...state, autoForging: false }
    toast('自動鍛造：找到目標')
    emit('ui')
    return
  }

  window.setTimeout(() => {
    if (state.autoForging) runAutoForgeLoop()
  }, 280)
}

export function stopAutoForge(): void {
  state = { ...state, autoForging: false }
  emit('ui')
}

export function upgradeForge(): void {
  mutate((player) => {
    const cost = forgeUpgradeCost(player)
    if (player.coin < cost.coin) {
      toast('金幣不足')
      return
    }
    player.coin -= cost.coin
    player.forgeLevel += 1
    toast(`鍛造爐 → Lv.${player.forgeLevel}`)
    pushLog(`花費金幣升級鍛造爐至 Lv.${player.forgeLevel}`)
    state = { ...state, overlay: { kind: 'forgeInfo' } }
  })
}

export function decomposeEquipped(slotUid: string): void {
  mutate((player) => {
    const g = player.bag.find((b) => b.uid === slotUid)
    if (!g) return
    const coin = decomposeValue(g)
    player.coin += coin
    player.bag = player.bag.filter((b) => b.uid !== slotUid)
    for (const slot of Object.keys(player.equips) as (keyof Player['equips'])[]) {
      if (player.equips[slot] === slotUid) player.equips[slot] = undefined
    }
    toast(`分解 +${coin} 金`)
  })
}

export function changeClass(id: ClassId): void {
  const cls = CLASS_MAP[id]
  if (!cls) return
  mutate((player) => {
    if (player.level < cls.unlockLevel) {
      toast(`需要 Lv.${cls.unlockLevel}`)
      return
    }
    if (id === 'novice') {
      toast('已是初階菇勇者')
      return
    }
    player.classId = id
    toast(`轉職為 ${cls.name}`)
    pushLog(`${player.name} 轉職成【${cls.name}】！`)
  })
}

export function startDungeon(id: DungeonId): void {
  if (!state.player) return
  const def = DUNGEON_MAP[id]
  const player = structuredClone(state.player)
  refreshDungeonKeys(player)
  if (player.stage < def.unlockStage) {
    toast(`需通關主線 ${def.unlockLabel}`)
    state = { ...state, player }
    emit('ui')
    return
  }
  if ((player.dungeonKeys[id] ?? 0) <= 0) {
    toast('鑰匙不足（每日 08:00 補充）')
    state = { ...state, player }
    emit('ui')
    return
  }
  state = {
    ...state,
    player,
    tab: 'dungeon',
    dungeonRun: { dungeonId: id, wave: 1, progress: 0 },
    overlay: { kind: 'dungeonBattle', dungeonId: id },
  }
  pushLog(`進入地下城：${def.name}`)
  writeSave(state)
  emit('ui')
}

function grantDungeonReward(player: Player, id: DungeonId): void {
  const hamPct = 1 + techRank(player, 'fg_ham_rew') * 0.12
  const coinPct = 1 + techRank(player, 'fg_coin_rew') * 0.12
  const ticketPct = 1 + techRank(player, 'sp_ticket') * 0.12
  const techPct = 1 + techRank(player, 'sp_techpt') * 0.12
  const stage = player.stage
  switch (id) {
    case 'hammer': {
      const ham = Math.floor((3 + Math.floor(stage / 10)) * hamPct)
      const coin = Math.floor((20 + stage * 2) * coinPct)
      player.hammer += ham
      player.coin += coin
      toast(`錘本通關 +${ham}錘 +${coin}金`)
      pushLog(`錘子小偷通關 +${ham}錘 +${coin}金`)
      break
    }
    case 'skill': {
      const t = Math.max(1, Math.floor(3 * ticketPct))
      player.skillTicket += t
      toast(`鬼鎮通關 +${t} 技能券`)
      pushLog(`鬼鎮通關 +${t} 技能券`)
      break
    }
    case 'pet': {
      const t = Math.max(1, Math.floor(2 * ticketPct))
      player.petTicket += t
      toast(`入侵通關 +${t} 寵物券`)
      pushLog(`入侵通關 +${t} 寵物券`)
      break
    }
    case 'research': {
      const t = Math.max(1, Math.floor(3 * techPct))
      player.techPoint += t
      toast(`殭屍狂奔通關 +${t} 科技點`)
      pushLog(`殭屍狂奔通關 +${t} 科技點`)
      break
    }
  }
}

export function summonSkills(times = 5): void {
  mutate((player) => {
    const costPct = 1 - techRank(player, 'sp_sk_cost') * 0.08
    const cost = Math.max(1, Math.floor(times * 8 * costPct))
    if (player.skillTicket < cost) {
      toast(`技能券不足（需要 ${cost}）`)
      return
    }
    player.skillTicket -= cost
    const weights = skillSummonWeights(player.skillSummonLevel)
    const names: string[] = []
    for (let i = 0; i < times; i++) {
      const rarityWeights = weights
      let r = Math.random() * rarityWeights.reduce((a, b) => a + b, 0)
      let ri = 0
      for (; ri < rarityWeights.length; ri++) {
        r -= rarityWeights[ri]
        if (r <= 0) break
      }
      ri = Math.min(ri, RARITY_ORDER.length - 1)
      const pool = SKILLS.filter((s) => s.rarity === RARITY_ORDER[ri])
      const def = pool[Math.floor(Math.random() * pool.length)] ?? SKILLS[0]
      const owned = player.ownedSkills.find((s) => s.id === def.id)
      if (owned) owned.fragments += 1
      else player.ownedSkills.push({ id: def.id, level: 1, fragments: 0 })
      names.push(`${def.rarity}·${def.name}`)
      player.skillSummonXp += 1
    }
    while (player.skillSummonXp >= skillSummonXpNeed(player.skillSummonLevel)) {
      player.skillSummonXp -= skillSummonXpNeed(player.skillSummonLevel)
      player.skillSummonLevel += 1
      pushLog(`技能召喚等級 → ${player.skillSummonLevel}`)
    }
    toast(`召喚：${names.slice(0, 3).join('、')}${names.length > 3 ? '…' : ''}`)
  })
}

export function upgradeAllSkills(): void {
  mutate((player) => {
    let n = 0
    for (const sk of player.ownedSkills) {
      while (sk.fragments >= skillUpgradeCost(sk.level)) {
        sk.fragments -= skillUpgradeCost(sk.level)
        sk.level += 1
        n++
      }
    }
    toast(n ? `升級 ${n} 次` : '碎片不足')
  })
}

export function quickEquipSkills(): void {
  mutate((player) => {
    const ranked = [...player.ownedSkills].sort((a, b) => {
      const da = SKILL_MAP[a.id]
      const db = SKILL_MAP[b.id]
      const ra = RARITY_ORDER.indexOf(da?.rarity ?? '普通')
      const rb = RARITY_ORDER.indexOf(db?.rarity ?? '普通')
      return rb - ra || b.level - a.level
    })
    player.equippedSkills = ranked.slice(0, 3).map((s) => s.id)
    toast('已快速裝備')
  })
}

export function equipSkill(id: string): void {
  mutate((player) => {
    if (!player.ownedSkills.some((s) => s.id === id)) return
    if (player.equippedSkills.includes(id)) {
      player.equippedSkills = player.equippedSkills.filter((x) => x !== id)
      toast('已卸下技能')
      return
    }
    if (player.equippedSkills.length >= 3) {
      player.equippedSkills = [...player.equippedSkills.slice(1), id]
    } else {
      player.equippedSkills.push(id)
    }
    toast('已裝備技能')
  })
}

export function summonPets(times = 1): void {
  mutate((player) => {
    const cost = times
    if (player.petTicket < cost) {
      toast(`寵物券不足（需要 ${cost}）`)
      return
    }
    player.petTicket -= cost
    const bonusChance = techRank(player, 'sp_pet_bonus') * 5
    let extra = Math.random() * 100 < bonusChance ? 1 : 0
    const total = times + extra
    const weights = petSummonWeights(player.petSummonLevel)
    const speedPct = techRank(player, 'sp_hatch') * 10
    for (let i = 0; i < total; i++) {
      let r = Math.random() * weights.reduce((a, b) => a + b, 0)
      let ri = 0
      for (; ri < weights.length; ri++) {
        r -= weights[ri]
        if (r <= 0) break
      }
      ri = Math.min(ri, RARITY_ORDER.length - 1)
      const pool = PETS.filter((p) => p.rarity === RARITY_ORDER[ri])
      const def = pool[Math.floor(Math.random() * pool.length)] ?? PETS[0]
      // 進孵化槽
      const free = player.hatchSlots.find((s) => !s.petId)
      if (free) {
        free.petId = def.id
        free.readyAt = Date.now() + hatchSeconds(def.rarity, speedPct) * 1000
        toast(`開始孵化 ${def.name}`)
      } else {
        const existing = player.ownedPets.find((p) => p.id === def.id)
        if (existing) existing.fragments += 1
        else player.ownedPets.push({ id: def.id, level: 1, fragments: 0 })
        toast(`獲得 ${def.name}（欄位滿→碎片）`)
      }
      player.petSummonXp += 1
    }
    while (player.petSummonXp >= petSummonXpNeed(player.petSummonLevel)) {
      player.petSummonXp -= petSummonXpNeed(player.petSummonLevel)
      player.petSummonLevel += 1
    }
  })
}

export function togglePet(id: string): void {
  mutate((player) => {
    if (!player.ownedPets.some((p) => p.id === id)) {
      toast('尚未擁有')
      return
    }
    if (player.petIds.includes(id)) {
      player.petIds = player.petIds.filter((x) => x !== id)
      toast('已卸下寵物')
      return
    }
    if (player.petIds.length >= 3) {
      player.petIds = [...player.petIds.slice(1), id]
    } else {
      player.petIds.push(id)
    }
    toast('已出戰寵物')
  })
}

export function buyHatchSlot(): void {
  mutate((player) => {
    const cost = 50 + player.hatchSlots.length * 40
    if (player.coin < cost) {
      toast(`需要 ${cost} 金`)
      return
    }
    player.coin -= cost
    player.hatchSlots.push({ petId: null, readyAt: null })
    toast('孵化欄位 +1')
  })
}

export function startResearch(nodeId: string): void {
  mutate((player) => {
    const node = TECH_MAP[nodeId]
    if (!node) return
    const prog = player.tech[nodeId] ?? { rank: 0, researchingUntil: null }
    if (prog.rank >= node.maxRank) {
      toast('已滿階')
      return
    }
    if (prog.researchingUntil) {
      toast('研究進行中')
      return
    }
    // 同時只允許一個研究
    for (const [id, p] of Object.entries(player.tech)) {
      if (p.researchingUntil && id !== nodeId) {
        toast('已有研究進行中')
        return
      }
    }
    const costPct = 1 - techRank(player, 'sp_cost') * 0.08
    const cost = Math.max(1, Math.floor(node.baseCost * (prog.rank + 1) * costPct))
    if (player.techPoint < cost) {
      toast(`科技點不足（需要 ${cost}）`)
      return
    }
    const speedPct = techRank(player, 'sp_speed') * 10
    const sec = Math.max(5, Math.floor(node.baseSeconds * (prog.rank + 1) * (1 - speedPct / 100)))
    player.techPoint -= cost
    player.tech[nodeId] = { rank: prog.rank, researchingUntil: Date.now() + sec * 1000 }
    toast(`開始研究 ${node.name}（${sec}s）`)
    pushLog(`研究開始：${node.name}`)
  })
}

function levelUpLoop(player: Player): void {
  while (player.level < LEVEL_CAP && player.xp >= xpToLevel(player.level)) {
    player.xp -= xpToLevel(player.level)
    player.level += 1
    pushLog(`升級！Lv.${player.level}`)
    toast(`升級至 Lv.${player.level}`)
  }
}

/** 掛機戰鬥／副本 tick */
export function gameTick(): void {
  if (!state.player || state.screen !== 'game') return
  const player = structuredClone(state.player)
  refreshDungeonKeys(player)
  settleResearch(player)
  settleHatch(player)

  // 副本戰鬥
  if (state.dungeonRun) {
    const run = { ...state.dungeonRun }
    const def = DUNGEON_MAP[run.dungeonId]
    const enemies = DUNGEON_ENEMIES[run.dungeonId]
    const stage = stageOf(Math.max(1, player.stage))
    const power = powerScore(player)
    const enemyPower = enemyPowerOf(stage.hp * 1.1, stage.atk * 1.1, stage.def)
    const ratio = power / Math.max(1, enemyPower)
    let step = progressStep(ratio, player.classId)
    step *= 0.9 + Math.random() * 0.25
    run.progress = Math.min(1, run.progress + step)

    if (Math.random() < 0.3) {
      const enemy = enemies[Math.min(run.wave - 1, enemies.length - 1)]
      pushLog(`對 ${enemy} 造成傷害`)
    }

    if (run.progress >= 1) {
      if (run.wave >= def.waves) {
        // 完成：扣鑰＋獎勵
        player.dungeonKeys[run.dungeonId] = Math.max(0, (player.dungeonKeys[run.dungeonId] ?? 0) - 1)
        grantDungeonReward(player, run.dungeonId)
        state = {
          ...state,
          player,
          dungeonRun: null,
          overlay: null,
          tick: state.tick + 1,
        }
        writeSave(state)
        emit('tick')
        return
      }
      run.wave += 1
      run.progress = 0
      pushLog(`進入第 ${run.wave} 波`)
    }

    player.lastTick = Date.now()
    state = { ...state, player, dungeonRun: run, tick: state.tick + 1 }
    if (state.tick % 10 === 0) writeSave(state)
    emit('tick')
    return
  }

  // 主線推圖
  const stage = stageOf(player.stage)
  const stats = totalStats(player)
  const power = powerScore(player)
  const enemyPower = enemyPowerOf(stage.hp, stage.atk, stage.def)
  const ratio = power / Math.max(1, enemyPower)
  let step = progressStep(ratio, player.classId)
  step *= 0.85 + Math.random() * 0.3
  player.stageProgress = Math.min(1, player.stageProgress + step)

  if (Math.random() < 0.35) {
    const dmg = Math.max(1, Math.floor(stats.atk - stage.def * 0.4 + Math.random() * 4))
    pushLog(`對 ${stage.enemy} 造成 ${dmg} 傷害`)
  }

  if (player.stageProgress >= 1) {
    const rewardMult = clearRewardMult(ratio)
    player.stageProgress = 0
    const coin = Math.floor(stage.coin * rewardMult)
    const hammer = Math.floor(stage.hammer * rewardMult)
    const xp = Math.floor(stage.xp * Math.max(0.5, rewardMult))
    player.coin += coin
    player.hammer += hammer
    player.xp += xp
    pushLog(
      `通關 ${stage.label}！+${coin}金 +${xp}XP` + (hammer ? ` +${hammer}錘` : ''),
    )
    player.stage += 1
    levelUpLoop(player)
  }

  // 緩慢回錘（取代舊神燈油）
  const regenEvery = oilRegenEvery(ratio)
  if (state.tick % (regenEvery * 2) === 0) player.hammer += 1

  player.lastTick = Date.now()
  state = { ...state, player, tick: state.tick + 1 }
  if (state.tick % 10 === 0) writeSave(state)
  emit('tick')
}

export function abortDungeon(): void {
  state = { ...state, dungeonRun: null, overlay: null }
  pushLog('撤退地下城（未扣鑰匙）')
  writeSave(state)
  emit('ui')
}

export function resetAll(): void {
  clearSave()
  state = fresh()
  state.screen = 'boot'
  emit('ui')
}

export function createChoices() {
  return CLASSES.filter((c) => c.id === 'novice')
}

export function classChoices(player: Player) {
  return CLASSES.filter((c) => c.id !== 'novice' || player.classId === 'novice')
}

export function forgeCost(player: Player) {
  return forgeUpgradeCost(player)
}

export function currentForgeHammerCost(player: Player) {
  return forgeHammerCost(player)
}

export { GAME_NAME, hasSave, nodesOfTree, TECH_MAP }
export type { TechTreeId }

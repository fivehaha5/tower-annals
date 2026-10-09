import { clearRewardMult, enemyPowerOf, oilRegenEvery, progressStep } from './combat'
import { CLASSES, CLASS_MAP } from './data/classes'
import { GEAR_MAP } from './data/gear'
import { PETS, PET_MAP } from './data/pets'
import { stageOf } from './data/stages'
import { canPull, forgeUpgradeCost } from './forge'
import { clearSave, hasSave, loadSave, writeSave } from './save'
import type { ClassId, GameState, OwnedGear, Player, Tab } from './types'
import {
  BAG_CAP,
  GAME_NAME,
  LEVEL_CAP,
  OFFLINE_CAP_SEC,
  createPlayer,
  forgeXpToLevel,
  gearCombatScore,
  lampCost,
  powerScore,
  sellValue,
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
    player: null,
    draftName: '',
    draftClass: 'novice',
    toast: null,
    lastDrop: null,
    battleLog: [],
    forging: false,
    offlineReport: null,
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
      // 遊戲中走 tick 局部更新，避免 toast 消失時全量 innerHTML 重繪閃爍
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

export function boot(): void {
  const saved = loadSave()
  if (saved?.player) {
    const player = saved.player
    const elapsed = Math.min(
      OFFLINE_CAP_SEC,
      Math.max(0, Math.floor((Date.now() - (player.lastTick || Date.now())) / 1000)),
    )
    let offlineReport: GameState['offlineReport'] = null
    if (elapsed >= 30) {
      const coin = Math.floor(elapsed * (0.4 + player.stage * 0.05))
      const hammer = Math.floor(elapsed / 90) + Math.floor(player.forgeLevel / 2)
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
      battleLog: [{ text: `歡迎回來，${player.name}。神燈還熱著。`, at: Date.now() }],
    }
    // B2：離線結算後立刻落盤，避免重領／丟獎
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
        text: `${player.name} 從新手村出發。點神燈開箱，掛機推圖，把騎士們打回去！`,
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
  state = { ...state, tab }
  emit('ui')
}

export function dismissOffline(): void {
  state = { ...state, offlineReport: null }
  writeSave(state)
  emit('ui')
}

function trimBag(player: Player): string[] {
  const sold: string[] = []
  const equipped = new Set(Object.values(player.equips).filter(Boolean) as string[])
  while (player.bag.length > BAG_CAP) {
    let junk: OwnedGear | null = null
    let junkScore = Infinity
    for (const g of player.bag) {
      if (equipped.has(g.uid)) continue
      const sc = gearCombatScore(g)
      if (sc < junkScore) {
        junkScore = sc
        junk = g
      }
    }
    if (!junk) break
    const coin = sellValue(junk)
    player.coin += coin
    player.bag = player.bag.filter((b) => b.uid !== junk!.uid)
    sold.push(GEAR_MAP[junk.defId]?.name ?? '裝備')
  }
  return sold
}

export function pullLamp(times = 1): void {
  if (!state.player || state.forging) return
  state = { ...state, forging: true }
  emit('ui')

  const drops: string[] = []
  let autoSold = 0
  mutate((player) => {
    for (let i = 0; i < times; i++) {
      const res = canPull(player.lampOil, player.forgeLevel)
      if (!res.ok) {
        toast(res.reason)
        break
      }
      player.lampOil -= res.cost
      player.bag.push(res.gear)
      player.totalPulls += 1
      player.forgeXp += 1
      while (player.forgeXp >= forgeXpToLevel(player.forgeLevel)) {
        player.forgeXp -= forgeXpToLevel(player.forgeLevel)
        player.forgeLevel += 1
        pushLog(`鍛造爐升至 Lv.${player.forgeLevel}！高稀有率上升。`)
      }
      const def = GEAR_MAP[res.gear.defId]
      drops.push(`${def?.rarity ?? ''}·${def?.name ?? '裝備'}`)
      maybeAutoEquip(player, res.gear)
    }
    autoSold = trimBag(player).length
  })

  if (drops.length) {
    const text = drops.length === 1 ? `神燈噴出：${drops[0]}` : `連抽 ${drops.length} 次：${drops.join('、')}`
    state = { ...state, lastDrop: text, forging: false }
    pushLog(text)
    if (autoSold) toast(`${text}（背包滿，自動賣掉 ${autoSold} 件）`)
    else toast(text)
  } else {
    state = { ...state, forging: false }
  }
  writeSave(state)
  emit('ui')
}

function maybeAutoEquip(player: Player, gear: OwnedGear): void {
  const def = GEAR_MAP[gear.defId]
  if (!def) return
  const curUid = player.equips[def.slot]
  if (!curUid) {
    player.equips[def.slot] = gear.uid
    return
  }
  const cur = player.bag.find((b) => b.uid === curUid)
  if (!cur) {
    player.equips[def.slot] = gear.uid
    return
  }
  // B7：比戰力貢獻，不單比稀有度
  if (gearCombatScore(gear) > gearCombatScore(cur)) {
    player.equips[def.slot] = gear.uid
  }
}

export function upgradeForge(): void {
  mutate((player) => {
    const cost = forgeUpgradeCost(player.forgeLevel)
    if (player.hammer < cost.hammer || player.coin < cost.coin) {
      toast('錘或金幣不足')
      return
    }
    player.hammer -= cost.hammer
    player.coin -= cost.coin
    player.forgeLevel += 1
    toast(`鍛造爐 → Lv.${player.forgeLevel}`)
    pushLog(`花費材料升級鍛造爐至 Lv.${player.forgeLevel}`)
  })
}

export function equipGear(uid: string): void {
  mutate((player) => {
    const g = player.bag.find((b) => b.uid === uid)
    const def = g ? GEAR_MAP[g.defId] : null
    if (!g || !def) return
    player.equips[def.slot] = uid
    toast(`已裝備 ${def.name}`)
  })
}

export function sellGear(uid: string): void {
  mutate((player) => {
    const g = player.bag.find((b) => b.uid === uid)
    const def = g ? GEAR_MAP[g.defId] : null
    if (!g || !def) return
    const coin = sellValue(g)
    player.coin += coin
    player.bag = player.bag.filter((b) => b.uid !== uid)
    for (const slot of Object.keys(player.equips) as (keyof Player['equips'])[]) {
      if (player.equips[slot] === uid) player.equips[slot] = undefined
    }
    toast(`出售 +${coin} 金`)
  })
}

export function enhanceGear(uid: string): void {
  mutate((player) => {
    const g = player.bag.find((b) => b.uid === uid)
    if (!g) return
    const cost = 3 + g.level * 2
    if (player.hammer < cost) {
      toast(`需要 ${cost} 錘`)
      return
    }
    player.hammer -= cost
    g.level += 1
    toast(`強化至 +${g.level}`)
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

export function selectPet(id: string): void {
  mutate((player) => {
    if (!player.unlockedPets.includes(id)) {
      toast('尚未解鎖')
      return
    }
    player.petId = id
    toast('已攜帶同伴')
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

function unlockPets(player: Player): void {
  for (const pet of PETS) {
    const forgeOk = player.forgeLevel >= (pet.unlockForge ?? 1)
    if (player.stage >= pet.unlockStage && forgeOk && !player.unlockedPets.includes(pet.id)) {
      player.unlockedPets.push(pet.id)
      pushLog(`解鎖同伴：${pet.name}`)
      toast(`解鎖同伴 ${pet.name}`)
    }
  }
}

function applyPetLoot(player: Player, ratio: number): { hammer: number; oil: number } {
  const pet = player.petId ? PET_MAP[player.petId] : null
  const loot = pet?.lootBonus
  if (!loot || ratio < 0.5) return { hammer: 0, oil: 0 }
  let hammer = 0
  let oil = 0
  if (loot.hammerChance && Math.random() < loot.hammerChance) hammer += 1
  if (loot.oilChance && Math.random() < loot.oilChance) oil += loot.oilExtra ?? 1
  return { hammer, oil }
}

/** 掛機戰鬥 tick：自動推關 */
export function gameTick(): void {
  if (!state.player || state.screen !== 'game') return
  const player = structuredClone(state.player)
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
    let oil = Math.floor((1 + Math.floor(player.forgeLevel / 3)) * rewardMult)
    const xp = Math.floor(stage.xp * Math.max(0.5, rewardMult))
    const petLoot = applyPetLoot(player, ratio)
    const totalHammer = hammer + petLoot.hammer
    oil += petLoot.oil
    player.coin += coin
    player.hammer += totalHammer
    player.lampOil += oil
    player.xp += xp
    const lootNote =
      petLoot.hammer || petLoot.oil
        ? `（偷燈鼠 +${petLoot.hammer ? `${petLoot.hammer}錘` : ''}${petLoot.oil ? `${petLoot.oil}油` : ''}）`
        : ''
    pushLog(
      `通關 ${stage.name}！+${coin}金 +${xp}XP` +
        (totalHammer ? ` +${totalHammer}錘` : '') +
        (oil ? ` +${oil}油` : '') +
        lootNote,
    )
    player.stage += 1
    levelUpLoop(player)
    unlockPets(player)
  }

  const regenEvery = oilRegenEvery(ratio)
  if (state.tick % regenEvery === 0) player.lampOil += 1

  player.lastTick = Date.now()
  state = { ...state, player, tick: state.tick + 1 }
  if (state.tick % 10 === 0) writeSave(state)
  emit('tick')
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

export function currentLampCost(player: Player): number {
  return lampCost(player.forgeLevel)
}

export function forgeCost(player: Player) {
  return forgeUpgradeCost(player.forgeLevel)
}

export { GAME_NAME, hasSave }

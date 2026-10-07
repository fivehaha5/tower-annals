import { applyCombatAction, classSkills, pickAutoAction, startBattle } from './combat'
import { ITEM_MAP, SHOP_ITEM_IDS } from './data/items'
import { MONSTER_MAP } from './data/monsters'
import { NPC_MAP } from './data/npcs'
import { QUEST_MAP } from './data/quests'
import { ZONE_MAP } from './data/zones'
import { clearRealmSave, hasRealmSave, loadRealmSave, saveRealm } from './save'
import type {
  ChatLine,
  ClassId,
  CombatAction,
  GameState,
  ModalState,
  Player,
  QuestDef,
  Tab,
} from './types'
import {
  LEVEL_CAP,
  REALM_NAME,
  addItem,
  bagQty,
  createPlayer,
  fullStats,
  removeItem,
  removeUid,
  syncVitals,
  xpToLevel,
} from './util'

type Listener = () => void

let state: GameState = freshState()
const listeners = new Set<Listener>()

function freshState(): GameState {
  return {
    screen: 'title',
    tab: 'scene',
    player: null,
    draftName: '',
    draftClass: 'swordsman',
    battle: null,
    autoBattle: false,
    chat: [
      {
        id: 'sys0',
        channel: '系統',
        text: `歡迎來到《${REALM_NAME}》——更接近傳統網遊節奏：接任務、清怪、換裝、開地圖。`,
        at: Date.now(),
      },
    ],
    toast: null,
    modal: null,
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

function emit(): void {
  for (const fn of listeners) fn()
}

function setState(patch: Partial<GameState>): void {
  state = { ...state, ...patch }
  emit()
}

function mutatePlayer(fn: (p: Player) => void): void {
  if (!state.player) return
  const player = structuredClone(state.player)
  fn(player)
  syncVitals(player)
  state = { ...state, player }
  saveRealm(state)
  emit()
}

function pushChat(channel: ChatLine['channel'], text: string): void {
  const line: ChatLine = {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    channel,
    text,
    at: Date.now(),
  }
  state = { ...state, chat: [...state.chat.slice(-80), line] }
}

function toast(text: string): void {
  state = { ...state, toast: text }
  window.setTimeout(() => {
    if (state.toast === text) {
      state = { ...state, toast: null }
      emit()
    }
  }, 2200)
}

export function bootRealm(): void {
  const saved = loadRealmSave()
  if (saved?.player) {
    state = {
      ...freshState(),
      screen: 'game',
      player: saved.player,
      autoBattle: saved.autoBattle,
      chat: [
        {
          id: 'sys_load',
          channel: '系統',
          text: `讀取存檔：${saved.player.name} · Lv.${saved.player.level}`,
          at: Date.now(),
        },
      ],
    }
  } else {
    state = freshState()
  }
  emit()
}

export function goTitle(): void {
  setState({ screen: 'title', battle: null, modal: null })
}

export function goCreate(): void {
  setState({ screen: 'create', draftName: '', draftClass: 'swordsman' })
}

export function setDraftName(name: string): void {
  setState({ draftName: name })
}

export function setDraftClass(id: ClassId): void {
  setState({ draftClass: id })
}

export function confirmCreate(): void {
  const player = createPlayer(state.draftName, state.draftClass)
  // auto-equip starter gear
  const weapon = player.bag.find((b) => ITEM_MAP[b.defId]?.slot === 'weapon')
  const armor = player.bag.find((b) => ITEM_MAP[b.defId]?.slot === 'armor')
  if (weapon) player.equips.weapon = weapon.uid
  if (armor) player.equips.armor = armor.uid
  const s = fullStats(player)
  player.hp = s.hp
  player.mp = s.mp
  state = {
    ...state,
    screen: 'game',
    player,
    tab: 'scene',
    battle: null,
    modal: null,
  }
  pushChat('系統', `${player.name} 踏入蒼瀾城。先去找長老吧。`)
  pushChat('世界', '【世界】有新的冒險者註冊了公會名冊。')
  saveRealm(state)
  emit()
}

export function continueGame(): void {
  if (!hasRealmSave()) {
    goCreate()
    return
  }
  bootRealm()
}

export function setTab(tab: Tab): void {
  if (state.battle && !state.battle.over && tab !== 'scene') {
    toast('戰鬥中無法切換頁面')
    emit()
    return
  }
  setState({ tab, modal: null })
}

export function setModal(modal: ModalState | null): void {
  setState({ modal })
}

export function setAutoBattle(on: boolean): void {
  state = { ...state, autoBattle: on }
  saveRealm(state)
  emit()
}

export function travelTo(zoneId: string): void {
  const p = state.player
  if (!p || state.battle) return
  if (!p.unlockedZones.includes(zoneId)) {
    toast('地圖尚未解鎖')
    emit()
    return
  }
  const zone = ZONE_MAP[zoneId]
  const cur = ZONE_MAP[p.zoneId]
  if (!zone || !cur?.links.includes(zoneId)) {
    toast('無法直接前往該地')
    emit()
    return
  }
  mutatePlayer((player) => {
    player.zoneId = zoneId
  })
  pushChat('系統', `移動至【${zone.name}】`)
  advanceQuestProgress('reach', zoneId, 1)
  // town rest
  if (zone.kind === 'town') {
    mutatePlayer((player) => {
      const s = fullStats(player)
      player.hp = s.hp
      player.mp = s.mp
    })
    toast('回到城鎮，狀態已恢復')
  }
  emit()
}

export function openNpc(npcId: string): void {
  const npc = NPC_MAP[npcId]
  if (!npc || !state.player) return
  if (state.player.zoneId !== npc.zoneId) {
    toast('NPC 不在此地')
    emit()
    return
  }
  setModal({ kind: 'npc', npcId })
}

function currentStep(quest: QuestDef, progress: number) {
  let acc = 0
  for (const step of quest.steps) {
    if (progress < acc + step.count) {
      return { step, doneInStep: progress - acc, stepIndex: quest.steps.indexOf(step) }
    }
    acc += step.count
  }
  return null
}

function questTotalNeeded(quest: QuestDef): number {
  return quest.steps.reduce((n, s) => n + s.count, 0)
}

function tryCompleteQuest(player: Player, questId: string): boolean {
  const quest = QUEST_MAP[questId]
  if (!quest) return false
  const prog = player.questProgress[questId] ?? 0
  if (prog < questTotalNeeded(quest)) return false
  if (player.doneQuests.includes(questId)) return false

  player.doneQuests.push(questId)
  player.activeQuests = player.activeQuests.filter((id) => id !== questId)
  player.xp += quest.rewardXp
  player.gold += quest.rewardGold
  for (const id of quest.rewardItemIds ?? []) addItem(player, id, 1)
  for (const z of quest.unlockZoneIds ?? []) {
    if (!player.unlockedZones.includes(z)) player.unlockedZones.push(z)
  }
  if (quest.nextQuestId && !player.doneQuests.includes(quest.nextQuestId)) {
    if (!player.activeQuests.includes(quest.nextQuestId)) {
      player.activeQuests.push(quest.nextQuestId)
      player.questProgress[quest.nextQuestId] = 0
    }
  }
  levelUpLoop(player)
  return true
}

function levelUpLoop(player: Player): void {
  while (player.level < LEVEL_CAP && player.xp >= xpToLevel(player.level)) {
    player.xp -= xpToLevel(player.level)
    player.level += 1
    const s = fullStats(player)
    player.hp = s.hp
    player.mp = s.mp
    state = { ...state, modal: { kind: 'levelup', level: player.level } }
    pushChat('系統', `${player.name} 升級至 Lv.${player.level}！`)
  }
}

export function advanceQuestProgress(
  type: 'talk' | 'kill' | 'collect' | 'reach' | 'equip',
  targetId: string,
  amount = 1,
): void {
  if (!state.player) return
  let completed: string | null = null
  mutatePlayer((player) => {
    for (const qid of [...player.activeQuests]) {
      const quest = QUEST_MAP[qid]
      if (!quest) continue
      const prog = player.questProgress[qid] ?? 0
      const cur = currentStep(quest, prog)
      if (!cur) {
        if (tryCompleteQuest(player, qid)) completed = qid
        continue
      }
      if (cur.step.type !== type || cur.step.targetId !== targetId) continue

      // collect: verify inventory
      if (type === 'collect') {
        const have = bagQty(player, targetId)
        const need = cur.step.count
        // set progress based on inventory for collect steps at start of that step
        const beforeSteps = quest.steps
          .slice(0, cur.stepIndex)
          .reduce((n, s) => n + s.count, 0)
        player.questProgress[qid] = beforeSteps + Math.min(have, need)
      } else {
        player.questProgress[qid] = prog + amount
      }

      const after = currentStep(quest, player.questProgress[qid] ?? 0)
      if (!after) {
        // for talk/collect handoff, completion may need talk — if all steps done:
        if ((player.questProgress[qid] ?? 0) >= questTotalNeeded(quest)) {
          if (tryCompleteQuest(player, qid)) completed = qid
        }
      }
    }
  })
  if (completed) {
    pushChat('任務', `完成任務：${QUEST_MAP[completed].name}`)
    state = { ...state, modal: { kind: 'questDone', questId: completed } }
    emit()
  }
}

export function acceptQuest(questId: string): void {
  mutatePlayer((player) => {
    if (player.activeQuests.includes(questId) || player.doneQuests.includes(questId)) return
    player.activeQuests.push(questId)
    player.questProgress[questId] = 0
  })
  const q = QUEST_MAP[questId]
  if (q) {
    pushChat('任務', `接受任務：${q.name}`)
    toast(`接受：${q.name}`)
  }
  emit()
}

export function talkToNpc(npcId: string): void {
  advanceQuestProgress('talk', npcId, 1)
  // also refresh collect progress when talking (hand-in)
  if (state.player) {
    for (const qid of state.player.activeQuests) {
      const quest = QUEST_MAP[qid]
      const prog = state.player.questProgress[qid] ?? 0
      const cur = currentStep(quest, prog)
      if (cur?.step.type === 'collect') {
        advanceQuestProgress('collect', cur.step.targetId, 0)
      }
    }
  }
  pushChat('世界', `${NPC_MAP[npcId]?.name ?? 'NPC'}：……`)
  emit()
}

export function hunt(): void {
  const p = state.player
  if (!p || state.battle) return
  const zone = ZONE_MAP[p.zoneId]
  if (!zone || zone.kind === 'town' || zone.monsterIds.length === 0) {
    toast('此處無法狩獵')
    emit()
    return
  }
  if (p.hp <= 0) {
    toast('生命不足，先回城休息')
    emit()
    return
  }
  const mid = zone.monsterIds[Math.floor(Math.random() * zone.monsterIds.length)]
  const battle = startBattle(p, mid)
  if (!battle) return
  state = { ...state, battle, tab: 'scene' }
  pushChat('戰鬥', `進入戰鬥：${MONSTER_MAP[mid].name}`)
  emit()
}

export function combatAct(action: CombatAction): void {
  const p = state.player
  const battle = state.battle
  if (!p || !battle || battle.over) return

  let next = applyCombatAction(battle, p, action)
  if (next.pendingPotionUid) {
    mutatePlayer((player) => {
      removeUid(player, next.pendingPotionUid!, 1)
      player.potionsUsed += 1
    })
    next = { ...next, pendingPotionUid: undefined }
  }

  // sync vitals from battle
  mutatePlayer((player) => {
    player.hp = next.player.hp
    player.mp = next.player.mp
  })

  if (next.over) {
    if (next.victory && next.rewards) {
      const rewards = next.rewards
      const monsterId = next.enemy.monsterId
      mutatePlayer((player) => {
        player.xp += rewards.xp
        player.gold += rewards.gold
        for (const d of rewards.drops) addItem(player, d, 1)
        if (monsterId) {
          player.kills[monsterId] = (player.kills[monsterId] ?? 0) + 1
        }
        levelUpLoop(player)
      })
      if (monsterId) advanceQuestProgress('kill', monsterId, 1)
      // refresh collect
      for (const d of rewards.drops) {
        if (d === 'herb_moss') advanceQuestProgress('collect', d, 0)
      }
      pushChat(
        '戰鬥',
        `勝利！+${rewards.xp} XP、+${rewards.gold} 金${rewards.drops.length ? `、掉落 ${rewards.drops.map((id) => ITEM_MAP[id]?.name).join('、')}` : ''}`,
      )
    } else if (!next.fled && next.victory === false) {
      mutatePlayer((player) => {
        player.zoneId = 'town_cangluan'
        const s = fullStats(player)
        player.hp = Math.max(1, Math.floor(s.hp * 0.4))
        player.mp = Math.floor(s.mp * 0.4)
        player.gold = Math.max(0, player.gold - Math.floor(player.gold * 0.05))
      })
      pushChat('系統', '戰敗罰沒少量金幣，已送回蒼瀾城。')
    }
  }

  state = { ...state, battle: next }
  saveRealm(state)
  emit()
}

export function dismissBattle(): void {
  setState({ battle: null })
}

export function tickAutoBattle(): void {
  const b = state.battle
  const p = state.player
  if (!state.autoBattle || !b || !p || b.over) return
  combatAct(pickAutoAction(b, p))
}

export function equipItem(itemUid: string): void {
  mutatePlayer((player) => {
    const owned = player.bag.find((b) => b.uid === itemUid)
    const def = owned ? ITEM_MAP[owned.defId] : null
    if (!def || def.kind !== 'equip' || !def.slot) return
    player.equips[def.slot] = itemUid
  })
  advanceQuestProgress('equip', 'any', 1)
  toast('已裝備')
  setModal(null)
  emit()
}

export function unequipSlot(slot: 'weapon' | 'armor' | 'accessory'): void {
  mutatePlayer((player) => {
    player.equips[slot] = undefined
  })
  toast('已卸下')
  emit()
}

export function useItem(itemUid: string): void {
  if (state.battle && !state.battle.over) {
    toast('戰鬥中請用戰鬥指令使用藥水')
    emit()
    return
  }
  mutatePlayer((player) => {
    const owned = player.bag.find((b) => b.uid === itemUid)
    const def = owned ? ITEM_MAP[owned.defId] : null
    if (!def || def.kind !== 'consumable') return
    const s = fullStats(player)
    if (def.healHp) player.hp = Math.min(s.hp, player.hp + def.healHp)
    if (def.healMp) player.mp = Math.min(s.mp, player.mp + def.healMp)
    removeUid(player, itemUid, 1)
  })
  toast('已使用')
  setModal(null)
  emit()
}

export function sellItem(itemUid: string): void {
  mutatePlayer((player) => {
    const owned = player.bag.find((b) => b.uid === itemUid)
    const def = owned ? ITEM_MAP[owned.defId] : null
    if (!def || def.kind === 'quest') return
    player.gold += def.sell * (owned?.qty ?? 1)
    player.bag = player.bag.filter((b) => b.uid !== itemUid)
    for (const slot of ['weapon', 'armor', 'accessory'] as const) {
      if (player.equips[slot] === itemUid) player.equips[slot] = undefined
    }
  })
  toast('已出售')
  setModal(null)
  emit()
}

export function buyItem(defId: string): void {
  const def = ITEM_MAP[defId]
  if (!def || !SHOP_ITEM_IDS.includes(defId)) return
  mutatePlayer((player) => {
    if (player.gold < def.price) return
    player.gold -= def.price
    addItem(player, defId, 1)
  })
  if ((state.player?.gold ?? 0) >= 0) {
    toast(`購買 ${def.name}`)
  }
  emit()
}

export function restInTown(): void {
  const p = state.player
  if (!p) return
  const zone = ZONE_MAP[p.zoneId]
  if (zone?.kind !== 'town') {
    toast('只能在城鎮休息')
    emit()
    return
  }
  mutatePlayer((player) => {
    const s = fullStats(player)
    player.hp = s.hp
    player.mp = s.mp
  })
  toast('休息完畢，狀態全滿')
  emit()
}

export function resetSave(): void {
  clearRealmSave()
  state = freshState()
  emit()
}

export function getQuestStepHint(player: Player, questId: string): string {
  const quest = QUEST_MAP[questId]
  if (!quest) return ''
  const prog = player.questProgress[questId] ?? 0
  const cur = currentStep(quest, prog)
  if (!cur) return '可交付／已完成條件'
  return `${cur.step.hint}（${cur.doneInStep}/${cur.step.count}）`
}

export function skillsForPlayer(player: Player) {
  return classSkills(player)
}

export function shopCatalog() {
  return SHOP_ITEM_IDS.map((id) => ITEM_MAP[id]).filter(Boolean)
}

export function removeQuestItemsOnHandin(): void {
  // herbs stay as materials; no forced remove for simplicity
  void removeItem
}

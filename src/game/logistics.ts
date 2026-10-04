import type { GameState, LogisticsOrder, OwnedCharacter, Resources, Role, WorkJob } from './types'
import { CHAR_MAP } from './data/characters'
import { uid } from './util'

export const WORK_BATCH_SEC = 5
/** 主塔每 100 層 +4%，上限 +80% */
export function mainTowerWorkBonus(mainFloor: number): number {
  const steps = Math.floor(Math.max(0, mainFloor) / 100)
  return Math.min(0.8, steps * 0.04)
}

/** 職業特化：僅對應工種 */
export function roleWorkBonus(role: Role, job: WorkJob): number {
  if (role === 'warrior' && job === 'forge') return 0.25
  if (role === 'mage' && job === 'skillbook') return 0.25
  if (role === 'priest' && job === 'soul') return 0.25
  return 0
}

export function scaleWorkYield(
  base: Partial<Resources>,
  role: Role,
  job: WorkJob,
  mainFloor: number,
): Partial<Resources> {
  const mult = (1 + roleWorkBonus(role, job)) * (1 + mainTowerWorkBonus(mainFloor))
  const out: Partial<Resources> = {}
  for (const [k, v] of Object.entries(base) as [keyof Resources, number][]) {
    if (v) out[k] = Math.max(1, Math.floor(v * mult))
  }
  return out
}

const ORDER_TEMPLATES: {
  reqKey: keyof Resources
  reqAmount: number
  rewardKey: keyof Resources
  rewardAmount: number
}[] = [
  { reqKey: 'essence', reqAmount: 40, rewardKey: 'crystal', rewardAmount: 120 },
  { reqKey: 'essence', reqAmount: 80, rewardKey: 'blueprint', rewardAmount: 25 },
  { reqKey: 'forge', reqAmount: 50, rewardKey: 'crystal', rewardAmount: 100 },
  { reqKey: 'forge', reqAmount: 90, rewardKey: 'blueprint', rewardAmount: 30 },
  { reqKey: 'skillbook', reqAmount: 20, rewardKey: 'crystal', rewardAmount: 150 },
  { reqKey: 'soul', reqAmount: 15, rewardKey: 'blueprint', rewardAmount: 35 },
]

export function makeOrder(): LogisticsOrder {
  const t = ORDER_TEMPLATES[Math.floor(Math.random() * ORDER_TEMPLATES.length)]
  return {
    id: uid('ord'),
    ...t,
    refreshAt: 0,
  }
}

export function ensureOrders(state: GameState) {
  state.orders ??= []
  while (state.orders.filter((o) => o.refreshAt <= Date.now()).length < 2 && state.orders.length < 2) {
    state.orders.push(makeOrder())
  }
  // 補滿至 2
  while (state.orders.length < 2) state.orders.push(makeOrder())
}

export function completeOrder(state: GameState, orderId: string): string | null {
  ensureOrders(state)
  const ord = state.orders.find((o) => o.id === orderId)
  if (!ord) return '找不到訂單'
  if (ord.refreshAt > Date.now()) return '訂單冷卻中'
  if (state.resources[ord.reqKey] < ord.reqAmount) return '資源不足'
  state.resources[ord.reqKey] -= ord.reqAmount
  state.resources[ord.rewardKey] += ord.rewardAmount
  // 替換為新單，短 CD
  const idx = state.orders.indexOf(ord)
  const next = makeOrder()
  next.refreshAt = Date.now() + 30_000
  state.orders[idx] = next
  return null
}

export type DispatchOption = {
  hours: number
  label: string
  reward: Partial<Resources>
}

export const DISPATCH_OPTIONS: DispatchOption[] = [
  { hours: 1, label: '短巡（1 時）', reward: { blueprint: 8 } },
  { hours: 2, label: '抄錄（2 時）', reward: { skillbook: 6 } },
  { hours: 4, label: '探層（4 時）', reward: { blueprint: 22, skillbook: 4 } },
  { hours: 8, label: '遠征（8 時）', reward: { blueprint: 50, skillbook: 14 } },
]

export function startDispatch(
  state: GameState,
  ch: OwnedCharacter,
  opt: DispatchOption,
  fighting: Set<string>,
): string | null {
  if (fighting.has(ch.uid)) return '出戰中無法派遣'
  if (ch.workJob) return '打工中無法派遣'
  if (ch.dispatchUntil && ch.dispatchUntil > Date.now()) return '已在派遣中'
  if (state.dispatches.some((d) => d.charUid === ch.uid)) return '已在派遣中'
  const endsAt = Date.now() + opt.hours * 3600_000
  ch.dispatchUntil = endsAt
  ch.dispatchReward = { ...opt.reward }
  state.dispatches.push({
    id: uid('dsp'),
    charUid: ch.uid,
    endsAt,
    reward: { ...opt.reward },
    label: `${CHAR_MAP[ch.defId]?.name ?? '?'} · ${opt.label}`,
  })
  return null
}

export function collectFinishedDispatches(state: GameState): Partial<Resources> {
  const now = Date.now()
  const gains: Partial<Resources> = {}
  const remain: typeof state.dispatches = []
  for (const d of state.dispatches ?? []) {
    if (d.endsAt > now) {
      remain.push(d)
      continue
    }
    for (const [k, v] of Object.entries(d.reward) as [keyof Resources, number][]) {
      if (v) gains[k] = (gains[k] ?? 0) + v
    }
    const ch = state.roster.find((c) => c.uid === d.charUid)
    if (ch) {
      ch.dispatchUntil = undefined
      ch.dispatchReward = undefined
    }
  }
  state.dispatches = remain
  return gains
}

export function isOnDispatch(ch: OwnedCharacter): boolean {
  return !!(ch.dispatchUntil && ch.dispatchUntil > Date.now())
}

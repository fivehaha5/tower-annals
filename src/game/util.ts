import type {
  Element,
  Rarity,
  Resources,
  Role,
  RoleLoadout,
  SkillKind,
  Stats,
} from './types'
import {
  ASCEND_MULT_STEP,
  RARITY_MULT_STEP,
  REBIRTH_MULT_STEP,
} from './balance'

export { CHAR_LEVEL_MAX } from './balance'

export const GAME_NAME = '異塔編年'
/** 作廢舊存檔：換 key */
export const SAVE_KEY = 'tower-annals-save-v3'
/** v4：技能卡經濟、技能本、暴走與增效曲線；舊 v3 存檔可遷移 */
export const SAVE_VERSION = 4
export const GODKING_UNLOCK = 10000
export const TICK_MS = 1000
/** 定向掉落基礎水晶（再 × 輪迴） */
export const LOOT_COST_CRYSTAL = 12000
/** 定向掉落基礎技能卡（再隨輪迴緩增） */
export const LOOT_COST_SKILLBOOK_AIM = 25
/** 離線結算上限（秒）— 收斂為 4 小時 */
export const OFFLINE_CAP_SEC = 4 * 3600
/**
 * 前景一次落後達此秒數（含）→ 改走離線結算（含離線上限＋報告）。
 * 低於此：直接補滿落下的 tick，避免長 AFK 只補到幾秒。
 */
export const FOREGROUND_OFFLINE_THRESHOLD_SEC = 30

export function emptyLoadout(): RoleLoadout {
  return { equips: {}, skills: {} }
}

export function defaultFormation(): Role[] {
  return ['warrior', 'mage', 'priest']
}

export function defaultSkillCastOrder(): SkillKind[] {
  return ['attack', 'defense', 'support']
}

export type LootCost = {
  crystal: number
  skillbook: number
}

export function emptyLootCost(): LootCost {
  return { crystal: 0, skillbook: 0 }
}

export const RARITY_ORDER: Rarity[] = [
  '普通',
  '稀有',
  '史詩',
  '傳奇',
  '神話',
  '永恆',
  '創世',
]

export const RARITY_COLOR: Record<Rarity, string> = {
  普通: '#d7d9df',
  稀有: '#4ea1ff',
  史詩: '#b56cff',
  傳奇: '#ff9a3c',
  神話: '#ffd76a',
  永恆: '#ff4d6d',
  創世: '#fff7d6',
}

export const ROLE_LABEL: Record<Role, string> = {
  warrior: '戰士',
  mage: '法師',
  priest: '牧師',
}

export const ROLE_COLOR: Record<Role, string> = {
  warrior: '#d4a017',
  mage: '#8b5cff',
  priest: '#3ecf8e',
}

export const SKILL_KIND_LABEL: Record<SkillKind, string> = {
  attack: '攻擊',
  defense: '防禦',
  support: '輔助',
}

export const ELEMENT_COLOR: Record<Element, string> = {
  火: '#ff6b4a',
  水: '#4db7ff',
  雷: '#ffe566',
  光: '#fff1b8',
  暗: '#a78bfa',
}

export const RESOURCE_META: {
  key: keyof Resources
  name: string
  rarity: Rarity
}[] = [
  { key: 'crystal', name: '異界水晶', rarity: '普通' },
  { key: 'gold', name: '金鑽', rarity: '傳奇' },
  { key: 'blueprint', name: '藍圖碎片', rarity: '稀有' },
  { key: 'forge', name: '熔鍛碎片', rarity: '史詩' },
  { key: 'essence', name: '法術精華', rarity: '史詩' },
  { key: 'skillbook', name: '技能卡', rarity: '史詩' },
  { key: 'soul', name: '神魂', rarity: '傳奇' },
]

/** 金鑽商店：1 單位資源需要的金鑽（水晶刻意脫鉤，避免金=水晶） */
export const SHOP_RATES: Partial<Record<keyof Resources, number>> = {
  crystal: 8,
  blueprint: 5,
  forge: 6,
  essence: 6,
  skillbook: 5,
  soul: 12,
}

export const GACHA_COST_ONE = 50
export const GACHA_COST_TEN = 480
export const GACHA_COST_HUNDRED = 4200

/** 火 > 雷 > 水 > 火；光暗互克 */
export function elementMult(atk: Element, def: Element): number {
  if (atk === def) return 1
  if ((atk === '光' && def === '暗') || (atk === '暗' && def === '光')) return 1.5
  const cycle: Element[] = ['火', '雷', '水']
  const ai = cycle.indexOf(atk)
  const di = cycle.indexOf(def)
  if (ai >= 0 && di >= 0) {
    if ((ai + 1) % 3 === di) return 1.35
    if ((di + 1) % 3 === ai) return 0.75
  }
  return 1
}

export function rarityIndex(r: Rarity): number {
  return RARITY_ORDER.indexOf(r)
}

/** 商店高額兌換已擁有角色卡（每張） */
export function ownedCardShopCost(rarity: Rarity): number {
  const table = [800, 2000, 5000, 14000, 40000, 100000, 250000]
  const i = Math.max(0, rarityIndex(rarity))
  return table[Math.min(table.length - 1, i)]
}

/** 商店販售技能（普通／稀有）金鑽價 */
export function shopSkillCost(rarity: Rarity): number {
  if (rarity === '稀有') return 3600
  return 1400
}

export function rarityMult(r: Rarity): number {
  return 1 + rarityIndex(r) * RARITY_MULT_STEP
}

export function ascendMult(ascend: number): number {
  return 1 + ascend * ASCEND_MULT_STEP
}

export function nextRarity(r: Rarity): Rarity | null {
  const i = rarityIndex(r)
  return i < RARITY_ORDER.length - 1 ? RARITY_ORDER[i + 1] : null
}

/** 角色升級：異界水晶（中後期變陡，讓轉生前有壓力） */
export function charLevelCost(level: number): number {
  const lv = Math.max(1, level)
  return Math.floor(18 + lv * 9 + lv * lv * 0.08)
}

/** 連續升級總消耗 */
export function charLevelCostRange(fromLevel: number, times: number): number {
  let total = 0
  const n = Math.max(0, Math.floor(times))
  for (let i = 0; i < n; i++) total += charLevelCost(fromLevel + i)
  return total
}

/** 角色進階：神魂（隨進階次數遞增） */
export function charAscendCost(ascend: number): number {
  const a = Math.max(0, Math.floor(ascend))
  return Math.floor(8 + a * 7 + a * a * 1.4)
}

/** 角色增效：多餘同名卡（第 n 次增效耗 n 張） */
export function charBoostCardCost(boost: number): number {
  return Math.max(1, Math.floor(boost) + 1)
}

/** 轉生：異界水晶 + 金鑽（抬高門檻，避免轉生戰力過度碾壓） */
export function charRebirthCost(rebirth: number): { crystal: number; gold: number } {
  const r = Math.max(0, rebirth)
  return {
    crystal: 12000 + r * 9000 + r * r * 1600,
    gold: 2200 + r * 1400 + r * r * 280,
  }
}

export function rebirthMult(rebirth: number): number {
  return 1 + Math.max(0, rebirth) * REBIRTH_MULT_STEP
}

export function isPrime(n: number): boolean {
  const x = Math.floor(n)
  if (x < 2) return false
  if (x === 2) return true
  if (x % 2 === 0) return false
  for (let i = 3; i * i <= x; i += 2) {
    if (x % i === 0) return false
  }
  return true
}

/** 第 n 個質數（n 從 1 起：2,3,5…） */
export function nthPrime(n: number): number {
  const want = Math.max(1, Math.floor(n))
  let found = 0
  let x = 1
  while (found < want) {
    x += 1
    if (isPrime(x)) found += 1
  }
  return x
}

export function nextPrimeAfter(n: number): number {
  let x = Math.floor(n) + 1
  if (x < 2) x = 2
  while (!isPrime(x)) x += 1
  return x
}

/**
 * 質數進度 → 裝備階級：
 * T0 恆可；每達到一個質數（2,3,5,7…）解鎖下一階。
 * 例：0～1 → T0；2 → T1；3 → T2；4 → T2；5 → T3
 */
export function maxEquipTierFromPrimeProgress(progress: number): number {
  const r = Math.max(0, Math.floor(progress))
  let tier = 0
  for (let i = 2; i <= r; i++) {
    if (isPrime(i)) tier += 1
  }
  return tier
}

/** 角色轉生次數 → 可穿裝備最高階 */
export function maxEquipTierForRebirth(rebirth: number): number {
  return maxEquipTierFromPrimeProgress(rebirth)
}

/** 穿 T{tier} 所需的最低轉生次數（質數門檻；T0 為 0） */
export function rebirthRequiredForEquipTier(tier: number): number {
  const t = Math.max(0, Math.floor(tier))
  if (t <= 0) return 0
  return nthPrime(t)
}

/** 主塔層數 → 藍圖可兌換最高階：⌊層數/100⌋ 為質數進度時解鎖 */
export function equipTierFromFloor(floor: number): number {
  return maxEquipTierFromPrimeProgress(Math.floor(Math.max(0, floor) / 100))
}

/** 解鎖下一藍圖階所需的主塔層數 */
export function nextBlueprintUnlockFloor(floor: number): number {
  const progress = Math.floor(Math.max(0, floor) / 100)
  return nextPrimeAfter(progress) * 100
}

/** 技能強化：技能卡；第 level 階（由 level → level+1）耗 nthPrime(level)×100 */
export function skillUpgradeCost(level: number): number {
  const lv = Math.max(1, Math.floor(level))
  return nthPrime(lv) * 100
}

/** 技能升階：消耗同名角色卡（保留本體，多餘卡作材料） */
export function skillAscendCardCost(rarity: Rarity): number {
  // 普通 1、稀有 2、史詩 3… 越高階越吃堆疊
  return 1 + rarityIndex(rarity)
}

/** 裝備強化：熔鍛碎片 + 金鑽（隨等級遞增） */
export function equipUpgradeCost(level: number): { forge: number; gold: number } {
  const lv = Math.max(1, Math.floor(level))
  return {
    forge: Math.floor(8 + lv * 4 + lv * lv * 0.12),
    gold: Math.floor(5 + lv * 3 + lv * lv * 0.08),
  }
}

/** 藍圖消耗（打造時） */
export function equipBlueprintCost(tier: number): number {
  return 20 + tier * 14
}

/** 後勤打造：熔鍛 + 金鑽（另耗藍圖） */
export function equipCraftCost(tier: number): { forge: number; gold: number } {
  const t = Math.max(0, Math.floor(tier))
  return { forge: 18 + t * 14, gold: 12 + t * 10 }
}

/** 打造品質權重（高品稀有，長期養成） */
export function rollCraftedEquipRarity(tier: number): Rarity {
  const t = Math.max(0, Math.floor(tier))
  const boost = Math.min(0.06, t * 0.008)
  const weights: { r: Rarity; w: number }[] = [
    { r: '普通', w: 0.58 - boost },
    { r: '稀有', w: 0.28 },
    { r: '史詩', w: 0.09 + boost * 0.35 },
    { r: '傳奇', w: 0.035 + boost * 0.25 },
    { r: '神話', w: 0.01 + boost * 0.12 },
    { r: '永恆', w: 0.003 + boost * 0.05 },
    { r: '創世', w: 0.001 + boost * 0.015 },
  ]
  const total = weights.reduce((s, x) => s + Math.max(0.001, x.w), 0)
  let r = Math.random() * total
  for (const row of weights) {
    r -= Math.max(0.001, row.w)
    if (r <= 0) return row.r
  }
  return '普通'
}

export function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs < 1000) return sign + Math.floor(abs).toString()
  const units = [
    { v: 1e36, s: 'Ud' },
    { v: 1e33, s: 'Dc' },
    { v: 1e30, s: 'No' },
    { v: 1e27, s: 'Oc' },
    { v: 1e24, s: 'Sp' },
    { v: 1e21, s: 'Sx' },
    { v: 1e18, s: 'Qi' },
    { v: 1e15, s: 'Qa' },
    { v: 1e12, s: 'T' },
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' },
  ]
  for (const u of units) {
    if (abs >= u.v) {
      const val = abs / u.v
      return sign + (val >= 100 ? val.toFixed(0) : val.toFixed(2).replace(/\.?0+$/, '')) + u.s
    }
  }
  return sign + Math.floor(abs).toString()
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}小時${m}分${r}秒`
  if (m > 0) return `${m}分${r}秒`
  return `${r}秒`
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
}

export function emptyStats(): Stats {
  return { hp: 0, atk: 0, def: 0, shield: 0 }
}

export function addStats(a: Stats, b: Partial<Stats>): Stats {
  return {
    hp: a.hp + (b.hp ?? 0),
    atk: a.atk + (b.atk ?? 0),
    def: a.def + (b.def ?? 0),
    shield: a.shield + (b.shield ?? 0),
  }
}

export function scaleStats(s: Stats, mult: number): Stats {
  return {
    hp: Math.floor(s.hp * mult),
    atk: Math.floor(s.atk * mult),
    def: Math.floor(s.def * mult),
    shield: Math.floor(s.shield * mult),
  }
}

export function emptyResources(): Resources {
  return {
    crystal: 0,
    gold: 0,
    blueprint: 0,
    forge: 0,
    essence: 0,
    skillbook: 0,
    soul: 0,
  }
}

export function addResources(a: Resources, b: Partial<Resources>): Resources {
  return {
    crystal: a.crystal + (b.crystal ?? 0),
    gold: a.gold + (b.gold ?? 0),
    blueprint: a.blueprint + (b.blueprint ?? 0),
    forge: a.forge + (b.forge ?? 0),
    essence: a.essence + (b.essence ?? 0),
    skillbook: a.skillbook + (b.skillbook ?? 0),
    soul: a.soul + (b.soul ?? 0),
  }
}

/** 依 Vite base（本機 `/`、GitHub Pages `/tower-annals/`）組資源路徑 */
export function assetUrl(path: string): string {
  const base =
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
    '/'
  const clean = path.replace(/^\//, '')
  return `${base}${clean}`
}

export function portraitPath(id: string): string {
  return assetUrl(`assets/portraits/${id}.jpg`)
}

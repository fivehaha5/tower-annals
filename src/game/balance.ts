/**
 * 《異塔編年》數值總則（平衡錨點）
 *
 * ## 三條進度軸（互鎖）
 * 1. 主塔層數 → 藍圖兌換階：⌊主塔層/100⌋ 走到質數才升階
 *    200→T1、300→T2、500→T3、700→T4…
 * 2. 角色轉生 → 可穿裝備階：轉生次數走到質數才升階（與藍圖同規則）
 *    轉生 2→穿 T1、3→T2、5→T3…（未達門檻的高階裝無法生效）
 * 3. 王塔／異域神王 → 神話／永恆角色卡＋獨特技能（首勝免費；之後耗水晶，定向另耗技能書）
 *
 * ## 養成循環
 * 升級（水晶，上限 100）→ 滿級轉生（高額水晶+金鑽，Lv 回 1，轉生+1；戰力 +20%/次）
 * → 進階（神魂）／增效（同名卡遞增）／技能強化（精華）／技能升階（同名卡）
 * → 裝備強化（熔鍛+金鑽）；戰敗扣水晶／金鑽
 *
 * ## 戰力里程碑（約略可穩刷）
 * - 新手編隊：主塔 ~10
 * - 首轉前滿級＋少量進階：~40–60
 * - 轉生 2 + T1 裝：~120–180（對齊藍圖 T1）
 * - 轉生 3 + T2：~250–350
 * - 轉生 5 + T3：~450–600
 * - 轉生 7 + T4：~700+
 * 王塔首隻約對齊轉生 2～3 戰力；神王需主塔萬層量級
 *
 * ## 王塔／神王輪迴掉落
 * 每輪難度約 ×100（王塔）／×130（神王），無定向掉率：
 * 基礎 20% + 每多一輪 3.5%，上限 48%（角色／技能各自獨立）
 */

/** 角色等級上限 */
export const CHAR_LEVEL_MAX = 100

/** 主塔敵方戰力：前期柔、中後期隨裝備／轉生節奏拉升 */
export function mainEnemyPower(floor: number): number {
  const f = Math.max(1, floor)
  let p = 58 * Math.pow(f, 1.33) * (1 + f / 1200)
  if (f % 10 === 0) p *= 1.32
  return Math.floor(p)
}

/** 王塔：首隻貼近轉生中期，其後指數 */
export function bossEnemyPower(floor: number): number {
  const f = Math.max(1, floor)
  return Math.floor(220_000 * Math.pow(2.15, f - 1))
}

/** 異域神王：高於主塔萬層，長線指數 */
export function godkingEnemyPower(floor: number): number {
  const f = Math.max(1, floor)
  return Math.floor(480_000_000 * Math.pow(1.55, f - 1))
}

/**
 * 王塔／神王輪迴掉落：
 * - 王塔每輪 6 層，戰力約 ×2.15^6 ≈ ×100
 * - 神王每輪 12 層，戰力約 ×1.55^12 ≈ ×130
 * 難度跨輪極陡，掉率只給溫和絕對加成，並設軟上限避免必出。
 * 第 1 輪 10%；之後每多一輪 +2%，上限 28%。
 */
export const CYCLE_DROP_BASE = 0.1
export const CYCLE_DROP_BONUS = 0.02
export const CYCLE_DROP_CAP = 0.28

export function bossPoolSize(mode: 'boss' | 'godking'): number {
  return mode === 'boss' ? 6 : 12
}

export function cycleFromFloor(mode: 'boss' | 'godking', floor: number): number {
  const n = bossPoolSize(mode)
  return Math.max(1, Math.ceil(Math.max(1, floor) / n))
}

/** 無定向時，角色／技能各自獨立的掉落率 */
export function cycleDropRate(mode: 'boss' | 'godking', floor: number): number {
  const cycle = cycleFromFloor(mode, floor)
  return Math.min(CYCLE_DROP_CAP, CYCLE_DROP_BASE + (cycle - 1) * CYCLE_DROP_BONUS)
}

/** 稀有度倍率步長 */
export const RARITY_MULT_STEP = 0.35

/** 進階倍率步長 */
export const ASCEND_MULT_STEP = 0.14

/** 轉生倍率步長（轉生門檻已提高，戰力步長略收） */
export const REBIRTH_MULT_STEP = 0.2

/** 裝備階級成長：高階解鎖要有感 */
export const EQUIP_TIER_SCALE = 0.8

/** 裝備強化等級成長（略收斂，避免無限強化蓋過轉生／階級） */
export const EQUIP_LEVEL_SCALE = 0.055

/** 技能等級強度 */
export const SKILL_LEVEL_SCALE = 0.11

/** 獨特技能額外倍率 */
export const UNIQUE_SKILL_BONUS = 1.18

/**
 * 單次出手只施放一個技能後，該技能種類冷卻（以該角色出手次數計）。
 * 1 = 下一次該角色出手不可再用同一種類，促進輪替、避免連打同一招。
 */
export const SKILL_KIND_COOLDOWN_TURNS = 1

/** 單技能出手補償（舊版同 tick 可疊三招，改為一招後略抬倍率） */
export const SINGLE_SKILL_FOCUS = 1.18

/** 技能皆在冷卻／未裝備時的普攻威力係數 */
export const BASIC_ATTACK_POWER = 0.7

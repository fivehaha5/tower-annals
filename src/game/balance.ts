/**
 * 《異塔編年》數值總則（平衡錨點）
 *
 * ## 三條進度軸（互鎖）
 * 1. 主塔層數 → 藍圖兌換階：⌊主塔層/100⌋ 走到質數才升階
 *    200→T1、300→T2、500→T3、700→T4…
 * 2. 角色轉生 → 可穿裝備階：轉生次數走到質數才升階（與藍圖同規則）
 *    轉生 2→穿 T1、3→T2、5→T3…（未達門檻的高階裝無法生效）
 * 3. 王塔／異域神王 → 神話／永恆角色卡＋獨特技能（首勝免費；之後耗水晶，定向另耗技能卡）
 *
 * ## 養成循環
 * 升級（水晶，上限 100）→ 滿級轉生（高額水晶+金鑽，Lv 回 1，轉生+1；戰力 +20%/次）
 * → 進階（神魂）／增效（同名卡，前期弱、後期漸強）
 * → 技能升級（法術精華，小幅遞增）／技能升階（同名技能本＝質數×8；技能本副本掉落）
 * → 裝備強化（熔鍛+金鑽）；戰敗扣水晶／金鑽
 * 通用「技能卡」仍用於王塔定向／克制兌換／後勤，不直接升階。
 *
 * ## 戰鬥節奏（現行）
 * - 每 tick 一名隊員左→右出手；三人後敵方一擊＝1 完整回合
 * - 技能種類 CD＝2（該角色出手次數）；三技能可輪替
 * - 超過 20 完整回合觸發敵方「暴走」，急升傷害並削盾／燒血，阻止無限磨血
 *
 * ## 戰力里程碑（新檔平滑曲線目標）
 * - 開局～1h：主塔 ~15–25（可穩推、戰敗不螺旋）
 * - 首日中段：解鎖技能本～18F，開始囤同名本
 * - 首轉前滿級：~50–80
 * - 轉生 1～2 + T1：~120–180
 * - 轉生 3 + T2：~250–350
 * - 轉生 5+：中後期長線
 * 王塔首隻約對齊轉生 2～3；神王需主塔萬層量級
 *
 * ## 王塔／神王輪迴掉落
 * 每輪難度約 ×100（王塔）／×130（神王），無定向掉率：
 * 基礎 20% + 每多一輪 3.5%，上限 48%（角色／技能各自獨立）
 */

/** 角色等級上限 */
export const CHAR_LEVEL_MAX = 100

/**
 * 主塔敵方戰力：前期可推，中後期變陡——防「一路輕鬆沖層」。
 * 降層掛機仍打較低 seed，不受前沿加成（見 FRONTIER_PUSH_MULT）。
 */
export function mainEnemyPower(floor: number): number {
  const f = Math.max(1, floor)
  let p = 38 * Math.pow(f, 1.2) * (1 + f / 2000)
  if (f >= 30) p *= 1 + (f - 30) * 0.0038
  if (f >= 80) p *= 1 + (f - 80) * 0.0055
  if (f >= 160) p *= 1 + (f - 160) * 0.007
  if (f % 10 === 0) p *= 1.12
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

/**
 * 技能等級強度：改為遞增曲線（見 skillLevelPowerBonus）。
 * 保留常數供文件／舊註解對照；實際戰鬥用 skillLevelPowerBonus。
 */
export const SKILL_LEVEL_SCALE = 0.06

/** 獨特技能額外倍率 */
export const UNIQUE_SKILL_BONUS = 1.18

/**
 * 單次出手只施放一個技能後，該技能種類冷卻（以該角色出手次數計）。
 * 2 = 隔一次該角色出手才能再用，三技能可乾淨輪替（A→B→C→A…）。
 */
export const SKILL_KIND_COOLDOWN_TURNS = 2

/** 單技能出手補償 */
export const SINGLE_SKILL_FOCUS = 1.14

/** 技能皆在冷卻／未裝備時的普攻威力係數 */
export const BASIC_ATTACK_POWER = 0.72

/**
 * 完整回合＝全員左→右各出手一次＋敵方一擊。
 * 超過此回合數觸發暴走，阻止弱勢無限磨死。
 */
export const BERSERK_AFTER_ROUNDS = 22

/** 暴走起始傷害倍率 */
export const BERSERK_DMG_MULT = 2.25

/** 暴走每多一回合再疊加的傷害倍率 */
export const BERSERK_DMG_GROW = 0.3

/** 暴走每回合額外燒血（占最大生命比例，隨超回合遞增） */
export const BERSERK_BURN_BASE = 0.022
export const BERSERK_BURN_GROW = 0.009

/** 敵方攻擊相對難度種子係數 */
export const ENEMY_ATK_FROM_POWER = 0.066

/**
 * 敵方生命相對難度種子。
 */
export const ENEMY_HP_FROM_POWER = 0.88

/** 敵方護盾相對難度種子（普通／小首領／Boss 再乘倍率） */
export const ENEMY_SHIELD_FROM_POWER = 0.22

/**
 * 敵方減傷錨點：無硬頂。
 */
export const ENEMY_DEF_ANCHOR_POWER = 220_000
export const ENEMY_DEF_ANCHOR_BONUS = 13

/**
 * 隊伍戰力低於敵方時的額外減傷指數。
 * 略收緊：落後時沖層更痛，鼓勵降層掛機養成。
 */
export const CP_UNDERDOG_MITIGATION_EXP = 1.0

/** 技能對戰力貢獻係數 */
export const SKILL_CP_WEIGHT = 0.85

/**
 * 掛在「已解鎖最高層」沖層時的敵方強化（血／盾／攻）。
 * 降層原地掛機不套用 → 養成仍穩，推關不能躺贏。
 */
export const FRONTIER_PUSH_MULT = 1.28

/** 技能本解鎖所需主塔層數（略提前，銜接首日養成） */
export const SKILL_DUNGEON_UNLOCK = 18

/** 技能本通關後冷卻（秒） */
export const SKILL_DUNGEON_COOLDOWN_SEC = 10

/**
 * 技能本每層掉落同名技能本數量（隨機分給已持有技能）。
 */
export function skillDungeonBookDrops(floor: number): number {
  const f = Math.max(1, floor)
  const mini = f % 5 === 0
  return 4 + Math.floor(f * 0.45) + (mini ? 3 : 0)
}

/**
 * 技能本敵方難度：可刷低層，其後仍明顯變難。
 * 第 1 層約主塔 12；之後每層 ×1.45。
 */
export function skillDungeonPowerSeed(floor: number): number {
  const f = Math.max(1, floor)
  const base = mainEnemyPower(12)
  return Math.floor(base * Math.pow(1.38, f - 1))
}

/**
 * 討伐訓練（刷破王徽）：王塔無主塔層門檻，故以「首通王塔／神王」解鎖。
 * 見 state.firstWin.boss｜godking。
 */
export const HUNT_UNLOCK_AFTER_FIRST_BOSS = true

/** 王塔／神王通關破王徽（保底） */
export const BOSS_CLEAR_KING_BADGE = 1
/** 通關時額外 +1 破王徽機率 */
export const BOSS_CLEAR_KING_BADGE_BONUS = 0.28
/** 王塔／神王戰敗掉破王徽機率 */
export const BOSS_FAIL_KING_BADGE_CHANCE = 0.2

/**
 * 商店兌換一枚未持有的克制王階技能。
 * 已持有則走精華升級／技能卡升階，不重複兌換。
 */
export const ANTI_KING_EXCHANGE_COST = {
  kingBadge: 28,
  skillbook: 120,
  crystal: 400,
} as const

/** 新存檔／遷移贈送的技能卡緩衝（定向／兌換用；升階改吃同名本） */
export const SKILL_CARD_STARTER_CUSHION = 180

/**
 * 技能強化等級加成（相對 Lv.1）。
 * 前期略抬、後期仍遞增但比舊爆炸曲線溫和。
 * 第 i→i+1 級增量 ≈ 0.032 + 0.007*(i-1)
 */
export function skillLevelPowerBonus(level: number): number {
  const lv = Math.max(1, Math.floor(level))
  let bonus = 0
  for (let i = 1; i < lv; i++) {
    bonus += 0.032 + 0.007 * (i - 1)
  }
  return bonus
}

/**
 * 角色增效打工倍率：前期弱、後期遞增。
 * 第 i 次增效加成 ≈ 0.05 + 0.018*(i-1)（舊版固定 +0.25/級過強）
 */
export function boostWorkBonus(boost: number): number {
  const b = Math.max(0, Math.floor(boost))
  let sum = 0
  for (let i = 1; i <= b; i++) {
    sum += 0.05 + 0.018 * (i - 1)
  }
  return sum
}

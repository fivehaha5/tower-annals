import type { BossMechanicId, Element } from './types'

/** 王塔／神王：角色 id → 機制 */
export const BOSS_MECHANIC_BY_CHAR: Record<string, BossMechanicId> = {
  boss_zhuowu: 'fogLayer',
  boss_jinshe: 'goldLeech',
  boss_duanceng: 'lawCrush',
  boss_saibo: 'compileShift',
  boss_taxin: 'gateBlock',
  boss_yongye: 'eternalNight',
  gk_aries: 'ramCharge',
  gk_taurus: 'stoneSkin',
  gk_gemini: 'mirrorTwin',
  gk_cancer: 'tideShell',
  gk_leo: 'solarBurn',
  gk_virgo: 'pureLaw',
  gk_libra: 'scaleJudgment',
  gk_scorpio: 'venomHeart',
  gk_sagittarius: 'starPierce',
  gk_capricorn: 'mountainSpine',
  gk_aquarius: 'aquaField',
  gk_pisces: 'dreamHeal',
}

export const MECHANIC_LABEL: Record<BossMechanicId, string> = {
  fogLayer: '霧層：非水屬傷害 -35%',
  goldLeech: '金蝕：受傷回復 8% 傷害量',
  lawCrush: '律裁：每秒壓低隊伍護盾',
  compileShift: '編譯：敵人屬性每秒錯位',
  gateBlock: '門禁：前 3 次攻擊無效',
  eternalNight: '永夜：治療效果減半',
  ramCharge: '衝鋒：攻擊力週期暴起',
  stoneSkin: '磐皮：護盾吸收倍率提升',
  mirrorTwin: '鏡語：反彈 12% 傷害',
  tideShell: '潮殼：護盾高時減傷',
  solarBurn: '日冕：灼燒持續傷',
  pureLaw: '淨律：降低你方增傷',
  scaleJudgment: '衡裁：血量差時增傷',
  venomHeart: '毒心：疊毒掉血',
  starPierce: '貫星：無視部分護盾',
  mountainSpine: '峰脊：高防低速',
  aquaField: '流陣：水傷增幅場',
  dreamHeal: '夢療：敵方緩慢回血',
}

const ELEMENTS: Element[] = ['火', '水', '雷', '光', '暗']

export function shiftElement(el: Element, tick: number): Element {
  const i = ELEMENTS.indexOf(el)
  return ELEMENTS[(i + (tick % 5) + 5) % 5]
}

/** 編年加成：質數轉生門檻 × 3 倍數人數 */
export const REBIRTH_BONUS_PRIMES = [2, 3, 5, 7, 11, 13]
export const REBIRTH_BONUS_COUNTS = [3, 6, 9]
export const REBIRTH_BONUS_PER_CELL = 0.02

/** 傳入已篩選該職業的角色列表 */
export function roleRebirthBonus(roleRoster: { rebirth: number }[]): number {
  let cells = 0
  for (const p of REBIRTH_BONUS_PRIMES) {
    const n = roleRoster.filter((c) => (c.rebirth ?? 0) >= p).length
    for (const need of REBIRTH_BONUS_COUNTS) {
      if (n >= need) cells += 1
    }
  }
  return cells * REBIRTH_BONUS_PER_CELL
}

export function countRebirthBonusCells(
  roleRoster: { rebirth: number }[],
): { prime: number; count: number; ok: boolean }[] {
  const out: { prime: number; count: number; ok: boolean }[] = []
  for (const p of REBIRTH_BONUS_PRIMES) {
    const n = roleRoster.filter((c) => (c.rebirth ?? 0) >= p).length
    for (const need of REBIRTH_BONUS_COUNTS) {
      out.push({ prime: p, count: need, ok: n >= need })
    }
  }
  return out
}

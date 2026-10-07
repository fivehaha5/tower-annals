/**
 * 菇燈鍛造 · 離散數據掃描
 * 產出關卡曲線、鍛造成本、稀有權重、清空時間、油耗等表。
 * 執行：npm run sim:spore:discrete
 */
import { CLASSES } from '../src/spore/data/classes.ts'
import { GEAR_MAP, RARITY_ORDER, RARITY_WEIGHT_BY_FORGE } from '../src/spore/data/gear.ts'
import { PETS } from '../src/spore/data/pets.ts'
import { stageOf } from '../src/spore/data/stages.ts'
import { forgeUpgradeCost, rollGear } from '../src/spore/forge.ts'
import {
  LEVEL_CAP,
  TICK_MS,
  createPlayer,
  forgeXpToLevel,
  lampCost,
  powerScore,
  xpToLevel,
} from '../src/spore/util.ts'
import { enemyPowerOf, enhanceCost, runSim } from './spore-sim-lib.ts'

function enemyPower(stage: number): number {
  return enemyPowerOf(stage)
}

/** 理論清空 ticks（期望 step，無隨機） */
function expectedTicksToClear(ratio: number): number {
  let step = 0.04
  if (ratio < 0.7) step = 0.01
  else if (ratio < 1) step = 0.025
  else if (ratio < 1.4) step = 0.055
  else step = 0.09
  const meanMult = 0.85 + 0.15 // E[U(0.85,1.15)] = 1.0
  step *= meanMult
  return Math.ceil(1 / step)
}

function classBarePower(level: number, classId: (typeof CLASSES)[number]['id']): number {
  const p = createPlayer('x', 'novice')
  p.classId = classId
  p.level = level
  p.bag = []
  p.equips = {}
  p.petId = null
  p.forgeLevel = 1
  return powerScore(p)
}

function main() {
  console.log('=== 《菇燈鍛造》離散數據掃描 ===')
  console.log('')

  // 1) 關卡曲線
  const stageRows = []
  for (const n of [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120]) {
    const st = stageOf(n)
    const ep = enemyPower(n)
    stageRows.push({
      stage: n,
      hp: st.hp,
      atk: st.atk,
      def: st.def,
      enemyPower: ep,
      coin: st.coin,
      hammer: st.hammer,
      xp: st.xp,
      scale: +(Math.pow(1.18, n - 1)).toFixed(3),
    })
  }
  console.log('--- 關卡敵方曲線（scale=1.18^(n-1)）---')
  console.table(stageRows)

  // 2) 玩家裸裝職業曲線 vs 關卡
  const classRows = []
  for (const lv of [1, 10, 20, 30, 40, 50, 60, 80]) {
    const row: Record<string, number | string> = { level: lv }
    for (const c of CLASSES) {
      row[c.id] = classBarePower(lv, c.id)
    }
    // 可打過的最高關（裸裝 ratio>=1）
    for (const c of CLASSES) {
      let maxStage = 1
      const pw = classBarePower(lv, c.id)
      for (let s = 1; s <= 150; s++) {
        if (pw / enemyPower(s) >= 1) maxStage = s
        else break
      }
      row[`${c.id}_clear`] = maxStage
    }
    classRows.push(row)
  }
  console.log('--- 裸裝戰力／可穩定通關上限（ratio≥1）---')
  console.table(classRows)

  // 3) 鍛造／燈油／強化成本
  const forgeRows = []
  let cumHammer = 0
  let cumCoin = 0
  let cumForgeXp = 0
  for (let lv = 1; lv <= 12; lv++) {
    const up = forgeUpgradeCost(lv)
    const fx = forgeXpToLevel(lv)
    cumHammer += up.hammer
    cumCoin += up.coin
    cumForgeXp += fx
    const w = RARITY_WEIGHT_BY_FORGE[Math.min(RARITY_WEIGHT_BY_FORGE.length - 1, lv - 1)]
    const total = w.reduce((a, b) => a + b, 0)
    const pct = Object.fromEntries(
      RARITY_ORDER.map((r, i) => [r, +((w[i] / total) * 100).toFixed(1)]),
    )
    forgeRows.push({
      forgeLv: lv,
      lampCost: lampCost(lv),
      upHammer: up.hammer,
      upCoin: up.coin,
      forgeXpNeed: fx,
      cumHammer,
      cumCoin,
      ...pct,
    })
  }
  console.log('--- 鍛造爐檔位／抽燈成本／稀有率% ---')
  console.table(forgeRows)

  // 4) 強化錘耗
  const enhRows = []
  let cum = 0
  for (let lv = 1; lv <= 20; lv++) {
    const c = enhanceCost(lv)
    cum += c
    enhRows.push({ from: lv, to: lv + 1, hammer: c, cumHammer: cum })
  }
  console.log('--- 單件強化錘耗 ---')
  console.table(enhRows.slice(0, 12))

  // 5) 等級 XP
  const xpRows = []
  let cumXp = 0
  for (const lv of [1, 5, 10, 15, 20, 30, 40, 50, 60, 80]) {
    if (lv >= LEVEL_CAP) continue
    const need = xpToLevel(lv)
    // 累計到該級
    cumXp = 0
    for (let i = 1; i < lv; i++) cumXp += xpToLevel(i)
    xpRows.push({ level: lv, xpToNext: need, cumXpToThis: cumXp })
  }
  console.log('--- 角色升級 XP ---')
  console.table(xpRows)

  // 6) 期望通關時間 vs ratio
  const clearRows = [0.5, 0.7, 0.85, 1.0, 1.2, 1.4, 1.8, 2.5].map((ratio) => {
    const ticks = expectedTicksToClear(ratio)
    return {
      ratio,
      ticks,
      seconds: +((ticks * TICK_MS) / 1000).toFixed(1),
      stagesPerHour: +((3600 / ((ticks * TICK_MS) / 1000)).toFixed(1)),
    }
  })
  console.log('--- 期望通關速度（依戰力比）---')
  console.table(clearRows)

  // 7) 寵物解鎖
  console.log('--- 寵物解鎖 ---')
  console.table(
    PETS.map((p) => ({
      id: p.id,
      name: p.name,
      unlockStage: p.unlockStage,
      bonus: JSON.stringify(p.bonus),
    })),
  )

  // 8) 稀有抽取實證（離散 Monte 抽）
  const pullN = 2000
  const empirical: Record<string, Record<string, number>> = {}
  for (const fl of [1, 3, 5, 7, 8]) {
    const counts: Record<string, number> = Object.fromEntries(RARITY_ORDER.map((r) => [r, 0]))
    for (let i = 0; i < pullN; i++) {
      const g = rollGear(fl)
      const r = GEAR_MAP[g.defId]?.rarity ?? '普通'
      counts[r] += 1
    }
    empirical[`forge${fl}`] = Object.fromEntries(
      RARITY_ORDER.map((r) => [r, +((counts[r] / pullN) * 100).toFixed(2)]),
    )
  }
  console.log(`--- 稀有率實證（各 ${pullN} 抽）---`)
  console.table(empirical)

  // 9) 進度懸崖：固定養成深度下的 ratio 曲線
  console.log('--- 懸崖掃描：智能體 2h/6h/12h 終態 ratio 曲線（對後續關）---')
  const cliff: Record<string, unknown>[] = []
  for (const h of [2, 6, 12]) {
    const r = runSim({
      hours: h,
      seed: 77,
      spend: 'agent',
      classPolicy: 'best_power',
    })
    const pw = r.final.power
    const row: Record<string, unknown> = {
      simHours: h,
      endStage: r.final.stage,
      power: pw,
      endRatio: +r.final.ratio.toFixed(3),
    }
    for (const ahead of [0, 5, 10, 20]) {
      const s = r.final.stage + ahead
      row[`ratio_s+${ahead}`] = +(pw / enemyPower(s)).toFixed(3)
    }
    cliff.push(row)
  }
  console.table(cliff)

  // 10) 油產 vs 油耗平衡點
  const oilRows = []
  for (const fl of [1, 3, 5, 8]) {
    const cost = lampCost(fl)
    // 每 tick 期望油：clear 獎勵 + 每 8 tick +1
    // 粗估：假設 ratio=1 → 40 ticks/clear，每 clear + (1+floor(fl/3))，另每 8 tick +1
    const ticksPerClear = expectedTicksToClear(1)
    const oilPerClear = 1 + Math.floor(fl / 3)
    const passivePerClear = ticksPerClear / 8
    const oilPerHour = ((oilPerClear + passivePerClear) / ticksPerClear) * (3600 / (TICK_MS / 1000))
    const maxPullsPerHour = oilPerHour / cost
    oilRows.push({
      forgeLv: fl,
      lampCost: cost,
      oilPerHour_atRatio1: +oilPerHour.toFixed(1),
      maxPullsPerHour: +maxPullsPerHour.toFixed(1),
    })
  }
  console.log('--- 神燈油產能（ratio=1 假設）---')
  console.table(oilRows)

  // 關卡成長倍率（每 10 關）
  const growth = []
  for (let s = 10; s <= 100; s += 10) {
    growth.push({
      stage: s,
      enemyPower: enemyPower(s),
      vsPrev10: +(enemyPower(s) / enemyPower(s - 10)).toFixed(3),
      vsStage1: +(enemyPower(s) / enemyPower(1)).toFixed(1),
    })
  }
  console.log('--- 敵方戰力每 10 關倍率 ---')
  console.table(growth)

  console.log('\n__JSON__')
  console.log(
    JSON.stringify(
      {
        stageRows,
        classRows,
        forgeRows,
        enhanceTo12: enhRows.slice(0, 12),
        xpRows,
        clearRows,
        pets: PETS,
        empiricalRarity: empirical,
        cliff,
        oilRows,
        growth,
      },
      null,
      2,
    ),
  )
}

main()

/**
 * 菇燈鍛造 · 最佳化路徑
 * 以權重搜尋（簡化 GA）找長期養成策略，並標出突破／卡關帶。
 * 執行：npm run sim:spore:optimal
 */
import { runSim, type ClassPolicy, type SpendPolicy } from './spore-sim-lib.ts'

const HOURS = Number(process.env.SPORE_OPT_HOURS ?? 12)
const POP = Number(process.env.SPORE_OPT_POP ?? 16)
const GENS = Number(process.env.SPORE_OPT_GENS ?? 6)
const VALIDATE = Number(process.env.SPORE_OPT_VALIDATE ?? 5)

type Gene = {
  spend: SpendPolicy
  classPolicy: ClassPolicy
  stallRatio: number
  decideEvery: number
}

const SPENDS: SpendPolicy[] = [
  'idle',
  'pull_greedy',
  'balanced',
  'forge_first',
  'enhance_first',
  'optimal',
]
const CLASSES: ClassPolicy[] = ['stay_novice', 'warrior', 'archer', 'mage', 'best_power']

function randGene(rng: () => number): Gene {
  return {
    spend: SPENDS[Math.floor(rng() * SPENDS.length)],
    classPolicy: CLASSES[Math.floor(rng() * CLASSES.length)],
    stallRatio: 0.7 + rng() * 0.35,
    decideEvery: 2 + Math.floor(rng() * 10),
  }
}

function mutate(g: Gene, rng: () => number): Gene {
  const n = { ...g }
  if (rng() < 0.4) n.spend = SPENDS[Math.floor(rng() * SPENDS.length)]
  if (rng() < 0.3) n.classPolicy = CLASSES[Math.floor(rng() * CLASSES.length)]
  if (rng() < 0.5) n.stallRatio = Math.max(0.65, Math.min(1.15, n.stallRatio + (rng() - 0.5) * 0.2))
  if (rng() < 0.4) n.decideEvery = Math.max(1, Math.min(16, n.decideEvery + Math.floor((rng() - 0.5) * 6)))
  return n
}

function fitness(g: Gene, seed: number): number {
  const r = runSim({
    hours: HOURS,
    seed,
    spend: g.spend,
    classPolicy: g.classPolicy,
    stallRatio: g.stallRatio,
    decideEvery: g.decideEvery,
  })
  // 主目標：關卡；副目標：戰力、少卡關、等級
  return (
    r.final.stage * 100 +
    r.final.power * 0.05 +
    r.final.level * 2 -
    r.maxStallHours * 40 -
    (r.final.ratio < 0.8 ? 30 : 0)
  )
}

function detectBreakpoints(timeline: ReturnType<typeof runSim>['timeline']) {
  const bps: { h: number; kind: string; detail: string }[] = []
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1]
    const b = timeline[i]
    const dh = Math.max(0.001, b.hours - a.hours)
    const dStage = (b.stage - a.stage) / dh
    const prevRatio = a.ratio
    const ratio = b.ratio

    if (prevRatio >= 0.9 && ratio < 0.75) {
      bps.push({
        h: b.hours,
        kind: 'stall',
        detail: `戰力比 ${prevRatio.toFixed(2)}→${ratio.toFixed(2)}，關${b.stage}`,
      })
    }
    if (dStage >= 8) {
      bps.push({
        h: b.hours,
        kind: 'spike',
        detail: `推進 ${dStage.toFixed(1)} 關/h，關${a.stage}→${b.stage}`,
      })
    }
    if (a.level < 10 && b.level >= 10) {
      bps.push({ h: b.hours, kind: 'unlock', detail: `Lv10 轉職窗（${b.classId}）` })
    }
    if (a.forgeLevel < b.forgeLevel && b.forgeLevel % 2 === 0) {
      bps.push({
        h: b.hours,
        kind: 'forge',
        detail: `鍛造爐 → Lv.${b.forgeLevel}（稀有權重檔位）`,
      })
    }
    if (a.petId !== b.petId && b.petId) {
      bps.push({ h: b.hours, kind: 'pet', detail: `同伴切換 → ${b.petId}` })
    }
  }
  // 去重鄰近
  const out: typeof bps = []
  for (const bp of bps) {
    const last = out[out.length - 1]
    if (last && last.kind === bp.kind && Math.abs(last.h - bp.h) < 0.25) continue
    out.push(bp)
  }
  return out.slice(0, 24)
}

function main() {
  let s = 123456789
  const rng = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 1_000_000) / 1_000_000
  }

  console.log('=== 《菇燈鍛造》最佳化路徑 ===')
  console.log(`時長 ${HOURS}h · 族群 ${POP} · 世代 ${GENS} · 驗證種子 ${VALIDATE}`)
  console.log('')

  let pop: Gene[] = Array.from({ length: POP }, () => randGene(rng))
  let bestGene = pop[0]
  let bestFit = -Infinity

  for (let gen = 0; gen < GENS; gen++) {
    const scored = pop.map((g, i) => {
      // 多種子平均
      let sum = 0
      for (let v = 0; v < Math.min(2, VALIDATE); v++) {
        sum += fitness(g, 5000 + gen * 100 + i * 13 + v * 7)
      }
      return { g, fit: sum / Math.min(2, VALIDATE) }
    })
    scored.sort((a, b) => b.fit - a.fit)
    if (scored[0].fit > bestFit) {
      bestFit = scored[0].fit
      bestGene = scored[0].g
    }
    console.log(
      `Gen ${gen + 1}/${GENS} bestFit=${scored[0].fit.toFixed(1)} spend=${scored[0].g.spend} class=${scored[0].g.classPolicy} stall=${scored[0].g.stallRatio.toFixed(2)} decide=${scored[0].g.decideEvery}`,
    )
    const elite = scored.slice(0, Math.ceil(POP / 3)).map((x) => x.g)
    const next: Gene[] = [...elite]
    while (next.length < POP) {
      const parent = elite[Math.floor(rng() * elite.length)]
      next.push(mutate(parent, rng))
    }
    pop = next
  }

  // 驗證最佳基因
  const finals = []
  for (let v = 0; v < VALIDATE; v++) {
    const r = runSim({
      hours: HOURS,
      seed: 9000 + v * 31,
      spend: bestGene.spend,
      classPolicy: bestGene.classPolicy,
      stallRatio: bestGene.stallRatio,
      decideEvery: bestGene.decideEvery,
    })
    finals.push(r)
  }
  const stages = finals.map((r) => r.final.stage)
  const meanStage = stages.reduce((a, b) => a + b, 0) / stages.length
  const meanPower = finals.reduce((a, r) => a + r.final.power, 0) / finals.length
  const meanStall = finals.reduce((a, r) => a + r.maxStallHours, 0) / finals.length

  // 基準對照
  const baselines: { name: string; spend: SpendPolicy; classPolicy: ClassPolicy }[] = [
    { name: '純掛機', spend: 'idle', classPolicy: 'stay_novice' },
    { name: '均衡', spend: 'balanced', classPolicy: 'best_power' },
    { name: '啟發式optimal', spend: 'optimal', classPolicy: 'best_power' },
  ]
  const baselineStats = baselines.map((b) => {
    const rs = Array.from({ length: VALIDATE }, (_, i) =>
      runSim({ hours: HOURS, seed: 9000 + i * 31, spend: b.spend, classPolicy: b.classPolicy }),
    )
    return {
      name: b.name,
      meanStage: rs.reduce((a, r) => a + r.final.stage, 0) / rs.length,
      meanPower: rs.reduce((a, r) => a + r.final.power, 0) / rs.length,
      meanStall: rs.reduce((a, r) => a + r.maxStallHours, 0) / rs.length,
    }
  })

  const demo = runSim({
    hours: HOURS,
    seed: 42,
    spend: bestGene.spend,
    classPolicy: bestGene.classPolicy,
    stallRatio: bestGene.stallRatio,
    decideEvery: bestGene.decideEvery,
  })
  const breakpoints = detectBreakpoints(demo.timeline)

  console.log('')
  console.log('--- 最佳基因 ---')
  console.log(JSON.stringify(bestGene))
  console.log(
    `驗證 mean 關 ${meanStage.toFixed(2)} · 戰力 ${meanPower.toFixed(0)} · 最長卡關 ${meanStall.toFixed(3)}h`,
  )
  console.log('')
  console.log('--- 基準對照 ---')
  for (const b of baselineStats) {
    console.log(
      `${b.name}: 關 ${b.meanStage.toFixed(2)} · 戰力 ${b.meanPower.toFixed(0)} · 卡關 ${b.meanStall.toFixed(3)}h`,
    )
  }
  console.log('')
  console.log('--- 時間軸突破點（seed=42）---')
  for (const bp of breakpoints) {
    console.log(`t=${bp.h.toFixed(2)}h [${bp.kind}] ${bp.detail}`)
  }
  console.log('')
  console.log('--- 里程碑 ---')
  console.log(JSON.stringify(demo.milestones, null, 2))

  console.log('\n__JSON__')
  console.log(
    JSON.stringify(
      {
        hours: HOURS,
        bestGene,
        validation: { meanStage, meanPower, meanStall, stages },
        baselines: baselineStats,
        breakpoints,
        milestones: demo.milestones,
        demoFinal: demo.final,
      },
      null,
      2,
    ),
  )
}

main()

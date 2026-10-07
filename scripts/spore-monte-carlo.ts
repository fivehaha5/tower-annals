/**
 * 菇燈鍛造 · 蒙地卡羅平衡模擬
 * 執行：npm run sim:spore:mc
 */
import {
  runSim,
  summarizeStages,
  type ClassPolicy,
  type SpendPolicy,
} from './spore-sim-lib.ts'

const HOURS = Number(process.env.SPORE_MC_HOURS ?? 8)
const RUNS = Number(process.env.SPORE_MC_RUNS ?? 40)

type Scenario = {
  name: string
  spend: SpendPolicy
  classPolicy: ClassPolicy
}

const scenarios: Scenario[] = [
  { name: '純掛機', spend: 'idle', classPolicy: 'stay_novice' },
  { name: '貪心抽燈', spend: 'pull_greedy', classPolicy: 'best_power' },
  { name: '均衡養成', spend: 'balanced', classPolicy: 'best_power' },
  { name: '優先升爐', spend: 'forge_first', classPolicy: 'best_power' },
  { name: '優先強化', spend: 'enhance_first', classPolicy: 'best_power' },
]

function main() {
  console.log('=== 《菇燈鍛造》蒙地卡羅平衡 ===')
  console.log(`時長 ${HOURS}h · 每情境 ${RUNS} 次 · tick=500ms`)
  console.log('')

  const report: Record<
    string,
    {
      stage: ReturnType<typeof summarizeStages>
      level: ReturnType<typeof summarizeStages>
      power: ReturnType<typeof summarizeStages>
      pulls: ReturnType<typeof summarizeStages>
      maxStallHours: ReturnType<typeof summarizeStages>
      milestage20: ReturnType<typeof summarizeStages>
      sample: ReturnType<typeof runSim>['final']
    }
  > = {}

  for (const sc of scenarios) {
    const stages: number[] = []
    const levels: number[] = []
    const powers: number[] = []
    const pulls: number[] = []
    const stalls: number[] = []
    const m20: number[] = []
    let sample = null as ReturnType<typeof runSim> | null

    for (let i = 0; i < RUNS; i++) {
      const r = runSim({
        hours: HOURS,
        seed: 1000 + i * 17 + sc.name.length * 91,
        spend: sc.spend,
        classPolicy: sc.classPolicy,
      })
      stages.push(r.final.stage)
      levels.push(r.final.level)
      powers.push(r.final.power)
      pulls.push(r.final.pulls)
      stalls.push(r.maxStallHours)
      if (r.milestones.stage_20 != null) m20.push(r.milestones.stage_20)
      if (i === 0) sample = r
    }

    const stageSum = summarizeStages(stages)
    const levelSum = summarizeStages(levels)
    const powerSum = summarizeStages(powers)
    const pullSum = summarizeStages(pulls)
    const stallSum = summarizeStages(stalls)
    const m20Sum = summarizeStages(m20.length ? m20 : [HOURS])

    report[sc.name] = {
      stage: stageSum,
      level: levelSum,
      power: powerSum,
      pulls: pullSum,
      maxStallHours: stallSum,
      milestage20: m20Sum,
      sample: sample!.final,
    }

    console.log(`--- ${sc.name} ---`)
    console.log(
      `關卡 mean ${stageSum.mean} · p10 ${stageSum.p10} · p50 ${stageSum.p50} · p90 ${stageSum.p90} · [${stageSum.min}-${stageSum.max}]`,
    )
    console.log(
      `等級 mean ${levelSum.mean} · 戰力 mean ${powerSum.mean} · 抽數 mean ${pullSum.mean}`,
    )
    console.log(
      `最長卡關(h) mean ${stallSum.mean} · p90 ${stallSum.p90} · 達20關小時 mean ${m20Sum.mean}（樣本數 ${m20.length}/${RUNS}）`,
    )
    console.log(
      `樣例終態 關${sample!.final.stage} Lv${sample!.final.level} 爐${sample!.final.forgeLevel} 戰力${sample!.final.power} 稀有${sample!.final.bestRarity} 職業${sample!.final.classId}`,
    )
    console.log('')
  }

  // 跨情境對比
  const idle = report['純掛機']
  const bal = report['均衡養成']
  if (idle && bal) {
    const lift = ((bal.stage.mean - idle.stage.mean) / Math.max(1, idle.stage.mean)) * 100
    console.log('=== 摘要 ===')
    console.log(
      `· 純掛機 ${HOURS}h 中位關 ${idle.stage.p50}；均衡養成中位關 ${bal.stage.p50}（相對提升約 ${lift.toFixed(1)}%）`,
    )
    console.log(
      `· 貪心抽燈 p90 關 ${report['貪心抽燈'].stage.p90} vs 優先升爐 p90 關 ${report['優先升爐'].stage.p90}`,
    )
    console.log(
      `· 卡關風險：均衡 p90 最長卡關 ${bal.maxStallHours.p90}h；純掛機 ${idle.maxStallHours.p90}h`,
    )
  }

  // JSON 塊供報告引用
  console.log('\n__JSON__')
  console.log(JSON.stringify({ hours: HOURS, runs: RUNS, report }, null, 2))
}

main()

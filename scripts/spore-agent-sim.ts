/**
 * 菇燈鍛造 · 智能體模擬
 * 狀態機智能體 vs 基準策略，記錄決策軌跡與卡關應對。
 * 執行：npm run sim:spore:agent
 */
import { runSim, summarizeStages } from './spore-sim-lib.ts'

const HOURS = Number(process.env.SPORE_AGENT_HOURS ?? 12)
const RUNS = Number(process.env.SPORE_AGENT_RUNS ?? 24)

function main() {
  console.log('=== 《菇燈鍛造》智能體模擬 ===')
  console.log(`時長 ${HOURS}h · 種子數 ${RUNS}`)
  console.log('')

  const agents = [
    { name: '智能體(狀態機)', spend: 'agent' as const, classPolicy: 'best_power' as const },
    { name: '啟發式optimal', spend: 'optimal' as const, classPolicy: 'best_power' as const },
    { name: '均衡養成', spend: 'balanced' as const, classPolicy: 'best_power' as const },
    { name: '純掛機', spend: 'idle' as const, classPolicy: 'stay_novice' as const },
    { name: '戰士路線', spend: 'agent' as const, classPolicy: 'warrior' as const },
    { name: '弓箭手路線', spend: 'agent' as const, classPolicy: 'archer' as const },
    { name: '法師路線', spend: 'agent' as const, classPolicy: 'mage' as const },
  ]

  const out: Record<string, unknown> = {}

  for (const ag of agents) {
    const stages: number[] = []
    const powers: number[] = []
    const stalls: number[] = []
    const forge: number[] = []
    const enhances: number[] = []
    const pulls: number[] = []
    const m30: number[] = []
    let demo = null as ReturnType<typeof runSim> | null

    for (let i = 0; i < RUNS; i++) {
      const r = runSim({
        hours: HOURS,
        seed: 2000 + i * 19,
        spend: ag.spend,
        classPolicy: ag.classPolicy,
        stallRatio: 0.88,
        decideEvery: 3,
      })
      stages.push(r.final.stage)
      powers.push(r.final.power)
      stalls.push(r.maxStallHours)
      forge.push(r.final.forgeLevel)
      enhances.push(r.final.enhances)
      pulls.push(r.final.pulls)
      if (r.milestones.stage_30 != null) m30.push(r.milestones.stage_30)
      if (i === 0) demo = r
    }

    const stageS = summarizeStages(stages)
    const powerS = summarizeStages(powers)
    const stallS = summarizeStages(stalls)

    // 時間軸斜率：前 25% vs 後 25%
    const tl = demo!.timeline
    const q = Math.floor(tl.length / 4)
    const earlyRate =
      q > 0 ? (tl[q].stage - tl[0].stage) / Math.max(0.01, tl[q].hours - tl[0].hours) : 0
    const lateRate =
      q > 0
        ? (tl[tl.length - 1].stage - tl[tl.length - 1 - q].stage) /
          Math.max(0.01, tl[tl.length - 1].hours - tl[tl.length - 1 - q].hours)
        : 0

    out[ag.name] = {
      stage: stageS,
      power: powerS,
      stall: stallS,
      meanForge: +(forge.reduce((a, b) => a + b, 0) / forge.length).toFixed(2),
      meanEnhance: +(enhances.reduce((a, b) => a + b, 0) / enhances.length).toFixed(2),
      meanPulls: +(pulls.reduce((a, b) => a + b, 0) / pulls.length).toFixed(2),
      stage30ReachRate: +(m30.length / RUNS).toFixed(3),
      stage30MeanHours: m30.length
        ? +(m30.reduce((a, b) => a + b, 0) / m30.length).toFixed(3)
        : null,
      earlyStagePerHour: +earlyRate.toFixed(2),
      lateStagePerHour: +lateRate.toFixed(2),
      demoFinal: demo!.final,
      milestones: demo!.milestones,
    }

    console.log(`--- ${ag.name} ---`)
    console.log(
      `關卡 mean ${stageS.mean} p50 ${stageS.p50} p90 ${stageS.p90} · 戰力 mean ${powerS.mean}`,
    )
    console.log(
      `卡關 mean ${stallS.mean}h p90 ${stallS.p90}h · 爐均 ${out[ag.name].meanForge} · 強化均 ${out[ag.name].meanEnhance} · 抽均 ${out[ag.name].meanPulls}`,
    )
    console.log(
      `30關達成率 ${(m30.length / RUNS * 100).toFixed(0)}% · 早期 ${earlyRate.toFixed(1)} 關/h · 晚期 ${lateRate.toFixed(1)} 關/h`,
    )
    console.log(
      `樣例 關${demo!.final.stage} Lv${demo!.final.level} ${demo!.final.classId} 比${demo!.final.ratio.toFixed(2)}`,
    )
    console.log('')
  }

  const agent = out['智能體(狀態機)'] as { stage: { mean: number }; stall: { p90: number } }
  const idle = out['純掛機'] as { stage: { mean: number } }
  const lift = ((agent.stage.mean - idle.stage.mean) / Math.max(1, idle.stage.mean)) * 100

  console.log('=== 摘要 ===')
  console.log(`· 智能體相對純掛機關卡 +${lift.toFixed(1)}%`)
  console.log(
    `· 職業線比較：戰士 ${(out['戰士路線'] as { stage: { mean: number } }).stage.mean} / 弓 ${(out['弓箭手路線'] as { stage: { mean: number } }).stage.mean} / 法 ${(out['法師路線'] as { stage: { mean: number } }).stage.mean}`,
  )
  console.log(`· 智能體卡關 p90 ${agent.stall.p90}h`)

  console.log('\n__JSON__')
  console.log(JSON.stringify({ hours: HOURS, runs: RUNS, agents: out }, null, 2))
}

main()

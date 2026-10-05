/**
 * 最佳規劃模擬：GA 搜尋長期策略 + 粗狀態 DP 短線建議，
 * 並掃描時間軸上的「突破點／卡關帶」。
 *
 * 執行：npm run sim:optimal
 */
import { createBattle, teamPower } from '../src/game/combat.ts'
import { enemyTargetPower } from '../src/game/enemies.ts'
import {
  BERSERK_AFTER_ROUNDS,
  SKILL_DUNGEON_UNLOCK,
  skillLevelPowerBonus,
} from '../src/game/balance.ts'
import {
  ascendCharacter,
  ascendSkill,
  chooseStarters,
  createNewState,
  getState,
  hydrate,
  levelUp,
  rebirthCharacter,
  setFarmFloor,
  setIdleMode,
  setPushMode,
  simulateTicks,
  upgradeSkill,
} from '../src/game/state.ts'
import {
  CHAR_LEVEL_MAX,
  charAscendCost,
  charRebirthCost,
  nextRarity,
  skillAscendCost,
  skillUpgradeCost,
} from '../src/game/util.ts'
import { CHAR_MAP } from '../src/game/data/characters.ts'
import type { IdleMode } from '../src/game/types.ts'

type Weights = {
  push: number
  bp: number
  skill: number
  hunt: number
  level: number
  skillUp: number
  ascend: number
  rebirth: number
}

type Snapshot = {
  h: number
  main: number
  skill: number
  bp: number
  hunt: number
  crystal: number
  essence: number
  books: number
  badge: number
  cp: number
  enemyCp: number
  deaths: number
  mode: IdleMode
  avgSkLv: number
  rareCount: number
  rebirthSum: number
}

type Breakpoint = {
  h: number
  kind: 'stall' | 'spike' | 'unlock' | 'rebirth' | 'softcap'
  detail: string
}

const HORIZON_H = Number(process.env.SIM_OPT_HOURS ?? 72)
const DECISION_MIN = Number(process.env.SIM_OPT_DECISION_MIN ?? 15)
const GA_POP = Number(process.env.SIM_GA_POP ?? 14)
const GA_GENS = Number(process.env.SIM_GA_GENS ?? 8)
const GA_VALIDATE = Number(process.env.SIM_GA_VALIDATE ?? 3)

function rand(): number {
  return Math.random()
}
function clamp01(x: number) {
  return Math.max(0.02, Math.min(1, x))
}
function fmt(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return String(Math.floor(n))
}

function randomWeights(): Weights {
  return {
    push: clamp01(rand()),
    bp: clamp01(rand() * 0.6),
    skill: clamp01(rand()),
    hunt: clamp01(rand() * 0.4),
    level: clamp01(0.4 + rand() * 0.6),
    skillUp: clamp01(0.3 + rand() * 0.7),
    ascend: clamp01(0.2 + rand() * 0.8),
    rebirth: clamp01(0.2 + rand() * 0.8),
  }
}

function mutate(w: Weights): Weights {
  const keys = Object.keys(w) as (keyof Weights)[]
  const out = { ...w }
  for (const k of keys) {
    if (rand() < 0.35) out[k] = clamp01(out[k] + (rand() - 0.5) * 0.35)
  }
  return out
}

function crossover(a: Weights, b: Weights): Weights {
  const out = { ...a }
  for (const k of Object.keys(a) as (keyof Weights)[]) {
    if (rand() < 0.5) out[k] = b[k]
  }
  return out
}

function totalBooks(s = getState()) {
  return s.skillItems.reduce((n, sk) => n + (sk.books ?? 0), 0)
}

function skillStats(s = getState()) {
  let lv = 0
  let n = 0
  let rare = 0
  for (const sk of s.skillItems) {
    lv += sk.level
    n += 1
    if (sk.rarity !== '普通') rare += 1
  }
  return { avgSkLv: n ? lv / n : 0, rareCount: rare }
}

function rebirthSum(s = getState()) {
  return s.roster.reduce((n, c) => n + (c.rebirth ?? 0), 0)
}

function trySpend(w: Weights) {
  const s = getState()
  // 角色升級（盡量用滿）
  if (w.level > 0.2) {
    let guard = 0
    while (guard++ < 40) {
      let did = false
      for (const ch of s.roster) {
        if (ch.level < CHAR_LEVEL_MAX) {
          const err = levelUp(ch.uid, 1)
          if (!err) did = true
        }
      }
      if (!did) break
    }
  }
  // 進階
  if (w.ascend > 0.25) {
    for (const ch of s.roster) {
      const cost = charAscendCost(ch.ascend ?? 0)
      if (s.resources.soul >= cost) ascendCharacter(ch.uid)
    }
  }
  // 轉生（滿級才有意義）
  if (w.rebirth > 0.25) {
    for (const ch of s.roster) {
      if ((ch.level ?? 1) < CHAR_LEVEL_MAX) continue
      const cost = charRebirthCost(ch.rebirth ?? 0)
      if (s.resources.crystal >= cost.crystal && s.resources.gold >= cost.gold) {
        rebirthCharacter(ch.uid)
      }
    }
  }
  // 技能升級／升階（能升就升）
  if (w.skillUp > 0.2) {
    let guard = 0
    while (guard++ < 60) {
      let did = false
      for (const sk of s.skillItems) {
        const up = skillUpgradeCost(sk.level)
        if (s.resources.essence >= up) {
          if (!upgradeSkill(sk.uid)) did = true
        }
        if (nextRarity(sk.rarity) && (sk.books ?? 0) >= skillAscendCost(sk.rarity)) {
          if (w.ascend > 0.15 && !ascendSkill(sk.uid)) did = true
        }
      }
      if (!did) break
    }
  }
}

function pickMode(w: Weights): IdleMode {
  const s = getState()
  const scores: { mode: IdleMode; score: number }[] = [
    { mode: 'main', score: w.push * (1.15 - Math.min(0.4, s.floors.main / 400)) },
  ]
  if (s.floors.main >= 8) {
    scores.push({ mode: 'blueprint', score: w.bp * (0.7 + Math.min(0.5, 40 / Math.max(1, s.resources.blueprint))) })
  }
  if (s.floors.main >= SKILL_DUNGEON_UNLOCK) {
    scores.push({
      mode: 'skill',
      score: w.skill * (0.85 + Math.min(0.6, 20 / Math.max(1, totalBooks() + 1))),
    })
  }
  if (s.firstWin.boss || s.firstWin.godking) {
    scores.push({ mode: 'hunt', score: w.hunt * (0.5 + Math.min(0.5, 30 / Math.max(1, s.resources.kingBadge + 1))) })
  }
  // 若主塔推不動（戰力明顯落後）→ 偏向刷本
  const cp = teamPower(s)
  const enemy = enemyTargetPower('main', s.floors.main)
  if (cp < enemy * 0.85) {
    for (const row of scores) {
      if (row.mode === 'main') row.score *= 0.45
      if (row.mode === 'skill') row.score *= 1.35
      if (row.mode === 'blueprint') row.score *= 1.15
    }
  }
  scores.sort((a, b) => b.score - a.score)
  return scores[0]!.mode
}

function applyMode(mode: IdleMode) {
  setIdleMode(mode)
  const s = getState()
  if (mode === 'main' || mode === 'blueprint' || mode === 'skill' || mode === 'hunt') {
    const max = s.floors[mode]
    const cp = teamPower(s)
    const enemy = enemyTargetPower(mode, max)
    const broke = s.resources.crystal < 60
    if (broke || cp < enemy * 0.95) {
      setPushMode(mode, 'stay')
      const back = mode === 'skill' ? 2 : mode === 'main' ? 4 : 2
      setFarmFloor(mode, Math.max(1, max - back))
    } else {
      setPushMode(mode, 'push')
      setFarmFloor(mode, max)
    }
  }
}

function takeSnap(h: number, deaths: number): Snapshot {
  const s = getState()
  const sk = skillStats(s)
  const mode = s.idleMode
  return {
    h,
    main: s.floors.main,
    skill: s.floors.skill,
    bp: s.floors.blueprint,
    hunt: s.floors.hunt,
    crystal: Math.floor(s.resources.crystal),
    essence: Math.floor(s.resources.essence),
    books: totalBooks(s),
    badge: Math.floor(s.resources.kingBadge ?? 0),
    cp: teamPower(s),
    enemyCp: enemyTargetPower(mode, s.farmFloor[mode]),
    deaths,
    mode,
    avgSkLv: sk.avgSkLv,
    rareCount: sk.rareCount,
    rebirthSum: rebirthSum(s),
  }
}

function runPolicy(w: Weights, hours: number, recordTimeline: boolean) {
  hydrate(createNewState())
  chooseStarters()
  // 純新號：不加額外補貼
  const decisionSec = Math.max(60, DECISION_MIN * 60)
  const total = Math.floor(hours * 3600)
  let t = 0
  let deaths = 0
  let nextDecision = 0
  const timeline: Snapshot[] = []
  let lastMain = 1
  let stallStartH = 0

  while (t < total) {
    if (t >= nextDecision) {
      trySpend(w)
      applyMode(pickMode(w))
      nextDecision = t + decisionSec
    }
    const before = getState()
    const floorsBefore = before.floors.main
    const deadLog = before.battle?.log ?? ''
    simulateTicks(1, false)
    const after = getState()
    if ((after.battle?.log ?? '').includes('倒下') || deadLog.includes('倒下')) {
      // count transition to defeat
    }
    if ((after.battle?.log ?? '').includes('倒下')) deaths += 1
    if (after.floors.main > floorsBefore) {
      // progress
    }
    t += 1
    if (recordTimeline && t % 1800 === 0) {
      // every 0.5h
      const snap = takeSnap(t / 3600, deaths)
      timeline.push(snap)
      if (snap.main <= lastMain) {
        if (!stallStartH) stallStartH = snap.h
      } else {
        stallStartH = 0
        lastMain = snap.main
      }
    }
  }
  const end = takeSnap(hours, deaths)
  if (recordTimeline) timeline.push(end)
  const fitness =
    end.main * 12 +
    end.skill * 8 +
    end.bp * 6 +
    end.hunt * 4 +
    end.avgSkLv * 15 +
    end.rareCount * 25 +
    end.rebirthSum * 80 +
    Math.log10(1 + end.crystal) * 8 +
    Math.log10(1 + end.books) * 10 -
    end.deaths * 0.015
  return { fitness, end, timeline, deaths, weights: w }
}

function detectBreakpoints(timeline: Snapshot[]): Breakpoint[] {
  const out: Breakpoint[] = []
  if (!timeline.length) return out

  // unlock markers
  for (const s of timeline) {
    if (s.main >= SKILL_DUNGEON_UNLOCK) {
      out.push({
        h: s.h,
        kind: 'unlock',
        detail: `技能本解鎖門檻（主塔≥${SKILL_DUNGEON_UNLOCK}）已過 · 技能層 ${s.skill}F · 同名本 ${s.books}`,
      })
      break
    }
  }
  for (const s of timeline) {
    if (s.rebirthSum >= 1) {
      out.push({ h: s.h, kind: 'rebirth', detail: `首轉出現（轉生合計 ${s.rebirthSum}）· 主塔 ${s.main}F · 水晶 ${fmt(s.crystal)}` })
      break
    }
  }
  for (const s of timeline) {
    if (s.rareCount >= 3) {
      out.push({ h: s.h, kind: 'spike', detail: `技能升階起步（非普通≥3）· 均Lv ${s.avgSkLv.toFixed(1)} · 主塔 ${s.main}F` })
      break
    }
  }

  // stall bands: main floor growth < 3 over 4h window
  for (let i = 0; i < timeline.length; i++) {
    const a = timeline[i]!
    const b = timeline.find((x) => x.h >= a.h + 4)
    if (!b) break
    const dMain = b.main - a.main
    const dSk = b.skill - a.skill
    if (dMain <= 2 && dSk <= 0 && a.main >= 10) {
      // 技能本養成期間主塔不動不算卡死
      if (a.mode === 'skill' || b.mode === 'skill') continue
      out.push({
        h: a.h,
        kind: 'stall',
        detail: `主塔停滯：${a.h.toFixed(1)}→${b.h.toFixed(1)}h 僅 ${a.main}→${b.main}F（CP ${fmt(a.cp)} vs 敵 ${fmt(a.enemyCp)} · 戰敗累計 ${a.deaths}→${b.deaths} · 模式偏 ${a.mode}）`,
      })
      i = timeline.indexOf(b)
    }
  }

  // softcap: last 12h gain small vs earlier
  const mid = timeline.find((x) => x.h >= HORIZON_H * 0.4)
  const late = timeline[timeline.length - 1]
  if (mid && late) {
    const earlyRate = mid.main / Math.max(0.5, mid.h)
    const lateRate = (late.main - mid.main) / Math.max(0.5, late.h - mid.h)
    if (lateRate < earlyRate * 0.35 && late.main > 30) {
      out.push({
        h: mid.h,
        kind: 'softcap',
        detail: `後期推進減速：前段 ~${earlyRate.toFixed(1)}F/h → 後段 ~${lateRate.toFixed(1)}F/h（終點 ${late.main}F）。可能卡在轉生／裝備階或技能本難度。`,
      })
    }
  }

  // dedupe similar stalls within 2h
  const filtered: Breakpoint[] = []
  for (const bp of out) {
    const near = filtered.find((x) => x.kind === bp.kind && Math.abs(x.h - bp.h) < 2)
    if (!near) filtered.push(bp)
  }
  return filtered.sort((a, b) => a.h - b.h)
}

/** 粗狀態 DP：樓層帶 × 是否已解鎖技能本 × 資源帶 → 建議動作 */
function runShortDp() {
  type Act = 'push' | 'farmSk' | 'farmBp' | 'idleUp'
  const floors = [1, 12, 18, 35, 60, 90, 130, 180]
  const actions: Act[] = ['push', 'farmSk', 'farmBp', 'idleUp']
  // 簡化報酬：用短模擬估計
  const V = new Map<string, number>()
  const policy = new Map<string, Act>()

  function key(fBand: number, skUnlock: number, resBand: number) {
    return `${fBand}|${skUnlock}|${resBand}`
  }

  for (let iter = 0; iter < 4; iter++) {
    for (const f of floors) {
      for (const skU of [0, 1]) {
        for (const res of [0, 1, 2]) {
          let best = -1e99
          let bestA: Act = 'push'
          for (const a of actions) {
            if (a === 'farmSk' && (skU === 0 || f < SKILL_DUNGEON_UNLOCK)) continue
            // synthetic reward
            let r = 0
            if (a === 'push') r = 12 + f * 0.04 - (res === 0 ? 4 : 0)
            if (a === 'farmSk') r = 9 + res * 2
            if (a === 'farmBp') r = 6 + (res === 0 ? 3 : 0)
            if (a === 'idleUp') r = 5 + res * 1.5
            const nf = a === 'push' ? Math.min(180, f + 8) : f
            const nSk = skU || nf >= SKILL_DUNGEON_UNLOCK ? 1 : 0
            const nRes = a === 'farmSk' || a === 'farmBp' || a === 'idleUp' ? Math.min(2, res + 1) : Math.max(0, res - (a === 'push' ? 1 : 0))
            const cont = V.get(key(nf, nSk, nRes)) ?? 0
            const score = r + 0.86 * cont
            if (score > best) {
              best = score
              bestA = a
            }
          }
          V.set(key(f, skU, res), best)
          policy.set(key(f, skU, res), bestA)
        }
      }
    }
  }

  const lines: string[] = []
  for (const f of floors) {
    const skU = f >= SKILL_DUNGEON_UNLOCK ? 1 : 0
    const act = policy.get(key(f, skU, 1)) ?? 'push'
    lines.push(`樓層帶 ~${f}F → 建議 ${act} (V=${(V.get(key(f, skU, 1)) ?? 0).toFixed(1)})`)
  }
  return lines
}

function main() {
  console.log('# 《異塔編年》最佳規劃模擬')
  console.log(`地平線 ${HORIZON_H}h · 決策間隔 ${DECISION_MIN}min · GA pop=${GA_POP} gens=${GA_GENS}`)
  console.log(`技能本解鎖 ${SKILL_DUNGEON_UNLOCK}F · 暴走≥${BERSERK_AFTER_ROUNDS} · Lv10技能加成≈${(skillLevelPowerBonus(10) * 100).toFixed(1)}%`)
  console.log('')

  let pop = Array.from({ length: GA_POP }, () => randomWeights())
  // seed a balanced prior
  pop[0] = {
    push: 0.95,
    bp: 0.25,
    skill: 0.55,
    hunt: 0.15,
    level: 0.9,
    skillUp: 0.85,
    ascend: 0.7,
    rebirth: 0.75,
  }

  let best = pop[0]!
  let bestFit = -1e99
  for (let g = 1; g <= GA_GENS; g++) {
    const scored = pop.map((w) => {
      const r = runPolicy(w, Math.min(18, HORIZON_H), false)
      return { w, fit: r.fitness, end: r.end }
    })
    scored.sort((a, b) => b.fit - a.fit)
    if (scored[0]!.fit > bestFit) {
      bestFit = scored[0]!.fit
      best = scored[0]!.w
    }
    console.log(
      `GA gen ${g}/${GA_GENS} bestFit=${scored[0]!.fit.toFixed(1)} main=${scored[0]!.end.main}F sk=${scored[0]!.end.skill}F books=${scored[0]!.end.books} rebirth=${scored[0]!.end.rebirthSum}`,
    )
    const elite = scored.slice(0, Math.max(2, Math.floor(GA_POP / 3))).map((x) => x.w)
    const next: Weights[] = [...elite]
    while (next.length < GA_POP) {
      const a = elite[Math.floor(rand() * elite.length)]!
      const b = elite[Math.floor(rand() * elite.length)]!
      next.push(mutate(crossover(a, b)))
    }
    pop = next
  }

  console.log('\n== 最佳基因體長跑驗證 ==')
  const validations = []
  for (let i = 0; i < GA_VALIDATE; i++) {
    const r = runPolicy(best, HORIZON_H, i === 0)
    validations.push(r)
    console.log(
      `  run${i + 1}: 主塔 ${r.end.main}F · 技能本 ${r.end.skill}F · 副塔 ${r.end.bp}F · 討伐 ${r.end.hunt}F · 本 ${r.end.books} · 徽 ${r.end.badge} · 轉生 ${r.end.rebirthSum} · 均技Lv ${r.end.avgSkLv.toFixed(1)} · 戰敗 ${r.end.deaths} · fit ${r.fitness.toFixed(1)}`,
    )
  }

  const primary = validations[0]!
  const bps = detectBreakpoints(primary.timeline)
  console.log('\n== 時間軸節選（每 0.5h）==')
  for (const s of primary.timeline.filter((_, i) => i % 4 === 0 || i === primary.timeline.length - 1)) {
    console.log(
      `  t=${s.h.toFixed(1)}h 主${s.main} 技${s.skill} 副${s.bp} · CP ${fmt(s.cp)}/${fmt(s.enemyCp)} · 水晶 ${fmt(s.crystal)} 精華 ${fmt(s.essence)} 本 ${s.books} · 技Lv ${s.avgSkLv.toFixed(1)} 稀有 ${s.rareCount} 轉 ${s.rebirthSum} · 模式 ${s.mode}`,
    )
  }

  console.log('\n== 突破點／卡關帶 ==')
  if (!bps.length) console.log('  （未偵測到明顯停滯帶）')
  for (const bp of bps) {
    console.log(`  [${bp.kind}] @${bp.h.toFixed(1)}h — ${bp.detail}`)
  }

  console.log('\n== GA 最佳權重 ==')
  console.log(
    `  push=${best.push.toFixed(2)} bp=${best.bp.toFixed(2)} skill=${best.skill.toFixed(2)} hunt=${best.hunt.toFixed(2)} level=${best.level.toFixed(2)} skillUp=${best.skillUp.toFixed(2)} ascend=${best.ascend.toFixed(2)} rebirth=${best.rebirth.toFixed(2)}`,
  )

  console.log('\n== DP 短線建議 ==')
  for (const line of runShortDp()) console.log(`  · ${line}`)

  // Aggregate advice
  console.log('\n== 結論 ==')
  const end = primary.end
  console.log(`  · 最佳規劃 ${HORIZON_H}h 終點：主塔 ${end.main}F、技能本 ${end.skill}F、同名本 ${end.books}、轉生合計 ${end.rebirthSum}`)
  const stalls = bps.filter((b) => b.kind === 'stall' || b.kind === 'softcap')
  if (stalls.length) {
    console.log('  · 需要關注的斷層：')
    for (const s of stalls) console.log(`    - ${s.detail}`)
  } else {
    console.log('  · 曲線相對連續；主要節奏點在解鎖／升階／轉生，而非硬卡死。')
  }
  void createBattle
  void CHAR_MAP
}

main()

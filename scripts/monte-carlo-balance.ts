/**
 * 長線掛機平衡 Monte Carlo（CLI）
 *
 * 重用真實 battleTick / clearRewards / skillUpgradeCost / skillAscendCost，避免平行假公式。
 * 執行：npm run sim:balance
 */
import { createBattle, teamPower } from '../src/game/combat.ts'
import { enemyTargetPower } from '../src/game/enemies.ts'
import {
  BERSERK_AFTER_ROUNDS,
  SKILL_DUNGEON_UNLOCK,
  skillLevelPowerBonus,
} from '../src/game/balance.ts'
import {
  ascendSkill,
  chooseStarters,
  createNewState,
  getState,
  hydrate,
  levelUp,
  setFarmFloor,
  setIdleMode,
  setPushMode,
  simulateTicks,
  upgradeSkill,
} from '../src/game/state.ts'
import { nextRarity, skillAscendCost, skillUpgradeCost } from '../src/game/util.ts'
import type { IdleMode } from '../src/game/types.ts'

type PathProfile = {
  name: string
  hours: number
  focus: 'pushMain' | 'farmBlueprint' | 'farmSkill' | 'farmHunt' | 'grindStuck'
  /** 自動：精華升級＋技能卡升階 */
  spendSkillGrowth: boolean
  /** grindStuck：相對戰力倍率，1=同戰力層附近 */
  stuckPowerRatio?: number
}

type RunStats = {
  name: string
  hours: number
  mainFloor: number
  blueprintFloor: number
  skillFloor: number
  huntFloor: number
  crystal: number
  blueprint: number
  essence: number
  skillbook: number
  kingBadge: number
  skillLevels: number[]
  skillRarities: string[]
  teamCp: number
  enemyCpAtFarm: number
  floorsCleared: number
  deaths: number
  berserkSeen: number
  grindFailedByBerserk: boolean
  maxRoundsSeen: number
}

function snapshotSkillLevels(): number[] {
  const s = getState()
  const levels: number[] = []
  for (const role of ['warrior', 'mage', 'priest'] as const) {
    for (const kind of ['attack', 'defense', 'support'] as const) {
      const uid = s.loadouts[role]?.skills?.[kind]
      const sk = s.skillItems.find((x) => x.uid === uid)
      if (sk) levels.push(sk.level)
    }
  }
  return levels
}

function snapshotSkillRarities(): string[] {
  const s = getState()
  const rarities: string[] = []
  for (const role of ['warrior', 'mage', 'priest'] as const) {
    for (const kind of ['attack', 'defense', 'support'] as const) {
      const uid = s.loadouts[role]?.skills?.[kind]
      const sk = s.skillItems.find((x) => x.uid === uid)
      if (sk) rarities.push(sk.rarity)
    }
  }
  return rarities
}

/** 精華升級 → 技能卡升階（稀有度） */
function trySpendSkillGrowth() {
  const s = getState()
  let progressed = true
  while (progressed) {
    progressed = false
    for (const role of ['warrior', 'mage', 'priest'] as const) {
      for (const kind of ['attack', 'defense', 'support'] as const) {
        const uid = s.loadouts[role]?.skills?.[kind]
        if (!uid) continue
        const sk = s.skillItems.find((x) => x.uid === uid)
        if (!sk) continue
        const upCost = skillUpgradeCost(sk.level)
        if (s.resources.essence >= upCost) {
          const err = upgradeSkill(uid)
          if (!err) {
            progressed = true
            continue
          }
        }
        if (nextRarity(sk.rarity) && (sk.books ?? 0) >= skillAscendCost(sk.rarity)) {
          const err = ascendSkill(uid)
          if (!err) progressed = true
        }
      }
    }
  }
}

function autoLevelRoster() {
  const s = getState()
  let progressed = true
  while (progressed) {
    progressed = false
    for (const ch of s.roster) {
      const before = ch.level
      if (before >= 100) continue
      const err = levelUp(ch.uid, 1)
      if (!err && ch.level > before) progressed = true
    }
  }
}

/** 找敵方戰力最接近 targetPower 的主塔層 */
function floorNearPower(targetPower: number): number {
  let best = 1
  let bestDiff = Infinity
  for (let f = 1; f <= 500; f++) {
    const p = enemyTargetPower('main', f)
    const d = Math.abs(p - targetPower)
    if (d < bestDiff) {
      bestDiff = d
      best = f
    }
  }
  return best
}

function runPath(profile: PathProfile): RunStats {
  hydrate(createNewState())
  chooseStarters()
  const s0 = getState()
  s0.resources.crystal += 8000
  s0.resources.gold += 800
  s0.resources.blueprint += 80
  s0.resources.essence += 400
  s0.resources.skillbook += 200
  autoLevelRoster()

  const totalTicks = Math.floor(profile.hours * 3600)
  const chunk = 120
  let floorsCleared = 0
  let deaths = 0
  let berserkSeen = 0
  let grindFailedByBerserk = false
  let maxRoundsSeen = 0
  let stuckFloorPicked = false

  let t = 0
  while (t < totalTicks) {
    const step = Math.min(chunk, totalTicks - t)
    const st = getState()
    const floorBefore = st.floors.main + st.floors.blueprint + st.floors.skill

    if (profile.focus === 'pushMain') {
      setIdleMode('main')
      // 卡關時回退刷資源，再沖層（模擬玩家切原地）
      if (st.floors.main >= 8 && st.resources.crystal < 80) {
        setPushMode('main', 'stay')
        setFarmFloor('main', Math.max(1, st.floors.main - 3))
      } else {
        setPushMode('main', 'push')
        setFarmFloor('main', st.floors.main)
      }
    } else if (profile.focus === 'farmBlueprint') {
      if (st.floors.main < 35) {
        setIdleMode('main')
        setPushMode('main', 'push')
      } else {
        setIdleMode('blueprint')
        setPushMode('blueprint', 'stay')
        setFarmFloor('blueprint', Math.max(1, st.floors.blueprint))
      }
    } else if (profile.focus === 'farmSkill') {
      if (st.floors.main < SKILL_DUNGEON_UNLOCK) {
        setIdleMode('main')
        setPushMode('main', 'push')
      } else {
        setIdleMode('skill')
        setPushMode('skill', 'stay')
        setFarmFloor('skill', Math.max(1, st.floors.skill))
      }
    } else if (profile.focus === 'farmHunt') {
      // 模擬首通王階後刷破王徽
      st.firstWin.boss = true
      setIdleMode('hunt')
      setPushMode('hunt', 'stay')
      setFarmFloor('hunt', Math.max(1, st.floors.hunt))
    } else if (!stuckFloorPicked) {
      // 先短暫養成，再挑接近戰力的層（可拖長、測暴走）
      setIdleMode('main')
      setPushMode('main', 'push')
      if (st.floors.main >= 8 || t > 600) {
        autoLevelRoster()
        const cp = teamPower(getState())
        const ratio = profile.stuckPowerRatio ?? 0.95
        const target = floorNearPower(cp * ratio)
        const cur = getState()
        cur.floors.main = Math.max(cur.floors.main, target)
        setPushMode('main', 'stay')
        setFarmFloor('main', target)
        cur.battle = createBattle(cur)
        stuckFloorPicked = true
      }
    }

    autoLevelRoster()
    if (profile.spendSkillGrowth) trySpendSkillGrowth()

    for (let i = 0; i < step; i++) {
      const before = getState()
      const hadBerserk = !!before.battle?.berserk
      const roundsBefore = before.battle?.roundsElapsed ?? 0
      maxRoundsSeen = Math.max(maxRoundsSeen, roundsBefore)
      const floorsSumBefore =
        before.floors.main + before.floors.blueprint + before.floors.skill
      simulateTicks(1, false)
      const after = getState()
      const floorsSumAfter =
        after.floors.main + after.floors.blueprint + after.floors.skill
      if (floorsSumAfter > floorsSumBefore) floorsCleared += floorsSumAfter - floorsSumBefore
      maxRoundsSeen = Math.max(maxRoundsSeen, after.battle?.roundsElapsed ?? 0)
      if (after.battle?.berserk) berserkSeen += 1
      if ((after.battle?.log ?? '').includes('倒下')) {
        deaths += 1
        if (hadBerserk || roundsBefore >= BERSERK_AFTER_ROUNDS) {
          grindFailedByBerserk = true
        }
      }
    }

    const floorAfter =
      getState().floors.main + getState().floors.blueprint + getState().floors.skill
    if (floorAfter > floorBefore) {
      // already counted per-tick
    }

    t += step
  }

  const end = getState()
  const mode = end.idleMode as IdleMode
  const farm = end.farmFloor[mode]
  return {
    name: profile.name,
    hours: profile.hours,
    mainFloor: end.floors.main,
    blueprintFloor: end.floors.blueprint,
    skillFloor: end.floors.skill,
    huntFloor: end.floors.hunt,
    crystal: Math.floor(end.resources.crystal),
    blueprint: Math.floor(end.resources.blueprint),
    essence: Math.floor(end.resources.essence),
    skillbook: Math.floor(end.resources.skillbook),
    kingBadge: Math.floor(end.resources.kingBadge ?? 0),
    skillLevels: snapshotSkillLevels(),
    skillRarities: snapshotSkillRarities(),
    teamCp: teamPower(end),
    enemyCpAtFarm: enemyTargetPower(mode, farm),
    floorsCleared,
    deaths,
    berserkSeen,
    grindFailedByBerserk,
    maxRoundsSeen,
  }
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return String(Math.floor(n))
}

function main() {
  const profiles: PathProfile[] = [
    { name: '主塔沖層 48h', hours: 48, focus: 'pushMain', spendSkillGrowth: true },
    { name: '副塔刷藍圖 24h', hours: 24, focus: 'farmBlueprint', spendSkillGrowth: false },
    { name: '技能本刷卡 24h', hours: 24, focus: 'farmSkill', spendSkillGrowth: true },
    { name: '討伐刷破王徽 12h', hours: 12, focus: 'farmHunt', spendSkillGrowth: false },
    {
      name: '近戰力磨關 8h',
      hours: 8,
      focus: 'grindStuck',
      spendSkillGrowth: false,
      // 敵略弱：可磨很久但不穩殺 → 測暴走打斷
      stuckPowerRatio: 0.88,
    },
  ]

  console.log('=== 《異塔編年》平衡 Monte Carlo ===')
  console.log(
    `技能 CD=2 · 暴走≥${BERSERK_AFTER_ROUNDS} 回合 · 升級=精華 · 升階=質數×100 技能卡`,
  )
  console.log(
    `Lv10 技能強度加成 ≈ ${(skillLevelPowerBonus(10) * 100).toFixed(1)}%（舊線性約 110%）`,
  )
  console.log('')

  const results: RunStats[] = []
  for (const p of profiles) {
    const r = runPath(p)
    results.push(r)
    console.log(`--- ${r.name} ---`)
    console.log(
      `主塔 ${r.mainFloor}F · 副塔 ${r.blueprintFloor}F · 技能本 ${r.skillFloor}F · 討伐 ${r.huntFloor}F · 清層≈${r.floorsCleared}`,
    )
    console.log(
      `資源 水晶 ${fmt(r.crystal)} · 藍圖 ${fmt(r.blueprint)} · 精華 ${fmt(r.essence)} · 技能卡 ${fmt(r.skillbook)} · 破王徽 ${fmt(r.kingBadge)}`,
    )
    console.log(
      `戰力 隊 ${fmt(r.teamCp)} vs 掛機敵 ${fmt(r.enemyCpAtFarm)} · 技能Lv [${r.skillLevels.join(',')}] · 階 [${r.skillRarities.join(',')}]`,
    )
    console.log(
      `戰敗 ${r.deaths} · 暴走tick ${r.berserkSeen} · 最長回合 ${r.maxRoundsSeen} · 被暴走打斷=${r.grindFailedByBerserk}`,
    )
    console.log('')
  }

  const push = results.find((r) => r.name.includes('沖層'))
  const bp = results.find((r) => r.name.includes('藍圖'))
  const sk = results.find((r) => r.name.includes('技能本'))
  const hunt = results.find((r) => r.name.includes('破王徽'))
  const stuck = results.find((r) => r.name.includes('磨關'))

  console.log('=== 摘要 ===')
  if (push) {
    const avg =
      push.skillLevels.reduce((a, b) => a + b, 0) / Math.max(1, push.skillLevels.length)
    console.log(
      `· 48h 沖層可達主塔 ~${push.mainFloor}F，水晶 ${fmt(push.crystal)}，藍圖 ${fmt(push.blueprint)}，精華 ${fmt(push.essence)}，技能平均 Lv ${avg.toFixed(1)}`,
    )
  }
  if (bp) {
    console.log(`· 24h 副塔路徑藍圖存量約 ${fmt(bp.blueprint)}`)
  }
  if (sk) {
    console.log(
      `· 24h 技能本路徑技能卡 ${fmt(sk.skillbook)}／精華 ${fmt(sk.essence)}，技能Lv [${sk.skillLevels.join(',')}]，階 [${sk.skillRarities.join(',')}]`,
    )
  }
  if (hunt) {
    console.log(
      `· 12h 討伐路徑破王徽 ${fmt(hunt.kingBadge)}（討伐 ${hunt.huntFloor}F）`,
    )
  }
  if (stuck) {
    console.log(
      `· 近戰力磨關：戰敗 ${stuck.deaths}，最長 ${stuck.maxRoundsSeen} 回合，暴走tick=${stuck.berserkSeen}，被暴走打斷=${stuck.grindFailedByBerserk}`,
    )
  }
}

main()

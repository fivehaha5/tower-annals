import { BOSS_CHARACTERS, CHARACTERS, CHAR_MAP, GODKING_CHARACTERS } from '../game/data/characters'
import { SKILL_MAP, antiKingSkills, shopSkillCatalog, uniqueSkillsBySource } from '../game/data/skills'
import { currentCycleDropInfo } from '../game/drops'
import {
  EQUIP_SLOTS,
  EQUIP_SLOT_LABEL,
  makeEquipDef,
  parseEquipDefId,
} from '../game/data/equipment'
import {
  equipStatLine,
  ownedEquipStatLine,
  skillEffectLine,
  skillPowerLine,
  skillSpecialLine,
} from '../game/formatText'
import {
  calcCharStats,
  createBattle,
  farmFloorOf,
  fightingUids,
  getEquippedSkill,
  getRoleCharacter,
  getTeamRoles,
  teamPower,
  workBoostMult,
} from '../game/combat'
import { allMobPortraitUrls, buildEnemy } from '../game/enemies'
import {
  GAME_NAME,
  GODKING_UNLOCK,
  FOREGROUND_OFFLINE_THRESHOLD_SEC,
  OFFLINE_CAP_SEC,
  RESOURCE_META,
  ROLE_LABEL,
  RARITY_COLOR,
  SKILL_KIND_LABEL,
  GACHA_COST_HUNDRED,
  GACHA_COST_ONE,
  GACHA_COST_TEN,
  CHAR_LEVEL_MAX,
  SHOP_RATES,
  assetUrl,
  charAscendCost,
  charBoostCardCost,
  charLevelCost,
  charLevelCostRange,
  charRebirthCost,
  equipBlueprintCost,
  equipCraftCost,
  formatDuration,
  formatNum,
  maxEquipTierForRebirth,
  nextBlueprintUnlockFloor,
  nextPrimeAfter,
  nextRarity,
  ownedCardShopCost,
  rarityIndex,
  rebirthRequiredForEquipTier,
  shopSkillCost,
  skillAscendCost,
  skillUpgradeCost,
} from '../game/util'
import type {
  DropAim,
  EquipSlot,
  GameState,
  IdleMode,
  OwnedCharacter,
  PushMode,
  Rarity,
  Resources,
  Role,
  SkillKind,
  WorkJob,
} from '../game/types'
import * as actions from '../game/state'
import {
  downloadSaveFile,
  exportSave,
  hasLocalSave,
  importSave,
  loadLocal,
  saveLocal,
  uploadSaveFile,
} from '../game/save'
import {
  DISPATCH_OPTIONS,
  WORK_BATCH_SEC,
  dispatchSlotCap,
  isOnDispatch,
  mainTowerWorkBonus,
  scaleDispatchReward,
  workStationCap,
} from '../game/logistics'
import { RELIC_MAP, RELICS, relicsUnlockedByRebirth } from '../game/data/relics'
import { countRebirthBonusCells, roleRebirthBonus } from '../game/mechanics'
import { APP_VERSION, checkAppUpdate, warmImageCache } from '../appUpdate'
import { ANTI_KING_EXCHANGE_COST, SKILL_DUNGEON_COOLDOWN_SEC, SKILL_DUNGEON_UNLOCK } from '../game/balance'

const MODE_LABEL: Record<IdleMode, string> = {
  main: '主塔',
  blueprint: '副塔',
  skill: '技能本',
  hunt: '討伐訓練',
  boss: '王塔',
  godking: '異域神王',
}

const WORK_LABEL: Record<WorkJob, string> = {
  gold: '淘金',
  forge: '熔鍛',
  essence: '精華',
  skillbook: '抄卡',
  soul: '集魂',
}

const WORK_JOBS: WorkJob[] = ['gold', 'forge', 'essence', 'skillbook', 'soul']

const WORK_DESC: Record<WorkJob, string> = {
  gold: '產出金鑽',
  forge: '產出熔鍛碎片',
  essence: '產出法術精華',
  skillbook: '產出技能卡',
  soul: '產出神魂',
}

const WORK_RES_KEY: Record<WorkJob, keyof Resources> = {
  gold: 'gold',
  forge: 'forge',
  essence: 'essence',
  skillbook: 'skillbook',
  soul: 'soul',
}

const TAB_ORDER: GameState['tab'][] = [
  'tower',
  'train',
  'gacha',
  'logistics',
  'settings',
]

const KINDS: SkillKind[] = ['attack', 'defense', 'support']

let toastTimer = 0
let prevTab: GameState['tab'] | null = null
let importCodeDraft = ''
let starterImportOpen = false
const barPctCache: Record<string, number> = {}
const navIndCache: { tab: GameState['tab'] | null; x: number; w: number } = {
  tab: null,
  x: 0,
  w: 22,
}
type LogisticsPage = 'stations' | 'detail'

function logisticsPage(): LogisticsPage {
  return (window as unknown as { __logisticsPage?: LogisticsPage }).__logisticsPage ?? 'stations'
}

function logisticsJob(): WorkJob | null {
  return (window as unknown as { __logisticsJob?: WorkJob | null }).__logisticsJob ?? null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function isEditingField(root: HTMLElement): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el || !root.contains(el)) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio' && type !== 'file'
  }
  return !!el.isContentEditable
}

/** 爬塔需整頁重繪的簽名（敵人／層數／掉落文案變了才重繪，避免每秒拆掉 img） */
let lastTowerPaintSig = ''
/** 戰鬥飄字序號：僅在變更時掛疊加層，不重繪立繪 */
let lastFloaterSeq = -1

function towerPaintSig(state: GameState): string {
  const b = state.battle
  const mode = state.idleMode
  const ds = mode === 'boss' || mode === 'godking' ? state.dropSettings[mode] : null
  return [
    mode,
    farmFloorOf(state),
    state.floors[mode],
    b?.enemy.name ?? '',
    b?.enemy.portrait ?? '',
    state.lastLootMsg ?? '',
    ds?.aim ?? '',
    ds?.targetId ?? '',
    state.firstWin.boss ? '1' : '0',
    state.firstWin.godking ? '1' : '0',
    state.pendingAntiKingPick ? '1' : '0',
    state.pushMode.hunt ?? 'push',
  ].join('|')
}

function spawnBattleFloaters(root: HTMLElement, state: GameState) {
  const b = state.battle
  if (!b || b.floaterSeq == null || b.floaterSeq === lastFloaterSeq) return
  lastFloaterSeq = b.floaterSeq
  const list = b.floaters ?? []
  if (!list.length) return

  for (const f of list) {
    const hero = root.querySelector(`[data-hero-role="${f.role}"]`) as HTMLElement | null
    if (!hero) continue
    const portrait = hero.querySelector('.portrait') as HTMLElement | null
    if (portrait) {
      portrait.classList.remove('portrait-strike')
      // 強制重啟 CSS 動畫
      void portrait.offsetWidth
      portrait.classList.add('portrait-strike')
      window.setTimeout(() => portrait.classList.remove('portrait-strike'), 420)
    }
    const layer = hero.querySelector('[data-floater-layer]') as HTMLElement | null
    if (!layer) continue
    const el = document.createElement('div')
    el.className = `battle-floater ${f.kind} ${f.role}`
    el.textContent = f.text
    const stack = layer.querySelectorAll('.battle-floater').length
    el.style.bottom = `${40 + stack * 16}%`
    layer.appendChild(el)
    window.setTimeout(() => el.remove(), 950)
  }
}

function patchLiveHud(root: HTMLElement, state: GameState) {
  const keys = RESOURCE_META.map((m) => m.key)
  const vals = root.querySelectorAll('.topbar .res .val')
  keys.forEach((k, i) => {
    const node = vals[i] as HTMLElement | undefined
    if (node) node.textContent = formatNum(state.resources[k])
  })

  if (state.tab !== 'tower' || !state.battle) return
  const b = state.battle
  const bars: [string, number][] = [
    ['enemy-shield', pctNum(b.enemy.shield, b.enemy.maxShield)],
    ['enemy-hp', pctNum(b.enemy.hp, b.enemy.maxHp)],
    ['team-shield', pctNum(b.teamShield, b.teamMaxShield)],
    ['team-hp', pctNum(b.teamHp, b.teamMaxHp)],
  ]
  for (const [key, target] of bars) {
    const bar = root.querySelector(`.bar[data-bar="${key}"]`) as HTMLElement | null
    const fill = bar?.querySelector('i') as HTMLElement | null
    if (!bar || !fill) continue
    bar.dataset.pct = target.toFixed(1)
    const prev = barPctCache[key] ?? target
    fill.style.transition = 'none'
    fill.style.width = `${prev}%`
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fill.style.transition = 'width 0.55s cubic-bezier(0.22, 1, 0.36, 1)'
        fill.style.width = `${target}%`
        barPctCache[key] = target
      })
    })
  }
  const logEl = root.querySelector('[data-battle-log]') as HTMLElement | null
  if (logEl) logEl.textContent = b.log || '準備戰鬥…'

  // 出戰技能冷卻：只改文字／class，不重繪立繪
  root.querySelectorAll<HTMLElement>('[data-skill-cd]').forEach((el) => {
    const role = el.dataset.role as Role | undefined
    const kind = el.dataset.kind as SkillKind | undefined
    if (!role || !kind) return
    const cd = b.skillCds?.[role]?.[kind] ?? 0
    const onCd = cd > 0
    el.classList.toggle('on-cd', onCd)
    const badge = el.querySelector('[data-cd-badge]') as HTMLElement | null
    if (badge) badge.textContent = onCd ? `CD${cd}` : ''
  })

  spawnBattleFloaters(root, state)
}

function toast(app: HTMLElement, msg: string, holdMs = 1800) {
  let el = app.querySelector('.toast') as HTMLElement | null
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast'
    app.querySelector('.phone')?.appendChild(el)
  }
  el.textContent = msg
  el.style.display = 'block'
  window.clearTimeout(toastTimer)
  if (holdMs > 0) {
    toastTimer = window.setTimeout(() => {
      el.style.display = 'none'
    }, holdMs)
  }
}

let warmingImages = false

function updateWarmProgressUi(
  root: HTMLElement,
  p: { done: number; total: number; saved: number; skipped: number; failed: number },
  doneMsg?: string,
) {
  const box = root.querySelector('#warm-progress') as HTMLElement | null
  const bar = root.querySelector('[data-warm-bar]') as HTMLElement | null
  const text = root.querySelector('[data-warm-text]') as HTMLElement | null
  if (!box || !bar || !text) return
  box.hidden = false
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
  bar.style.width = `${pct}%`
  if (doneMsg) {
    text.textContent = doneMsg
    return
  }
  text.textContent = `預載中 ${p.done}/${p.total}（${pct}%）· 新下載 ${p.saved} · 已有 ${p.skipped}${
    p.failed ? ` · 失敗 ${p.failed}` : ''
  }`
}

function pctNum(cur: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (cur / max) * 100))
}

function raritySpan(r: string): string {
  const color = RARITY_COLOR[r as keyof typeof RARITY_COLOR] ?? '#fff'
  return `<span style="color:${color}">${r}</span>`
}

function nameSpan(name: string, rarity: Rarity | string): string {
  const color = RARITY_COLOR[rarity as Rarity] ?? '#fff'
  const rainbow = rarity === '創世' ? ' rarity-genesis' : ''
  return `<span class="name-rarity${rainbow}" style="color:${color}">${name}</span>`
}

function uiFlag(key: string): boolean {
  return !!(window as unknown as Record<string, unknown>)[key]
}

function setUiFlag(key: string, on: boolean) {
  ;(window as unknown as Record<string, unknown>)[key] = on
}

function foldBtn(flag: string, openLabel: string, closedLabel: string): string {
  const open = uiFlag(flag)
  return `<button class="btn fold-btn" data-act="uifold" data-flag="${flag}" data-on="${open ? '0' : '1'}">${open ? openLabel : closedLabel}</button>`
}

function topbar(state: GameState): string {
  return `<div class="topbar res-bar all-res scroll-res">${RESOURCE_META.map((meta) => {
    return `<div class="res"><div class="name" style="color:${RARITY_COLOR[meta.rarity]}">${meta.name}</div><div class="val">${formatNum(state.resources[meta.key])}</div></div>`
  }).join('')}</div>`
}

function floorSelectPanel(state: GameState): string {
  const mode = state.idleMode
  const max = Math.max(1, state.floors[mode])
  const farm = farmFloorOf(state)

  if (mode === 'boss' || mode === 'godking') {
    const pool = mode === 'boss' ? BOSS_CHARACTERS : GODKING_CHARACTERS
    const n = pool.length
    const maxCycle = Math.max(1, Math.ceil(max / n))
    const win = window as unknown as { __bossCycle?: number }
    let cycle = win.__bossCycle ?? Math.ceil(farm / n)
    cycle = Math.max(1, Math.min(cycle, maxCycle))
    win.__bossCycle = cycle

    const open = uiFlag('__foldBossPick')
    return `<div class="panel compact-panel">
      <div class="section-head">
        <div>
          <div class="section-title">掛機 · 第 ${formatNum(farm)} 層</div>
          <div class="muted">解鎖 ${formatNum(max)} · 輪迴 ${cycle}/${maxCycle}</div>
        </div>
        ${foldBtn('__foldBossPick', '收起選關', '展開選關')}
      </div>
      ${
        open
          ? `<div class="btn-row" style="margin-top:8px">
        <button class="btn" data-act="bosscycle" data-delta="-1" ${cycle <= 1 ? 'disabled' : ''}>上一輪</button>
        <span class="tag on">輪迴 ${cycle}</span>
        <button class="btn" data-act="bosscycle" data-delta="1" ${cycle >= maxCycle ? 'disabled' : ''}>下一輪</button>
      </div>
      <div class="floor-pick-grid compact-picks">
        ${pool
          .map((c, i) => {
            const floor = (cycle - 1) * n + i + 1
            const locked = floor > max
            const active = farm === floor
            return `<button class="floor-pick ${active ? 'active' : ''} ${locked ? 'locked' : ''}" data-act="farmfloor" data-floor="${floor}" ${locked ? 'disabled' : ''}>
              <img src="${c.portrait}" alt="${c.name}" />
              <div class="fp-name">${nameSpan(c.name, c.rarity)}</div>
              <div class="fp-meta">${formatNum(floor)}F</div>
              ${locked ? '<div class="fp-lock">鎖</div>' : ''}
            </button>`
          })
          .join('')}
      </div>`
          : ''
      }
    </div>`
  }

  const push = state.pushMode[mode as 'main' | 'blueprint' | 'skill' | 'hunt']
  const open = uiFlag('__foldFarm')
  const berserking = !!state.battle?.berserk
  const huntHint =
    mode === 'hunt'
      ? ' · 主產破王徽'
      : mode === 'skill'
        ? ` · 同名技能本 · 通關冷卻${SKILL_DUNGEON_COOLDOWN_SEC}s`
        : ''
  const skillCd =
    mode === 'skill' && (state.skillDungeonCdLeft ?? 0) > 0
      ? ` · 冷卻 ${state.skillDungeonCdLeft}s`
      : ''
  return `<div class="panel compact-panel">
    <div class="section-head">
      <div>
        <div class="section-title">掛機 · ${formatNum(farm)}F · ${push === 'push' ? '沖層' : '原地'}</div>
        <div class="muted">解鎖 ${formatNum(max)} · 戰力 ${formatNum(buildEnemy(mode, farm).power)}${huntHint}${skillCd}${berserking ? ' · 暴走中' : ''}</div>
      </div>
      ${foldBtn('__foldFarm', '收起設定', '展開設定')}
    </div>
    ${
      open
        ? `<div class="btn-row" style="margin-top:8px">
      <button class="btn ${push === 'push' ? 'primary' : ''}" data-act="pushmode" data-mode="${mode}" data-push="push">沖層</button>
      <button class="btn ${push === 'stay' ? 'primary' : ''}" data-act="pushmode" data-mode="${mode}" data-push="stay">原地</button>
    </div>
    <div class="floor-num-row">
      <button class="btn" data-act="farmfloor-delta" data-delta="-1">−</button>
      <input class="floor-input" id="farm-floor-input" type="number" min="1" max="${max}" value="${farm}" />
      <button class="btn" data-act="farmfloor-delta" data-delta="1">＋</button>
      <button class="btn primary" data-act="farmfloor-max">最高</button>
    </div>`
        : ''
    }
  </div>`
}

function dropPanel(state: GameState, mode: 'boss' | 'godking'): string {
  const first = state.firstWin[mode]
  const ds = state.dropSettings[mode]
  const chars = mode === 'boss' ? BOSS_CHARACTERS : GODKING_CHARACTERS
  const skills = uniqueSkillsBySource(mode)
  const cycleInfo = currentCycleDropInfo(state, mode)
  const ratePct = (cycleInfo.rate * 100).toFixed(1)
  const aimCost = cycleInfo.aimCost
  const aimLabel =
    ds.aim === 'none' ? `空刷 ${ratePct}%` : ds.aim === 'character' ? '定向角色' : '定向技能'
  const open = uiFlag('__foldDrop')
  return `<div class="panel compact-panel">
    <div class="section-head">
      <div>
        <div class="section-title">掉落 · ${aimLabel}</div>
        <div class="muted">${first ? `卡 ${formatNum(state.resources.skillbook)} · 輪迴 ${cycleInfo.cycle}` : '首勝免費包待領'}</div>
      </div>
      ${foldBtn('__foldDrop', '收起掉落', '展開掉落')}
    </div>
    ${
      open
        ? `<div class="muted" style="margin-top:6px">${
            first
              ? `空刷免費機率掉；定向耗 ${formatNum(aimCost.crystal)} 水晶＋${formatNum(aimCost.skillbook)} 技能卡（隨輪迴遞增）`
              : '尚未首勝：下一勝必掉角色＋技能'
          }</div>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn ${ds.aim === 'none' ? 'primary' : ''}" data-act="dropaim" data-mode="${mode}" data-aim="none">空刷</button>
      <button class="btn ${ds.aim === 'character' ? 'primary' : ''}" data-act="dropaim" data-mode="${mode}" data-aim="character">定向角色</button>
      <button class="btn ${ds.aim === 'skill' ? 'primary' : ''}" data-act="dropaim" data-mode="${mode}" data-aim="skill">定向技能</button>
    </div>
    ${
      ds.aim === 'character'
        ? `<select class="input" style="min-height:auto;margin-top:8px" data-act="droptarget" data-mode="${mode}" data-kind="character">
            <option value="">隨機該池</option>
            ${chars.map((c) => `<option value="${c.id}" ${ds.targetId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>`
        : ''
    }
    ${
      ds.aim === 'skill'
        ? `<select class="input" style="min-height:auto;margin-top:8px" data-act="droptarget" data-mode="${mode}" data-kind="skill">
            <option value="">隨機該池</option>
            ${skills.map((s) => `<option value="${s.id}" ${ds.targetId === s.id ? 'selected' : ''}>${s.name}（${skillPowerLine(s)}）</option>`).join('')}
          </select>`
        : ''
    }`
        : ''
    }
  </div>`
}

function towerView(state: GameState): string {
  const b = state.battle
  const floor = farmFloorOf(state)
  const maxFloor = state.floors[state.idleMode]
  const lockedGod = state.floors.main < GODKING_UNLOCK
  const isBossTier = state.idleMode === 'boss' || state.idleMode === 'godking'
  const rarityLabel = state.idleMode === 'godking' ? '永恆' : state.idleMode === 'boss' ? '神話' : '普通'
  const enemyName = b?.enemy.name
    ? nameSpan(b.enemy.name, rarityLabel)
    : '無名殘影'

  const teamBlock = `
      <div class="team-row compact-team">
        ${state.formation
          .map((role) => {
            const ch = getRoleCharacter(state, role)
            if (!ch) {
              return `<div class="hero" data-hero-role="${role}">
              <div class="portrait-wrap">
                <div class="portrait ${role}"></div>
                <div class="battle-floater-layer" data-floater-layer></div>
              </div>
              <div class="meta"><div class="n">${ROLE_LABEL[role]}</div></div>
            </div>`
            }
            const def = CHAR_MAP[ch.defId]
            return `<div class="hero" data-hero-role="${role}">
              <div class="portrait-wrap">
                <img class="portrait ${role}" src="${def.portrait}" alt="${def.name}" loading="lazy" decoding="async" />
                <div class="battle-floater-layer" data-floater-layer></div>
              </div>
              <div class="meta">
                <div class="n">${nameSpan(def.name, ch.rarity)}</div>
              </div>
            </div>`
          })
          .join('')}
      </div>
      <div class="muted" style="margin-top:6px">隊伍戰力 ${formatNum(teamPower(state))}（含出戰技能）</div>
      <div class="bar shield" data-bar="team-shield" data-pct="${pctNum(b?.teamShield ?? 0, b?.teamMaxShield ?? 1).toFixed(1)}"><i></i></div>
      <div class="bar team" data-bar="team-hp" data-pct="${pctNum(b?.teamHp ?? 0, b?.teamMaxHp ?? 1).toFixed(1)}"><i></i></div>`

  const skillsPanel = `<div class="panel compact-panel">
      <div class="section-head">
        <div class="section-title">出戰技能</div>
        ${foldBtn('__foldSkills', '收起', '展開')}
      </div>
      ${
        uiFlag('__foldSkills')
          ? `<div class="skill-grid compact-skills" style="margin-top:8px">
        ${getTeamRoles(state)
          .map(({ role, ch }) => {
            const def = CHAR_MAP[ch.defId]
            return `<div class="skill-col">
              <h4>${nameSpan(def.name, ch.rarity)}</h4>
              <div class="skills" style="grid-template-columns:1fr">${KINDS.map((kind) => {
                const s = getEquippedSkill(state, role, kind)
                const sd = s ? SKILL_MAP[s.skillId] : undefined
                const cd = b?.skillCds?.[role]?.[kind] ?? 0
                const onCd = cd > 0
                const tip = sd ? skillEffectLine(sd) : ''
                const fx = sd ? skillPowerLine(sd) : ''
                const special = sd ? skillSpecialLine(sd) : ''
                return `<div class="skill skill-with-fx${onCd ? ' on-cd' : ''}" data-skill-cd data-role="${role}" data-kind="${kind}" style="border-color:${RARITY_COLOR[s?.rarity ?? '普通']}" title="${escapeHtml(tip)}"><div class="skill-name">${SKILL_KIND_LABEL[kind]} ${sd?.unique ? '★' : ''}${sd?.name ?? '—'}${s ? ` Lv.${s.level}` : ''}<span class="cd-badge" data-cd-badge>${onCd ? `CD${cd}` : ''}</span></div>${fx ? `<div class="skill-fx">${escapeHtml(fx)}${special ? ` · ${escapeHtml(special)}` : ''}</div>` : ''}</div>`
              }).join('')}</div>
            </div>`
          })
          .join('')}
      </div>`
          : ''
      }
    </div>`

  const battlePanel = isBossTier
    ? `<div class="panel battle-focus boss-stage">
      <div class="boss-stage-art" ${b?.enemy.portrait ? `style="background-image:url('${b.enemy.portrait}')"` : ''}></div>
      <div class="boss-stage-scrim"></div>
      <div class="boss-stage-meta">
        <div class="enemy-name">${enemyName}</div>
        <div class="muted">${b?.enemy.element ?? '-'} · 戰力 ${formatNum(b?.enemy.power ?? 0)} · ${formatNum(floor)}/${formatNum(maxFloor)}F</div>
        <div class="muted" data-battle-log>${b?.log ?? '準備戰鬥…'}</div>
        <div class="bar shield" data-bar="enemy-shield" data-pct="${pctNum(b?.enemy.shield ?? 0, b?.enemy.maxShield ?? 1).toFixed(1)}"><i></i></div>
        <div class="bar enemy" data-bar="enemy-hp" data-pct="${pctNum(b?.enemy.hp ?? 0, b?.enemy.maxHp ?? 1).toFixed(1)}"><i></i></div>
      </div>
      <div class="boss-stage-foot">
        ${teamBlock}
      </div>
    </div>`
    : `<div class="panel battle-focus">
      <div class="battle-top">
        ${
          b?.enemy.portrait
            ? `<img class="battle-enemy-pic" src="${b.enemy.portrait}" alt="" loading="lazy" decoding="async" />`
            : '<div class="battle-enemy-pic placeholder"></div>'
        }
        <div class="battle-enemy-meta">
          <div class="enemy-name">${enemyName}</div>
          <div class="muted">${b?.enemy.element ?? '-'} · 戰力 ${formatNum(b?.enemy.power ?? 0)} · ${formatNum(floor)}/${formatNum(maxFloor)}F</div>
          <div class="muted" data-battle-log>${b?.log ?? '準備戰鬥…'}</div>
          <div class="bar shield" data-bar="enemy-shield" data-pct="${pctNum(b?.enemy.shield ?? 0, b?.enemy.maxShield ?? 1).toFixed(1)}"><i></i></div>
          <div class="bar enemy" data-bar="enemy-hp" data-pct="${pctNum(b?.enemy.hp ?? 0, b?.enemy.maxHp ?? 1).toFixed(1)}"><i></i></div>
        </div>
      </div>
      ${teamBlock}
    </div>`

  return `
    <div class="mode-tabs">
      ${(['main', 'blueprint', 'skill', 'hunt', 'boss', 'godking'] as IdleMode[])
        .map((m) => {
          const lockedSkill = m === 'skill' && state.floors.main < SKILL_DUNGEON_UNLOCK
          const lockedHunt = m === 'hunt' && !actions.canUnlockHunt()
          const disabled = (m === 'godking' && lockedGod) || lockedSkill || lockedHunt
          const farm = state.farmFloor?.[m] ?? state.floors[m]
          const lockHint =
            m === 'godking' && lockedGod
              ? `(主塔${GODKING_UNLOCK})`
              : lockedSkill
                ? `(主塔${SKILL_DUNGEON_UNLOCK})`
                : lockedHunt
                  ? '(首通王階)'
                  : ''
          return `<button data-mode="${m}" class="${state.idleMode === m ? 'active' : ''}" ${disabled ? 'disabled' : ''}>${MODE_LABEL[m]}${lockHint}<br/><span class="muted">掛${formatNum(farm)}/解${formatNum(state.floors[m])}</span></button>`
        })
        .join('')}
    </div>
    ${floorSelectPanel(state)}
    ${isBossTier ? dropPanel(state, state.idleMode as 'boss' | 'godking') : ''}
    ${isBossTier && state.lastLootMsg ? `<div class="loot-chip muted">掉落：${state.lastLootMsg}</div>` : ''}
    ${battlePanel}
    ${skillsPanel}
  `
}

type TrainPage = 'team' | 'lounge' | 'dex'
type LoungeFilter = 'all' | Role
type ShopPage = 'hub' | 'gacha' | 'resource' | 'cards' | 'equip' | 'skills'
type ShopCardFilter = 'all' | Role
type ShopSkillFilter = 'all' | Role

function trainPage(): TrainPage {
  return (window as unknown as { __trainPage?: TrainPage }).__trainPage ?? 'team'
}

function shopPage(): ShopPage {
  return (window as unknown as { __shopPage?: ShopPage }).__shopPage ?? 'hub'
}

function shopCardFilter(): ShopCardFilter {
  return (window as unknown as { __shopCardFilter?: ShopCardFilter }).__shopCardFilter ?? 'all'
}

function shopSkillFilter(): ShopSkillFilter {
  return (window as unknown as { __shopSkillFilter?: ShopSkillFilter }).__shopSkillFilter ?? 'all'
}

function setShopPage(page: ShopPage) {
  ;(window as unknown as { __shopPage?: ShopPage }).__shopPage = page
}

function loungeFilter(): LoungeFilter {
  return (window as unknown as { __loungeFilter?: LoungeFilter }).__loungeFilter ?? 'all'
}

function levelButtons(ch: OwnedCharacter): string {
  const atCap = ch.level >= CHAR_LEVEL_MAX
  const room = Math.max(0, CHAR_LEVEL_MAX - ch.level)
  const n10 = Math.min(10, room)
  const cost1 = charLevelCost(ch.level)
  const cost10 = charLevelCostRange(ch.level, n10)
  const rebirth = ch.rebirth ?? 0
  const rbCost = charRebirthCost(rebirth)
  if (atCap) {
    const curTier = maxEquipTierForRebirth(rebirth)
    const after = rebirth + 1
    const nextTier = maxEquipTierForRebirth(after)
    const unlockHint =
      nextTier > curTier
        ? `本次轉生將解鎖 T${nextTier}`
        : `下一階裝備需轉生至質數 ${nextPrimeAfter(rebirth)} 次`
    return `
      <div class="btn-row" style="margin-top:8px">
        <button class="btn" disabled>已滿級 Lv.${CHAR_LEVEL_MAX}</button>
        <button class="btn primary" data-act="rebirth" data-id="${ch.uid}">轉生(${formatNum(rbCost.crystal)}水晶+${formatNum(rbCost.gold)}金鑽)</button>
      </div>
      <div class="muted" style="margin-top:4px">轉生後回 Lv.1，轉生次數+1。裝備階僅在轉生次數為質數時提升 · ${unlockHint}</div>`
  }
  return `
    <div class="btn-row" style="margin-top:8px">
      <button class="btn" data-act="level" data-id="${ch.uid}" data-times="1">+1(${formatNum(cost1)}水晶)</button>
      <button class="btn" data-act="level" data-id="${ch.uid}" data-times="10" ${n10 < 1 ? 'disabled' : ''}>+${n10 || 10}(${formatNum(cost10)}水晶)</button>
      <button class="btn primary" data-act="levelmax" data-id="${ch.uid}">升滿</button>
    </div>`
}

function charCard(state: GameState, ch: OwnedCharacter, opts?: { showDeploy?: boolean }): string {
  const def = CHAR_MAP[ch.defId]
  if (!def) return ''
  const stats = calcCharStats(state, ch)
  const deployed = fightingUids(state).has(ch.uid)
  const stack = Math.max(1, ch.count ?? 1)
  const ascendCost = charAscendCost(ch.ascend)
  const boostCost = charBoostCardCost(ch.boost ?? 0)
  const rebirth = ch.rebirth ?? 0
  const maxTier = maxEquipTierForRebirth(rebirth)
  const showDeploy = opts?.showDeploy ?? true
  return `<div class="card stack-card" data-char="${ch.uid}">
    <img src="${def.portrait}" alt="${def.name}" />
    <div class="body">
      <div class="title">${nameSpan(def.name, ch.rarity)} · ${raritySpan(ch.rarity)} · Lv.${ch.level}/${CHAR_LEVEL_MAX}</div>
      <div class="sub">${ROLE_LABEL[def.role]} · ${def.element} · 進階${ch.ascend} · 轉生${rebirth}（裝T${maxTier}）· 攻${formatNum(stats.atk)} 血${formatNum(stats.hp)} 防${formatNum(stats.def)} 盾${formatNum(stats.shield)}</div>
      <div class="sub">增效${ch.boost}（打工${workBoostMult(ch).toFixed(2)}x）· ${deployed ? '出戰' : ch.workJob ? WORK_LABEL[ch.workJob] : '閒置'}</div>
      ${levelButtons(ch)}
      <div class="btn-row" style="margin-top:8px">
        <button class="btn" data-act="ascend" data-id="${ch.uid}">進階(${formatNum(ascendCost)}神魂)</button>
        <button class="btn" data-act="boost" data-id="${ch.uid}" ${stack < boostCost + 1 ? 'disabled' : ''}>增效(耗${boostCost}張)</button>
        ${showDeploy ? `<button class="btn" data-act="deploy" data-id="${ch.uid}">${deployed ? '已出戰' : '出戰'}</button>` : ''}
      </div>
      <div class="stack-count">x${stack}</div>
    </div>
  </div>`
}

function roleSkillBlock(state: GameState, role: Role): string {
  const lo = state.loadouts[role]
  const ch = getRoleCharacter(state, role)
  const stack = Math.max(1, ch?.count ?? 1)
  const wornUids = new Set(KINDS.map((k) => lo.skills[k]).filter(Boolean) as string[])
  const bag = state.skillItems.filter((sk) => {
    const sd = SKILL_MAP[sk.skillId]
    return sd && sd.role === role && !wornUids.has(sk.uid)
  })

  const slots = KINDS.map((kind) => {
    const s = getEquippedSkill(state, role, kind)
    if (!s) {
      return `<div style="margin-top:8px"><div class="muted">${SKILL_KIND_LABEL[kind]} · 未裝備</div></div>`
    }
    const sd = SKILL_MAP[s.skillId]
    const upCost = skillUpgradeCost(s.level)
    const canAsc = !!nextRarity(s.rarity)
    const ascCost = skillAscendCost(s.rarity)
    const books = s.books ?? 0
    const canPayEssence = state.resources.essence >= upCost
    const canPayAsc = books >= ascCost
    const tip = sd ? skillEffectLine(sd) : ''
    return `<div style="margin-top:8px">
      <div class="muted">${SKILL_KIND_LABEL[kind]} ${sd?.unique ? '★' : ''}${sd?.name ?? '?'} ${raritySpan(s.rarity)} Lv.${s.level} · 技能本×${formatNum(books)}${sd?.source === 'antiKing' ? ' · 克制王階' : ''}</div>
      ${sd ? `<div class="sub" title="${escapeHtml(tip)}">${escapeHtml(skillPowerLine(sd))}${skillSpecialLine(sd) ? ` · ${escapeHtml(skillSpecialLine(sd))}` : ''}</div><div class="muted" style="font-size:11px">${escapeHtml(sd.desc)}</div>` : ''}
      <div class="btn-row" style="margin-top:4px">
        <button class="btn" data-act="skillup" data-id="${s.uid}" ${canPayEssence ? '' : 'disabled'}>升級(${formatNum(upCost)}精華)</button>
        ${
          canAsc
            ? `<button class="btn" data-act="skillasc" data-id="${s.uid}" ${canPayAsc ? '' : 'disabled'}>升階(${formatNum(ascCost)}同名本)</button>`
            : `<button class="btn" disabled>升階(已滿)</button>`
        }
        <button class="btn" data-act="skillunequip-role" data-role="${role}" data-kind="${kind}">卸下</button>
      </div>
    </div>`
  }).join('')

  const bagOpen = uiFlag('__foldSkillBag')
  const bagList =
    bag
      .map((sk) => {
        const sd = SKILL_MAP[sk.skillId]!
        const tip = skillEffectLine(sd)
        const bagUpCost = skillUpgradeCost(sk.level)
        const bagCanUp = state.resources.essence >= bagUpCost
        const bagAsc = nextRarity(sk.rarity)
        const bagAscCost = skillAscendCost(sk.rarity)
        const bagBooks = sk.books ?? 0
        const bagCanAsc = !!bagAsc && bagBooks >= bagAscCost
        return `<div class="row-item">
          <div class="row-main">${sd.unique ? '★' : ''}${sd.name} · ${raritySpan(sk.rarity)} Lv.${sk.level} · 技能本×${formatNum(bagBooks)}${sd.source === 'antiKing' ? ' · 克制王階' : ''}</div>
          <div class="sub" title="${escapeHtml(tip)}">${escapeHtml(skillPowerLine(sd))}${skillSpecialLine(sd) ? ` · ${escapeHtml(skillSpecialLine(sd))}` : ''}</div>
          <div class="muted" style="font-size:11px">${escapeHtml(sd.desc)}</div>
          <div class="btn-row">
            <button class="btn primary" data-act="skillequip-role" data-role="${role}" data-skill="${sk.uid}">裝上</button>
            <button class="btn" data-act="skillup" data-id="${sk.uid}" ${bagCanUp ? '' : 'disabled'}>升級(${formatNum(bagUpCost)}精華)</button>
            ${
              bagAsc
                ? `<button class="btn" data-act="skillasc" data-id="${sk.uid}" ${bagCanAsc ? '' : 'disabled'}>升階(${formatNum(bagAscCost)}同名本)</button>`
                : ''
            }
          </div>
        </div>`
      })
      .join('') || '<div class="muted">無庫存技能</div>'

  return `
    <div class="card"><div class="body">
      <div class="title">已裝技能 · 角色同名卡 x${stack}（增效用）</div>
      ${slots}
    </div></div>
    <div class="card" style="margin-top:8px"><div class="body">
      <div class="section-head">
        <div class="title">庫存（${bag.length}）</div>
        ${foldBtn('__foldSkillBag', '收起庫存', '展開庫存')}
      </div>
      ${bagOpen ? `<div class="list tight-list" style="margin-top:6px">${bagList}</div>` : ''}
    </div></div>`
}

function roleEquipBlock(state: GameState, role: Role): string {
  const lo = state.loadouts[role]
  const ch = getRoleCharacter(state, role)
  const list = state.equips.filter((eq) => {
    const p = parseEquipDefId(eq.defId)
    return p && p.role === role
  })
  const wornSlots = lo.equips ?? {}
  const bagOpen = uiFlag('__foldEquipBag')
  return `<div class="panel compact-panel">
    <div class="section-title">${ROLE_LABEL[role]} · 裝備</div>
    <div class="muted" style="margin-bottom:6px">${EQUIP_SLOTS.map((slot) => {
      const uidEq = wornSlots[slot]
      if (!uidEq) return `${EQUIP_SLOT_LABEL[slot]}—`
      const eq = state.equips.find((e) => e.uid === uidEq)
      const p = eq ? parseEquipDefId(eq.defId) : null
      if (!eq || !p) return EQUIP_SLOT_LABEL[slot]
      return `${EQUIP_SLOT_LABEL[slot]}T${p.tier}(${ownedEquipStatLine(eq)})`
    }).join(' · ')}</div>
    <div class="section-head">
      <div class="muted">背包 ${list.length}</div>
      ${foldBtn('__foldEquipBag', '收起背包', '展開背包')}
    </div>
    ${
      bagOpen
        ? `<div class="list tight-list" style="margin-top:6px">
      ${
        list
          .map((eq) => {
            const p = parseEquipDefId(eq.defId)
            if (!p) return ''
            const worn = wornSlots[p.slot] === eq.uid
            const wearLocked = !!ch && p.tier > maxEquipTierForRebirth(ch.rebirth ?? 0)
            const needRebirth = rebirthRequiredForEquipTier(p.tier)
            return `<div class="row-item">
              <div class="row-main">${EQUIP_SLOT_LABEL[p.slot]} T${p.tier} · ${raritySpan(eq.rarity)} +${eq.level}${worn ? ' · 穿' : ''}</div>
              <div class="sub">${ownedEquipStatLine(eq)}</div>
              <div class="btn-row">
                <button class="btn" data-act="equp" data-id="${eq.uid}">+Lv</button>
                <button class="btn" data-act="wear-role" data-role="${role}" data-id="${eq.uid}" ${wearLocked ? 'disabled' : ''}>${wearLocked ? `轉${needRebirth}` : '裝'}</button>
              </div>
            </div>`
          })
          .join('') || '<div class="muted">尚無裝備</div>'
      }
    </div>`
        : ''
    }
  </div>`
}

function roleRelicBlock(state: GameState, role: Role): string {
  const ch = getRoleCharacter(state, role)
  const rebirth = ch?.rebirth ?? 0
  const unlocked = relicsUnlockedByRebirth(rebirth, role)
  const cur = state.loadouts[role].relicId
  const inv = new Set(state.relicInventory ?? [])
  const options = RELICS.filter(
    (r) =>
      r.role === role &&
      (inv.has(r.id) || unlocked.some((u) => u.id === r.id) || cur === r.id),
  )
  return `<div class="panel">
    <div class="section-title">${ROLE_LABEL[role]} · 遺物</div>
    <div class="muted">職業特化遺物：僅本職可裝；依出戰角色轉生解鎖</div>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn ${!cur ? 'primary' : ''}" data-act="relic" data-role="${role}">卸下</button>
      ${options
        .map((r) => {
          const locked = rebirth < r.needRebirth && !inv.has(r.id)
          return `<button class="btn ${cur === r.id ? 'primary' : ''}" data-act="relic" data-role="${role}" data-relic="${r.id}" ${locked ? 'disabled' : ''} title="${escapeHtml(r.desc)}">${r.name}${locked ? `（需轉${r.needRebirth}）` : ''}</button>`
        })
        .join('')}
    </div>
    ${cur && RELIC_MAP[cur] ? `<div class="muted" style="margin-top:6px">目前：${RELIC_MAP[cur].name} — ${RELIC_MAP[cur].desc}</div>` : '<div class="muted" style="margin-top:6px">未裝備遺物</div>'}
  </div>`
}

function skillCastOrderPanel(state: GameState): string {
  const order = state.skillCastOrder ?? []
  const open = uiFlag('__foldCast')
  return `<div class="panel compact-panel">
    <div class="section-head">
      <div class="section-title">施法優先（每次出手一招）：${order.map((k) => SKILL_KIND_LABEL[k]).join('→')}</div>
      ${foldBtn('__foldCast', '收起', '調整')}
    </div>
    ${
      open
        ? order
            .map((kind, idx) => {
              return `<div class="btn-row" style="margin-top:6px">
          <span class="tag on">${idx + 1}. ${SKILL_KIND_LABEL[kind]}</span>
          <button class="btn" data-act="castup" data-kind="${kind}" ${idx <= 0 ? 'disabled' : ''}>↑</button>
          <button class="btn" data-act="castdown" data-kind="${kind}" ${idx >= order.length - 1 ? 'disabled' : ''}>↓</button>
        </div>`
            })
            .join('')
        : ''
    }
  </div>`
}

type TrainLoadoutTab = 'char' | 'skill' | 'equip' | 'relic'

function trainLoadoutTab(): TrainLoadoutTab {
  return ((window as unknown as { __trainLoadoutTab?: TrainLoadoutTab }).__trainLoadoutTab ??
    'char') as TrainLoadoutTab
}

function rebirthBonusPanel(state: GameState): string {
  return `<div class="panel">
    <div class="section-title">編年轉生加成</div>
    <div class="muted">各職業質數轉生門檻 × 人數達 3／6／9 解鎖格子，每格 +2% 該職戰力</div>
    ${(['warrior', 'mage', 'priest'] as Role[])
      .map((role) => {
        const roster = state.roster.filter((c) => CHAR_MAP[c.defId]?.role === role)
        const bonus = roleRebirthBonus(roster)
        const cells = countRebirthBonusCells(roster)
        const lit = cells.filter((c) => c.ok).length
        return `<div style="margin-top:10px">
          <div class="sub">${ROLE_LABEL[role]} · 已點亮 ${lit}/${cells.length} · 加成 +${(bonus * 100).toFixed(0)}%</div>
          <div class="tags" style="margin-top:4px">${cells
            .map((c) => `<span class="tag ${c.ok ? 'on' : ''}">≥${c.prime}轉×${c.count}人</span>`)
            .join('')}</div>
        </div>`
      })
      .join('')}
  </div>`
}

function sortByRank(list: OwnedCharacter[]): OwnedCharacter[] {
  return [...list].sort((a, b) => {
    const rd = rarityIndex(b.rarity) - rarityIndex(a.rarity)
    if (rd !== 0) return rd
    if (b.ascend !== a.ascend) return b.ascend - a.ascend
    if (b.level !== a.level) return b.level - a.level
    return CHAR_MAP[a.defId].name.localeCompare(CHAR_MAP[b.defId].name, 'zh-Hant')
  })
}

function selectedTrainRole(state: GameState): Role {
  const win = window as unknown as { __trainFocusRole?: Role }
  const roles = state.formation ?? (['warrior', 'mage', 'priest'] as Role[])
  if (win.__trainFocusRole && roles.includes(win.__trainFocusRole)) return win.__trainFocusRole
  const first = roles.find((r) => getRoleCharacter(state, r))
  win.__trainFocusRole = first ?? roles[0]
  return win.__trainFocusRole
}

function roleDeployPicker(state: GameState, role: Role): string {
  const pool = state.roster.filter((c) => CHAR_MAP[c.defId]?.role === role)
  if (!pool.length) return '<span class="muted">無此職角色</span>'
  return pool
    .map((ch) => {
      const def = CHAR_MAP[ch.defId]
      const active = state.loadouts[role].characterUid === ch.uid
      return `<button class="btn ${active ? 'primary' : ''}" data-act="deploy" data-id="${ch.uid}" title="${def.name}">${nameSpan(def.name, ch.rarity)}</button>`
    })
    .join('')
}

function trainTeamView(state: GameState): string {
  const focusRole = selectedTrainRole(state)
  const focus = getRoleCharacter(state, focusRole)
  const stack = focus ? Math.max(1, focus.count ?? 1) : 1
  const ascendCost = focus ? charAscendCost(focus.ascend) : 0
  const boostCost = focus ? charBoostCardCost(focus.boost ?? 0) : 1
  const rebirth = focus?.rebirth ?? 0
  const maxTier = maxEquipTierForRebirth(rebirth)
  const stats = focus ? calcCharStats(state, focus) : null
  const form = state.formation ?? (['warrior', 'mage', 'priest'] as Role[])
  const focusIdx = form.indexOf(focusRole)

  const tab = trainLoadoutTab()
  const tabBtn = (id: TrainLoadoutTab, label: string) =>
    `<button class="btn ${tab === id ? 'primary' : ''}" data-act="trainloadout" data-tab="${id}">${label}</button>`

  let body = ''
  if (!focus || !stats) {
    body = `<div class="panel">
      <div class="muted">此職尚未出戰</div>
      <div class="btn-row" style="margin-top:8px;flex-wrap:wrap">${roleDeployPicker(state, focusRole)}</div>
    </div>`
  } else if (tab === 'char') {
    body = `<div class="panel">
      <div class="section-title">${ROLE_LABEL[focusRole]} · ${nameSpan(CHAR_MAP[focus.defId].name, focus.rarity)}</div>
      <div class="sub">${CHAR_MAP[focus.defId].element} · Lv.${focus.level}/${CHAR_LEVEL_MAX} · 進階${focus.ascend} · 轉${rebirth}（T0～T${maxTier}）· 增效${focus.boost}</div>
      <div class="stats-row" style="margin-top:8px">
        <span>攻 ${formatNum(stats.atk)}</span>
        <span>血 ${formatNum(stats.hp)}</span>
        <span>防 ${formatNum(stats.def)}</span>
        <span>盾 ${formatNum(stats.shield)}</span>
      </div>
      ${levelButtons(focus)}
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" data-act="ascend" data-id="${focus.uid}">進階(${formatNum(ascendCost)}魂)</button>
        <button class="btn" data-act="boost" data-id="${focus.uid}" ${stack < boostCost + 1 ? 'disabled' : ''}>增效(耗${boostCost}張)·堆x${stack}</button>
      </div>
      <div class="muted" style="margin-top:8px">更換出戰</div>
      <div class="btn-row" style="margin-top:4px;flex-wrap:wrap">${roleDeployPicker(state, focusRole)}</div>
      ${skillCastOrderPanel(state)}
    </div>`
  } else if (tab === 'skill') {
    body = `<div class="panel"><div class="list">${roleSkillBlock(state, focusRole)}</div></div>`
  } else if (tab === 'equip') {
    body = roleEquipBlock(state, focusRole)
  } else {
    body = roleRelicBlock(state, focusRole)
  }

  return `
    <div class="panel train-sticky">
      <div class="section-head">
        <div>
          <div class="section-title">養成</div>
          <div class="muted">戰力 ${formatNum(teamPower(state))} · 隊長 ${ROLE_LABEL[state.captainRole]}</div>
        </div>
        <div class="btn-row">
          <button class="btn" data-act="trainpage" data-page="lounge">休息室</button>
          <button class="btn" data-act="trainpage" data-page="dex">圖鑑</button>
        </div>
      </div>
      <div class="train-portrait-row" style="margin-top:10px">
        ${form
          .map((role) => {
            const ch = getRoleCharacter(state, role)
            const def = ch ? CHAR_MAP[ch.defId] : null
            const active = role === focusRole
            const cap = state.captainRole === role
            if (!ch || !def) {
              return `<button class="train-pick empty ${active ? 'active' : ''}" data-act="trainfocus-role" data-role="${role}">
                <div class="train-pick-frame ${role}"></div>
                <div class="fp-meta">${ROLE_LABEL[role]}</div>
                <div class="fp-meta">空缺</div>
              </button>`
            }
            return `<button class="train-pick ${active ? 'active' : ''}" data-act="trainfocus-role" data-role="${role}">
              <img class="train-pick-frame ${role}" src="${def.portrait}" alt="${def.name}" />
              <div class="fp-name">${nameSpan(def.name, ch.rarity)}</div>
              <div class="fp-meta">Lv.${ch.level}${cap ? ' ·長' : ''}</div>
            </button>`
          })
          .join('')}
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn ${state.captainRole === focusRole ? 'primary' : ''}" data-act="captain" data-role="${focusRole}">${state.captainRole === focusRole ? '隊長' : '隊長'}</button>
        <button class="btn" data-act="formup" data-role="${focusRole}" ${focusIdx <= 0 ? 'disabled' : ''}>←</button>
        <button class="btn" data-act="formdown" data-role="${focusRole}" ${focusIdx < 0 || focusIdx >= form.length - 1 ? 'disabled' : ''}>→</button>
      </div>
      <div class="btn-row loadout-tabs" style="margin-top:8px">
        ${tabBtn('char', '角色')}
        ${tabBtn('skill', '技能')}
        ${tabBtn('equip', '裝備')}
        ${tabBtn('relic', '遺物')}
      </div>
    </div>
    ${body}
  `
}

function trainLoungeView(state: GameState): string {
  const filter = loungeFilter()
  const pool = sortByRank(
    state.roster.filter((ch) => {
      const def = CHAR_MAP[ch.defId]
      if (!def) return false
      return filter === 'all' || def.role === filter
    }),
  )
  const countOf = (role: Role) => state.roster.filter((c) => CHAR_MAP[c.defId]?.role === role).length

  return `
    ${rebirthBonusPanel(state)}
    <div class="panel">
      <div class="section-title">休息室</div>
      <div class="muted">升級／進階／增效／轉生 · 穿裝與技能請至出戰編隊</div>
      <button class="btn" data-act="trainpage" data-page="team" style="width:100%;margin-top:10px">返回出戰養成</button>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn ${filter === 'all' ? 'primary' : ''}" data-act="loungefilter" data-filter="all">全部 ${state.roster.length}</button>
        <button class="btn ${filter === 'warrior' ? 'primary' : ''}" data-act="loungefilter" data-filter="warrior">戰士 ${countOf('warrior')}</button>
        <button class="btn ${filter === 'mage' ? 'primary' : ''}" data-act="loungefilter" data-filter="mage">法師 ${countOf('mage')}</button>
        <button class="btn ${filter === 'priest' ? 'primary' : ''}" data-act="loungefilter" data-filter="priest">牧師 ${countOf('priest')}</button>
      </div>
    </div>
    ${(['warrior', 'mage', 'priest'] as Role[])
      .filter((role) => filter === 'all' || filter === role)
      .map((role) => {
        const list = sortByRank(pool.filter((ch) => CHAR_MAP[ch.defId]?.role === role))
        if (filter !== 'all' && list.length === 0) {
          return `<div class="panel"><div class="muted">此職業尚無角色</div></div>`
        }
        if (filter === 'all' && list.length === 0) return ''
        return `<div class="panel">
          <div class="section-title">${ROLE_LABEL[role]}（${list.length}）· 階級排序</div>
          <div class="list">${list.map((c) => charCard(state, c, { showDeploy: true })).join('')}</div>
        </div>`
      })
      .join('') || '<div class="panel"><div class="muted">尚無角色</div></div>'}
  `
}

function trainView(state: GameState): string {
  const page = trainPage()
  if (page === 'lounge') return trainLoungeView(state)
  if (page === 'dex') return dexView(state)
  return trainTeamView(state)
}

function shopHubView(state: GameState): string {
  const owned = state.roster.length
  const tier = actions.availableEquipTiers()
  return `
    <div class="panel">
      <div class="section-title">商店</div>
      <p class="muted">選擇分類進入。持有金鑽 ${formatNum(state.resources.gold)}</p>
    </div>
    <div class="station-grid">
      <button class="station-card tap-target" data-act="shoppage" data-page="gacha">
        <div class="station-head">
          <div class="station-title">異塔招募</div>
          <div class="station-count">抽卡</div>
        </div>
        <div class="station-desc">單抽／10連／100連 · ${GACHA_COST_ONE}/${GACHA_COST_TEN}/${GACHA_COST_HUNDRED} 金鑽</div>
      </button>
      <button class="station-card tap-target" data-act="shoppage" data-page="resource">
        <div class="station-head">
          <div class="station-title">資源兌換</div>
          <div class="station-count">6 類</div>
        </div>
        <div class="station-desc">水晶、藍圖、熔鍛、精華、技能卡、神魂</div>
      </button>
      <button class="station-card tap-target" data-act="shoppage" data-page="cards">
        <div class="station-head">
          <div class="station-title">同名卡兌換</div>
          <div class="station-count">${owned} 名</div>
        </div>
        <div class="station-desc">高額金鑽兌換已擁有角色堆疊 · 依職業分類</div>
      </button>
      <button class="station-card tap-target" data-act="shoppage" data-page="equip">
        <div class="station-head">
          <div class="station-title">裝備說明</div>
          <div class="station-count">T${tier}</div>
        </div>
        <div class="station-desc">打造在後勤 · 藍圖＋熔鍛＋金鑽 · 品質機率</div>
      </button>
      <button class="station-card tap-target" data-act="shoppage" data-page="skills">
        <div class="station-head">
          <div class="station-title">基礎技能</div>
          <div class="station-count">${shopSkillCatalog().length}</div>
        </div>
        <div class="station-desc">各職攻／防／輔 · 顯示係數／特效 · 含克制王階預覽</div>
      </button>
    </div>
  `
}

function shopBackBtn(): string {
  return `<button class="btn tap-target" data-act="shoppage" data-page="hub" style="width:100%;margin-bottom:10px">← 返回商店分類</button>`
}

function shopGachaView(state: GameState): string {
  return `
    <div class="panel">
      ${shopBackBtn()}
      <div class="section-title">異塔招募</div>
      <p class="muted">36 名（每職 12：普通／史詩／傳奇）。單抽 ${GACHA_COST_ONE} · 10連 ${GACHA_COST_TEN} · 100連 ${GACHA_COST_HUNDRED} 金鑽。</p>
      <div class="btn-row">
        <button class="btn primary" data-act="gacha" data-times="1">單抽（${GACHA_COST_ONE}金鑽）</button>
        <button class="btn primary" data-act="gacha" data-times="10">10連（${GACHA_COST_TEN}金鑽）</button>
        <button class="btn primary" data-act="gacha" data-times="100">100連（${GACHA_COST_HUNDRED}金鑽）</button>
      </div>
      <div class="muted" style="margin-top:8px">持有金鑽：${formatNum(state.resources.gold)}</div>
    </div>
  `
}

function shopResourceView(state: GameState): string {
  const shopItems = (Object.keys(SHOP_RATES) as (keyof Resources)[]).filter((k) => k !== 'gold')
  return `
    <div class="panel">
      ${shopBackBtn()}
      <div class="section-title">資源兌換</div>
      <div class="muted">輸入數量後兌換。比例＝每 1 單位資源所需金鑽 · 持有金鑽 ${formatNum(state.resources.gold)}</div>
      <div class="list" style="margin-top:8px">
        ${shopItems
          .map((key) => {
            const meta = RESOURCE_META.find((m) => m.key === key)!
            const rate = SHOP_RATES[key]!
            return `<div class="card"><div class="body">
              <div class="title" style="color:${RARITY_COLOR[meta.rarity]}">${meta.name}</div>
              <div class="sub">兌換比例：1 ${meta.name} = ${rate} 金鑽 · 持有 ${formatNum(state.resources[key])}</div>
              <div class="floor-num-row">
                <input class="floor-input shop-qty" data-shop-res="${key}" type="number" min="1" value="1" />
                <button class="btn primary" data-act="shop" data-res="${key}">兌換</button>
              </div>
              <div class="muted shop-cost" data-shop-cost="${key}">預估：${rate} 金鑽</div>
            </div></div>`
          })
          .join('')}
      </div>
    </div>
  `
}

function shopCardsView(state: GameState): string {
  const filter = shopCardFilter()
  const ownedCards = [...state.roster]
    .filter((ch) => {
      const def = CHAR_MAP[ch.defId]
      if (!def) return false
      return filter === 'all' || def.role === filter
    })
    .sort((a, b) => {
      const rd = rarityIndex(b.rarity) - rarityIndex(a.rarity)
      if (rd !== 0) return rd
      return (CHAR_MAP[a.defId]?.name ?? '').localeCompare(CHAR_MAP[b.defId]?.name ?? '', 'zh-Hant')
    })
  const countOf = (role: Role) => state.roster.filter((c) => CHAR_MAP[c.defId]?.role === role).length

  return `
    <div class="panel">
      ${shopBackBtn()}
      <div class="section-title">同名卡高額兌換</div>
      <div class="muted">僅限已擁有角色。金鑽大量消耗換取堆疊，供增效 · 持有金鑽 ${formatNum(state.resources.gold)}</div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn ${filter === 'all' ? 'primary' : ''}" data-act="shopcardfilter" data-filter="all">全部 ${state.roster.length}</button>
        <button class="btn ${filter === 'warrior' ? 'primary' : ''}" data-act="shopcardfilter" data-filter="warrior">戰士 ${countOf('warrior')}</button>
        <button class="btn ${filter === 'mage' ? 'primary' : ''}" data-act="shopcardfilter" data-filter="mage">法師 ${countOf('mage')}</button>
        <button class="btn ${filter === 'priest' ? 'primary' : ''}" data-act="shopcardfilter" data-filter="priest">牧師 ${countOf('priest')}</button>
      </div>
    </div>
    <div class="list">
      ${
        ownedCards.length
          ? ownedCards
              .map((ch) => {
                const def = CHAR_MAP[ch.defId]
                if (!def) return ''
                const unit = ownedCardShopCost(ch.rarity)
                const stack = Math.max(1, ch.count ?? 1)
                return `<div class="card"><div class="body">
                  <div class="title">${nameSpan(def.name, ch.rarity)} · ${raritySpan(ch.rarity)}</div>
                  <div class="sub">${ROLE_LABEL[def.role]} · 持有 x${stack} · 單張 ${formatNum(unit)} 金鑽</div>
                  <div class="floor-num-row">
                    <input class="floor-input shop-card-qty" data-card-id="${ch.defId}" type="number" min="1" value="1" />
                    <button class="btn primary" data-act="shopcard" data-id="${ch.defId}">兌換同名卡</button>
                  </div>
                  <div class="muted shop-card-cost" data-shop-card-cost="${ch.defId}">預估：${formatNum(unit)} 金鑽</div>
                </div></div>`
              })
              .join('')
          : '<div class="panel"><div class="muted">此分類尚無已擁有角色</div></div>'
      }
    </div>
  `
}

function shopEquipView(state: GameState): string {
  const tier = actions.availableEquipTiers()
  const bp = equipBlueprintCost(tier)
  const craft = equipCraftCost(tier)
  const mainFloor = state.floors.main
  const nextUnlockFloor = nextBlueprintUnlockFloor(mainFloor)
  return `
    <div class="panel">
      ${shopBackBtn()}
      <div class="section-title">裝備打造說明</div>
      <div class="muted">品質於<strong>後勤 → 裝備打造</strong>以藍圖＋熔鍛＋金鑽鍛造，依機率出品質（非事後升品）。強化只加等級。</div>
      <div class="muted" style="margin-top:6px">目前可打造 T${tier} · 下一階需主塔 ${formatNum(nextUnlockFloor)} 層</div>
      <div class="muted" style="margin-top:4px">T${tier} 單件約：${formatNum(bp)} 藍圖＋${formatNum(craft.forge)} 熔鍛＋${formatNum(craft.gold)} 金鑽</div>
      <div class="muted" style="margin-top:8px">T${tier} 基礎屬性（普通 Lv.0，品質／強化會再乘算）：</div>
      <div class="list tight-list" style="margin-top:4px">
        ${EQUIP_SLOTS.map((slot) => {
          const sample = makeEquipDef('warrior', slot, tier)
          return `<div class="row-item"><div class="row-main">${EQUIP_SLOT_LABEL[slot]} · ${equipStatLine(sample.bonus)}</div></div>`
        }).join('')}
      </div>
      <button class="btn primary" data-act="goto-craft" style="width:100%;margin-top:10px">前往後勤打造</button>
    </div>
  `
}

function logisticsCraftSection(state: GameState): string {
  const tier = actions.availableEquipTiers()
  const bp = equipBlueprintCost(tier)
  const craft = equipCraftCost(tier)
  const open = uiFlag('__foldCraft')
  return `<div class="panel compact-panel">
    <div class="section-head">
      <div>
        <div class="section-title">裝備打造 · T${tier}</div>
        <div class="muted">${formatNum(bp)}藍圖＋${formatNum(craft.forge)}熔鍛＋${formatNum(craft.gold)}金鑽 · 品質機率</div>
      </div>
      ${foldBtn('__foldCraft', '收起', '展開')}
    </div>
    ${
      open
        ? `<div class="muted" style="margin-top:6px">持有 藍圖 ${formatNum(state.resources.blueprint)} · 熔鍛 ${formatNum(state.resources.forge)} · 金鑽 ${formatNum(state.resources.gold)}</div>
    <div class="list" style="margin-top:8px">
      ${(['warrior', 'mage', 'priest'] as Role[])
        .map(
          (role) => `<div class="card"><div class="body">
            <div class="title">${ROLE_LABEL[role]} · T${tier}</div>
            <div class="btn-row" style="margin-top:6px;flex-wrap:wrap">
              ${EQUIP_SLOTS.map((slot) => {
                const sample = makeEquipDef(role, slot, tier)
                return `<button class="btn" data-act="crafteq" data-role="${role}" data-slot="${slot}" data-tier="${tier}" title="${escapeHtml(equipStatLine(sample.bonus))}">${EQUIP_SLOT_LABEL[slot]}<br/><span class="muted" style="font-size:10px">${equipStatLine(sample.bonus)}</span></button>`
              }).join('')}
            </div>
          </div></div>`,
        )
        .join('')}
    </div>`
        : ''
    }
  </div>`
}

function shopSkillsView(state: GameState): string {
  const filter = shopSkillFilter()
  const catalog = shopSkillCatalog().filter((x) => filter === 'all' || x.def.role === filter)
  const countOf = (role: Role) => shopSkillCatalog().filter((x) => x.def.role === role).length
  const antiPool = antiKingSkills().filter((d) => filter === 'all' || d.role === filter)
  const ownedAnti = new Set(
    state.skillItems.filter((s) => SKILL_MAP[s.skillId]?.source === 'antiKing').map((s) => s.skillId),
  )
  const cost = ANTI_KING_EXCHANGE_COST
  const canPay =
    (state.resources.kingBadge ?? 0) >= cost.kingBadge &&
    state.resources.skillbook >= cost.skillbook &&
    state.resources.crystal >= cost.crystal
  return `
    <div class="panel">
      ${shopBackBtn()}
      <div class="section-title">基礎技能商店</div>
      <div class="muted">各職業攻擊／防禦／輔助 · 僅最初階（普通）與次階（稀有）。史詩以上需王塔／神王掉落 · 持有金鑽 ${formatNum(state.resources.gold)}</div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn ${filter === 'all' ? 'primary' : ''}" data-act="shopskillfilter" data-filter="all">全部 ${shopSkillCatalog().length}</button>
        <button class="btn ${filter === 'warrior' ? 'primary' : ''}" data-act="shopskillfilter" data-filter="warrior">戰士 ${countOf('warrior')}</button>
        <button class="btn ${filter === 'mage' ? 'primary' : ''}" data-act="shopskillfilter" data-filter="mage">法師 ${countOf('mage')}</button>
        <button class="btn ${filter === 'priest' ? 'primary' : ''}" data-act="shopskillfilter" data-filter="priest">牧師 ${countOf('priest')}</button>
      </div>
    </div>
    <div class="panel">
      <div class="section-title">克制王階</div>
      <div class="muted">專克王塔／神王。首通王階可自選 1 枚；其餘以破王徽＋技能卡兌換。討伐訓練主產破王徽。持有 破王徽 ${formatNum(state.resources.kingBadge ?? 0)} · 技能卡 ${formatNum(state.resources.skillbook)} · 水晶 ${formatNum(state.resources.crystal)}</div>
      <div class="muted" style="margin-top:4px">兌換價：破王徽 ${formatNum(cost.kingBadge)}＋技能卡 ${formatNum(cost.skillbook)}＋水晶 ${formatNum(cost.crystal)}</div>
      <div class="list" style="margin-top:8px">
        ${antiPool
          .map((def) => {
            const owned = ownedAnti.has(def.id)
            const tip = skillEffectLine(def)
            return `<div class="card ${owned ? '' : 'locked-soft'}"><div class="body">
              <div class="title">${ROLE_LABEL[def.role]} · ${SKILL_KIND_LABEL[def.kind]} · ★${def.name}${owned ? '' : ' · 未持有'}</div>
              <div class="sub" title="${escapeHtml(tip)}">${escapeHtml(skillPowerLine(def))}${skillSpecialLine(def) ? ` · ${escapeHtml(skillSpecialLine(def))}` : ''}</div>
              <div class="muted">${escapeHtml(def.desc)}</div>
              <div class="btn-row" style="margin-top:6px">
                ${
                  owned
                    ? `<button class="btn" disabled>已持有 · 請至養成升級／升階</button>`
                    : `<button class="btn primary" data-act="exchange-antiking" data-skill="${def.id}" ${canPay ? '' : 'disabled'}>兌換</button>`
                }
              </div>
            </div></div>`
          })
          .join('')}
      </div>
    </div>
    <div class="list">
      ${catalog
        .map(({ def, rarity }) => {
          const cost = shopSkillCost(rarity)
          const tip = skillEffectLine(def)
          return `<div class="card"><div class="body">
            <div class="title">${ROLE_LABEL[def.role]} · ${SKILL_KIND_LABEL[def.kind]} · ${def.name}</div>
            <div class="sub" title="${escapeHtml(tip)}">${raritySpan(rarity)} · ${escapeHtml(skillPowerLine(def))}</div>
            <div class="muted">${escapeHtml(def.desc)}</div>
            <div class="btn-row" style="margin-top:6px">
              <button class="btn primary" data-act="buyskill" data-skill="${def.id}" data-rarity="${rarity}">購買(${formatNum(cost)}金鑽)</button>
            </div>
          </div></div>`
        })
        .join('')}
    </div>
  `
}

function gachaView(state: GameState): string {
  const page = shopPage()
  if (page === 'gacha') return shopGachaView(state)
  if (page === 'resource') return shopResourceView(state)
  if (page === 'cards') return shopCardsView(state)
  if (page === 'equip') return shopEquipView(state)
  if (page === 'skills') return shopSkillsView(state)
  return shopHubView(state)
}

function logisticsDispatchSection(state: GameState): string {
  const fighting = fightingUids(state)
  const available = state.roster.filter(
    (ch) => !fighting.has(ch.uid) && !ch.workJob && !isOnDispatch(ch),
  )
  const active = (state.dispatches ?? []).filter((d) => d.endsAt > Date.now())
  const cap = dispatchSlotCap(state.floors.main)
  const full = active.length >= cap
  const open = uiFlag('__foldDispatch')
  return `<div class="panel compact-panel">
    <div class="section-head">
      <div>
        <div class="section-title">遠征派遣</div>
        <div class="muted">席位 ${active.length}/${cap} · 可派 ${available.length} · 獎勵隨主塔遞增</div>
      </div>
      ${foldBtn('__foldDispatch', '收起', '展開')}
    </div>
    ${
      open
        ? `${
            active.length
              ? `<div class="list tight-list" style="margin-top:8px">${active
                  .map(
                    (d) =>
                      `<div class="muted">· ${escapeHtml(d.label)} · 剩 ${formatDuration(Math.max(0, Math.ceil((d.endsAt - Date.now()) / 1000)))}</div>`,
                  )
                  .join('')}</div>`
              : ''
          }
    ${
      full
        ? '<div class="muted" style="margin-top:6px">派遣席位已滿</div>'
        : available.length
          ? `<div class="list tight-list" style="margin-top:8px">${available
              .map((ch) => {
                const def = CHAR_MAP[ch.defId]
                return `<div class="row-item">
                <div class="row-main">${nameSpan(def.name, ch.rarity)}</div>
                <div class="btn-row">
                  ${DISPATCH_OPTIONS.map((o) => {
                    const scaled = scaleDispatchReward(o.reward, state.floors.main)
                    const tip = Object.entries(scaled)
                      .filter(([, v]) => v)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(' ')
                    return `<button class="btn" data-act="dispatch" data-id="${ch.uid}" data-hours="${o.hours}" title="${tip}">${o.hours}h</button>`
                  }).join('')}
                </div>
              </div>`
              })
              .join('')}</div>`
          : '<div class="muted" style="margin-top:6px">無可派遣角色</div>'
    }`
        : ''
    }
  </div>`
}

function logisticsOrdersSection(state: GameState): string {
  const orders = state.orders ?? []
  return `<div class="panel">
    <div class="section-title">後勤訂單</div>
    <div class="muted">交付資源換獎勵 · 完成後 30 秒刷新</div>
    <div class="list" style="margin-top:8px">
      ${
        orders.length
          ? orders
              .map((o) => {
                const req = RESOURCE_META.find((m) => m.key === o.reqKey)!
                const rew = RESOURCE_META.find((m) => m.key === o.rewardKey)!
                const onCd = o.refreshAt > Date.now()
                const can =
                  !onCd && (state.resources[o.reqKey] ?? 0) >= o.reqAmount
                return `<div class="card"><div class="body">
                  <div class="title">需 ${formatNum(o.reqAmount)} ${req.name}</div>
                  <div class="sub">獎勵 ${formatNum(o.rewardAmount)} ${rew.name}${onCd ? ` · 冷卻 ${formatDuration(Math.ceil((o.refreshAt - Date.now()) / 1000))}` : ''}</div>
                  <button class="btn primary" data-act="order" data-id="${o.id}" ${can ? '' : 'disabled'} style="margin-top:6px">交付</button>
                </div></div>`
              })
              .join('')
          : '<div class="muted">訂單載入中…</div>'
      }
    </div>
  </div>`
}

function logisticsStationsView(state: GameState): string {
  const fighting = fightingUids(state)
  const mtBonus = (mainTowerWorkBonus(state.floors.main) * 100).toFixed(0)
  const stationCap = workStationCap(state.floors.main)
  return `
    <div class="panel compact-panel">
      <div class="section-title">後勤工位</div>
      <div class="muted">每工位最多 ${stationCap} 人 · 每 ${WORK_BATCH_SEC} 秒一批 · 主塔 +${mtBonus}% · 戰熔鍛／法書／牧魂 +25%</div>
    </div>
    <div class="station-grid">
      ${WORK_JOBS.map((job) => {
        const workers = state.roster.filter((ch) => ch.workJob === job && !fighting.has(ch.uid))
        const previews = workers.slice(0, 3)
        const resKey = WORK_RES_KEY[job]
        const resMeta = RESOURCE_META.find((m) => m.key === resKey)
        const specRole =
          job === 'forge' ? 'warrior' : job === 'skillbook' ? 'mage' : job === 'soul' ? 'priest' : null
        const specTag = specRole
          ? `<span class="tag on">${ROLE_LABEL[specRole]}+</span>`
          : ''
        return `<button class="station-card tap-target" data-act="logistics-open" data-job="${job}">
          <div class="station-head">
            <div class="station-title">${WORK_LABEL[job]} ${specTag}</div>
            <div class="station-count">${workers.length}/${stationCap}</div>
          </div>
          <div class="station-portraits">
            ${
              previews.length
                ? previews
                    .map((ch) => {
                      const def = CHAR_MAP[ch.defId]
                      return `<img src="${def.portrait}" alt="${def.name}" />`
                    })
                    .join('')
                : '<span class="station-empty">空</span>'
            }
            ${workers.length > 3 ? `<span class="station-more">+${workers.length - 3}</span>` : ''}
          </div>
          <div class="station-res" style="color:${RARITY_COLOR[resMeta?.rarity ?? '普通']}">
            ${formatNum(state.resources[resKey])}
          </div>
        </button>`
      }).join('')}
    </div>
    ${logisticsCraftSection(state)}
    ${logisticsOrdersSection(state)}
    ${logisticsDispatchSection(state)}
  `
}

function logisticsDetailView(state: GameState, job: WorkJob): string {
  const fighting = fightingUids(state)
  const stationCap = workStationCap(state.floors.main)
  const workers = state.roster.filter((ch) => ch.workJob === job && !fighting.has(ch.uid))
  const available = state.roster.filter((ch) => !fighting.has(ch.uid) && ch.workJob !== job)
  const full = workers.length >= stationCap
  const resKey = WORK_RES_KEY[job]
  const resMeta = RESOURCE_META.find((m) => m.key === resKey)

  return `
    <div class="panel">
      <button class="btn tap-target" data-act="logistics-back" style="width:100%;margin-bottom:10px">← 返回工位列表</button>
      <div class="section-title">${WORK_LABEL[job]}工位</div>
      <p class="muted">${WORK_DESC[job]} · ${resMeta?.name ?? ''} 庫存 ${formatNum(state.resources[resKey])}</p>
      <p class="muted">在職 ${workers.length}/${stationCap} · 超出人數不產物（依增效／等級優先）</p>
    </div>
    <div class="panel">
      <div class="section-title">在職員工</div>
      ${
        workers.length
          ? `<div class="list">${workers
              .map((ch) => {
                const def = CHAR_MAP[ch.defId]
                return `<div class="card stack-card">
                  <img src="${def.portrait}" alt="${def.name}" />
                  <div class="body">
                    <div class="title">${nameSpan(def.name, ch.rarity)} · Lv.${ch.level}</div>
                    <div class="sub">增效${ch.boost}（${workBoostMult(ch).toFixed(2)}x）· ${ROLE_LABEL[def.role]}</div>
                    <div class="btn-row" style="margin-top:6px">
                      <button class="btn tap-target" data-act="work" data-id="${ch.uid}">撤下</button>
                    </div>
                    <div class="stack-count">x${Math.max(1, ch.count ?? 1)}</div>
                  </div>
                </div>`
              })
              .join('')}</div>`
          : '<p class="muted">尚無員工，從下方選擇角色加入。</p>'
      }
    </div>
    <div class="panel">
      <div class="section-title">可指派角色</div>
      ${
        available.length
          ? `<div class="list">${available
              .map((ch) => {
                const def = CHAR_MAP[ch.defId]
                const elsewhere = ch.workJob ? WORK_LABEL[ch.workJob] : '閒置'
                return `<div class="card stack-card">
                  <img src="${def.portrait}" alt="${def.name}" />
                  <div class="body">
                    <div class="title">${nameSpan(def.name, ch.rarity)} · Lv.${ch.level}</div>
                    <div class="sub">${ROLE_LABEL[def.role]} · ${elsewhere} · 增效${ch.boost}</div>
                    <div class="btn-row" style="margin-top:6px">
                      <button class="btn primary tap-target" data-act="work" data-id="${ch.uid}" data-job="${job}" ${full ? 'disabled' : ''}>${full ? '工位已滿' : '加入工位'}</button>
                    </div>
                    <div class="stack-count">x${Math.max(1, ch.count ?? 1)}</div>
                  </div>
                </div>`
              })
              .join('')}</div>`
          : '<p class="muted">沒有可指派角色（出戰中或已全在此工位）。</p>'
      }
    </div>
  `
}

function logisticsView(state: GameState): string {
  const job = logisticsJob()
  if (logisticsPage() === 'detail' && job) return logisticsDetailView(state, job)
  return logisticsStationsView(state)
}

type DexFilter = 'all' | Role

function dexPool(filter: DexFilter) {
  if (filter === 'all') return CHARACTERS
  return CHARACTERS.filter((c) => c.role === filter)
}

function dexView(state: GameState): string {
  const activeFilter = (window as unknown as { __dexFilter?: DexFilter }).__dexFilter ?? 'all'
  const pool = dexPool(activeFilter)
  const owned = new Set(state.dex)
  const got = pool.filter((c) => owned.has(c.id)).length
  const seriesLabel = (s?: string) =>
    s === 'boss' ? '王塔首領' : s === 'godking-zodiac' ? '異域神王·黃道' : '招募'
  const roleCount = (role: Role) => CHARACTERS.filter((c) => c.role === role).length
  const roleGot = (role: Role) => CHARACTERS.filter((c) => c.role === role && owned.has(c.id)).length

  return `
    <div class="panel">
      <button class="btn tap-target" data-act="trainpage" data-page="team" style="width:100%;margin-bottom:10px">← 返回出戰養成</button>
      <div class="section-title">角色圖鑑</div>
      <div class="muted">已收集 ${owned.size}／${CHARACTERS.length} · 本頁 ${got}／${pool.length} · 戰力次要加成 +${(owned.size * 0.5).toFixed(1)}%</div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn ${activeFilter === 'all' ? 'primary' : ''}" data-act="dexfilter" data-filter="all">全部</button>
        <button class="btn ${activeFilter === 'warrior' ? 'primary' : ''}" data-act="dexfilter" data-filter="warrior">戰士 ${roleGot('warrior')}/${roleCount('warrior')}</button>
        <button class="btn ${activeFilter === 'mage' ? 'primary' : ''}" data-act="dexfilter" data-filter="mage">法師 ${roleGot('mage')}/${roleCount('mage')}</button>
        <button class="btn ${activeFilter === 'priest' ? 'primary' : ''}" data-act="dexfilter" data-filter="priest">牧師 ${roleGot('priest')}/${roleCount('priest')}</button>
      </div>
    </div>
    <div class="dex-grid">
      ${pool
        .map((c) => {
          const unlocked = owned.has(c.id)
          return unlocked
            ? `<button class="dex-card" data-act="dexpreview" data-id="${c.id}">
            <img src="${c.portrait}" alt="${c.name}" />
            <div class="dex-name">${nameSpan(c.name, c.rarity)}</div>
            <div class="dex-meta">${ROLE_LABEL[c.role]} · ${c.element}</div>
            <div class="dex-meta">${raritySpan(c.rarity)}</div>
            <div class="dex-meta">${seriesLabel(c.series)}</div>
          </button>`
            : `<div class="dex-card locked">
            <img src="${c.portrait}" alt="" class="sil" />
            <div class="dex-name">？？？</div>
            <div class="dex-meta">未收集</div>
          </div>`
        })
        .join('')}
    </div>
  `
}

function portraitLightbox(): string {
  const id = (window as unknown as { __dexPreview?: string }).__dexPreview
  if (!id || !CHAR_MAP[id]) return ''
  const c = CHAR_MAP[id]
  return `<div class="portrait-lightbox" data-act="dexpreview-close">
    <div class="portrait-lightbox-inner" data-stop="1">
      <div class="pli-scroll">
        <img src="${c.portrait}" alt="${c.name}" />
        <div class="pli-name">${nameSpan(c.name, c.rarity)}</div>
        <div class="pli-meta">${ROLE_LABEL[c.role]} · ${c.element} · ${raritySpan(c.rarity)}</div>
        <div class="pli-desc">${c.desc}</div>
      </div>
      <button class="btn primary pli-close" data-act="dexpreview-close">關閉</button>
    </div>
  </div>`
}

function gameGuideModal(): string {
  if (!(window as unknown as { __showGuide?: boolean }).__showGuide) return ''
  return `<div class="modal guide-modal" data-act="guide-close"><div class="sheet" data-stop="1">
    <h3>遊戲引導</h3>
    <div class="muted" style="text-align:left;line-height:1.55;max-height:55vh;overflow-y:auto">
      <p><strong>爬塔</strong>：主塔／副塔／技能本／討伐訓練可沖層或原地刷（副塔／技能本／討伐每 5 層小首領）；技能本每層難度大幅上升，通關掉數本<strong>同名技能本</strong>（隨機分給已持有技能）並冷卻 ${SKILL_DUNGEON_COOLDOWN_SEC} 秒（主塔 ${SKILL_DUNGEON_UNLOCK} 解鎖）；討伐訓練主產破王徽（首通王階後解鎖）。戰敗會扣水晶／金鑽。王塔／神王可空刷（低機率）或定向（水晶＋技能卡隨輪迴遞增）；資源不足會改回空刷。</p>
      <p><strong>職業編隊</strong>：戰士、法師、牧師各有獨立 loadout——出戰角色、七部位裝備、三技能格、遺物。換角色不改裝備配置。</p>
      <p><strong>裝備</strong>：後勤打造（藍圖＋熔鍛＋金鑽），高品機率偏低；強化只加等級，不能事後升品。</p>
      <p><strong>技能</strong>：商店普通／稀有（金鑽）。<strong>升級</strong>耗法術精華（隨等級遞增，小幅加威力）；<strong>升階</strong>耗<strong>同名技能本</strong>（第 n 階＝第 n 個質數×3；技能本優先掉給出戰技）。王塔／神王可掉獨特技。同類技能 CD＝2 回合，三技能輪替。戰鬥超過 28 完整回合敵方暴走。介面會顯示攻／盾／療係數與特效數字。</p>
      <p><strong>克制王階</strong>：專克王塔／神王（對王階傷害加成）。首通王階可自選 1 枚；其餘以破王徽＋技能卡（＋少量水晶）於商店兌換。破王徽來自王階通關／戰敗機率與討伐訓練。不進王塔／神王獨特掉落池。</p>
      <p><strong>後勤</strong>：每工位最多 ${workStationCap(1)} 人（主塔每 1000 層 +1，上限 6）；每 ${WORK_BATCH_SEC} 秒一批；主塔每 100 層 +4%（上限 80%）。含打造、訂單、派遣。</p>
      <p><strong>養成消耗</strong>：進階神魂、增效同名卡（前期弱、後期漸強）、技能升級精華、技能升階同名技能本（質數×3）、裝備熔鍛／金鑽皆隨次數遞增；增效第 n 次耗 n 張多餘同名卡。通用技能卡仍用於王塔定向／克制技兌換／後勤。</p>
      <p><strong>派遣</strong>：席位有上限；獎勵隨主塔層遞增。非出戰、非打工角色可遠征。</p>
      <p><strong>訂單</strong>：需求與獎勵隨主塔層遞增，完成後短時間刷新。</p>
      <p><strong>遺物</strong>：依出戰角色轉生解鎖，裝在職業格上。</p>
      <p><strong>編年加成</strong>：各職質數轉生門檻達 3／6／9 人點亮格子，提升該職戰力。</p>
      <p><strong>離線</strong>：切走分頁、重開、或前景一次落後達 ${formatDuration(FOREGROUND_OFFLINE_THRESHOLD_SEC)} 會走離線結算；最多 ${formatDuration(OFFLINE_CAP_SEC)}，超過上限會顯示實際離線時間。</p>
    </div>
    <button class="btn primary" data-act="guide-close" style="width:100%;margin-top:12px">關閉</button>
  </div></div>`
}

function settingsView(_state: GameState): string {
  return `
    <div class="panel">
      <div class="section-title">設置 · ${GAME_NAME}</div>
      <p class="muted">v5 存檔（可由 v3／v4 遷移）。本地自動存；可匯出檔案／存檔碼做雲端備份。</p>
      <button class="btn" data-act="guide" style="width:100%;margin-bottom:8px">遊戲引導</button>
      <div class="btn-row">
        <button class="btn primary" data-act="savelocal">立即存檔</button>
        <button class="btn" data-act="exportfile">匯出檔案</button>
        <button class="btn" data-act="exportcode">複製存檔碼</button>
      </div>
      <div style="margin-top:10px"><input type="file" id="import-file" accept="application/json,.json" /></div>
      <textarea class="input" id="import-code" placeholder="貼上存檔碼">${escapeHtml(importCodeDraft)}</textarea>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn primary" data-act="importcode">還原</button>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" data-act="checkupdate" style="width:100%">檢查更新</button>
        <button class="btn" data-act="warmimages" style="width:100%;margin-top:8px">預載立繪到本機</button>
        <p class="muted" style="margin-top:6px">看過的圖片會自動存本機；也可一次預載全部立繪（約數十 MB）。</p>
        <div id="warm-progress" class="warm-progress" hidden>
          <div class="warm-progress-bar"><i data-warm-bar></i></div>
          <div class="warm-progress-text muted" data-warm-text>待機</div>
        </div>
      </div>
      <p class="muted" style="margin-top:8px">建置 ${escapeHtml(APP_VERSION)}</p>
    </div>
  `
}

function offlineModal(state: GameState): string {
  const r = state.pendingOffline
  if (!r) return ''
  const lines = RESOURCE_META.filter((m) => (r.gains[m.key] ?? 0) > 0)
    .map((m) => `<div class="stats-row"><span>${m.name}</span><span>+${formatNum(r.gains[m.key] ?? 0)}</span></div>`)
    .join('')
  const dropLines = (r.drops ?? [])
    .map((d) => {
      const parts: string[] = []
      if (d.characterId && CHAR_MAP[d.characterId]) {
        const c = CHAR_MAP[d.characterId]
        parts.push(nameSpan(c.name, c.rarity))
      }
      if (d.skillId && SKILL_MAP[d.skillId]) parts.push(SKILL_MAP[d.skillId].name)
      return parts.length ? `<div class="muted">· ${parts.join(' / ')}</div>` : ''
    })
    .join('')
  const durLine =
    r.rawSeconds != null && r.rawSeconds > r.seconds
      ? `離線 ${formatDuration(r.seconds)}（實際 ${formatDuration(r.rawSeconds)}，上限 ${formatDuration(OFFLINE_CAP_SEC)}）`
      : `離線 ${formatDuration(r.seconds)}`
  return `<div class="modal"><div class="sheet">
    <h3>離線結算</h3>
    <p class="muted">${durLine} · ${MODE_LABEL[r.mode]} · +${r.floorsCleared} 層</p>
    ${lines || '<div class="muted">無資源變化</div>'}
    ${dropLines ? `<div class="section-title" style="margin-top:10px">掉落</div>${dropLines}` : ''}
    <button class="btn primary" data-act="dismiss-offline" style="width:100%;margin-top:12px">確認</button>
  </div></div>`
}

/** 首通王階：自選 1 枚克制技能（優先標示編隊職業） */
function antiKingPickModal(state: GameState): string {
  if (!state.pendingAntiKingPick || state.antiKingIntroDone) return ''
  const owned = new Set(
    state.skillItems.filter((s) => SKILL_MAP[s.skillId]?.source === 'antiKing').map((s) => s.skillId),
  )
  const formRoles = new Set(state.formation)
  const pool = antiKingSkills().filter((d) => !owned.has(d.id))
  const preferred = pool.filter((d) => formRoles.has(d.role))
  const rest = pool.filter((d) => !formRoles.has(d.role))
  const ordered = [...preferred, ...rest]
  if (!ordered.length) return ''
  const card = (def: (typeof ordered)[0], highlight: boolean) => {
    const tip = skillEffectLine(def)
    return `<button class="card tap-target" data-act="pick-antiking" data-skill="${def.id}" style="text-align:left;width:100%;${highlight ? 'border-color:#6a5420' : ''}">
      <div class="body">
        <div class="title">${ROLE_LABEL[def.role]} · ${SKILL_KIND_LABEL[def.kind]} · ★${def.name}${highlight ? ' · 推薦' : ''}</div>
        <div class="sub" title="${escapeHtml(tip)}">${escapeHtml(skillPowerLine(def))}${skillSpecialLine(def) ? ` · ${escapeHtml(skillSpecialLine(def))}` : ''}</div>
        <div class="muted">${escapeHtml(def.desc)}</div>
      </div>
    </button>`
  }
  return `<div class="modal"><div class="sheet" data-stop="1">
    <h3>首通王階 · 克制技能</h3>
    <p class="muted" style="text-align:left">選擇 1 枚克制王階技能（僅此一次）。編隊職業技能已標「推薦」；其餘可於商店以破王徽兌換。</p>
    <div class="list" style="margin-top:10px;max-height:50vh;overflow-y:auto">
      ${preferred.map((d) => card(d, true)).join('')}
      ${rest.map((d) => card(d, false)).join('')}
    </div>
  </div></div>`
}

function nav(state: GameState): string {
  return `<nav class="nav nav-5">
    <div class="nav-rail">
      <button data-tab="tower" class="tap-target ${state.tab === 'tower' ? 'active' : ''}">爬塔</button>
      <button data-tab="train" class="tap-target ${state.tab === 'train' ? 'active' : ''}">養成</button>
      <button class="fab tap-target ${state.tab === 'gacha' ? 'active' : ''}" data-tab="gacha">商店</button>
      <button data-tab="logistics" class="tap-target ${state.tab === 'logistics' ? 'active' : ''}">後勤</button>
      <button data-tab="settings" class="tap-target ${state.tab === 'settings' ? 'active' : ''}">設置</button>
    </div>
    <div class="nav-indicator" aria-hidden="true"></div>
  </nav>`
}

function animateBars(root: HTMLElement) {
  root.querySelectorAll('.bar[data-bar]').forEach((el) => {
    const bar = el as HTMLElement
    const key = bar.dataset.bar!
    const target = Number(bar.dataset.pct ?? 0)
    const fill = bar.querySelector('i') as HTMLElement | null
    if (!fill) return
    const prev = barPctCache[key] ?? target
    fill.style.transition = 'none'
    fill.style.width = `${prev}%`
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fill.style.transition = 'width 0.55s cubic-bezier(0.22, 1, 0.36, 1)'
        fill.style.width = `${target}%`
        barPctCache[key] = target
      })
    })
  })
}

function updateNavIndicator(navEl: HTMLElement, tab: GameState['tab']) {
  const ind = navEl.querySelector('.nav-indicator') as HTMLElement | null
  const btn = navEl.querySelector(`[data-tab="${tab}"]`) as HTMLElement | null
  if (!ind || !btn) return
  const rail = navEl.querySelector('.nav-rail') as HTMLElement | null
  const base = rail ?? navEl
  const baseRect = base.getBoundingClientRect()
  const r = btn.getBoundingClientRect()
  const w = Math.min(32, Math.max(18, r.width * 0.5))
  const x = r.left - baseRect.left + (r.width - w) / 2
  const sameTab = navIndCache.tab === tab
  ind.style.transition = 'none'
  if (sameTab || navIndCache.tab === null) {
    ind.style.width = `${w}px`
    ind.style.transform = `translateX(${x}px)`
    ind.classList.add('ready')
  } else {
    ind.style.width = `${navIndCache.w}px`
    ind.style.transform = `translateX(${navIndCache.x}px)`
    ind.classList.add('ready')
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ind.style.transition =
          'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), width 0.35s ease'
        ind.style.width = `${w}px`
        ind.style.transform = `translateX(${x}px)`
      })
    })
  }
  navIndCache.tab = tab
  navIndCache.x = x
  navIndCache.w = w
}

function bindPressFeedback(root: HTMLElement) {
  root.querySelectorAll('.tap-target, .btn, [data-act], [data-tab], .dex-card, .train-pick').forEach((el) => {
    const node = el as HTMLElement
    if (node.dataset.pressBound) return
    node.dataset.pressBound = '1'
    const press = () => node.classList.add('is-press')
    const release = () => node.classList.remove('is-press')
    node.addEventListener('pointerdown', press)
    node.addEventListener('pointerup', release)
    node.addEventListener('pointerleave', release)
    node.addEventListener('pointercancel', release)
  })
}

function bindSwipeTabs(phone: HTMLElement) {
  const navEl = phone.querySelector('.nav') as HTMLElement | null
  const content = phone.querySelector('.content') as HTMLElement | null
  let startX = 0
  let startY = 0
  let tracking = false

  const onStart = (ev: TouchEvent) => {
    if ((ev.target as HTMLElement | null)?.closest?.('.nav-indicator')) {
      tracking = false
      return
    }
    const t = ev.touches[0]
    startX = t.clientX
    startY = t.clientY
    tracking = true
  }
  const onEnd = (ev: TouchEvent) => {
    if (!tracking) return
    tracking = false
    const t = ev.changedTouches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.35) return
    const tab = actions.getState().tab
    const idx = TAB_ORDER.indexOf(tab)
    if (idx < 0) return
    const next = dx < 0 ? TAB_ORDER[idx + 1] : TAB_ORDER[idx - 1]
    if (!next) return
    if (next === 'train') {
      ;(window as unknown as { __trainPage?: TrainPage }).__trainPage = 'team'
    }
    if (next === 'gacha') setShopPage('hub')
    if (next === 'logistics') {
      ;(window as unknown as { __logisticsPage?: LogisticsPage }).__logisticsPage = 'stations'
      ;(window as unknown as { __logisticsJob?: WorkJob | null }).__logisticsJob = null
    }
    actions.setTab(next)
  }

  ;[navEl, content].forEach((el) => {
    if (!el) return
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
  })

  if (navEl) {
    let dragStartX = 0
    let dragging = false
    const ind = navEl.querySelector('.nav-indicator') as HTMLElement | null
    ind?.addEventListener(
      'touchstart',
      (ev) => {
        dragging = true
        dragStartX = ev.touches[0].clientX
        ind.classList.add('dragging')
      },
      { passive: true },
    )
    ind?.addEventListener(
      'touchmove',
      (ev) => {
        if (!dragging || !ind) return
        const rail = navEl.querySelector('.nav-rail') as HTMLElement | null
        const base = rail ?? navEl
        const x = ev.touches[0].clientX - base.getBoundingClientRect().left - ind.offsetWidth / 2
        ind.style.transform = `translateX(${Math.max(0, Math.min(base.clientWidth - ind.offsetWidth, x))}px)`
      },
      { passive: true },
    )
    ind?.addEventListener(
      'touchend',
      (ev) => {
        if (!dragging || !ind) return
        dragging = false
        ind.classList.remove('dragging')
        const endX = ev.changedTouches[0].clientX
        const buttons = Array.from(navEl.querySelectorAll('[data-tab]')) as HTMLElement[]
        let best: HTMLElement | null = null
        let bestDist = Infinity
        for (const btn of buttons) {
          const r = btn.getBoundingClientRect()
          const cx = r.left + r.width / 2
          const d = Math.abs(cx - endX)
          if (d < bestDist) {
            bestDist = d
            best = btn
          }
        }
        const tab = (best?.dataset.tab ?? actions.getState().tab) as GameState['tab']
        if (Math.abs(endX - dragStartX) > 8 || tab !== actions.getState().tab) {
          if (tab === 'train') {
            ;(window as unknown as { __trainPage?: TrainPage }).__trainPage = 'team'
          }
          if (tab === 'gacha') setShopPage('hub')
          if (tab === 'logistics') {
            ;(window as unknown as { __logisticsPage?: LogisticsPage }).__logisticsPage = 'stations'
            ;(window as unknown as { __logisticsJob?: WorkJob | null }).__logisticsJob = null
          }
          actions.setTab(tab)
        } else {
          updateNavIndicator(navEl, actions.getState().tab)
        }
      },
      { passive: true },
    )
  }
}

export function render(root: HTMLElement, kind: 'tick' | 'ui' = 'ui') {
  const state = actions.getState()

  const flushToast = () => {
    if (!state.pendingToast) return
    toast(root, state.pendingToast)
    actions.clearPendingToast()
  }

  // 掛機 tick：盡量局部更新，避免每秒 innerHTML 拆掉立繪 img 重抓圖
  // 待選克制技能時強制整頁，以顯示自選彈窗
  if (kind === 'tick' && !state.pendingAntiKingPick) {
    const towerSig = state.tab === 'tower' ? towerPaintSig(state) : ''
    const towerUnchanged = state.tab !== 'tower' || towerSig === lastTowerPaintSig
    if (isEditingField(root) || towerUnchanged || state.tab !== 'tower') {
      if (state.tab === 'tower' && towerSig) lastTowerPaintSig = towerSig
      patchLiveHud(root, state)
      flushToast()
      return
    }
    lastTowerPaintSig = towerSig
  }

  const prevContent = root.querySelector('.content') as HTMLElement | null
  const scrollTop = prevContent?.scrollTop ?? 0
  const active = document.activeElement as HTMLElement | null
  const focusId =
    active && root.contains(active) && active.id ? active.id : null
  const focusSel =
    focusId && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)
      ? { start: active.selectionStart, end: active.selectionEnd }
      : null

  if (state.screen === 'starter' || !state.starterDone) {
    const showImport = starterImportOpen
    root.innerHTML = `<div class="phone">
      <div class="starter starter-hero">
        <div class="starter-bg" style="background-image:url('${assetUrl('hero.jpg')}')" aria-hidden="true"></div>
        <div class="starter-scrim" aria-hidden="true"></div>
        <div class="starter-fore">
          <h1 class="hero-title">《${GAME_NAME}》</h1>
          <p class="muted hero-tagline">賽博遺跡中的歷史長塔。指揮戰士、法師、牧師攀向異界之巔。</p>
          <div class="starter-actions">
            ${hasLocalSave() ? '<button class="btn primary" data-act="continuegame">繼續遊戲</button>' : ''}
            <button class="btn ${hasLocalSave() ? '' : 'primary'}" data-act="newgame">新遊戲</button>
            <button class="btn" data-act="starter-import-toggle">${showImport ? '收起讀檔' : '讀取存檔'}</button>
          </div>
          ${
            showImport
              ? `<div class="panel starter-import" style="text-align:left;margin-top:8px">
            <div style="margin-top:6px"><input type="file" id="import-file-starter" accept="application/json,.json" /></div>
            <textarea class="input" id="import-code-starter" placeholder="貼上存檔碼">${escapeHtml(importCodeDraft)}</textarea>
            <div class="btn-row" style="margin-top:8px">
              <button class="btn primary" data-act="importcode">還原</button>
            </div>
          </div>`
              : ''
          }
        </div>
      </div>
    </div>`
    bindStarter(root)
    return
  }

  const body =
    state.tab === 'tower'
      ? towerView(state)
      : state.tab === 'train'
        ? trainView(state)
        : state.tab === 'gacha'
          ? gachaView(state)
          : state.tab === 'logistics'
            ? logisticsView(state)
            : settingsView(state)

  const tabChanged = prevTab !== null && prevTab !== state.tab
  prevTab = state.tab
  if (state.tab === 'tower') {
    lastTowerPaintSig = towerPaintSig(state)
    // 整頁重繪後對齊序號，避免立刻重播上一 tick 飄字
    lastFloaterSeq = state.battle?.floaterSeq ?? -1
  }

  root.innerHTML = `<div class="phone">
    ${topbar(state)}
    <div class="content ${tabChanged ? 'content-enter' : ''}">${body}</div>
    ${nav(state)}
    ${offlineModal(state)}
    ${antiKingPickModal(state)}
    ${gameGuideModal()}
    ${state.tab === 'train' && trainPage() === 'dex' ? portraitLightbox() : ''}
  </div>`

  const content = root.querySelector('.content') as HTMLElement | null
  if (content) content.scrollTop = scrollTop
  const navEl = root.querySelector('.nav') as HTMLElement | null
  if (navEl) {
    requestAnimationFrame(() => updateNavIndicator(navEl, state.tab))
  }
  animateBars(root)
  bind(root)

  flushToast()

  if (focusId) {
    const again = root.querySelector(`#${CSS.escape(focusId)}`) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null
    if (again) {
      again.focus()
      if (focusSel && typeof again.setSelectionRange === 'function') {
        try {
          again.setSelectionRange(focusSel.start ?? 0, focusSel.end ?? 0)
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function restoreFromSave(root: HTMLElement, data: GameState) {
  importCodeDraft = ''
  actions.hydrate(data)
  const s = actions.getState()
  if (!s.battle) s.battle = createBattle(s)
  actions.applyOfflineOnBoot()
  saveLocal(s)
  toast(root, '已還原')
}

function bindStarter(root: HTMLElement) {
  const phone = root.querySelector('.phone') as HTMLElement
  bindPressFeedback(phone)

  phone.querySelector('#import-code-starter')?.addEventListener('input', (ev) => {
    importCodeDraft = (ev.target as HTMLTextAreaElement).value
  })

  phone.querySelector('#import-file-starter')?.addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0]
    if (!f) return
    const data = await uploadSaveFile(f)
    if (!data) return toast(root, '檔案無效')
    restoreFromSave(root, data)
  })

  phone.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', async () => {
      const act = (el as HTMLElement).dataset.act!
      if (act === 'starter-import-toggle') {
        starterImportOpen = !starterImportOpen
        render(root)
        return
      }
      if (act === 'continuegame') {
        const data = loadLocal()
        if (!data) return toast(root, '找不到存檔')
        restoreFromSave(root, data)
        return
      }
      if (act === 'newgame') {
        if (hasLocalSave() && !window.confirm('將覆蓋目前本地存檔並開始新遊戲，確定？')) return
        actions.startNewGame()
        saveLocal(actions.getState())
        starterImportOpen = false
        return
      }
      if (act === 'importcode') {
        const raw =
          (phone.querySelector('#import-code-starter') as HTMLTextAreaElement | null)?.value ??
          importCodeDraft
        const data = importSave(raw)
        if (!data) return toast(root, '無效')
        restoreFromSave(root, data)
        starterImportOpen = false
      }
    })
  })
}

function bind(root: HTMLElement) {
  const phone = root.querySelector('.phone') as HTMLElement
  bindPressFeedback(phone)
  bindSwipeTabs(phone)

  phone.querySelectorAll('[data-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      const tab = (el as HTMLElement).dataset.tab as GameState['tab']
      if (tab === 'train') {
        ;(window as unknown as { __trainPage?: TrainPage }).__trainPage = 'team'
      }
      if (tab === 'gacha') {
        setShopPage('hub')
      }
      if (tab === 'logistics') {
        ;(window as unknown as { __logisticsPage?: LogisticsPage }).__logisticsPage = 'stations'
        ;(window as unknown as { __logisticsJob?: WorkJob | null }).__logisticsJob = null
      }
      actions.setTab(tab)
    })
  })

  phone.querySelectorAll('[data-stop]').forEach((el) => {
    el.addEventListener('click', (ev) => ev.stopPropagation())
  })

  phone.querySelectorAll('[data-mode]').forEach((el) => {
    if ((el as HTMLElement).dataset.act) return
    el.addEventListener('click', () => {
      actions.setIdleMode((el as HTMLElement).dataset.mode as IdleMode)
      saveLocal(actions.getState())
    })
  })

  phone.querySelectorAll('select[data-act="droptarget"]').forEach((el) => {
    el.addEventListener('change', () => {
      const mode = (el as HTMLSelectElement).dataset.mode as 'boss' | 'godking'
      const aim = actions.getState().dropSettings[mode].aim
      const targetId = (el as HTMLSelectElement).value || undefined
      actions.setDropAim(mode, aim, targetId)
      saveLocal(actions.getState())
    })
  })

  const floorInput = phone.querySelector('#farm-floor-input') as HTMLInputElement | null
  floorInput?.addEventListener('change', () => {
    const mode = actions.getState().idleMode
    actions.setFarmFloor(mode, Number(floorInput.value))
    saveLocal(actions.getState())
  })

  phone.querySelectorAll('input.shop-qty').forEach((el) => {
    const input = el as HTMLInputElement
    const update = () => {
      const res = input.dataset.shopRes as keyof Resources
      const rate = SHOP_RATES[res] ?? 0
      const qty = Math.max(1, Math.floor(Number(input.value) || 1))
      const label = phone.querySelector(`[data-shop-cost="${res}"]`)
      if (label) label.textContent = `預估：${formatNum(rate * qty)} 金鑽`
    }
    input.addEventListener('input', update)
    update()
  })

  phone.querySelectorAll('input.shop-card-qty').forEach((el) => {
    const input = el as HTMLInputElement
    const update = () => {
      const defId = input.dataset.cardId
      if (!defId) return
      const owned = actions.getState().roster.find((c) => c.defId === defId)
      if (!owned) return
      const qty = Math.max(1, Math.floor(Number(input.value) || 1))
      const unit = ownedCardShopCost(owned.rarity)
      const label = phone.querySelector(`[data-shop-card-cost="${defId}"]`)
      if (label) label.textContent = `預估：${formatNum(unit * qty)} 金鑽`
    }
    input.addEventListener('input', update)
    update()
  })

  const importCode = phone.querySelector('#import-code') as HTMLTextAreaElement | null
  importCode?.addEventListener('input', () => {
    importCodeDraft = importCode.value
  })

  phone.querySelectorAll('[data-act]').forEach((el) => {
    if ((el as HTMLElement).tagName === 'SELECT') return
    el.addEventListener('click', async () => {
      const act = (el as HTMLElement).dataset.act!
      const id = (el as HTMLElement).dataset.id
      const skill = (el as HTMLElement).dataset.skill
      const st = actions.getState()

      if (act === 'dismiss-offline') actions.dismissOffline()
      if (act === 'dexfilter') {
        ;(window as unknown as { __dexFilter?: DexFilter }).__dexFilter = (el as HTMLElement)
          .dataset.filter as DexFilter
        ;(window as unknown as { __trainPage?: TrainPage }).__trainPage = 'dex'
        actions.setTab('train')
      }
      if (act === 'trainpage') {
        ;(window as unknown as { __trainPage?: TrainPage }).__trainPage = (el as HTMLElement)
          .dataset.page as TrainPage
        actions.setTab('train')
      }
      if (act === 'uifold') {
        const flag = (el as HTMLElement).dataset.flag
        const on = (el as HTMLElement).dataset.on === '1'
        if (flag) setUiFlag(flag, on)
        actions.setTab(st.tab)
      }
      if (act === 'trainloadout') {
        ;(window as unknown as { __trainLoadoutTab?: TrainLoadoutTab }).__trainLoadoutTab = (el as HTMLElement)
          .dataset.tab as TrainLoadoutTab
        actions.setTab('train')
      }
      if (act === 'trainfocus-role') {
        const role = (el as HTMLElement).dataset.role as Role
        ;(window as unknown as { __trainFocusRole?: Role }).__trainFocusRole = role
        actions.setTab('train')
      }
      if (act === 'captain') {
        const role = (el as HTMLElement).dataset.role as Role
        actions.setCaptain(role)
      }
      if (act === 'formup' || act === 'formdown') {
        const role = (el as HTMLElement).dataset.role as Role
        actions.moveFormation(role, act === 'formup' ? -1 : 1)
      }
      if (act === 'castup' || act === 'castdown') {
        const kind = (el as HTMLElement).dataset.kind as SkillKind
        actions.moveSkillCast(kind, act === 'castup' ? -1 : 1)
      }
      if (act === 'skillequip-role' && skill) {
        const role = (el as HTMLElement).dataset.role as Role
        const err = actions.equipSkillOnRole(role, skill)
        toast(root, err ?? '已裝上技能')
      }
      if (act === 'skillunequip-role') {
        const role = (el as HTMLElement).dataset.role as Role
        const k = (el as HTMLElement).dataset.kind as SkillKind
        const err = actions.unequipSkillOnRole(role, k)
        if (err) toast(root, err)
      }
      if (act === 'wear-role' && id) {
        const role = (el as HTMLElement).dataset.role as Role
        const err = actions.equipOnRole(role, id)
        if (err) toast(root, err)
      }
      if (act === 'relic') {
        const role = (el as HTMLElement).dataset.role as Role
        const relic = (el as HTMLElement).dataset.relic
        const err = actions.equipRelicOnRole(role, relic || undefined)
        if (err) toast(root, err)
      }
      if (act === 'dispatch' && id) {
        const hours = Number((el as HTMLElement).dataset.hours)
        const err = actions.beginDispatch(id, hours)
        toast(root, err ?? '已派出')
      }
      if (act === 'order' && id) {
        const err = actions.fulfillOrder(id)
        toast(root, err ?? '訂單完成')
      }
      if (act === 'guide') {
        ;(window as unknown as { __showGuide?: boolean }).__showGuide = true
        render(root)
        return
      }
      if (act === 'guide-close') {
        ;(window as unknown as { __showGuide?: boolean }).__showGuide = false
        render(root)
        return
      }
      if (act === 'loungefilter') {
        ;(window as unknown as { __loungeFilter?: LoungeFilter }).__loungeFilter = (el as HTMLElement)
          .dataset.filter as LoungeFilter
        ;(window as unknown as { __trainPage?: TrainPage }).__trainPage = 'lounge'
        actions.setTab('train')
      }
      if (act === 'shoppage') {
        setShopPage(((el as HTMLElement).dataset.page as ShopPage) || 'hub')
        actions.setTab('gacha')
      }
      if (act === 'shopskillfilter') {
        ;(window as unknown as { __shopSkillFilter?: ShopSkillFilter }).__shopSkillFilter = (el as HTMLElement)
          .dataset.filter as ShopSkillFilter
        setShopPage('skills')
        actions.setTab('gacha')
      }
      if (act === 'shopcardfilter') {
        ;(window as unknown as { __shopCardFilter?: ShopCardFilter }).__shopCardFilter = (el as HTMLElement)
          .dataset.filter as ShopCardFilter
        setShopPage('cards')
        actions.setTab('gacha')
      }
      if (act === 'dexpreview') {
        const cid = (el as HTMLElement).dataset.id
        if (cid) {
          ;(window as unknown as { __dexPreview?: string }).__dexPreview = cid
          ;(window as unknown as { __trainPage?: TrainPage }).__trainPage = 'dex'
          actions.setTab('train')
        }
      }
      if (act === 'dexpreview-close') {
        ;(window as unknown as { __dexPreview?: string }).__dexPreview = undefined
        ;(window as unknown as { __trainPage?: TrainPage }).__trainPage = 'dex'
        actions.setTab('train')
      }
      if (act === 'farmfloor') {
        const floor = Number((el as HTMLElement).dataset.floor)
        const mode = actions.getState().idleMode
        actions.setFarmFloor(mode, floor)
        if (mode === 'boss' || mode === 'godking') {
          const n = mode === 'boss' ? BOSS_CHARACTERS.length : GODKING_CHARACTERS.length
          ;(window as unknown as { __bossCycle?: number }).__bossCycle = Math.ceil(floor / n)
        }
      }
      if (act === 'farmfloor-delta') {
        const delta = Number((el as HTMLElement).dataset.delta)
        const mode = actions.getState().idleMode
        actions.setFarmFloor(mode, farmFloorOf(actions.getState()) + delta)
      }
      if (act === 'farmfloor-max') {
        const mode = actions.getState().idleMode
        actions.setFarmFloor(mode, actions.getState().floors[mode])
      }
      if (act === 'pushmode') {
        const mode = (el as HTMLElement).dataset.mode as 'main' | 'blueprint' | 'skill' | 'hunt'
        const push = (el as HTMLElement).dataset.push as PushMode
        actions.setPushMode(mode, push)
      }
      if (act === 'bosscycle') {
        const delta = Number((el as HTMLElement).dataset.delta)
        const mode = actions.getState().idleMode
        if (mode !== 'boss' && mode !== 'godking') return
        const n = mode === 'boss' ? BOSS_CHARACTERS.length : GODKING_CHARACTERS.length
        const maxCycle = Math.max(1, Math.ceil(actions.getState().floors[mode] / n))
        const win = window as unknown as { __bossCycle?: number }
        const cur = win.__bossCycle ?? 1
        win.__bossCycle = Math.max(1, Math.min(maxCycle, cur + delta))
        actions.setTab('tower')
      }
      if (act === 'level' && id) {
        const times = Number((el as HTMLElement).dataset.times ?? 1)
        const err = actions.levelUp(id, times)
        if (err) toast(root, err)
      }
      if (act === 'levelmax' && id) {
        const err = actions.levelUpMax(id)
        if (err) toast(root, err)
      }
      if (act === 'rebirth' && id) {
        const err = actions.rebirthCharacter(id)
        toast(root, err ?? '轉生成功')
      }
      if (act === 'ascend' && id) actions.ascendCharacter(id)
      if (act === 'boost' && id) {
        const err = actions.boostCharacter(id)
        toast(root, err ?? '增效成功')
      }
      if (act === 'deploy' && id) actions.deployCharacter(id)
      if (act === 'skillup' && id) {
        const err = actions.upgradeSkill(id)
        toast(root, err ?? '技能升級成功')
      }
      if (act === 'skillasc' && id) {
        const err = actions.ascendSkill(id)
        toast(root, err ?? '技能升階成功（稀有度提升）')
      }
      if (act === 'buyskill' && skill) {
        const rarity = (el as HTMLElement).dataset.rarity as Rarity
        const err = actions.shopBuySkill(skill, rarity)
        toast(root, err ?? '已購入技能')
      }
      if (act === 'exchange-antiking' && skill) {
        const err = actions.shopExchangeAntiKing(skill)
        toast(root, err ?? '已兌換克制王階技能')
      }
      if (act === 'pick-antiking' && skill) {
        const err = actions.pickAntiKingIntro(skill)
        toast(root, err ?? '已獲得克制王階技能')
      }
      if (act === 'dropaim') {
        const mode = (el as HTMLElement).dataset.mode as 'boss' | 'godking'
        const aim = (el as HTMLElement).dataset.aim as DropAim
        actions.setDropAim(mode, aim)
      }
      if (act === 'equp' && id) {
        const err = actions.upgradeEquip(id)
        if (err) toast(root, err)
      }
      if (act === 'goto-craft') {
        setUiFlag('__foldCraft', true)
        ;(window as unknown as { __logisticsPage?: LogisticsPage }).__logisticsPage = 'stations'
        actions.setTab('logistics')
      }
      if (act === 'crafteq') {
        const err = actions.craftEquip(
          (el as HTMLElement).dataset.role as Role,
          (el as HTMLElement).dataset.slot as EquipSlot,
          Number((el as HTMLElement).dataset.tier),
        )
        if (err) toast(root, err)
      }
      if (act === 'logistics-open') {
        const job = (el as HTMLElement).dataset.job as WorkJob
        ;(window as unknown as { __logisticsPage?: LogisticsPage }).__logisticsPage = 'detail'
        ;(window as unknown as { __logisticsJob?: WorkJob | null }).__logisticsJob = job
        actions.setTab('logistics')
      }
      if (act === 'logistics-back') {
        ;(window as unknown as { __logisticsPage?: LogisticsPage }).__logisticsPage = 'stations'
        ;(window as unknown as { __logisticsJob?: WorkJob | null }).__logisticsJob = null
        actions.setTab('logistics')
      }
      if (act === 'work' && id) {
        const err = actions.assignWork(id, (el as HTMLElement).dataset.job as WorkJob | undefined)
        if (err) toast(root, err)
      }
      if (act === 'gacha') {
        const times = Number((el as HTMLElement).dataset.times ?? 1) as 1 | 10 | 100
        const got = actions.gachaPull(times)
        if (!got) toast(root, '金鑽不足')
        else if (times === 1) {
          const c = CHAR_MAP[got[0].defId]
          toast(root, `獲得 ${c.name}（x${got[0].count}）`)
          const t = root.querySelector('.toast')
          if (t) (t as HTMLElement).style.color = RARITY_COLOR[c.rarity]
        } else {
          toast(root, `${times}連完成`)
        }
      }
      if (act === 'shop') {
        const res = (el as HTMLElement).dataset.res as keyof Resources
        const input = phone.querySelector(`input.shop-qty[data-shop-res="${res}"]`) as HTMLInputElement | null
        const qty = Number(input?.value ?? 1)
        const err = actions.shopBuy(res, qty)
        toast(root, err ?? `已兌換 ${qty}`)
      }
      if (act === 'shopcard' && id) {
        const input = phone.querySelector(
          `input.shop-card-qty[data-card-id="${id}"]`,
        ) as HTMLInputElement | null
        const qty = Number(input?.value ?? 1)
        const err = actions.shopBuyOwnedCard(id, qty)
        toast(root, err ?? `已兌換同名卡 x${Math.max(1, Math.floor(qty))}`)
      }
      if (act === 'savelocal') {
        saveLocal(st)
        toast(root, '已存檔')
      }
      if (act === 'exportfile') {
        downloadSaveFile(st)
        toast(root, '已匯出')
      }
      if (act === 'exportcode') {
        await navigator.clipboard.writeText(exportSave(st))
        toast(root, '存檔碼已複製')
      }
      if (act === 'importcode') {
        const raw =
          (phone.querySelector('#import-code') as HTMLTextAreaElement | null)?.value ??
          importCodeDraft
        const data = importSave(raw)
        if (!data) return toast(root, '無效')
        restoreFromSave(root, data)
      }
      if (act === 'checkupdate') {
        toast(root, '檢查中…')
        const result = await checkAppUpdate({ manual: true })
        if (result === 'reloading') return
        if (result === 'current') toast(root, '已是最新版本')
        else if (result === 'blocked') toast(root, '偵測到新版但快取未刷新，請稍後再試或強制重新整理')
        else toast(root, '檢查更新失敗')
        return
      }
      if (act === 'warmimages') {
        if (warmingImages) {
          toast(root, '預載進行中…')
          return
        }
        if (!('caches' in window)) {
          toast(root, '此瀏覽器不支援本機圖片快取')
          return
        }
        warmingImages = true
        const btn = el as HTMLButtonElement
        btn.disabled = true
        const urls = [
          assetUrl('hero.jpg'),
          assetUrl('apple-touch-icon.jpg'),
          ...CHARACTERS.map((c) => c.portrait),
          ...BOSS_CHARACTERS.map((c) => c.portrait),
          ...GODKING_CHARACTERS.map((c) => c.portrait),
          ...allMobPortraitUrls(),
        ]
        updateWarmProgressUi(root, { done: 0, total: urls.length, saved: 0, skipped: 0, failed: 0 })
        toast(root, '開始預載立繪…', 0)
        try {
          const result = await warmImageCache(urls, (p) => {
            updateWarmProgressUi(root, p)
            toast(root, `預載 ${p.done}/${p.total}（${Math.round((p.done / Math.max(1, p.total)) * 100)}%）`, 0)
          })
          const summary = `完成 ${result.done}/${result.total} · 新下載 ${result.saved} · 已有 ${result.skipped}${
            result.failed ? ` · 失敗 ${result.failed}` : ''
          }`
          updateWarmProgressUi(root, result, summary)
          toast(root, summary, 3200)
        } finally {
          warmingImages = false
          btn.disabled = false
        }
        return
      }
      saveLocal(actions.getState())
    })
  })

  phone.querySelector('#import-file')?.addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0]
    if (!f) return
    const data = await uploadSaveFile(f)
    if (!data) return toast(root, '檔案無效')
    restoreFromSave(root, data)
  })
}

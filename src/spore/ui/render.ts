import { enemyPowerOf } from '../combat'
import { CLASSES, CLASS_MAP } from '../data/classes'
import { DUNGEONS, DUNGEON_ENEMIES, DUNGEON_MAP } from '../data/dungeons'
import { GEAR_MAP, RARITY_COLOR, RARITY_ORDER, SLOT_LABEL, SLOTS, rarityWeightsAt } from '../data/gear'
import { PET_MAP, petSummonXpNeed } from '../data/pets'
import { SKILL_MAP, skillSummonXpNeed } from '../data/skills'
import { stageOf } from '../data/stages'
import { TECH_TREE_META, nodesOfTree } from '../data/tech'
import {
  abortDungeon,
  buyHatchSlot,
  changeClass,
  confirmCreate,
  continueGame,
  currentForgeHammerCost,
  decomposeEquipped,
  dismissOffline,
  doForge,
  equipSkill,
  forgeCost,
  getState,
  goBoot,
  goCreate,
  hasSave,
  quickEquipSkills,
  resetAll,
  setAutoForgeSettings,
  setDraftName,
  setGrowSub,
  setOverlay,
  setTab,
  startAutoForge,
  startDungeon,
  startResearch,
  stopAutoForge,
  summonPets,
  summonSkills,
  togglePet,
  upgradeAllSkills,
  upgradeForge,
  type EmitKind,
} from '../state'
import type {
  ClassId,
  DungeonId,
  GameState,
  GrowSub,
  OwnedGear,
  Stats,
  Tab,
  TechTreeId,
} from '../types'
import { GAME_NAME, formatNum, gearLine, powerScore, totalStats, xpToLevel } from '../util'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function setTextIfChanged(el: HTMLElement | null, text: string): void {
  if (!el || el.textContent === text) return
  el.textContent = text
}

function setBarWidth(fill: HTMLElement | null, pct: number): void {
  if (!fill) return
  const next = `${pct}%`
  if (fill.style.width === next) return
  const prev = parseFloat(fill.style.width) || 0
  if (pct < prev - 0.5) {
    fill.style.transition = 'none'
    fill.style.width = next
    void fill.offsetWidth
    fill.style.transition = ''
    return
  }
  fill.style.width = next
}

let lastBattleLogSig = ''

function patchLiveHud(root: HTMLElement, s: GameState): void {
  const p = s.player
  if (!p || s.screen !== 'game') return

  const stage = stageOf(p.stage)
  const power = powerScore(p)
  const enemyPower = enemyPowerOf(stage.hp, stage.atk, stage.def)
  const xpNeed = xpToLevel(p.level)
  const xpPct = Number.isFinite(xpNeed) ? Math.min(100, (p.xp / xpNeed) * 100) : 100
  const progPct = Math.floor(
    (s.dungeonRun ? s.dungeonRun.progress : p.stageProgress) * 100,
  )

  setTextIfChanged(
    root.querySelector('[data-status-name]') as HTMLElement | null,
    p.name,
  )
  setTextIfChanged(
    root.querySelector('[data-status-meta]') as HTMLElement | null,
    `戰力 ${formatNum(power)}`,
  )
  setBarWidth(root.querySelector('[data-xp-bar] > i') as HTMLElement | null, xpPct)

  setTextIfChanged(root.querySelector('[data-res-gold]') as HTMLElement | null, formatNum(p.coin))
  setTextIfChanged(
    root.querySelector('[data-res-hammer]') as HTMLElement | null,
    formatNum(p.hammer),
  )
  setTextIfChanged(
    root.querySelector('[data-res-ticket]') as HTMLElement | null,
    formatNum(p.skillTicket),
  )
  setTextIfChanged(
    root.querySelector('[data-res-pet]') as HTMLElement | null,
    formatNum(p.petTicket),
  )
  setTextIfChanged(
    root.querySelector('[data-res-tech]') as HTMLElement | null,
    formatNum(p.techPoint),
  )

  const battleTitle = s.dungeonRun
    ? `${DUNGEON_MAP[s.dungeonRun.dungeonId].name} ${s.dungeonRun.wave}/${DUNGEON_MAP[s.dungeonRun.dungeonId].waves}`
    : `戰鬥 ${stage.label}`
  setTextIfChanged(root.querySelector('[data-stage-name]') as HTMLElement | null, battleTitle)
  setBarWidth(root.querySelector('[data-stage-bar] > i') as HTMLElement | null, progPct)

  const ratio = power / Math.max(1, enemyPower)
  const feel =
    ratio < 0.35
      ? '卡住'
      : ratio < 0.5
        ? '極弱'
        : ratio < 0.8
          ? '吃力'
          : ratio < 1
            ? '膠著'
            : ratio < 1.5
              ? '優勢'
              : '碾壓'
  const enemy = s.dungeonRun
    ? DUNGEON_ENEMIES[s.dungeonRun.dungeonId][
        Math.min(s.dungeonRun.wave - 1, DUNGEON_ENEMIES[s.dungeonRun.dungeonId].length - 1)
      ]
    : stage.enemy
  setTextIfChanged(
    root.querySelector('[data-stage-meta]') as HTMLElement | null,
    `${progPct}% · ${enemy} · ${feel}`,
  )

  const logEl = root.querySelector('[data-battle-log]') as HTMLElement | null
  if (logEl) {
    const lines = [...s.battleLog].reverse().slice(0, 8)
    const sig = lines.map((l) => l.text).join('\n')
    if (sig !== lastBattleLogSig) {
      lastBattleLogSig = sig
      logEl.innerHTML =
        lines.map((l) => `<div>${esc(l.text)}</div>`).join('') || '<div class="tiny">尚無紀錄</div>'
    }
  }

  let toastEl = root.querySelector('.toast') as HTMLElement | null
  if (s.toast) {
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.className = 'toast'
      root.querySelector('.game')?.appendChild(toastEl)
    }
    setTextIfChanged(toastEl, s.toast)
    toastEl.style.display = 'block'
  } else if (toastEl) {
    toastEl.remove()
  }

  // 研究倒數
  const researchEl = root.querySelector('[data-research-timer]') as HTMLElement | null
  if (researchEl) {
    let left = ''
    for (const [id, prog] of Object.entries(p.tech)) {
      if (prog.researchingUntil) {
        const sec = Math.max(0, Math.ceil((prog.researchingUntil - Date.now()) / 1000))
        const node = nodesOfTree('forge')
          .concat(nodesOfTree('power'), nodesOfTree('skillpet'))
          .find((n) => n.id === id)
        left = `${node?.name ?? id} ${Math.floor(sec / 60)}分${sec % 60}秒`
        break
      }
    }
    setTextIfChanged(researchEl, left || '無進行中研究')
  }
}

export function render(root: HTMLElement, kind: EmitKind = 'ui'): void {
  const s = getState()

  if (kind === 'tick') {
    if (s.screen === 'game' && s.player) {
      const shell = root.querySelector('#spore-shell') as HTMLElement | null
      if (shell?.querySelector('.game')) {
        patchLiveHud(shell, s)
      }
    }
    return
  }

  const prevContent = root.querySelector('.content') as HTMLElement | null
  const scrollTop = prevContent?.scrollTop ?? 0
  const active = document.activeElement as HTMLElement | null
  const focusId = active && root.contains(active) && active.id ? active.id : null
  const focusSel =
    focusId && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)
      ? { start: active.selectionStart, end: active.selectionEnd }
      : null

  lastBattleLogSig = ''
  root.innerHTML = `<div class="shell" id="spore-shell"></div>`
  const shell = root.querySelector('#spore-shell') as HTMLElement
  paint(shell, s)
  bind(shell)

  const content = shell.querySelector('.content') as HTMLElement | null
  if (content) content.scrollTop = scrollTop
  if (focusId) {
    const el = shell.querySelector(`#${CSS.escape(focusId)}`) as HTMLElement | null
    if (el) {
      el.focus()
      if (
        focusSel &&
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        focusSel.start != null &&
        focusSel.end != null
      ) {
        el.setSelectionRange(focusSel.start, focusSel.end)
      }
    }
  }
}

function paint(shell: HTMLElement, s: GameState): void {
  if (s.screen === 'boot') {
    shell.innerHTML = `
      <div class="boot">
        <div class="brand">${esc(GAME_NAME)}</div>
        <p class="sub">菇燈主題 · Forge Master 循環：鍛造、四副本、技能／寵物、三科技樹。</p>
        <div class="mushroom-hero" aria-hidden="true"></div>
        <div class="btn-col">
          ${hasSave() ? '<button class="btn primary" data-act="continue" type="button">繼續冒險</button>' : ''}
          <button class="btn${hasSave() ? '' : ' primary'}" data-act="new" type="button">新的菇菇</button>
        </div>
        <p class="tiny" style="margin-top:14px;text-align:center">獨立入口 · 與《異塔編年》互不干擾</p>
      </div>
    `
    return
  }

  if (s.screen === 'create') {
    shell.innerHTML = `
      <div class="create">
        <div class="brand" style="font-size:2rem">建立菇菇</div>
        <p class="sub">先取個名字。職業可在「更多」於 Lv.10 轉職。</p>
        <div class="field">
          <label>名字</label>
          <input id="name-input" maxlength="10" placeholder="例如：小孢孢" value="${esc(s.draftName)}" />
        </div>
        <div class="btn-col">
          <button class="btn primary" data-act="confirm" type="button">開始鍛造</button>
          <button class="btn ghost" data-act="back-boot" type="button">返回</button>
        </div>
      </div>
    `
    return
  }

  const p = s.player!
  const stage = stageOf(p.stage)
  const stats = totalStats(p)
  const power = powerScore(p)

  shell.innerHTML = `
    <div class="game">
      <div class="topbar">
        <div class="avatar-block">
          <div class="avatar" aria-hidden="true">🍄</div>
          <div>
            <div class="status-name" data-status-name>${esc(p.name)}</div>
            <div class="status-meta" data-status-meta>戰力 ${formatNum(power)}</div>
          </div>
        </div>
        <div class="res-row">
          <span class="chip gold" title="金幣"><i>👑</i><b data-res-gold>${formatNum(p.coin)}</b></span>
          <span class="chip hammer" title="錘"><i>🔨</i><b data-res-hammer>${formatNum(p.hammer)}</b></span>
        </div>
      </div>
      <div class="content">${renderTab(s, stage, stats)}</div>
      <nav class="nav fm-nav">
        ${nav('battle', '⚔️', '戰鬥', s.tab)}
        ${nav('dungeon', '🚪', '地下城', s.tab)}
        ${nav('grow', '🧪', '養成', s.tab)}
        ${nav('more', '☰', '更多', s.tab)}
      </nav>
      ${s.toast ? `<div class="toast">${esc(s.toast)}</div>` : ''}
      ${s.offlineReport ? offlineModal(s) : ''}
      ${s.overlay ? renderOverlay(s) : ''}
    </div>
  `
}

function nav(tab: Tab, icon: string, label: string, cur: Tab): string {
  return `<button type="button" data-tab="${tab}" class="${tab === cur ? 'active' : ''}"><span class="nav-ico">${icon}</span><span>${label}</span></button>`
}

function offlineModal(s: GameState): string {
  const r = s.offlineReport!
  return `
    <div class="modal-bg" data-dismiss-offline>
      <div class="modal">
        <h3>離線收益</h3>
        <p>離開 ${Math.floor(r.seconds / 60)} 分 ${r.seconds % 60} 秒<br/>
        +${r.coin} 金 · +${r.hammer} 錘</p>
        <button class="btn primary" data-dismiss-offline type="button" style="width:100%">領取</button>
      </div>
    </div>
  `
}

function renderTab(s: GameState, stage: ReturnType<typeof stageOf>, stats: Stats): string {
  switch (s.tab) {
    case 'dungeon':
      return renderDungeon(s)
    case 'grow':
      return renderGrow(s)
    case 'more':
      return renderMore(s, stats)
    default:
      return renderBattle(s, stage)
  }
}

function renderBattle(s: GameState, stage: ReturnType<typeof stageOf>): string {
  const p = s.player!
  const pct = Math.floor((s.dungeonRun ? s.dungeonRun.progress : p.stageProgress) * 100)
  const power = powerScore(p)
  const enemyPower = enemyPowerOf(stage.hp, stage.atk, stage.def)
  const ratio = power / Math.max(1, enemyPower)
  const feel =
    ratio < 0.35
      ? '卡住'
      : ratio < 0.5
        ? '極弱'
        : ratio < 0.8
          ? '吃力'
          : ratio < 1
            ? '膠著'
            : ratio < 1.5
              ? '優勢'
              : '碾壓'
  const cost = currentForgeHammerCost(p)
  const title = s.dungeonRun
    ? `${DUNGEON_MAP[s.dungeonRun.dungeonId].name}`
    : `戰鬥 ${stage.label}`

  return `
    <div class="arena">
      <div class="arena-title" data-stage-name>${esc(title)}</div>
      <div class="nodes">
        <span class="node on"></span><span class="node ${pct >= 50 ? 'on' : ''}"></span><span class="node ${pct >= 100 ? 'on' : ''}"></span>
      </div>
      <div class="bar fat" data-stage-bar><i style="width:${pct}%"></i></div>
      <p class="tiny arena-meta" data-stage-meta>${pct}% · ${esc(stage.enemy)} · ${feel}</p>
      <div class="arena-vis" aria-hidden="true">
        <div class="hero-blob">🍄</div>
        <div class="pet-row">${(p.petIds || []).map((id) => `<span>${esc(PET_MAP[id]?.name?.[0] ?? '宠')}</span>`).join('')}</div>
        <div class="enemy-blob">💀</div>
      </div>
    </div>

    <div class="forge-dock">
      <div class="equip-grid">
        ${SLOTS.map((slot) => {
          const uid = p.equips[slot]
          const g = uid ? p.bag.find((b) => b.uid === uid) : null
          const def = g ? GEAR_MAP[g.defId] : null
          const wide = slot === 'mount' ? ' wide' : ''
          return `<button type="button" class="eq-slot${wide}" data-decompose="${g?.uid ?? ''}" ${g ? '' : 'disabled'} title="${esc(SLOT_LABEL[slot])}">
            <span class="eq-slot-lab">${esc(SLOT_LABEL[slot])}</span>
            ${
              def && g
                ? `<span class="eq-name" style="color:${RARITY_COLOR[def.rarity]}">${esc(def.name)}</span><span class="eq-lv">Lv.${g.level}</span>`
                : `<span class="eq-empty">空</span>`
            }
          </button>`
        }).join('')}
      </div>
      <div class="anvil-row">
        <button class="info-dot" data-overlay="forgeInfo" type="button" title="機率資訊">i</button>
        <div class="anvil" aria-hidden="true">
          <div class="anvil-icon">⚒️</div>
          <div class="anvil-cost"><span>🔨</span> ${formatNum(p.hammer)}</div>
        </div>
        <div class="forge-actions">
          <button class="btn primary forge-main ${s.forging ? 'pulse' : ''}" data-act="forge" type="button">
            鍛造 等級 ${p.forgeLevel}
            <small>耗 ${cost} 錘</small>
          </button>
          <button class="btn forge-auto" data-overlay="autoForge" type="button">${s.autoForging ? '自動中…' : '自動'}</button>
        </div>
      </div>
      ${s.lastDrop ? `<p class="tiny drop-line">${esc(s.lastDrop)}</p>` : ''}
      <p class="tiny hint">無背包：點裝備格可分解；未穿件鍛造後自動分解換金。</p>
    </div>

    <div class="panel log-panel">
      <h2>戰鬥日誌</h2>
      <div class="log" data-battle-log>
        ${
          [...s.battleLog]
            .reverse()
            .slice(0, 8)
            .map((l) => `<div>${esc(l.text)}</div>`)
            .join('') || '<div class="tiny">尚無紀錄</div>'
        }
      </div>
    </div>
  `
}

function renderDungeon(s: GameState): string {
  const p = s.player!
  return `
    <div class="page-head">
      <h2>地下城</h2>
      <p class="lede">鑰匙每天補充。僅完成時消耗。戰鬥與主線相同，只換怪物。</p>
    </div>
    <div class="dungeon-list">
      ${DUNGEONS.map((d) => {
        const locked = p.stage < d.unlockStage
        const keys = p.dungeonKeys[d.id] ?? 0
        return `
          <div class="dungeon-card" style="--accent:${d.accent}">
            <div class="dungeon-bg"></div>
            <div class="dungeon-body">
              <div class="dungeon-title">${esc(d.name)}</div>
              <div class="tiny">獎勵：${esc(d.rewardLabel)} · ${d.waves === 1 ? '單 Boss' : `${d.waves} 波`}</div>
              <div class="dungeon-meta">
                <span>🔑 ${keys}/${d.keyMax}</span>
                <span>${locked ? `🔒 ${d.unlockLabel}` : '已解鎖'}</span>
              </div>
            </div>
            <button class="btn primary" type="button" data-dungeon="${d.id}" ${locked || keys <= 0 ? 'disabled' : ''}>
              ${locked ? '未解鎖' : keys <= 0 ? '無鑰匙' : '打開'}
            </button>
          </div>`
      }).join('')}
    </div>
  `
}

function renderGrow(s: GameState): string {
  const sub = s.growSub
  return `
    <div class="grow-tabs">
      ${growTab('skills', '技能', sub)}
      ${growTab('pets', '寵物', sub)}
      ${growTab('tech', '科技樹', sub)}
    </div>
    ${sub === 'skills' ? renderSkills(s) : sub === 'pets' ? renderPets(s) : renderTechOverview(s)}
  `
}

function growTab(id: GrowSub, label: string, cur: GrowSub): string {
  return `<button type="button" class="grow-tab ${id === cur ? 'active' : ''}" data-grow="${id}">${label}</button>`
}

function renderSkills(s: GameState): string {
  const p = s.player!
  const stats = totalStats(p)
  const xpNeed = skillSummonXpNeed(p.skillSummonLevel)
  return `
    <div class="res-inline">
      <span class="chip">🎟 <b data-res-ticket>${formatNum(p.skillTicket)}</b></span>
      <span class="tiny">技能 ${p.ownedSkills.length}/${Object.keys(SKILL_MAP).length}</span>
    </div>
    <div class="passive-banner">+${stats.atk} 基礎傷害 · +${stats.hp} 基礎生命</div>
    <div class="skill-grid">
      ${
        p.ownedSkills
          .map((sk) => {
            const def = SKILL_MAP[sk.id]
            if (!def) return ''
            const on = p.equippedSkills.includes(sk.id)
            return `<button type="button" class="skill-cell" data-skill="${sk.id}" style="border-color:${RARITY_COLOR[def.rarity]}">
              <span class="sk-name">${esc(def.name)}</span>
              <span class="tiny">等級 ${sk.level}</span>
              <span class="tiny">${sk.fragments}/${2 + sk.level}</span>
              ${on ? '<span class="equipped-tag">已裝備</span>' : ''}
            </button>`
          })
          .join('') || '<div class="tiny">尚無技能，去鬼鎮拿券召喚</div>'
      }
    </div>
    <div class="equip-bar">
      <span class="ribbon">已裝備</span>
      ${[0, 1, 2]
        .map((i) => {
          const id = p.equippedSkills[i]
          const def = id ? SKILL_MAP[id] : null
          return `<div class="mini-slot">${def ? esc(def.name) : '—'}</div>`
        })
        .join('')}
    </div>
    <div class="row">
      <button class="btn" data-act="upgrade-skills" type="button">全部升級</button>
      <button class="btn" data-act="quick-skills" type="button">快速裝備</button>
    </div>
    <div class="summon-row">
      <button class="btn primary" data-act="summon-skills" type="button">召喚 x5 · 耗券</button>
      <button class="info-dot" data-overlay="skillRates" type="button">i</button>
      <div class="summon-lv">
        <div class="tiny">召喚 Lv.${p.skillSummonLevel}</div>
        <div class="bar"><i style="width:${Math.min(100, (p.skillSummonXp / xpNeed) * 100)}%"></i></div>
      </div>
    </div>
  `
}

function renderPets(s: GameState): string {
  const p = s.player!
  const xpNeed = petSummonXpNeed(p.petSummonLevel)
  return `
    <div class="res-inline">
      <span class="chip">🥚 <b data-res-pet>${formatNum(p.petTicket)}</b></span>
    </div>
    <div class="equip-bar">
      <span class="ribbon">出戰</span>
      ${[0, 1, 2]
        .map((i) => {
          const id = p.petIds[i]
          const def = id ? PET_MAP[id] : null
          return `<div class="mini-slot">${def ? esc(def.name) : '—'}</div>`
        })
        .join('')}
    </div>
    <div class="skill-grid">
      ${
        p.ownedPets
          .map((pet) => {
            const def = PET_MAP[pet.id]
            if (!def) return ''
            const on = p.petIds.includes(pet.id)
            return `<button type="button" class="skill-cell" data-pet="${pet.id}" style="border-color:${RARITY_COLOR[def.rarity]}">
              <span class="sk-name">${esc(def.name)}</span>
              <span class="tiny">${def.rarity} · Lv.${pet.level}</span>
              ${on ? '<span class="equipped-tag">出戰</span>' : ''}
            </button>`
          })
          .join('') || '<div class="tiny">尚無寵物</div>'
      }
    </div>
    <div class="panel">
      <h2>孵化</h2>
      <div class="hatch-row">
        ${p.hatchSlots
          .map((slot, i) => {
            if (!slot.petId) return `<div class="hatch-slot">空位 ${i + 1}</div>`
            const left = slot.readyAt ? Math.max(0, Math.ceil((slot.readyAt - Date.now()) / 1000)) : 0
            const name = PET_MAP[slot.petId]?.name ?? '?'
            return `<div class="hatch-slot busy">${esc(name)}<br/><span class="tiny">${left > 0 ? `${left}s` : '就緒!'}</span></div>`
          })
          .join('')}
        <button class="btn" data-act="buy-hatch" type="button">欄位 +1</button>
      </div>
    </div>
    <div class="summon-row">
      <button class="btn primary" data-act="summon-pets" type="button">召喚 x1</button>
      <button class="info-dot" data-overlay="petRates" type="button">i</button>
      <div class="summon-lv">
        <div class="tiny">召喚 Lv.${p.petSummonLevel}</div>
        <div class="bar"><i style="width:${Math.min(100, (p.petSummonXp / xpNeed) * 100)}%"></i></div>
      </div>
    </div>
  `
}

function renderTechOverview(s: GameState): string {
  const p = s.player!
  const trees: TechTreeId[] = ['forge', 'power', 'skillpet']
  let researching = '無進行中研究'
  for (const [id, prog] of Object.entries(p.tech)) {
    if (prog.researchingUntil) {
      const sec = Math.max(0, Math.ceil((prog.researchingUntil - Date.now()) / 1000))
      const node = [...nodesOfTree('forge'), ...nodesOfTree('power'), ...nodesOfTree('skillpet')].find(
        (n) => n.id === id,
      )
      researching = `${node?.name ?? id}（${Math.floor(sec / 60)}時 ${sec % 60}分）`
      break
    }
  }
  return `
    <div class="res-inline">
      <span class="chip">🧪 <b data-res-tech>${formatNum(p.techPoint)}</b></span>
      <span class="tiny" data-research-timer>${esc(researching)}</span>
    </div>
    <div class="page-head"><h2>科技樹</h2><p class="lede">完成即升階，無需領取。不含 Police／工會。</p></div>
    <div class="tech-grid">
      ${trees
        .map((t) => {
          const meta = TECH_TREE_META[t]
          const nodes = nodesOfTree(t)
          const done = nodes.reduce((a, n) => a + (p.tech[n.id]?.rank ?? 0), 0)
          const max = nodes.reduce((a, n) => a + n.maxRank, 0)
          const pct = max ? ((done / max) * 100).toFixed(1) : '0'
          return `<button type="button" class="tech-card" data-tech-tree="${t}">
            <div class="tech-card-h">${meta.icon} ${esc(meta.name)}</div>
            <div class="tech-card-p">${pct}%</div>
            <div class="tiny">${esc(meta.blurb)}</div>
          </button>`
        })
        .join('')}
    </div>
  `
}

function renderMore(s: GameState, stats: Stats): string {
  const p = s.player!
  return `
    <div class="panel">
      <h2>${esc(p.name)}</h2>
      <p class="lede">${esc(CLASS_MAP[p.classId].name)} · Lv.${p.level} · 戰力 ${formatNum(powerScore(p))}</p>
      <div class="stat-grid">
        <div class="stat-cell"><b>${stats.atk}</b><span>攻擊</span></div>
        <div class="stat-cell"><b>${stats.def}</b><span>防禦</span></div>
        <div class="stat-cell"><b>${stats.hp}</b><span>生命</span></div>
        <div class="stat-cell"><b>${stats.spd}</b><span>速度</span></div>
        <div class="stat-cell"><b>${stats.crit}%</b><span>暴擊</span></div>
        <div class="stat-cell"><b>${p.forgeLevel}</b><span>爐級</span></div>
      </div>
    </div>
    <div class="panel">
      <h2>轉職</h2>
      <div class="list">
        ${CLASSES.filter((c) => c.id !== 'novice')
          .map((c) => {
            const locked = p.level < c.unlockLevel
            const active = p.classId === c.id
            return `<button class="list-btn" type="button" data-class="${c.id}" ${locked ? 'disabled' : ''} style="${
              active ? 'border-color:var(--moss-bright)' : ''
            }">
              <strong>${esc(c.name)} ${active ? '· 目前' : locked ? `· Lv.${c.unlockLevel}` : ''}</strong>
              <span>${esc(c.blurb)}</span>
            </button>`
          })
          .join('')}
      </div>
    </div>
    <div class="panel">
      <h2>關於</h2>
      <p class="lede">《${esc(GAME_NAME)}》獨立存檔。無背包；未裝備只能分解。四副本解鎖：錘 1-5／技能 2-1／寵物 2-5／研究 3-1。</p>
      <button class="btn" data-act="reset" type="button">刪除本遊戲存檔</button>
    </div>
  `
}

function renderOverlay(s: GameState): string {
  const o = s.overlay
  if (!o) return ''
  const p = s.player!
  if (o.kind === 'forgeInfo') {
    const cur = rarityWeightsAt(p.forgeLevel)
    const next = rarityWeightsAt(p.forgeLevel + 1)
    const sum = (w: number[]) => w.reduce((a, b) => a + b, 0) || 1
    const up = forgeCost(p)
    return `
      <div class="modal-bg">
        <div class="modal wide">
          <h3>機率資訊</h3>
          <p class="tiny">鍛造機率 · 等級 ${p.forgeLevel} → ${p.forgeLevel + 1}</p>
          <div class="rate-table">
            ${RARITY_ORDER.map((r, i) => {
              const a = ((cur[i] / sum(cur)) * 100).toFixed(0)
              const b = ((next[i] / sum(next)) * 100).toFixed(0)
              return `<div class="rate-row" style="border-left:4px solid ${RARITY_COLOR[r]}">
                <span>${r}</span><span>${a}%</span><span>${b}%</span>
              </div>`
            }).join('')}
          </div>
          <p class="tiny">升級鍛造等級，解鎖更高稀有；低階機率隨爐級降至 0%。</p>
          <button class="btn gold" data-act="upgrade-forge" type="button" style="width:100%">等級提升 · ${formatNum(up.coin)} 金</button>
          <button class="btn close-x" data-overlay="close" type="button">關閉</button>
        </div>
      </div>`
  }
  if (o.kind === 'autoForge') {
    const af = s.autoForge
    return `
      <div class="modal-bg">
        <div class="modal wide">
          <h3>自動鍛造</h3>
          <p class="lede">保留稀有度下限；命中後可選擇是否繼續。</p>
          <label class="field">最低保留
            <select id="af-rarity">
              ${RARITY_ORDER.map(
                (r, i) =>
                  `<option value="${i}" ${af.minRarityIndex === i ? 'selected' : ''}>${r} 以上</option>`,
              ).join('')}
            </select>
          </label>
          <label class="field">一次耗錘
            <select id="af-hammers">
              ${[1, 2, 3, 5, 9]
                .map((n) => `<option value="${n}" ${af.hammersPerForge === n ? 'selected' : ''}>${n}</option>`)
                .join('')}
            </select>
          </label>
          <label class="check"><input type="checkbox" id="af-continue" ${af.continueOnHit ? 'checked' : ''}/> 找到目標裝備時繼續鍛造</label>
          <div class="row">
            <button class="btn primary" data-act="start-auto" type="button">開始</button>
            <button class="btn" data-act="stop-auto" type="button">停止</button>
            <button class="btn ghost" data-overlay="close" type="button">關閉</button>
          </div>
        </div>
      </div>`
  }
  if (o.kind === 'forgeResult') {
    return forgeResultModal(o.gear, o.replaced)
  }
  if (o.kind === 'skillRates' || o.kind === 'petRates') {
    return `
      <div class="modal-bg">
        <div class="modal">
          <h3>${o.kind === 'skillRates' ? '技能' : '寵物'}召喚機率</h3>
          <p class="tiny">召喚等級越高，低階機率越低。</p>
          <button class="btn primary" data-overlay="close" type="button" style="width:100%">關閉</button>
        </div>
      </div>`
  }
  if (o.kind === 'skillDetail') {
    const def = SKILL_MAP[o.id]
    const owned = p.ownedSkills.find((x) => x.id === o.id)
    if (!def || !owned) return ''
    return `
      <div class="modal-bg">
        <div class="modal">
          <h3>[${def.rarity}] ${esc(def.name)}</h3>
          <p>${esc(def.blurb)}</p>
          <p class="tiny">等級 ${owned.level} · 碎片 ${owned.fragments}</p>
          <div class="row">
            <button class="btn primary" data-skill-equip="${def.id}" type="button">${p.equippedSkills.includes(def.id) ? '移除' : '裝備'}</button>
            <button class="btn ghost" data-overlay="close" type="button">關閉</button>
          </div>
        </div>
      </div>`
  }
  if (o.kind === 'techTree') {
    const tree = o.tree
    const meta = TECH_TREE_META[tree]
    const nodes = nodesOfTree(tree)
    return `
      <div class="modal-bg">
        <div class="modal wide">
          <h3>${meta.icon} ${esc(meta.name)}</h3>
          <div class="tech-nodes">
            ${nodes
              .map((n) => {
                const prog = p.tech[n.id] ?? { rank: 0, researchingUntil: null }
                const busy = !!prog.researchingUntil
                const left = busy
                  ? Math.max(0, Math.ceil((prog.researchingUntil! - Date.now()) / 1000))
                  : 0
                const maxed = prog.rank >= n.maxRank
                return `<button type="button" class="tech-node ${maxed ? 'max' : ''}" data-research="${n.id}" ${busy || maxed ? 'disabled' : ''}>
                  <strong>${esc(n.name)}</strong>
                  <span class="tiny">${esc(n.blurb)}</span>
                  <span>${maxed ? '最大' : busy ? `${left}s` : `${prog.rank}/${n.maxRank}`}</span>
                </button>`
              })
              .join('')}
          </div>
          <button class="btn" data-overlay="close" type="button" style="width:100%;margin-top:10px">返回</button>
        </div>
      </div>`
  }
  if (o.kind === 'dungeonBattle') {
    const def = DUNGEON_MAP[o.dungeonId]
    const run = s.dungeonRun
    return `
      <div class="modal-bg dim">
        <div class="modal">
          <h3>${esc(def.name)}</h3>
          <p>波次 ${run?.wave ?? 1}/${def.waves}</p>
          <div class="bar fat" data-stage-bar><i style="width:${Math.floor((run?.progress ?? 0) * 100)}%"></i></div>
          <p class="tiny">與主線相同戰鬥，擊敗後領取 ${esc(def.rewardLabel)}</p>
          <button class="btn ghost" data-act="abort-dungeon" type="button">撤退（不扣鑰）</button>
        </div>
      </div>`
  }
  return ''
}

function forgeResultModal(gear: OwnedGear, replaced?: OwnedGear | null): string {
  const def = GEAR_MAP[gear.defId]
  return `
    <div class="modal-bg">
      <div class="modal">
        <h3>鍛造結果</h3>
        <p style="color:${def ? RARITY_COLOR[def.rarity] : '#fff'};font-weight:700;font-size:1.2rem">
          ${esc(def?.rarity ?? '')} · ${esc(def?.name ?? '裝備')}
        </p>
        <p class="tiny">${def ? esc(gearLine(gear)) : ''} · 不可強化</p>
        ${replaced ? `<p class="tiny">替換並分解舊件：${esc(GEAR_MAP[replaced.defId]?.name ?? '')}</p>` : ''}
        <p class="tiny">較弱則自動分解換金；無背包留存。</p>
        <button class="btn primary" data-overlay="close" type="button" style="width:100%">確定</button>
      </div>
    </div>`
}

function bind(shell: HTMLElement): void {
  shell.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', () => {
      const act = (el as HTMLElement).dataset.act
      if (act === 'continue') continueGame()
      if (act === 'new') goCreate()
      if (act === 'back-boot') goBoot()
      if (act === 'confirm') {
        const input = shell.querySelector('#name-input') as HTMLInputElement | null
        confirmCreate(input?.value)
      }
      if (act === 'forge') doForge()
      if (act === 'upgrade-forge') upgradeForge()
      if (act === 'start-auto') {
        const rarity = shell.querySelector('#af-rarity') as HTMLSelectElement | null
        const hammers = shell.querySelector('#af-hammers') as HTMLSelectElement | null
        const cont = shell.querySelector('#af-continue') as HTMLInputElement | null
        setAutoForgeSettings({
          minRarityIndex: Number(rarity?.value ?? 2),
          hammersPerForge: Number(hammers?.value ?? 1),
          continueOnHit: !!cont?.checked,
        })
        startAutoForge()
      }
      if (act === 'stop-auto') stopAutoForge()
      if (act === 'summon-skills') summonSkills(5)
      if (act === 'summon-pets') summonPets(1)
      if (act === 'upgrade-skills') upgradeAllSkills()
      if (act === 'quick-skills') quickEquipSkills()
      if (act === 'buy-hatch') buyHatchSlot()
      if (act === 'abort-dungeon') abortDungeon()
      if (act === 'reset') {
        if (confirm('刪除《菇燈鍛造》存檔？異塔不受影響。')) resetAll()
      }
    })
  })

  const nameInput = shell.querySelector('#name-input') as HTMLInputElement | null
  nameInput?.addEventListener('compositionend', () => setDraftName(nameInput.value))
  nameInput?.addEventListener('input', (ev) => {
    if ((ev as InputEvent).isComposing) return
    setDraftName(nameInput.value)
  })

  shell.querySelectorAll('[data-tab]').forEach((el) => {
    el.addEventListener('click', () => setTab((el as HTMLElement).dataset.tab as Tab))
  })
  shell.querySelectorAll('[data-grow]').forEach((el) => {
    el.addEventListener('click', () => setGrowSub((el as HTMLElement).dataset.grow as GrowSub))
  })
  shell.querySelectorAll('[data-overlay]').forEach((el) => {
    el.addEventListener('click', () => {
      const v = (el as HTMLElement).dataset.overlay
      if (v === 'close') setOverlay(null)
      else if (v === 'forgeInfo') setOverlay({ kind: 'forgeInfo' })
      else if (v === 'autoForge') setOverlay({ kind: 'autoForge' })
      else if (v === 'skillRates') setOverlay({ kind: 'skillRates' })
      else if (v === 'petRates') setOverlay({ kind: 'petRates' })
    })
  })
  shell.querySelectorAll('[data-dungeon]').forEach((el) => {
    el.addEventListener('click', () => startDungeon((el as HTMLElement).dataset.dungeon as DungeonId))
  })
  shell.querySelectorAll('[data-tech-tree]').forEach((el) => {
    el.addEventListener('click', () =>
      setOverlay({ kind: 'techTree', tree: (el as HTMLElement).dataset.techTree as TechTreeId }),
    )
  })
  shell.querySelectorAll('[data-research]').forEach((el) => {
    el.addEventListener('click', () => startResearch((el as HTMLElement).dataset.research!))
  })
  shell.querySelectorAll('[data-skill]').forEach((el) => {
    el.addEventListener('click', () =>
      setOverlay({ kind: 'skillDetail', id: (el as HTMLElement).dataset.skill! }),
    )
  })
  shell.querySelectorAll('[data-skill-equip]').forEach((el) => {
    el.addEventListener('click', () => equipSkill((el as HTMLElement).dataset.skillEquip!))
  })
  shell.querySelectorAll('[data-pet]').forEach((el) => {
    el.addEventListener('click', () => togglePet((el as HTMLElement).dataset.pet!))
  })
  shell.querySelectorAll('[data-decompose]').forEach((el) => {
    el.addEventListener('click', () => {
      const uid = (el as HTMLElement).dataset.decompose
      if (!uid) return
      if (confirm('分解此裝備換金幣？未裝備無法保留。')) decomposeEquipped(uid)
    })
  })
  shell.querySelectorAll('[data-class]').forEach((el) => {
    el.addEventListener('click', () => changeClass((el as HTMLElement).dataset.class as ClassId))
  })
  shell.querySelectorAll('[data-dismiss-offline]').forEach((el) => {
    el.addEventListener('click', () => dismissOffline())
  })
}

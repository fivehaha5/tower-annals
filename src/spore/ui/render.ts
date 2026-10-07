import { enemyPowerOf } from '../combat'
import { CLASSES, CLASS_MAP } from '../data/classes'
import { GEAR_MAP, RARITY_COLOR, SLOT_LABEL, SLOTS } from '../data/gear'
import { PETS, PET_MAP } from '../data/pets'
import { stageOf } from '../data/stages'
import {
  changeClass,
  confirmCreate,
  continueGame,
  currentLampCost,
  dismissOffline,
  enhanceGear,
  equipGear,
  forgeCost,
  getState,
  goBoot,
  goCreate,
  hasSave,
  pullLamp,
  resetAll,
  selectPet,
  sellGear,
  setDraftName,
  setTab,
  upgradeForge,
  type EmitKind,
} from '../state'
import type { ClassId, GameState, Stats, Tab } from '../types'
import { BAG_CAP, GAME_NAME, formatNum, gearLine, powerScore, totalStats, xpToLevel } from '../util'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function isEditingField(root: HTMLElement): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el || !root.contains(el)) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio'
  }
  return !!el.isContentEditable
}

/** tick 局部更新：避免每 500ms innerHTML 拆樹＋重播入場動畫 */
function patchLiveHud(root: HTMLElement, s: GameState): void {
  const p = s.player
  if (!p || s.screen !== 'game') return

  const stage = stageOf(p.stage)
  const power = powerScore(p)
  const enemyPower = enemyPowerOf(stage.hp, stage.atk, stage.def)
  const xpNeed = xpToLevel(p.level)
  const xpPct = Number.isFinite(xpNeed) ? Math.min(100, (p.xp / xpNeed) * 100) : 100
  const progPct = Math.floor(p.stageProgress * 100)

  const nameEl = root.querySelector('[data-status-name]') as HTMLElement | null
  if (nameEl) nameEl.textContent = `${p.name} · ${CLASS_MAP[p.classId].name}`

  const metaEl = root.querySelector('[data-status-meta]') as HTMLElement | null
  if (metaEl) metaEl.textContent = `Lv.${p.level} · 戰力 ${formatNum(power)} · 關卡 ${p.stage}`

  const xpFill = root.querySelector('[data-xp-bar] > i') as HTMLElement | null
  if (xpFill) xpFill.style.width = `${xpPct}%`

  const gold = root.querySelector('[data-res-gold]') as HTMLElement | null
  if (gold) gold.textContent = `金 ${formatNum(p.coin)}`
  const hammer = root.querySelector('[data-res-hammer]') as HTMLElement | null
  if (hammer) hammer.textContent = `錘 ${formatNum(p.hammer)}`
  const oil = root.querySelector('[data-res-oil]') as HTMLElement | null
  if (oil) oil.textContent = `油 ${formatNum(p.lampOil)}`

  const stageName = root.querySelector('[data-stage-name]') as HTMLElement | null
  if (stageName) stageName.textContent = stage.name

  const progFill = root.querySelector('[data-stage-bar] > i') as HTMLElement | null
  if (progFill) progFill.style.width = `${progPct}%`

  const progMeta = root.querySelector('[data-stage-meta]') as HTMLElement | null
  if (progMeta) {
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
    progMeta.textContent = `${progPct}% · 敵 ${stage.enemy} · ${feel}`
  }

  const logEl = root.querySelector('[data-battle-log]') as HTMLElement | null
  if (logEl) {
    const lines = [...s.battleLog].reverse().slice(0, 12)
    logEl.innerHTML =
      lines.map((l) => `<div>${esc(l.text)}</div>`).join('') || '<div class="tiny">尚無紀錄</div>'
  }

  let toastEl = root.querySelector('.toast') as HTMLElement | null
  if (s.toast) {
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.className = 'toast'
      root.querySelector('.game')?.appendChild(toastEl)
    }
    toastEl.textContent = s.toast
    toastEl.style.display = 'block'
  } else if (toastEl) {
    toastEl.remove()
  }
}

export function render(root: HTMLElement, kind: EmitKind = 'ui'): void {
  const s = getState()

  // 掛機 tick：局部更新；編輯中或非 game 也避免拆樹
  if (kind === 'tick' && s.screen === 'game' && s.player) {
    const shell = root.querySelector('#spore-shell') as HTMLElement | null
    if (shell?.querySelector('.game') && !isEditingField(root)) {
      patchLiveHud(shell, s)
      return
    }
  }

  const prevContent = root.querySelector('.content') as HTMLElement | null
  const scrollTop = prevContent?.scrollTop ?? 0
  const active = document.activeElement as HTMLElement | null
  const focusId = active && root.contains(active) && active.id ? active.id : null
  const focusSel =
    focusId && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)
      ? { start: active.selectionStart, end: active.selectionEnd }
      : null

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
        <p class="sub">參考《菇勇者傳說》神燈開箱＋《Forge Master》鍛造養成：掛機推圖、點燈噴裝、升級鐵砧。</p>
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
        <p class="sub">先取個名字。職業可在 Lv.10 於英雄頁轉職（戰士／弓箭手／法師）。</p>
        <div class="field">
          <label>名字</label>
          <input id="name-input" maxlength="10" placeholder="例如：小孢孢" value="${esc(s.draftName)}" />
        </div>
        <div class="btn-col">
          <button class="btn primary" data-act="confirm" type="button">點亮神燈</button>
          <button class="btn ghost" data-act="back-boot" type="button">返回</button>
        </div>
      </div>
    `
    return
  }

  const p = s.player!
  const stage = stageOf(p.stage)
  const stats = totalStats(p)
  const xpNeed = xpToLevel(p.level)
  const power = powerScore(p)

  shell.innerHTML = `
    <div class="game">
      <div class="status">
        <div>
          <div class="status-name" data-status-name>${esc(p.name)} · ${esc(CLASS_MAP[p.classId].name)}</div>
          <div class="status-meta" data-status-meta>Lv.${p.level} · 戰力 ${formatNum(power)} · 關卡 ${p.stage}</div>
          <div class="bar" data-xp-bar><i style="width:${Number.isFinite(xpNeed) ? Math.min(100, (p.xp / xpNeed) * 100) : 100}%"></i></div>
        </div>
        <div class="res-row">
          <span class="chip gold" data-res-gold>金 ${formatNum(p.coin)}</span>
          <span class="chip hammer" data-res-hammer>錘 ${formatNum(p.hammer)}</span>
          <span class="chip oil" data-res-oil>油 ${formatNum(p.lampOil)}</span>
        </div>
      </div>
      <div class="content">${renderTab(s, stage, stats)}</div>
      <nav class="nav">
        ${nav('battle', '推圖', s.tab)}
        ${nav('forge', '神燈', s.tab)}
        ${nav('bag', '背包', s.tab)}
        ${nav('hero', '英雄', s.tab)}
        ${nav('more', '更多', s.tab)}
      </nav>
      ${s.toast ? `<div class="toast">${esc(s.toast)}</div>` : ''}
      ${s.offlineReport ? offlineModal(s) : ''}
    </div>
  `
}

function nav(tab: Tab, label: string, cur: Tab): string {
  return `<button type="button" data-tab="${tab}" class="${tab === cur ? 'active' : ''}">${label}</button>`
}

function offlineModal(s: GameState): string {
  const r = s.offlineReport!
  return `
    <div class="modal-bg" data-dismiss-offline>
      <div class="modal">
        <h3>離線收益</h3>
        <p>離開 ${Math.floor(r.seconds / 60)} 分 ${r.seconds % 60} 秒<br/>
        +${r.coin} 金 · +${r.hammer} 錘 · +${r.oil} 神燈油</p>
        <button class="btn primary" data-dismiss-offline type="button" style="width:100%">收下</button>
      </div>
    </div>
  `
}

function renderTab(s: GameState, stage: ReturnType<typeof stageOf>, stats: Stats): string {
  switch (s.tab) {
    case 'forge':
      return renderForge(s)
    case 'bag':
      return renderBag(s)
    case 'hero':
      return renderHero(s, stats)
    case 'more':
      return renderMore()
    default:
      return renderBattle(s, stage)
  }
}

function renderBattle(s: GameState, stage: ReturnType<typeof stageOf>): string {
  const p = s.player!
  const pct = Math.floor(p.stageProgress * 100)
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
  return `
    <div class="panel">
      <h2 data-stage-name>${esc(stage.name)}</h2>
      <p class="lede">掛機自動推圖。戰力夠就一路往前；不夠就去點神燈換裝。</p>
      <div class="tiny">進度</div>
      <div class="bar" data-stage-bar><i style="width:${pct}%"></i></div>
      <p class="tiny" style="margin-top:6px" data-stage-meta>${pct}% · 敵 ${esc(stage.enemy)} · ${feel}</p>
      <div class="sep"></div>
      <div class="row">
        <button class="btn gold" data-tab="forge" type="button">去點神燈</button>
        <button class="btn" data-tab="bag" type="button">整理裝備</button>
      </div>
    </div>
    <div class="panel">
      <h2>戰鬥日誌</h2>
      <div class="log" data-battle-log>
        ${
          [...s.battleLog]
            .reverse()
            .slice(0, 12)
            .map((l) => `<div>${esc(l.text)}</div>`)
            .join('') || '<div class="tiny">尚無紀錄</div>'
        }
      </div>
    </div>
  `
}

function renderForge(s: GameState): string {
  const p = s.player!
  const cost = currentLampCost(p)
  const up = forgeCost(p)
  return `
    <div class="panel">
      <h2>神燈鍛造</h2>
      <p class="lede">點燈噴裝備（菇勇者爽感）＋升級鍛造爐提升稀有率（Forge Master 養成）。</p>
      <button class="lamp ${s.forging ? 'pulse' : ''}" data-act="pull1" type="button">
        <div class="lamp-icon">🪔</div>
        <div class="lamp-tip">點我開箱</div>
        <div class="tiny">消耗 ${cost} 神燈油 · 爐 Lv.${p.forgeLevel}</div>
      </button>
      <div class="row">
        <button class="btn primary" data-act="pull1" type="button">抽 1 次</button>
        <button class="btn" data-act="pull10" type="button">連抽 10</button>
      </div>
      ${s.lastDrop ? `<p class="tiny" style="margin-top:10px;color:var(--cap)">${esc(s.lastDrop)}</p>` : ''}
    </div>
    <div class="panel">
      <h2>鍛造爐 Lv.${p.forgeLevel}</h2>
      <p class="lede">爐級越高，史詩／傳說越容易噴出。爐 Lv.12 仍會繼續提升稀有率。</p>
      <button class="btn gold" data-act="upgrade-forge" type="button" style="width:100%">
        升級鍛造爐（${up.hammer} 錘 · ${up.coin} 金）
      </button>
      <p class="tiny" style="margin-top:8px">累計開箱 ${p.totalPulls} 次</p>
    </div>
  `
}

function renderBag(s: GameState): string {
  const p = s.player!
  const equipped = new Set(Object.values(p.equips).filter(Boolean))
  return `
    <div class="panel">
      <h2>裝備欄</h2>
      <div class="list">
        ${SLOTS.map((slot) => {
          const uid = p.equips[slot]
          const g = uid ? p.bag.find((b) => b.uid === uid) : null
          const def = g ? GEAR_MAP[g.defId] : null
          return `<div class="list-btn">
            <strong>${SLOT_LABEL[slot]}：${
              def
                ? `<span class="rarity" style="color:${RARITY_COLOR[def.rarity]}">${esc(def.name)}</span>`
                : '（空）'
            }</strong>
            <span>${def && g ? esc(gearLine(g)) : '去神燈開箱'}</span>
          </div>`
        }).join('')}
      </div>
    </div>
    <div class="panel">
      <h2>背包（${p.bag.length}/${BAG_CAP}）</h2>
      <p class="lede">點裝備可穿上；多餘的可強化或賣掉換金。超過 ${BAG_CAP} 件會自動賣掉最弱未裝備。</p>
      <div class="list">
        ${
          p.bag
            .slice()
            .reverse()
            .map((g) => {
              const def = GEAR_MAP[g.defId]
              if (!def) return ''
              const on = equipped.has(g.uid)
              const affix =
                Object.entries(g.affix)
                  .map(([k, v]) => `${k}+${v}`)
                  .join(' ') || '無'
              return `<div class="list-btn">
              <strong><span class="rarity" style="color:${RARITY_COLOR[def.rarity]}">${esc(def.name)}</span> ${
                on ? '· 穿戴中' : ''
              }</strong>
              <span>${esc(gearLine(g))} · 詞條 ${esc(affix)}</span>
              <div class="row" style="margin-top:8px">
                <button class="btn primary" data-equip="${g.uid}" type="button">裝備</button>
                <button class="btn" data-enhance="${g.uid}" type="button">強化</button>
                <button class="btn ghost" data-sell="${g.uid}" type="button">賣</button>
              </div>
            </div>`
            })
            .join('') || '<div class="tiny">空空的，去點神燈</div>'
        }
      </div>
    </div>
  `
}

function renderHero(s: GameState, stats: Stats): string {
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
      <p class="lede">Lv.10 可選戰士／弓箭手／法師（菇勇者傳說式）。職業會影響推圖速度。</p>
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
      <h2>同伴</h2>
      <div class="list">
        ${PETS.map((pet) => {
          const unlocked = p.unlockedPets.includes(pet.id)
          const active = p.petId === pet.id
          const lockHint = `關卡 ${pet.unlockStage} · 爐 Lv.${pet.unlockForge}`
          return `<button class="list-btn" type="button" data-pet="${pet.id}" ${unlocked ? '' : 'disabled'} style="${
            active ? 'border-color:var(--cap)' : ''
          }">
            <strong>${esc(pet.name)} ${active ? '· 出戰' : unlocked ? '' : `· ${lockHint}`}</strong>
            <span>${esc(pet.blurb)}</span>
          </button>`
        }).join('')}
      </div>
      <p class="tiny" style="margin-top:8px">目前：${esc(PET_MAP[p.petId ?? '']?.name ?? '無')}</p>
    </div>
  `
}

function renderMore(): string {
  return `
    <div class="panel">
      <h2>關於</h2>
      <p class="lede">《${esc(GAME_NAME)}》是獨立遊戲入口，存檔與《異塔編年》分開。<br/><br/>
      異塔：網址結尾 <b>/tower-annals/</b><br/>
      本遊戲：網址結尾 <b>/tower-annals/spore/</b></p>
      <div class="btn-col">
        <button class="btn" data-act="reset" type="button">刪除本遊戲存檔</button>
      </div>
    </div>
  `
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
      if (act === 'pull1') pullLamp(1)
      if (act === 'pull10') pullLamp(10)
      if (act === 'upgrade-forge') upgradeForge()
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
  shell.querySelectorAll('[data-equip]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      equipGear((el as HTMLElement).dataset.equip!)
    })
  })
  shell.querySelectorAll('[data-enhance]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      enhanceGear((el as HTMLElement).dataset.enhance!)
    })
  })
  shell.querySelectorAll('[data-sell]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      sellGear((el as HTMLElement).dataset.sell!)
    })
  })
  shell.querySelectorAll('[data-class]').forEach((el) => {
    el.addEventListener('click', () =>
      changeClass((el as HTMLElement).dataset.class as ClassId),
    )
  })
  shell.querySelectorAll('[data-pet]').forEach((el) => {
    el.addEventListener('click', () => selectPet((el as HTMLElement).dataset.pet!))
  })
  shell.querySelectorAll('[data-dismiss-offline]').forEach((el) => {
    el.addEventListener('click', () => dismissOffline())
  })
}

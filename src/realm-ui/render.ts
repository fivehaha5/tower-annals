import { CLASSES, CLASS_MAP } from '../realm/data/classes'
import { ITEM_MAP, RARITY_COLOR } from '../realm/data/items'
import { NPCS } from '../realm/data/npcs'
import { QUEST_MAP } from '../realm/data/quests'
import { ZONE_MAP } from '../realm/data/zones'
import {
  acceptQuest,
  buyItem,
  combatAct,
  confirmCreate,
  continueGame,
  dismissBattle,
  equipItem,
  getQuestStepHint,
  getState,
  goCreate,
  goTitle,
  hunt,
  openNpc,
  restInTown,
  resetSave,
  sellItem,
  setAutoBattle,
  setDraftClass,
  setDraftName,
  setModal,
  setTab,
  shopCatalog,
  skillsForPlayer,
  talkToNpc,
  travelTo,
  unequipSlot,
  useItem,
} from '../realm/state'
import type { ClassId, GameState, Tab } from '../realm/types'
import {
  REALM_NAME,
  formatNum,
  fullStats,
  xpToLevel,
} from '../realm/util'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function bar(pct: number): string {
  return `${Math.max(0, Math.min(100, pct))}%`
}

export function renderHub(root: HTMLElement, onPick: (game: 'idle' | 'realm') => void): void {
  root.innerHTML = `
    <div class="realm-shell">
      <div class="hub">
        <div class="brand-mark">雙界入口</div>
        <p class="brand-sub">同一座塔外，還有另一種玩法。選你想進入的世界。</p>
        <div class="hub-cards">
          <button class="hub-card idle" data-game="idle" type="button">
            <h2>異塔編年</h2>
            <p>掛機爬塔、編成與養成。離線也在推進的長線放置遊戲。</p>
            <span class="tag">IDLE / 編成養成</span>
          </button>
          <button class="hub-card realm" data-game="realm" type="button">
            <h2>${esc(REALM_NAME)}</h2>
            <p>城鎮、任務、地圖與手動回合戰鬥——更接近傳統網遊節奏。</p>
            <span class="tag">MMO-LIKE / 任務冒險</span>
          </button>
        </div>
      </div>
    </div>
  `
  root.querySelectorAll<HTMLButtonElement>('[data-game]').forEach((btn) => {
    btn.addEventListener('click', () => onPick(btn.dataset.game as 'idle' | 'realm'))
  })
}

export function renderRealm(root: HTMLElement): void {
  const s = getState()
  root.innerHTML = `<div class="realm-shell" id="realm-root"></div>`
  const shell = root.querySelector('#realm-root') as HTMLElement
  paint(shell, s)
  bind(shell, s)
}

function paint(shell: HTMLElement, s: GameState): void {
  if (s.screen === 'title') {
    shell.innerHTML = `
      <div class="title-screen">
        <div class="brand-mark">${esc(REALM_NAME)}</div>
        <p class="brand-sub">接任務、清怪、換裝、開地圖。自己選技能，自己決定要不要逃——比較像在玩網遊。</p>
        <div class="btn-row" style="margin-top:auto;flex-direction:column">
          <button class="btn primary" data-act="continue" type="button">繼續冒險</button>
          <button class="btn" data-act="new" type="button">建立角色</button>
          <button class="btn ghost" data-act="hub" type="button">返回雙界入口</button>
        </div>
      </div>
    `
    return
  }

  if (s.screen === 'create') {
    shell.innerHTML = `
      <div class="create-screen">
        <div class="brand-mark" style="font-size:2rem">建立角色</div>
        <p class="brand-sub">選好職業與名字，從蒼瀾城踏上征途。</p>
        <div class="field">
          <label>角色名稱</label>
          <input id="name-input" maxlength="10" placeholder="例如：蒼行" value="${esc(s.draftName)}" />
        </div>
        <div class="section-label">選擇職業</div>
        <div class="class-grid">
          ${CLASSES.map(
            (c) => `
            <button type="button" class="class-card ${s.draftClass === c.id ? 'active' : ''}" data-class="${c.id}" style="--class-color:${c.color}">
              <h3>${esc(c.name)}</h3>
              <div class="title">${esc(c.title)}</div>
              <p>${esc(c.blurb)}</p>
            </button>
          `,
          ).join('')}
        </div>
        <div class="btn-row">
          <button class="btn ghost" data-act="back-title" type="button">返回</button>
          <button class="btn primary" data-act="confirm-create" type="button">踏入蒼瀾</button>
        </div>
      </div>
    `
    return
  }

  const p = s.player!
  const stats = fullStats(p)
  const zone = ZONE_MAP[p.zoneId]
  const xpNeed = xpToLevel(p.level)

  shell.innerHTML = `
    <div class="game-root">
      <div class="status-bar">
        <div class="status-main">
          <div class="status-name">${esc(p.name)} · ${esc(CLASS_MAP[p.classId].name)}</div>
          <div class="status-meta">Lv.${p.level} · ${esc(zone?.name ?? p.zoneId)}</div>
          <div class="bars">
            <div class="bar-label"><span>HP</span><span>${p.hp}/${stats.hp}</span></div>
            <div class="bar hp"><i style="width:${bar((p.hp / stats.hp) * 100)}"></i></div>
            <div class="bar-label"><span>MP</span><span>${p.mp}/${stats.mp}</span></div>
            <div class="bar mp"><i style="width:${bar((p.mp / Math.max(1, stats.mp)) * 100)}"></i></div>
            <div class="bar-label"><span>XP</span><span>${formatNum(p.xp)}/${formatNum(xpNeed)}</span></div>
            <div class="bar xp"><i style="width:${bar(Number.isFinite(xpNeed) ? (p.xp / xpNeed) * 100 : 100)}"></i></div>
          </div>
        </div>
        <div class="gold-chip">金 ${formatNum(p.gold)}</div>
      </div>
      <div class="content" id="main-content">
        ${renderTab(s)}
      </div>
      <nav class="nav">
        ${navBtn('scene', '場景', s.tab)}
        ${navBtn('char', '角色', s.tab)}
        ${navBtn('bag', '背包', s.tab)}
        ${navBtn('quest', '任務', s.tab)}
        ${navBtn('chat', '訊息', s.tab)}
      </nav>
      ${s.modal ? renderModal(s) : ''}
      ${s.toast ? `<div class="toast">${esc(s.toast)}</div>` : ''}
    </div>
  `
}

function navBtn(tab: Tab, label: string, cur: Tab): string {
  return `<button type="button" data-tab="${tab}" class="${tab === cur ? 'active' : ''}">${label}</button>`
}

function renderTab(s: GameState): string {
  if (s.battle) return renderBattle(s)
  switch (s.tab) {
    case 'scene':
      return renderScene(s)
    case 'char':
      return renderChar(s)
    case 'bag':
      return renderBag(s)
    case 'quest':
      return renderQuest(s)
    case 'chat':
      return renderChat(s)
    case 'more':
      return renderMore(s)
    default:
      return renderScene(s)
  }
}

function renderScene(s: GameState): string {
  const p = s.player!
  const zone = ZONE_MAP[p.zoneId]
  const npcs = NPCS.filter((n) => n.zoneId === p.zoneId)
  const links = (zone?.links ?? []).filter((id) => p.unlockedZones.includes(id))
  const locked = (zone?.links ?? []).filter((id) => !p.unlockedZones.includes(id))

  return `
    <div class="panel">
      <h2>${esc(zone?.name ?? '未知之地')}</h2>
      <p class="lede">${esc(zone?.blurb ?? '')}</p>
      <p class="atmosphere">${esc(zone?.atmosphere ?? '')}</p>
      <div class="btn-row">
        ${
          zone?.kind !== 'town'
            ? `<button class="btn primary" data-act="hunt" type="button">狩獵遇敵</button>`
            : `<button class="btn primary" data-act="rest" type="button">休息回復</button>
               <button class="btn" data-act="shop" type="button">打開商店</button>`
        }
      </div>
      ${
        zone?.kind === 'town'
          ? ''
          : `<p class="tiny muted" style="margin-top:8px">推薦等級 Lv.${zone?.levelMin}-${zone?.levelMax}</p>`
      }
    </div>

    ${
      npcs.length
        ? `<div class="section-label">人物</div>
      <div class="npc-list">
        ${npcs
          .map(
            (n) => `
          <button class="list-btn" type="button" data-npc="${n.id}">
            <strong>${esc(n.name)}</strong>
            <span>${esc(n.title)}</span>
          </button>`,
          )
          .join('')}
      </div>`
        : ''
    }

    <div class="section-label">可前往</div>
    <div class="link-list">
      ${links
        .map((id) => {
          const z = ZONE_MAP[id]
          return `<button class="list-btn" type="button" data-travel="${id}">
            <strong>${esc(z?.name ?? id)}</strong>
            <span>${z?.kind === 'town' ? '城鎮' : `野外 · Lv.${z?.levelMin}-${z?.levelMax}`}</span>
          </button>`
        })
        .join('')}
      ${locked
        .map((id) => {
          const z = ZONE_MAP[id]
          return `<div class="list-btn" style="opacity:.45">
            <strong>${esc(z?.name ?? id)}（未解鎖）</strong>
            <span>完成主線任務後開放</span>
          </div>`
        })
        .join('')}
    </div>

    <div class="section-label">說明</div>
    <div class="panel">
      <p class="lede" style="margin:0">這不是純掛機：在場景狩獵、自己點技能；任務頁看目標；城鎮找 NPC 接任務與買藥水。</p>
      <div class="spacer"></div>
      <button class="btn ghost" data-tab="more" type="button">設定與存檔</button>
    </div>
  `
}

function renderBattle(s: GameState): string {
  const b = s.battle!
  const p = s.player!
  const skills = skillsForPlayer(p)

  if (b.over) {
    return `
      <div class="panel battle-panel">
        <h2>${b.victory ? '戰鬥勝利' : b.fled ? '已逃離' : '戰敗'}</h2>
        <div class="battle-log">
          ${b.log.map((l) => `<div>${esc(l)}</div>`).join('')}
        </div>
        ${
          b.rewards
            ? `<p class="lede">獎勵：+${b.rewards.xp} XP、+${b.rewards.gold} 金${
                b.rewards.drops.length
                  ? `、${b.rewards.drops.map((id) => ITEM_MAP[id]?.name ?? id).join('、')}`
                  : ''
              }</p>`
            : ''
        }
        <button class="btn primary" data-act="dismiss-battle" type="button">返回場景</button>
      </div>
    `
  }

  return `
    <div class="panel battle-panel">
      <h2>戰鬥中</h2>
      <label class="toggle">
        <input type="checkbox" id="auto-battle" ${s.autoBattle ? 'checked' : ''} />
        自動戰鬥（網遊掛機感）
      </label>
      <div class="fighters">
        <div class="fighter">
          <div class="name">${esc(b.player.name)}</div>
          <div class="lv">Lv.${b.player.level}</div>
          <div class="bar-label"><span>HP</span><span>${b.player.hp}/${b.player.maxHp}</span></div>
          <div class="bar hp"><i style="width:${bar((b.player.hp / b.player.maxHp) * 100)}"></i></div>
          <div class="bar-label"><span>MP</span><span>${b.player.mp}/${b.player.maxMp}</span></div>
          <div class="bar mp"><i style="width:${bar((b.player.mp / Math.max(1, b.player.maxMp)) * 100)}"></i></div>
        </div>
        <div class="fighter enemy">
          <div class="name">${esc(b.enemy.name)}</div>
          <div class="lv">Lv.${b.enemy.level}</div>
          <div class="bar-label"><span>HP</span><span>${b.enemy.hp}/${b.enemy.maxHp}</span></div>
          <div class="bar hp"><i style="width:${bar((b.enemy.hp / b.enemy.maxHp) * 100)}"></i></div>
        </div>
      </div>
      <div class="battle-log">
        ${b.log.slice(-8).map((l) => `<div>${esc(l)}</div>`).join('')}
      </div>
      <div class="skill-grid">
        <button class="btn primary" data-combat="attack" type="button">普通攻擊</button>
        <button class="btn" data-combat="potion" type="button">使用藥水</button>
        ${skills
          .map((sk, i) => {
            const locked = p.level < sk.unlockLevel
            return `<button class="btn" data-combat="skill${i}" type="button" ${locked ? 'disabled' : ''}>
              ${esc(sk.name)}<br/><span class="tiny muted">MP ${sk.mpCost}${locked ? ` · Lv.${sk.unlockLevel}` : ''}</span>
            </button>`
          })
          .join('')}
        <button class="btn danger" data-combat="flee" type="button">逃跑</button>
      </div>
    </div>
  `
}

function renderChar(s: GameState): string {
  const p = s.player!
  const stats = fullStats(p)
  const cls = CLASS_MAP[p.classId]
  const skills = skillsForPlayer(p)
  const slots: Array<['weapon' | 'armor' | 'accessory', string]> = [
    ['weapon', '武器'],
    ['armor', '防具'],
    ['accessory', '飾品'],
  ]

  return `
    <div class="panel">
      <h2>${esc(p.name)}</h2>
      <p class="lede">${esc(cls.name)} · ${esc(cls.title)} · Lv.${p.level}</p>
      <div class="stat-grid">
        <div class="stat-cell"><b>${stats.atk}</b><span>攻擊</span></div>
        <div class="stat-cell"><b>${stats.def}</b><span>防禦</span></div>
        <div class="stat-cell"><b>${stats.spd}</b><span>速度</span></div>
        <div class="stat-cell"><b>${stats.crit}%</b><span>暴擊</span></div>
        <div class="stat-cell"><b>${stats.hp}</b><span>生命</span></div>
        <div class="stat-cell"><b>${stats.mp}</b><span>魔力</span></div>
      </div>
    </div>
    <div class="section-label">裝備</div>
    <div class="item-list">
      ${slots
        .map(([slot, label]) => {
          const uid = p.equips[slot]
          const owned = uid ? p.bag.find((b) => b.uid === uid) : null
          const def = owned ? ITEM_MAP[owned.defId] : null
          return `<div class="list-btn">
            <strong>${label}：${def ? esc(def.name) : '（空）'}</strong>
            <span>${def ? esc(def.desc) : '前往背包裝備'}</span>
            ${uid ? `<div class="spacer"></div><button class="btn ghost" data-unequip="${slot}" type="button">卸下</button>` : ''}
          </div>`
        })
        .join('')}
    </div>
    <div class="section-label">技能</div>
    <div class="item-list">
      ${skills
        .map((sk) => {
          const locked = p.level < sk.unlockLevel
          return `<div class="list-btn" style="${locked ? 'opacity:.55' : ''}">
            <strong>${esc(sk.name)} ${locked ? `· Lv.${sk.unlockLevel} 解鎖` : ''}</strong>
            <span>${esc(sk.desc)}（MP ${sk.mpCost}）</span>
          </div>`
        })
        .join('')}
    </div>
  `
}

function renderBag(s: GameState): string {
  const p = s.player!
  if (!p.bag.length) {
    return `<div class="panel"><h2>背包</h2><p class="lede">空空如也。去野外狩獵或開商店吧。</p></div>`
  }
  return `
    <div class="panel">
      <h2>背包</h2>
      <p class="lede">${p.bag.length} 格物品 · 點擊可裝備／使用／出售</p>
    </div>
    <div class="item-list">
      ${p.bag
        .map((b) => {
          const def = ITEM_MAP[b.defId]
          if (!def) return ''
          const equipped =
            p.equips.weapon === b.uid ||
            p.equips.armor === b.uid ||
            p.equips.accessory === b.uid
          return `<button class="list-btn" type="button" data-item="${b.uid}">
            <strong>
              <span class="rarity" style="color:${RARITY_COLOR[def.rarity]}">${esc(def.name)}</span>
              ${b.qty > 1 ? ` ×${b.qty}` : ''}
              ${equipped ? ' · 已裝備' : ''}
            </strong>
            <span>${esc(def.rarity)} · ${esc(def.desc)}</span>
          </button>`
        })
        .join('')}
    </div>
  `
}

function renderQuest(s: GameState): string {
  const p = s.player!
  const active = p.activeQuests.map((id) => QUEST_MAP[id]).filter(Boolean)
  const done = p.doneQuests.map((id) => QUEST_MAP[id]).filter(Boolean)

  return `
    <div class="panel">
      <h2>任務日誌</h2>
      <p class="lede">主線會解鎖新地圖。完成目標後記得回 NPC 對話交付。</p>
    </div>
    <div class="section-label">進行中</div>
    <div class="quest-list">
      ${
        active.length
          ? active
              .map(
                (q) => `
        <div class="list-btn">
          <strong>${esc(q.name)}</strong>
          <span>${esc(q.chapter)}</span>
          <span style="margin-top:6px;color:var(--teal-bright)">${esc(getQuestStepHint(p, q.id))}</span>
          <span style="margin-top:4px">${esc(q.desc)}</span>
        </div>`,
              )
              .join('')
          : `<div class="list-btn"><strong>沒有進行中任務</strong><span>去蒼瀾城找 NPC 接取</span></div>`
      }
    </div>
    <div class="section-label">已完成（${done.length}）</div>
    <div class="quest-list">
      ${done
        .slice()
        .reverse()
        .slice(0, 8)
        .map((q) => `<div class="list-btn" style="opacity:.7"><strong>${esc(q.name)}</strong><span>${esc(q.chapter)}</span></div>`)
        .join('') || `<div class="muted tiny">尚無</div>`}
    </div>
  `
}

function renderChat(s: GameState): string {
  return `
    <div class="panel">
      <h2>訊息</h2>
      <p class="lede">系統／世界／任務／戰鬥頻道（單機模擬網遊氛圍）。</p>
    </div>
    <div class="chat-feed">
      ${[...s.chat]
        .reverse()
        .map(
          (c) => `
        <div class="chat-line ${esc(c.channel)}">
          <span class="ch">[${esc(c.channel)}]</span>${esc(c.text)}
        </div>`,
        )
        .join('')}
    </div>
  `
}

function renderMore(_s: GameState): string {
  return `
    <div class="panel">
      <h2>設定</h2>
      <p class="lede">《${esc(REALM_NAME)}》存檔獨立於《異塔編年》，互不覆蓋。</p>
      <div class="btn-row" style="flex-direction:column">
        <button class="btn" data-act="hub" type="button">返回雙界入口</button>
        <button class="btn danger" data-act="reset" type="button">刪除本遊戲存檔</button>
      </div>
    </div>
  `
}

function renderModal(s: GameState): string {
  const m = s.modal
  if (!m) return ''
  if (m.kind === 'npc') {
    const npc = NPCS.find((n) => n.id === m.npcId)
    if (!npc) return ''
    const p = s.player!
    const offer = (npc.questIds ?? []).filter(
      (id) => !p.doneQuests.includes(id) && !p.activeQuests.includes(id) && QUEST_MAP[id],
    )
    return `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal" data-stop>
          <h3>${esc(npc.name)}</h3>
          <p>${esc(npc.lines[Math.floor(Math.random() * npc.lines.length)])}</p>
          <div class="btn-row" style="flex-direction:column">
            <button class="btn primary" data-talk="${npc.id}" type="button">對話／交付任務</button>
            ${offer
              .map(
                (id) =>
                  `<button class="btn" data-accept="${id}" type="button">接受：${esc(QUEST_MAP[id].name)}</button>`,
              )
              .join('')}
            ${npc.shop ? `<button class="btn" data-act="shop" type="button">交易</button>` : ''}
            <button class="btn ghost" data-close-modal type="button">離開</button>
          </div>
        </div>
      </div>
    `
  }
  if (m.kind === 'shop') {
    const items = shopCatalog()
    return `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal" data-stop>
          <h3>雜貨與裝備</h3>
          <p>金幣：${formatNum(s.player?.gold ?? 0)}</p>
          <div class="item-list">
            ${items
              .map(
                (it) => `
              <button class="list-btn" type="button" data-buy="${it.id}">
                <strong><span class="rarity" style="color:${RARITY_COLOR[it.rarity]}">${esc(it.name)}</span> · ${it.price} 金</strong>
                <span>${esc(it.desc)}</span>
              </button>`,
              )
              .join('')}
          </div>
          <div class="spacer"></div>
          <button class="btn ghost" data-close-modal type="button">關閉</button>
        </div>
      </div>
    `
  }
  if (m.kind === 'item') {
    const p = s.player!
    const owned = p.bag.find((b) => b.uid === m.uid)
    const def = owned ? ITEM_MAP[owned.defId] : null
    if (!owned || !def) return ''
    return `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal" data-stop>
          <h3><span class="rarity" style="color:${RARITY_COLOR[def.rarity]}">${esc(def.name)}</span></h3>
          <p>${esc(def.desc)}</p>
          <div class="btn-row" style="flex-direction:column">
            ${def.kind === 'equip' ? `<button class="btn primary" data-equip="${owned.uid}" type="button">裝備</button>` : ''}
            ${def.kind === 'consumable' ? `<button class="btn primary" data-use="${owned.uid}" type="button">使用</button>` : ''}
            ${def.kind !== 'quest' ? `<button class="btn" data-sell="${owned.uid}" type="button">出售（${def.sell * owned.qty} 金）</button>` : ''}
            <button class="btn ghost" data-close-modal type="button">關閉</button>
          </div>
        </div>
      </div>
    `
  }
  if (m.kind === 'levelup') {
    return `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal" data-stop>
          <h3>升級！</h3>
          <p>你升到了 Lv.${m.level}。屬性提升，記得查看新技能解鎖。</p>
          <button class="btn primary" data-close-modal type="button">太好了</button>
        </div>
      </div>
    `
  }
  if (m.kind === 'questDone') {
    const q = QUEST_MAP[m.questId]
    return `
      <div class="modal-backdrop" data-close-modal>
        <div class="modal" data-stop>
          <h3>任務完成</h3>
          <p>${esc(q?.name ?? '')}——${esc(q?.desc ?? '')}<br/>獎勵已發放，新地圖可能已解鎖。</p>
          <button class="btn primary" data-close-modal type="button">確認</button>
        </div>
      </div>
    `
  }
  return ''
}

function bind(shell: HTMLElement, s: GameState): void {
  shell.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const act = (el as HTMLElement).dataset.act
      if (act === 'continue') continueGame()
      if (act === 'new') goCreate()
      if (act === 'hub') {
        window.dispatchEvent(new CustomEvent('realm:hub'))
      }
      if (act === 'back-title') goTitle()
      if (act === 'confirm-create') confirmCreate()
      if (act === 'hunt') hunt()
      if (act === 'rest') restInTown()
      if (act === 'shop') setModal({ kind: 'shop' })
      if (act === 'dismiss-battle') dismissBattle()
      if (act === 'reset') {
        if (confirm('確定刪除《幻域征途》存檔？')) resetSave()
      }
    })
  })

  shell.querySelectorAll('[data-class]').forEach((el) => {
    el.addEventListener('click', () => setDraftClass((el as HTMLElement).dataset.class as ClassId))
  })

  const nameInput = shell.querySelector('#name-input') as HTMLInputElement | null
  nameInput?.addEventListener('input', () => setDraftName(nameInput.value))

  shell.querySelectorAll('[data-tab]').forEach((el) => {
    el.addEventListener('click', () => setTab((el as HTMLElement).dataset.tab as Tab))
  })

  shell.querySelectorAll('[data-npc]').forEach((el) => {
    el.addEventListener('click', () => openNpc((el as HTMLElement).dataset.npc!))
  })

  shell.querySelectorAll('[data-travel]').forEach((el) => {
    el.addEventListener('click', () => travelTo((el as HTMLElement).dataset.travel!))
  })

  shell.querySelectorAll('[data-combat]').forEach((el) => {
    el.addEventListener('click', () => {
      const a = (el as HTMLElement).dataset.combat as
        | 'attack'
        | 'skill0'
        | 'skill1'
        | 'skill2'
        | 'potion'
        | 'flee'
      combatAct(a)
    })
  })

  const auto = shell.querySelector('#auto-battle') as HTMLInputElement | null
  auto?.addEventListener('change', () => setAutoBattle(auto.checked))

  shell.querySelectorAll('[data-item]').forEach((el) => {
    el.addEventListener('click', () => setModal({ kind: 'item', uid: (el as HTMLElement).dataset.item! }))
  })

  shell.querySelectorAll('[data-equip]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      equipItem((el as HTMLElement).dataset.equip!)
    })
  })
  shell.querySelectorAll('[data-use]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      useItem((el as HTMLElement).dataset.use!)
    })
  })
  shell.querySelectorAll('[data-sell]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      sellItem((el as HTMLElement).dataset.sell!)
    })
  })
  shell.querySelectorAll('[data-unequip]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      unequipSlot((el as HTMLElement).dataset.unequip as 'weapon' | 'armor' | 'accessory')
    })
  })
  shell.querySelectorAll('[data-buy]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      buyItem((el as HTMLElement).dataset.buy!)
    })
  })
  shell.querySelectorAll('[data-talk]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      talkToNpc((el as HTMLElement).dataset.talk!)
    })
  })
  shell.querySelectorAll('[data-accept]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      acceptQuest((el as HTMLElement).dataset.accept!)
    })
  })
  shell.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (el.hasAttribute('data-stop') && e.target !== el) return
      if ((e.target as HTMLElement).closest('[data-stop]') && !(e.target as HTMLElement).hasAttribute('data-close-modal')) {
        // click inside modal content shouldn't close unless button
      }
      if (el.classList.contains('modal-backdrop') && e.target !== el) return
      setModal(null)
    })
  })

  void s
}

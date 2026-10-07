import type { NpcDef } from '../types'

export const NPCS: NpcDef[] = [
  {
    id: 'npc_elder',
    name: '長老·沈暮',
    title: '蒼瀾執政',
    zoneId: 'town_cangluan',
    lines: [
      '界門重開後，星軌不再穩定。蒼瀾需要能走遠路的人。',
      '城外林徑已不安全。你若願意，就從清剿開始。',
      '天闕祭壇仍在雲上閃爍……那不是好兆頭。',
    ],
    questIds: ['q_welcome', 'q_moon_relic', 'q_gate'],
  },
  {
    id: 'npc_medic',
    name: '醫療官·青穗',
    title: '城內醫館',
    zoneId: 'town_cangluan',
    lines: [
      '傷患比藥材多。青苔藥草雖然普通，現在卻緊缺。',
      '喝藥水要趁早，倒在野外可沒人抬你回來。',
    ],
    questIds: ['q_herbs'],
  },
  {
    id: 'npc_scholar',
    name: '學者·許遠',
    title: '星軌研究所',
    zoneId: 'town_cangluan',
    lines: [
      '霧沼的煙氣成分變了。我需要現場樣本。',
      '界門上方的光帶……像是有什麼在拉扯。',
    ],
    questIds: ['q_mist_sample'],
  },
  {
    id: 'npc_smith',
    name: '鐵匠·赤錘',
    title: '鍛造鋪',
    zoneId: 'town_cangluan',
    lines: [
      '礦道不通，爐火就得吃存糧。你去赤岩看看？',
      '好裝備不是抽來的，是打怪、換金、再鍛出來的。',
    ],
    questIds: ['q_mine_escort'],
    shop: true,
  },
  {
    id: 'npc_captain',
    name: '隊長·霍臨',
    title: '城衛指揮',
    zoneId: 'town_cangluan',
    lines: [
      '龍脊峽谷不是旅遊點。沒準備好就別逞強。',
      '能活著從天闕下來的人，這座城會記住名字。',
    ],
    questIds: ['q_dragon_proof'],
  },
  {
    id: 'npc_merchant',
    name: '行商·阿琉',
    title: '雜貨攤',
    zoneId: 'town_cangluan',
    lines: [
      '藥水、布甲、便宜飾品，缺什麼跟我說。',
      '野外掉落也能賣我，價錢公道。',
    ],
    shop: true,
  },
  {
    id: 'npc_guide',
    name: '引路人·南枝',
    title: '冒險者公會',
    zoneId: 'town_cangluan',
    lines: [
      '這世界運作很單純：接任務、清怪、換裝、開地圖。',
      '別只掛機——自己選技能、自己決定要不要逃，才像冒險者。',
      '打開任務頁看目標，場景頁移動與狩獵，背包整理裝備。',
    ],
    questIds: ['q_clear_path'],
  },
]

export const NPC_MAP = Object.fromEntries(NPCS.map((n) => [n.id, n])) as Record<string, NpcDef>

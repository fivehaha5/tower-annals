import type { CharacterDef, Element, Rarity, Role, Stats } from '../types'
import { defaultSkills } from './skills'
import { portraitPath } from '../util'

type Seed = {
  id: string
  name: string
  role: Role
  element: Element
  rarity: Rarity
  desc: string
}

function baseFor(role: Role, rarity: Rarity): { base: Stats; growth: Stats } {
  const r =
    rarity === '永恆' ? 1.7 : rarity === '神話' ? 1.5 : rarity === '傳奇' ? 1.35 : rarity === '史詩' ? 1.15 : 1
  if (role === 'warrior') {
    return {
      base: {
        hp: Math.floor(400 * r),
        atk: Math.floor(55 * r),
        def: Math.floor(34 * r),
        shield: Math.floor(75 * r),
      },
      growth: { hp: 36 * r, atk: 5 * r, def: 3 * r, shield: 5.5 * r },
    }
  }
  if (role === 'mage') {
    return {
      base: {
        hp: Math.floor(290 * r),
        atk: Math.floor(72 * r),
        def: Math.floor(20 * r),
        shield: Math.floor(55 * r),
      },
      growth: { hp: 25 * r, atk: 6.5 * r, def: 1.9 * r, shield: 4.2 * r },
    }
  }
  return {
    base: {
      hp: Math.floor(350 * r),
      atk: Math.floor(40 * r),
      def: Math.floor(27 * r),
      shield: Math.floor(105 * r),
    },
    growth: { hp: 31 * r, atk: 3.5 * r, def: 2.5 * r, shield: 7.5 * r },
  }
}

function toDef(s: Seed, series: CharacterDef['series']): CharacterDef {
  const stats = baseFor(s.role, s.rarity)
  return {
    ...s,
    ...stats,
    skillIds: defaultSkills(s.role),
    portrait: portraitPath(s.id),
    series,
  }
}

const GACHA_SEEDS: Seed[] = [
  { id: 'w_chibi', name: '赤刃', role: 'warrior', element: '火', rarity: '普通', desc: '熔線巷弄出身的見習斬手。' },
  { id: 'w_tiemo', name: '鐵陌', role: 'warrior', element: '雷', rarity: '普通', desc: '以廢鐵重鑄兵刃的街壘衛士。' },
  { id: 'w_duanlang', name: '斷浪', role: 'warrior', element: '水', rarity: '普通', desc: '在塔下潮渠練刀的巡邏者。' },
  { id: 'w_huiji', name: '灰戟', role: 'warrior', element: '暗', rarity: '普通', desc: '塵霧裡沉默前進的長戟兵。' },
  { id: 'w_helian', name: '赫連朔', role: 'warrior', element: '火', rarity: '史詩', desc: '古氏族徽被改寫成電路烙印。' },
  { id: 'w_mocheng', name: '墨城', role: 'warrior', element: '暗', rarity: '史詩', desc: '黑金城牆的活體斷片。' },
  { id: 'w_liebei', name: '裂碑', role: 'warrior', element: '雷', rarity: '史詩', desc: '把紀年石碑劈成武器的叛卒。' },
  { id: 'w_yinshu', name: '銀戍', role: 'warrior', element: '光', rarity: '史詩', desc: '銀紋甲胄守護舊朝關隘。' },
  { id: 'w_cenye', name: '岑夜斬', role: 'warrior', element: '暗', rarity: '傳奇', desc: '夜色中只留下一道切線。' },
  { id: 'w_xuanjia', name: '玄甲淵', role: 'warrior', element: '水', rarity: '傳奇', desc: '淵底玄鐵鍛成的塔衛統帥。' },
  { id: 'w_taxin', name: '塔心衛', role: 'warrior', element: '光', rarity: '傳奇', desc: '與主塔核心契約的永駐守軍。' },
  { id: 'w_jinluo', name: '燼羅', role: 'warrior', element: '火', rarity: '傳奇', desc: '從焚城餘燼中走出來的戰將。' },

  { id: 'm_qingying', name: '青熒', role: 'mage', element: '雷', rarity: '普通', desc: '提著螢芯燈演算術式的學徒。' },
  { id: 'm_wusuan', name: '霧算', role: 'mage', element: '水', rarity: '普通', desc: '在霧裡用算盤推演傷害的術者。' },
  { id: 'm_yujin', name: '余燼', role: 'mage', element: '火', rarity: '普通', desc: '專收戰場餘溫點燃法陣。' },
  { id: 'm_zheguang', name: '折光', role: 'mage', element: '光', rarity: '普通', desc: '把光線折成刀鋒的觀測生。' },
  { id: 'm_lingshuang', name: '凌霜匣', role: 'mage', element: '水', rarity: '史詩', desc: '匣中封存千層寒霜公式。' },
  { id: 'm_leizhuan', name: '雷篆', role: 'mage', element: '雷', rarity: '史詩', desc: '以古篆驅動雷弧的銘文師。' },
  { id: 'm_xulv', name: '虛律', role: 'mage', element: '暗', rarity: '史詩', desc: '改寫物理常數的異端學者。' },
  { id: 'm_chiheng', name: '赤衡', role: 'mage', element: '火', rarity: '史詩', desc: '用天秤秤量熔晶當量。' },
  { id: 'm_sinan', name: '司南淵', role: 'mage', element: '水', rarity: '傳奇', desc: '指向異界的活體羅盤。' },
  { id: 'm_yongye', name: '永夜譜', role: 'mage', element: '暗', rarity: '傳奇', desc: '把黑夜譜成可詠唱的樂章。' },
  { id: 'm_jingguan', name: '晶棺使', role: 'mage', element: '光', rarity: '傳奇', desc: '護送塔晶遺骸的儀仗法師。' },
  { id: 'm_yishi', name: '異史官', role: 'mage', element: '雷', rarity: '傳奇', desc: '記錄並改寫塔層歷史的史官。' },

  { id: 'p_baidao', name: '白禱', role: 'priest', element: '光', rarity: '普通', desc: '低聲誦念也能穩住傷勢。' },
  { id: 'p_chaodeng', name: '潮燈', role: 'priest', element: '水', rarity: '普通', desc: '提燈照亮潮渠傷員的看護。' },
  { id: 'p_jingling', name: '靜鈴', role: 'priest', element: '雷', rarity: '普通', desc: '鈴響一次，痛楚暫歇。' },
  { id: 'p_suwei', name: '素帷', role: 'priest', element: '暗', rarity: '普通', desc: '素白帷幕後的匿名療者。' },
  { id: 'p_zhaoming', name: '昭明', role: 'priest', element: '光', rarity: '史詩', desc: '把晨光編進繃帶的祭司。' },
  { id: 'p_huichao', name: '晦潮', role: 'priest', element: '暗', rarity: '史詩', desc: '以暗潮洗淨詛咒的行者。' },
  { id: 'p_henglv', name: '衡律', role: 'priest', element: '雷', rarity: '史詩', desc: '用律法般的節奏平衡隊伍。' },
  { id: 'p_shenghui', name: '聖灰', role: 'priest', element: '火', rarity: '史詩', desc: '聖火燃盡後留下的癒合灰。' },
  { id: 'p_miguang', name: '彌光', role: 'priest', element: '光', rarity: '傳奇', desc: '光塵瀰漫處無人再倒下。' },
  { id: 'p_yeqi', name: '夜祈', role: 'priest', element: '暗', rarity: '傳奇', desc: '只在深夜應允祈願的聖女。' },
  { id: 'p_taji', name: '塔祭', role: 'priest', element: '水', rarity: '傳奇', desc: '主持塔層祭儀的大祭司。' },
  { id: 'p_yongnian', name: '永念', role: 'priest', element: '雷', rarity: '傳奇', desc: '記憶永不腐壞的守靈者。' },
]

/** 王塔首領卡 ×6（固定神話） */
const BOSS_SEEDS: Seed[] = [
  { id: 'boss_zhuowu', name: '濁霧井龍', role: 'warrior', element: '水', rarity: '神話', desc: '王塔凝結的龍影戰體。' },
  { id: 'boss_jinshe', name: '金蝕君主', role: 'mage', element: '火', rarity: '神話', desc: '被金鑽腐蝕又昇華的君主。' },
  { id: 'boss_duanceng', name: '斷層裁決者', role: 'priest', element: '光', rarity: '神話', desc: '以斷層為法槌的裁決者。' },
  { id: 'boss_saibo', name: '賽博祭司', role: 'priest', element: '雷', rarity: '神話', desc: '經文編譯成機器禱詞。' },
  { id: 'boss_taxin', name: '塔心守門人', role: 'warrior', element: '光', rarity: '神話', desc: '主塔之心的門衛殘影。' },
  { id: 'boss_yongye', name: '永夜鐵凰', role: 'mage', element: '暗', rarity: '神話', desc: '鐵翼遮蔽永夜的魔鳥。' },
]

/** 異域神王·黃道十二宮（固定永恆） */
const ZODIAC_SEEDS: Seed[] = [
  { id: 'gk_aries', name: '白羊·焰角', role: 'warrior', element: '火', rarity: '永恆', desc: '黃道神王·白羊座。' },
  { id: 'gk_taurus', name: '金牛·磐座', role: 'warrior', element: '光', rarity: '永恆', desc: '黃道神王·金牛座。' },
  { id: 'gk_gemini', name: '雙子·鏡語', role: 'mage', element: '雷', rarity: '永恆', desc: '黃道神王·雙子座。' },
  { id: 'gk_cancer', name: '巨蟹·潮殼', role: 'priest', element: '水', rarity: '永恆', desc: '黃道神王·巨蟹座。' },
  { id: 'gk_leo', name: '獅子·日冕', role: 'mage', element: '火', rarity: '永恆', desc: '黃道神王·獅子座。' },
  { id: 'gk_virgo', name: '處女·律衡', role: 'priest', element: '光', rarity: '永恆', desc: '黃道神王·處女座。' },
  { id: 'gk_libra', name: '天秤·金裁', role: 'priest', element: '光', rarity: '永恆', desc: '黃道神王·天秤座。' },
  { id: 'gk_scorpio', name: '天蠍·毒冕', role: 'mage', element: '暗', rarity: '永恆', desc: '黃道神王·天蠍座。' },
  { id: 'gk_sagittarius', name: '射手·星矢', role: 'warrior', element: '雷', rarity: '永恆', desc: '黃道神王·射手座。' },
  { id: 'gk_capricorn', name: '摩羯·峰脊', role: 'warrior', element: '暗', rarity: '永恆', desc: '黃道神王·摩羯座。' },
  { id: 'gk_aquarius', name: '水瓶·流陣', role: 'mage', element: '水', rarity: '永恆', desc: '黃道神王·水瓶座。' },
  { id: 'gk_pisces', name: '雙魚·夢汐', role: 'priest', element: '水', rarity: '永恆', desc: '黃道神王·雙魚座。' },
]

export const GACHA_CHARACTERS: CharacterDef[] = GACHA_SEEDS.map((s) => toDef(s, 'gacha'))
export const BOSS_CHARACTERS: CharacterDef[] = BOSS_SEEDS.map((s) => toDef(s, 'boss'))
export const GODKING_CHARACTERS: CharacterDef[] = ZODIAC_SEEDS.map((s) => toDef(s, 'godking-zodiac'))

export const CHARACTERS: CharacterDef[] = [
  ...GACHA_CHARACTERS,
  ...BOSS_CHARACTERS,
  ...GODKING_CHARACTERS,
]

export const CHAR_MAP = Object.fromEntries(CHARACTERS.map((c) => [c.id, c])) as Record<
  string,
  CharacterDef
>

export const STARTERS = ['w_chibi', 'm_qingying', 'p_baidao'] as const

export const ALL_PORTRAIT_IDS = CHARACTERS.map((c) => c.id)

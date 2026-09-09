import { readFileSync } from 'node:fs'
import { cachedDescriptionForStock } from './stockClassification.mjs'
import { manualThemesForStock } from './manualThemeStore.mjs'

const catalogPath = process.env.THEME_CATALOG_PATH || new URL('./data/themes.kr.json', import.meta.url)
const rawCatalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const THEMES = rawCatalog?.themes ?? {}
const CATALOG = Object.fromEntries(Object.entries(THEMES).map(([theme, config]) => [theme, new Set(config?.symbols ?? [])]))
const KEYWORDS = Object.entries(THEMES).map(([theme, config]) => [theme, config?.keywords ?? []])

// 카탈로그에 없는 종목만 대상으로 한다. 너무 넓은 단어 하나로 테마를 붙이지 않고,
// 기업개요에서 핵심 사업이 직접 드러나는 표현만 단일 대표 테마로 사용한다.
const OVERVIEW_THEME_RULES = [
  ['반도체', /(반도체용|반도체 칩|반도체칩|반도체 패키지|반도체패키지|반도체 기판|반도체기판|반도체 소재|반도체소재|반도체 장비|반도체장비|HBM|DRAM|NAND|FC-?BGA|IC\s*SUBSTRATE|PACKAGE\s*SUBSTRATE|패키지 기판|패키지기판)/i],
  ['원전', /(원자력발전|원자력 발전|원전 계측|원전계측|원전 제어|원전제어|원자로|소형모듈원자로|SMR|핵연료|원전 정비|원전정비)/i],
  ['전력기기', /(전력용 변압기|전력용변압기|배전용 변압기|배전용변압기|산업용 변압기|산업용변압기|전력기기|전력 기기|송배전|배전반|차단기|전력망용)/i],
  ['조선', /(선박엔진|선박 엔진|선박기자재|선박 기자재|조선기자재|조선 기자재|LNG선|LNG 운반선|해양플랜트|해양 플랜트|선박 건조|선박건조)/i],
  ['2차전지', /(2차전지|이차전지|배터리셀|배터리 셀|양극재|음극재|분리막|전해질|리튬이온 배터리|리튬이온배터리)/i],
  ['바이오', /(신약 개발|신약개발|항체 치료제|항체치료제|바이오의약품|바이오 의약품|의약품 제조|의약품제조|임상시험|임상 시험|의료기기 제조|의료기기제조)/i],
  ['자동차', /(완성차|자동차부품|자동차 부품|차량용 부품|차량용부품|전기차 부품|전기차부품|파워트레인|자동차 전장|자동차전장)/i],
  ['로봇', /(산업용 로봇|산업용로봇|협동로봇|휴머노이드|로봇용 감속기|로봇 감속기|로봇 자동화|로봇자동화)/i],
  ['광통신', /(광트랜시버|광 트랜시버|광모듈|광 모듈|광통신 장비|광통신장비|광케이블|광 케이블|광섬유|광 네트워크|광네트워크)/i],
  ['방산', /(방산 제품|방산제품|방위산업|군수용 장비|군수용장비|유도무기|미사일|레이더 체계|레이더체계)/i],
  ['인터넷·게임', /(온라인 게임|온라인게임|모바일 게임|모바일게임|게임 개발|게임개발|검색 포털|검색포털|인터넷 플랫폼|온라인 플랫폼)/i],
  ['금융', /(은행업|증권업|손해보험|생명보험|금융지주|자산운용업|자산운용 업)/i],
]

export const themeCatalogMetadata = {
  version: rawCatalog?.version ?? 1,
  updatedAt: rawCatalog?.updatedAt ?? null,
  policy: rawCatalog?.policy ?? null,
  themeCount: Object.keys(THEMES).length,
}

function normalizeName(value) {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase()
}

function normalizeOverview(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function inferThemeFromOverview(symbol, name = '', description = null) {
  const overview = normalizeOverview(description ?? cachedDescriptionForStock(symbol))
  if (!overview) return null
  for (const [theme, pattern] of OVERVIEW_THEME_RULES) {
    if (pattern.test(overview)) return theme
  }
  return null
}

export function themeMembershipsForStock(symbol, name = '', description = null) {
  const result = new Map()
  const code = String(symbol ?? '').trim()

  const manualThemes = manualThemesForStock(code)
  if (manualThemes?.length) {
    return manualThemes.map((theme) => ({
      name: theme,
      source: 'manual-user',
      confidence: 'user',
    }))
  }

  for (const [theme, symbols] of Object.entries(CATALOG)) {
    if (symbols.has(code)) result.set(theme, { name: theme, source: 'catalog-symbol', confidence: 'verified' })
  }

  const normalized = normalizeName(name)
  for (const [theme, words] of KEYWORDS) {
    if (words.some((word) => normalized.includes(normalizeName(word)))) {
      if (!result.has(theme)) result.set(theme, { name: theme, source: 'catalog-keyword', confidence: 'verified' })
    }
  }

  if (!result.size) {
    const inferred = inferThemeFromOverview(code, name, description)
    if (inferred) result.set(inferred, { name: inferred, source: 'company-overview', confidence: 'high' })
  }

  return [...result.values()]
}

export function themesForStock(symbol, name = '', description = null) {
  return themeMembershipsForStock(symbol, name, description).map((item) => item.name)
}

export function buildThemeGroups(rankings, { limit = 50, minMembers = 3, maxThemes = 7 } = {}) {
  const groups = new Map()
  for (const item of rankings.slice(0, limit)) {
    if (!item?.symbol) continue
    for (const theme of themesForStock(item.symbol, item.name, item.description ?? null)) {
      const group = groups.get(theme) ?? { name: theme, members: [], tradingAmount: 0 }
      if (!group.members.some((member) => member.symbol === item.symbol)) {
        group.members.push(item)
        group.tradingAmount += Number(item.tradingAmount) || 0
      }
      groups.set(theme, group)
    }
  }

  return [...groups.values()]
    .filter((group) => group.members.length >= minMembers)
    .sort((a, b) => b.tradingAmount - a.tradingAmount)
    .slice(0, maxThemes)
}

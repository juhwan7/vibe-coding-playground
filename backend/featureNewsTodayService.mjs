import {
  FeatureNewsService,
  collapseNewsIssues,
  filterNewsSinceKstSix,
  kstSixStart,
  parseNewsRss,
  selectHighSignalIssues,
  summarizeIssueTitle,
} from './featureNewsService.mjs'

const NEWS_URL = 'https://news.google.com/rss/search'
const THEME_CATALYST = /(반도체|HBM|AI|인공지능|데이터센터|광통신|광섬유|광케이블|광모듈|원전|SMR|전력기기|변압기|전선|방산|조선|바이오|제약|로봇|2차전지|배터리)/i
const CATALYST_ACTION = /(수주|계약|공급|납품|투자|증설|정책|정부|승인|허가|임상|발표|협력|MOU|인수|합병|실적|급등|강세|관세|규제|지원|수출)/i
const MAX_PER_HOUR = 8

function kstDateKey(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

function hourKey(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(value))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}`
}

function timeValue(value) {
  const parsed = Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function issueKey(item = {}) {
  const normalized = summarizeIssueTitle(item.summary || item.title || '').toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
  return normalized || String(item.link ?? '')
}

export function filterNewsToday(items = [], now = Date.now()) {
  return filterNewsSinceKstSix(items, now)
}

export function mergeDailyNews(existing = [], incoming = [], now = Date.now()) {
  const from = kstSixStart(now)
  const until = Number(now) + 5 * 60 * 1000
  const map = new Map()
  for (const item of [...existing, ...incoming]) {
    const published = timeValue(item?.publishedAt)
    if (!published || published < from || published > until) continue
    const key = String(item.link ?? '').trim() || issueKey(item)
    if (!key) continue
    const previous = map.get(key)
    if (!previous || timeValue(item.publishedAt) >= timeValue(previous.publishedAt)) map.set(key, item)
  }
  return [...map.values()].sort((a, b) => timeValue(a.publishedAt) - timeValue(b.publishedAt)).slice(-500)
}

async function fetchQuery(query) {
  const params = new URLSearchParams({ q: query, hl: 'ko', gl: 'KR', ceid: 'KR:ko' })
  const response = await fetch(`${NEWS_URL}?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 market-flow/1.0', Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`뉴스 RSS 조회 실패 (${response.status})`)
  return parseNewsRss(await response.text())
}

function focusNames(snapshot) {
  const rows = (snapshot?.topRankings ?? []).filter((item) => item?.name && item.name !== item.symbol).slice(0, 50)
  return [...rows].sort((a, b) => {
    const aScore = (50 - rows.indexOf(a)) + Math.min(30, Math.abs(Number(a.changeRate) || 0) * 4)
    const bScore = (50 - rows.indexOf(b)) + Math.min(30, Math.abs(Number(b.changeRate) || 0) * 4)
    return bScore - aScore
  }).slice(0, 10).map((item) => `"${item.name}"`)
}

function focusQuery(snapshot) {
  const names = focusNames(snapshot)
  return names.length ? `(${names.join(' OR ')}) (급등 OR 수주 OR 계약 OR 공시 OR 실적 OR 투자 OR 승인 OR 정책) when:1d` : null
}

function themeFocusQuery(themes = []) {
  const names = [...new Set(themes.map((theme) => String(theme?.name ?? '').trim()).filter(Boolean))].slice(0, 5)
  if (!names.length) return null
  return `(${names.map((name) => `"${name}"`).join(' OR ')}) (수주 OR 계약 OR 공급 OR 투자 OR 정책 OR 승인 OR 실적 OR 급등 OR 규제 OR 지원) when:1d`
}

function mergeThemeCatalysts(primary = [], collapsed = []) {
  const selected = new Map(primary.map((item) => [issueKey(item), item]))
  for (const item of collapsed) {
    const text = `${item.title ?? ''} ${item.summary ?? ''}`
    if (!THEME_CATALYST.test(text) || !CATALYST_ACTION.test(text)) continue
    const key = issueKey(item)
    if (!key || selected.has(key)) continue
    selected.set(key, {
      ...item,
      category: '테마 이슈',
      importance: Math.max(6, Number(item.importance ?? 0)),
      matches: item.matches ?? [],
    })
  }

  const byHour = new Map()
  for (const item of [...selected.values()].sort((a, b) => timeValue(a.publishedAt) - timeValue(b.publishedAt))) {
    const key = hourKey(item.publishedAt)
    const bucket = byHour.get(key) ?? []
    bucket.push(item)
    byHour.set(key, bucket)
  }

  return [...byHour.values()].flatMap((bucket) => bucket
    .sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0) || timeValue(a.publishedAt) - timeValue(b.publishedAt))
    .slice(0, MAX_PER_HOUR))
    .sort((a, b) => timeValue(a.publishedAt) - timeValue(b.publishedAt))
}

export class FeatureNewsTodayService extends FeatureNewsService {
  constructor(options = {}) {
    super(options)
    this.getThemes = options.getThemes ?? null
    this.dailyDate = null
    this.dailyRawItems = []
  }

  async refresh() {
    try {
      const now = Date.now()
      const date = kstDateKey(now)
      if (this.dailyDate !== date) {
        this.dailyDate = date
        this.dailyRawItems = []
      }

      const snapshot = this.getSnapshot?.() ?? null
      const themes = this.getThemes?.() ?? []
      const queries = [
        '국내 증시 급등 거래대금 특징주 코스피 코스닥 when:1d',
        '주식 상한가 수주 계약 공시 실적 승인 투자 정책 when:1d',
        '반도체 HBM AI 데이터센터 광통신 광섬유 광모듈 증시 when:1d',
        '원전 SMR 전력기기 변압기 전선 방산 조선 바이오 로봇 2차전지 증시 when:1d',
        '미국 증시 CPI PCE FOMC 연준 금리 고용 물가 관세 when:1d',
        '증시 이란 전쟁 호르무즈 중동 유가 환율 when:1d',
      ]
      const stockDynamic = focusQuery(snapshot)
      const themeDynamic = themeFocusQuery(themes)
      if (stockDynamic) queries.push(stockDynamic)
      if (themeDynamic) queries.push(themeDynamic)

      const batches = await Promise.all(queries.map((query) => fetchQuery(query).catch(() => [])))
      const incoming = filterNewsSinceKstSix(batches.flat(), now)
      this.dailyRawItems = mergeDailyNews(this.dailyRawItems, incoming, now)

      const collapsed = collapseNewsIssues(this.dailyRawItems)
      const primary = selectHighSignalIssues(collapsed, snapshot)
      const items = mergeThemeCatalysts(primary, collapsed)

      this.payload = {
        ok: true,
        updatedAt: new Date(now).toISOString(),
        windowStart: new Date(kstSixStart(now)).toISOString(),
        source: 'Google News RSS · 당일 06:00 이후 재검색/누적 · 거래대금 집중 종목 + 테마 촉매 + 글로벌 매크로/지정학 · 중복/광고/저가치 필터',
        policy: {
          maxPerHour: MAX_PER_HOUR,
          targetPerHour: 4,
          importanceFiltered: true,
          themeCatalystIncluded: true,
          deduplicated: true,
          rescanFromSix: true,
          keepAcceptedToday: true,
          rawCandidateCount: this.dailyRawItems.length,
        },
        items,
        error: null,
      }
      return this.payload
    } catch (error) {
      if (this.payload.items.length) return { ...this.payload, stale: true, error: error instanceof Error ? error.message : String(error) }
      this.payload = {
        ok: false,
        updatedAt: new Date().toISOString(),
        windowStart: new Date(kstSixStart()).toISOString(),
        source: 'Google News RSS · 당일 06:00 이후 고신호 시황 요약',
        items: [],
        error: error instanceof Error ? error.message : String(error),
      }
      return this.payload
    }
  }
}

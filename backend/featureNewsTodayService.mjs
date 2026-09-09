import { FeatureNewsService, collapseNewsIssues, parseNewsRss, selectHighSignalIssues } from './featureNewsService.mjs'

const NEWS_URL = 'https://news.google.com/rss/search'

function kstDateKey(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function kstDayStart(now = Date.now()) {
  return Date.parse(`${kstDateKey(now)}T00:00:00+09:00`)
}

export function filterNewsToday(items = [], now = Date.now()) {
  const from = kstDayStart(now)
  const until = Number(now) + 5 * 60 * 1000
  return items.filter((item) => {
    const published = Date.parse(item?.publishedAt ?? 0)
    return Number.isFinite(published) && published >= from && published <= until
  })
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
  const rows = (snapshot?.topRankings ?? []).filter((item) => item?.name).slice(0, 50)
  return [...rows].sort((a, b) => {
    const aScore = (50 - rows.indexOf(a)) + Math.min(30, Math.abs(Number(a.changeRate) || 0) * 4)
    const bScore = (50 - rows.indexOf(b)) + Math.min(30, Math.abs(Number(b.changeRate) || 0) * 4)
    return bScore - aScore
  }).slice(0, 10).map((item) => `"${item.name}"`)
}

function focusQuery(snapshot) {
  const names = focusNames(snapshot)
  return names.length ? `(${names.join(' OR ')}) (급등 OR 수주 OR 계약 OR 공시 OR 실적 OR 투자 OR 승인) when:1d` : null
}

export class FeatureNewsTodayService extends FeatureNewsService {
  async refresh() {
    try {
      const now = Date.now()
      const snapshot = this.getSnapshot?.() ?? null
      const queries = [
        '국내 증시 급등 거래대금 특징주 코스피 코스닥 when:1d',
        '주식 상한가 수주 계약 공시 실적 승인 투자 when:1d',
        '미국 증시 CPI PCE FOMC 연준 금리 고용 물가 관세 when:1d',
        '증시 이란 전쟁 호르무즈 중동 유가 환율 when:1d',
      ]
      const dynamic = focusQuery(snapshot)
      if (dynamic) queries.push(dynamic)

      const batches = await Promise.all(queries.map((query) => fetchQuery(query).catch(() => [])))
      const filtered = filterNewsToday(batches.flat(), now)
      const collapsed = collapseNewsIssues(filtered)
      const items = selectHighSignalIssues(collapsed, snapshot)

      this.payload = {
        ok: true,
        updatedAt: new Date(now).toISOString(),
        windowStart: new Date(kstDayStart(now)).toISOString(),
        source: 'Google News RSS · 당일 00:00 이후 · 국내 급등/거래대금 집중 종목 + 글로벌 매크로/지정학 · 중복/광고/저가치 필터',
        policy: {
          maxPerHour: 8,
          targetPerHour: 4,
          importanceFiltered: true,
          deduplicated: true,
          keepAllToday: true,
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
        windowStart: new Date(kstDayStart()).toISOString(),
        source: 'Google News RSS · 당일 전체 고신호 시황 요약',
        items: [],
        error: error instanceof Error ? error.message : String(error),
      }
      return this.payload
    }
  }
}

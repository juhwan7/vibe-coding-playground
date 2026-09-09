const NEWS_URL = 'https://news.google.com/rss/search'
const ISSUE_WINDOW_MS = 2 * 60 * 60 * 1000
const MAX_PER_HOUR = 8
const TARGET_PER_HOUR = 4

const PROMOTIONAL_PATTERNS = [
  /(?:^|\s|\[)(?:광고|홍보|PR)(?:\]|\s|$)/i,
  /리딩\s*방/i,
  /무료\s*(?:추천|체험|상담|종목|방)/i,
  /(?:카톡|카카오톡|텔레그램)\s*(?:방|채널|무료|초대)/i,
  /회원\s*(?:모집|가입)/i,
  /추천주\s*(?:공개|받기|무료)/i,
  /수익률\s*\d+(?:\.\d+)?%.*(?:무료|체험|추천)/i,
  /(?:대박|급등주)\s*(?:공개|추천|포착)/i,
]

const LOW_VALUE_PATTERNS = [
  /오늘의\s*(?:추천주|관심주)/i,
  /증권사\s*추천/i,
  /목표주가.*(?:상향|하향)/i,
  /리포트\s*요약/i,
  /전문가.*(?:추천|픽)/i,
]

const MARKET_IMPACT_PATTERNS = [
  /\bCPI\b|소비자물가/i,
  /\bPCE\b|개인소비지출/i,
  /\bFOMC\b|연준|파월|기준금리|금리\s*(?:인상|인하|동결)/i,
  /고용보고서|비농업|실업률|GDP|ISM|PMI/i,
  /관세|무역전쟁|수출규제|제재/i,
  /이란|이스라엘|전쟁|호르무즈|중동|우크라이나/i,
  /유가|WTI|브렌트|원유/i,
  /환율|원\/달러|달러인덱스/i,
  /BOJ|일본은행|ECB|유럽중앙은행|중국\s*(?:부양|금리|지준율)/i,
]

const STOCK_CATALYST_PATTERNS = [
  /상한가|급등|강세/i,
  /수주|계약|공급계약|납품|MOU|협약/i,
  /인수|합병|매각|지분|투자유치|유상증자|무상증자/i,
  /승인|허가|임상|FDA|품목허가/i,
  /실적|영업이익|흑자전환|적자전환|어닝/i,
  /공시|자사주|배당|소각/i,
  /정책|정부지원|국책|보조금/i,
]

const TOKEN_STOP_WORDS = new Set([
  '특징주', '증시', '오늘', '코스피', '코스닥', '장중', '마감', '급등', '상승', '강세', '약세', '하락', '주가', '관련주',
  '기대', '기대감', '영향', '전망', '소식', '속보', '단독', '종목', '시장', '기자', '오전', '오후', '뉴스',
])

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function decode(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))
  return match ? decode(match[1]) : ''
}

function sourceFrom(block) {
  const match = block.match(/<source(?:\s+url="([^"]+)")?[^>]*>([\s\S]*?)<\/source>/i)
  return match ? { sourceUrl: decode(match[1] || ''), source: decode(match[2] || '') } : { sourceUrl: '', source: '' }
}

export function parseNewsRss(xml = '') {
  const items = []
  for (const match of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1]
    const title = tag(block, 'title').replace(/\s+-\s+[^-]+$/, '').trim()
    const link = tag(block, 'link')
    const publishedAt = tag(block, 'pubDate')
    const { source, sourceUrl } = sourceFrom(block)
    if (!title || !/^https?:\/\//.test(link)) continue
    items.push({ title, link, source: source || '뉴스', sourceUrl: /^https?:\/\//.test(sourceUrl) ? sourceUrl : null, publishedAt: publishedAt || null })
  }
  return items
}

export function summarizeIssueTitle(title = '') {
  return String(title)
    .replace(/^\s*(?:\[[^\]]{1,30}\]\s*)+/g, '')
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
}

export function isPromotionalNews(item = {}) {
  const haystack = `${item.title ?? ''} ${item.source ?? ''}`
  return PROMOTIONAL_PATTERNS.some((pattern) => pattern.test(haystack))
}

function isLowValueNews(item = {}) {
  const haystack = `${item.title ?? ''} ${item.source ?? ''}`
  return LOW_VALUE_PATTERNS.some((pattern) => pattern.test(haystack))
}

function issueTokens(title = '') {
  const tokens = summarizeIssueTitle(title).toLowerCase().match(/[가-힣a-z0-9]+/g) ?? []
  return new Set(tokens.filter((token) => token.length >= 2 && !TOKEN_STOP_WORDS.has(token)))
}

function comparableIssue(a, b) {
  const normalizedA = summarizeIssueTitle(a).toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
  const normalizedB = summarizeIssueTitle(b).toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
  if (normalizedA && normalizedA === normalizedB) return true

  const aTokens = issueTokens(a)
  const bTokens = issueTokens(b)
  if (!aTokens.size || !bTokens.size) return false
  let common = 0
  for (const token of aTokens) if (bTokens.has(token)) common += 1
  const overlap = common / Math.min(aTokens.size, bTokens.size)
  return common >= 3 && overlap >= 0.5
}

function timeValue(value) {
  const parsed = Date.parse(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function kstDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value))
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

function kstHourKey(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(value))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}`
}

export function kstSixStart(now = Date.now()) {
  return Date.parse(`${kstDateKey(now)}T06:00:00+09:00`)
}

export function filterNewsSinceKstSix(items = [], now = Date.now()) {
  const from = kstSixStart(now)
  const until = Number(new Date(now)) + 5 * 60 * 1000
  return items.filter((item) => {
    const published = timeValue(item?.publishedAt)
    return published >= from && published <= until
  })
}

function uniqueClauses(titles = []) {
  const clauses = []
  for (const title of titles) {
    for (const clause of summarizeIssueTitle(title).split(/(?:\s*[·|]\s*|\s+[—–-]\s+|\.\.\.|…)/)) {
      const clean = clause.replace(/\s+/g, ' ').trim()
      if (clean.length < 8) continue
      const normalized = clean.toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
      if (!normalized || clauses.some((item) => item.normalized.includes(normalized) || normalized.includes(item.normalized))) continue
      clauses.push({ text: clean, normalized })
    }
  }
  return clauses.map((item) => item.text)
}

function buildGroupSummary(group) {
  const orderedTitles = [...group.titles].sort((a, b) => b.length - a.length)
  const clauses = uniqueClauses(orderedTitles)
  if (!clauses.length) return summarizeIssueTitle(group.summary)
  const first = clauses[0]
  const second = clauses.find((clause) => clause !== first && clause.length <= 70)
  const combined = second ? `${first} · ${second}` : first
  return combined.slice(0, 155)
}

export function collapseNewsIssues(items = []) {
  const ordered = [...items]
    .filter((item) => item?.title && item?.link && !isPromotionalNews(item) && !isLowValueNews(item))
    .sort((a, b) => timeValue(a.publishedAt) - timeValue(b.publishedAt))

  const groups = []
  for (const item of ordered) {
    const published = timeValue(item.publishedAt)
    const summary = summarizeIssueTitle(item.title)
    let group = null

    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const candidate = groups[index]
      if (published && candidate.lastPublished && published - candidate.lastPublished > ISSUE_WINDOW_MS) break
      if (comparableIssue(summary, candidate.summary)) {
        group = candidate
        break
      }
    }

    if (!group) {
      groups.push({
        summary,
        titles: new Set([summary]),
        firstPublished: published,
        lastPublished: published,
        representative: item,
        count: 1,
        sources: new Set([item.source || '뉴스']),
      })
      continue
    }

    group.count += 1
    group.lastPublished = Math.max(group.lastPublished, published)
    group.sources.add(item.source || '뉴스')
    group.titles.add(summary)
    if (summary.length > group.summary.length) group.summary = summary
    if (published >= timeValue(group.representative.publishedAt)) group.representative = item
  }

  return groups.map((group) => ({
    ...group.representative,
    summary: buildGroupSummary(group),
    publishedAt: group.firstPublished ? new Date(group.firstPublished).toISOString() : group.representative.publishedAt,
    lastPublishedAt: group.lastPublished ? new Date(group.lastPublished).toISOString() : group.representative.publishedAt,
    duplicateCount: group.count,
    sourceCount: group.sources.size,
  }))
}

function snapshotStocks(snapshot) {
  return (snapshot?.topRankings ?? [])
    .filter((item) => item?.symbol && item?.name)
    .map((item, index) => ({
      symbol: item.symbol,
      name: item.name,
      changeRate: number(item.changeRate),
      tradingAmount: number(item.tradingAmount),
      rank: index + 1,
    }))
}

function focusStocks(snapshot) {
  const stocks = snapshotStocks(snapshot).slice(0, 50)
  const selected = [...stocks]
    .sort((a, b) => {
      const aScore = (51 - Math.min(a.rank, 50)) + Math.min(30, Math.abs(a.changeRate ?? 0) * 4)
      const bScore = (51 - Math.min(b.rank, 50)) + Math.min(30, Math.abs(b.changeRate ?? 0) * 4)
      return bScore - aScore
    })
    .slice(0, 10)
  return selected
}

function matchedStocks(item, snapshot) {
  const text = `${item.title ?? ''} ${item.summary ?? ''}`.toLowerCase()
  return snapshotStocks(snapshot)
    .filter((stock) => stock.name && text.includes(String(stock.name).toLowerCase()))
    .slice(0, 4)
}

function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text))
}

function classifyIssue(item, matches) {
  const text = `${item.title ?? ''} ${item.summary ?? ''}`
  if (matchesAny(MARKET_IMPACT_PATTERNS, text)) {
    if (/이란|이스라엘|전쟁|호르무즈|중동|우크라이나|제재/i.test(text)) return '지정학'
    return '글로벌·매크로'
  }
  if (matches.length || matchesAny(STOCK_CATALYST_PATTERNS, text)) return '종목 이슈'
  return '시장 이슈'
}

function importanceScore(item, matches) {
  const text = `${item.title ?? ''} ${item.summary ?? ''}`
  let score = 0
  if (matchesAny(MARKET_IMPACT_PATTERNS, text)) score += 8
  if (matchesAny(STOCK_CATALYST_PATTERNS, text)) score += 4
  if (matches.length) score += 4
  for (const stock of matches) {
    if ((stock.rank ?? 99) <= 10) score += 2
    if (Math.abs(stock.changeRate ?? 0) >= 5) score += 3
    else if (Math.abs(stock.changeRate ?? 0) >= 3) score += 2
  }
  score += Math.min(3, Math.max(0, (item.sourceCount ?? 1) - 1))
  score += Math.min(2, Math.max(0, (item.duplicateCount ?? 1) - 1))
  return score
}

export function selectHighSignalIssues(items = [], snapshot = null) {
  const enriched = items.map((item) => {
    const matches = matchedStocks(item, snapshot)
    const importance = importanceScore(item, matches)
    return {
      ...item,
      category: classifyIssue(item, matches),
      importance,
      matches,
    }
  }).filter((item) => item.importance >= 4)

  const byHour = new Map()
  for (const item of enriched) {
    const hour = kstHourKey(item.publishedAt)
    const bucket = byHour.get(hour) ?? []
    bucket.push(item)
    byHour.set(hour, bucket)
  }

  const selected = []
  for (const bucket of byHour.values()) {
    const ranked = [...bucket].sort((a, b) => b.importance - a.importance || timeValue(a.publishedAt) - timeValue(b.publishedAt))
    const strong = ranked.filter((item) => item.importance >= 7).slice(0, MAX_PER_HOUR)
    const keep = [...strong]
    if (keep.length < TARGET_PER_HOUR) {
      for (const item of ranked) {
        if (keep.includes(item)) continue
        keep.push(item)
        if (keep.length >= TARGET_PER_HOUR || keep.length >= MAX_PER_HOUR) break
      }
    }
    selected.push(...keep.slice(0, MAX_PER_HOUR))
  }

  return selected.sort((a, b) => timeValue(a.publishedAt) - timeValue(b.publishedAt))
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

function focusQuery(snapshot) {
  const names = focusStocks(snapshot).map((stock) => `"${stock.name}"`)
  if (!names.length) return null
  return `(${names.join(' OR ')}) (급등 OR 수주 OR 계약 OR 공시 OR 실적 OR 투자 OR 승인) when:1d`
}

export class FeatureNewsService {
  constructor({ refreshMs = 180000, getSnapshot = null } = {}) {
    this.refreshMs = refreshMs
    this.getSnapshot = getSnapshot
    this.payload = { ok: false, updatedAt: null, windowStart: null, items: [], error: null }
    this.loading = null
  }

  async get() {
    const age = Date.now() - Date.parse(this.payload.updatedAt ?? 0)
    if (this.payload.ok && age < this.refreshMs) return this.payload
    if (this.loading) return this.loading
    this.loading = this.refresh().finally(() => { this.loading = null })
    return this.loading
  }

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
      const filtered = filterNewsSinceKstSix(batches.flat(), now)
      const collapsed = collapseNewsIssues(filtered)
      const items = selectHighSignalIssues(collapsed, snapshot).slice(-64)
      this.payload = {
        ok: true,
        updatedAt: new Date(now).toISOString(),
        windowStart: new Date(kstSixStart(now)).toISOString(),
        source: 'Google News RSS · 국내 급등/거래대금 집중 종목 + 글로벌 매크로/지정학 · 중복/광고/저가치 필터',
        policy: {
          maxPerHour: MAX_PER_HOUR,
          targetPerHour: TARGET_PER_HOUR,
          importanceFiltered: true,
          deduplicated: true,
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
        source: 'Google News RSS · 고신호 시황 요약',
        items: [],
        error: error instanceof Error ? error.message : String(error),
      }
      return this.payload
    }
  }
}

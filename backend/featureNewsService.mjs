const NEWS_URL = 'https://news.google.com/rss/search'
const ISSUE_WINDOW_MS = 90 * 60 * 1000

const PROMOTIONAL_PATTERNS = [
  /(?:^|\s|\[)(?:광고|홍보|PR)(?:\]|\s|$)/i,
  /리딩\s*방/i,
  /무료\s*(?:추천|체험|상담|종목|방)/i,
  /(?:카톡|카카오톡|텔레그램)\s*(?:방|채널|무료|초대)/i,
  /회원\s*(?:모집|가입)/i,
  /추천주\s*(?:공개|받기|무료)/i,
  /수익률\s*\d+(?:\.\d+)?%.*(?:무료|체험|추천)/i,
]

const TOKEN_STOP_WORDS = new Set([
  '특징주', '증시', '오늘', '코스피', '코스닥', '장중', '마감', '급등', '상승', '강세', '약세', '하락', '주가', '관련주',
  '기대', '기대감', '영향', '전망', '소식', '속보', '단독', '종목', '시장', '기자', '오전', '오후',
])

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
    .slice(0, 120)
}

export function isPromotionalNews(item = {}) {
  const haystack = `${item.title ?? ''} ${item.source ?? ''}`
  return PROMOTIONAL_PATTERNS.some((pattern) => pattern.test(haystack))
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
  return common >= 3 && overlap >= 0.55
}

function timeValue(value) {
  const parsed = Date.parse(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function collapseNewsIssues(items = []) {
  const ordered = [...items]
    .filter((item) => item?.title && item?.link && !isPromotionalNews(item))
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
    if (summary.length > group.summary.length) group.summary = summary
    if (published >= timeValue(group.representative.publishedAt)) group.representative = item
  }

  return groups.map((group) => ({
    ...group.representative,
    summary: group.summary,
    publishedAt: group.firstPublished ? new Date(group.firstPublished).toISOString() : group.representative.publishedAt,
    lastPublishedAt: group.lastPublished ? new Date(group.lastPublished).toISOString() : group.representative.publishedAt,
    duplicateCount: group.count,
    sourceCount: group.sources.size,
  }))
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

export class FeatureNewsService {
  constructor({ refreshMs = 60000 } = {}) {
    this.refreshMs = refreshMs
    this.payload = { ok: false, updatedAt: null, items: [], error: null }
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
      const batches = await Promise.all([
        fetchQuery('특징주 코스피 코스닥 when:1d'),
        fetchQuery('주식 급등 상한가 특징주 when:1d'),
      ])
      const items = collapseNewsIssues(batches.flat()).slice(-24)
      this.payload = { ok: true, updatedAt: new Date().toISOString(), source: 'Google News RSS · 중복/홍보 필터 · 원문 기사 연결', items, error: null }
      return this.payload
    } catch (error) {
      if (this.payload.items.length) return { ...this.payload, stale: true, error: error instanceof Error ? error.message : String(error) }
      this.payload = { ok: false, updatedAt: new Date().toISOString(), source: 'Google News RSS · 중복/홍보 필터 · 원문 기사 연결', items: [], error: error instanceof Error ? error.message : String(error) }
      return this.payload
    }
  }
}

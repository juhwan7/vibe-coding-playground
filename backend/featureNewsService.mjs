const NEWS_URL = 'https://news.google.com/rss/search'

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
      const seen = new Set()
      const items = batches.flat()
        .filter((item) => {
          const key = item.title.replace(/\s+/g, ' ').toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .sort((a, b) => Date.parse(b.publishedAt ?? 0) - Date.parse(a.publishedAt ?? 0))
        .slice(0, 24)
      this.payload = { ok: true, updatedAt: new Date().toISOString(), source: 'Google News RSS · 원문 기사 연결', items, error: null }
      return this.payload
    } catch (error) {
      if (this.payload.items.length) return { ...this.payload, stale: true, error: error instanceof Error ? error.message : String(error) }
      this.payload = { ok: false, updatedAt: new Date().toISOString(), source: 'Google News RSS · 원문 기사 연결', items: [], error: error instanceof Error ? error.message : String(error) }
      return this.payload
    }
  }
}

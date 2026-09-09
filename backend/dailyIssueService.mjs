import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { themesForStock } from './themeCatalog.mjs'
import { collapseNewsIssues, parseNewsRss } from './featureNewsService.mjs'
import { sleep } from './tossClient.mjs'

const NEWS_URL = 'https://news.google.com/rss/search'
const FINALIZE_MINUTE = 15 * 60 + 20
const CHART_BUCKET_MS = 5 * 60 * 1000
const EXCHANGE_TRADED_NAME = /(ETF|ETN|KODEX|TIGER|RISE|ACE|PLUS|SOL|HANARO|KOSEF|TIMEFOLIO|ARIRANG|FOCUS|KBSTAR|리츠|스팩|인프라)/i

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function kstParts(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00'
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

function rankingRecords(payload) {
  const result = payload?.result
  if (Array.isArray(result?.rankings)) return result.rankings
  if (Array.isArray(result)) return result
  return []
}

function stockRecords(payload) {
  const result = payload?.result
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.stocks)) return result.stocks
  if (Array.isArray(result?.items)) return result.items
  return []
}

function metaOf(item = {}) {
  return {
    symbol: item.symbol ?? item.stock?.symbol ?? null,
    name: item.name ?? item.stockName ?? item.displayName ?? item.shortName ?? item.stock?.name ?? null,
    market: item.market ?? item.marketName ?? item.exchange ?? item.stock?.market ?? null,
    securityType: item.securityType ?? item.stock?.securityType ?? null,
  }
}

function rankingItem(item, meta = null) {
  const rawRate = number(item?.price?.changeRate ?? item?.changeRate)
  return {
    symbol: item?.symbol ?? item?.stock?.symbol ?? meta?.symbol ?? null,
    name: meta?.name ?? item?.name ?? item?.stockName ?? item?.stock?.name ?? null,
    market: meta?.market ?? item?.market ?? item?.stock?.market ?? null,
    securityType: meta?.securityType ?? item?.securityType ?? null,
    price: number(item?.price?.lastPrice ?? item?.lastPrice),
    changeRate: rawRate != null ? rawRate * (Math.abs(rawRate) <= 1 ? 100 : 1) : null,
    tradingAmount: number(item?.tradingAmount),
  }
}

function isIndividualStock(item = {}) {
  const type = String(item.securityType ?? '').trim().toUpperCase()
  if (type) return type === 'STOCK'
  return !EXCHANGE_TRADED_NAME.test(String(item.name ?? ''))
}

function candleRecords(payload) {
  const candles = payload?.result?.candles
  if (!Array.isArray(candles)) return []
  return candles.map((candle) => ({
    timestamp: candle.timestamp ?? null,
    closePrice: number(candle.closePrice),
  })).filter((candle) => candle.timestamp && candle.closePrice != null)
}

export function buildIntradayLine(candles = []) {
  const ordered = [...candles].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  if (!ordered.length) return []
  const latestDay = kstParts(ordered.at(-1).timestamp).day
  const buckets = new Map()
  for (const candle of ordered) {
    const parsed = Date.parse(candle.timestamp)
    if (!Number.isFinite(parsed) || kstParts(candle.timestamp).day !== latestDay) continue
    const { hour, minute } = kstParts(candle.timestamp)
    const marketMinute = hour * 60 + minute
    if (marketMinute < 9 * 60 || marketMinute > FINALIZE_MINUTE + 10) continue
    const key = Math.floor(parsed / CHART_BUCKET_MS) * CHART_BUCKET_MS
    buckets.set(key, { timestamp: new Date(key).toISOString(), value: number(candle.closePrice) })
  }
  return [...buckets.values()].filter((point) => point.value != null).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

function normalizeIssueText(text = '') {
  return String(text).replace(/^\s*(?:\[[^\]]{1,30}\]\s*)+/g, '').replace(/\s+/g, ' ').trim()
}

export function summarizeStockIssues(stock, articles = []) {
  const name = String(stock?.name ?? '').trim()
  if (!name) return { summary: '직접적인 당일 뉴스 재료 확인 안 됨', articleCount: 0, sources: [], links: [] }
  const matched = articles.filter((article) => normalizeIssueText(article.title).toLowerCase().includes(name.toLowerCase()))
  const collapsed = collapseNewsIssues(matched)
    .sort((a, b) => ((b.sourceCount ?? 1) + (b.duplicateCount ?? 1)) - ((a.sourceCount ?? 1) + (a.duplicateCount ?? 1)) || Date.parse(b.publishedAt ?? 0) - Date.parse(a.publishedAt ?? 0))
    .slice(0, 3)
  if (!collapsed.length) return { summary: '직접적인 당일 뉴스 재료 확인 안 됨', articleCount: 0, sources: [], links: [] }

  const summaries = []
  for (const issue of collapsed) {
    const clean = normalizeIssueText(issue.summary || issue.title)
    if (!clean) continue
    const key = clean.toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
    if (summaries.some((item) => item.key.includes(key) || key.includes(item.key))) continue
    summaries.push({ key, text: clean })
  }
  return {
    summary: summaries.map((item) => item.text).join(' · ').slice(0, 260) || '직접적인 당일 뉴스 재료 확인 안 됨',
    articleCount: collapsed.reduce((sum, item) => sum + (item.duplicateCount ?? 1), 0),
    sources: [...new Set(collapsed.map((item) => item.source).filter(Boolean))].slice(0, 5),
    links: collapsed.map((item) => ({ title: item.title, link: item.link, source: item.source ?? '뉴스' })).slice(0, 3),
  }
}

export function sortDailyIssueRows(rows = []) {
  return [...rows].sort((a, b) => (number(b.changeRate) ?? -Infinity) - (number(a.changeRate) ?? -Infinity) || (number(b.tradingAmount) ?? 0) - (number(a.tradingAmount) ?? 0))
}

async function fetchNewsQuery(query) {
  const params = new URLSearchParams({ q: query, hl: 'ko', gl: 'KR', ceid: 'KR:ko' })
  const response = await fetch(`${NEWS_URL}?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 market-flow/1.0', Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(9000),
  })
  if (!response.ok) throw new Error(`뉴스 RSS 조회 실패 (${response.status})`)
  return parseNewsRss(await response.text())
}

function articleQueries(stocks) {
  const names = stocks.map((stock) => stock.name).filter(Boolean)
  const queries = []
  for (let index = 0; index < names.length; index += 8) {
    const group = names.slice(index, index + 8).map((name) => `"${name}"`).join(' OR ')
    queries.push(`(${group}) when:1d`)
  }
  return queries
}

async function mapLimit(items, limit, worker) {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (item == null) return
      await worker(item)
    }
  })
  await Promise.all(workers)
}

export class DailyIssueService {
  constructor(client, {
    cachePath = process.env.DAILY_ISSUE_CACHE_PATH || '/app/data/daily-issues.json',
    checkMs = 30000,
  } = {}) {
    this.client = client
    this.cachePath = cachePath
    this.checkMs = Math.max(10000, Number(checkMs) || 30000)
    this.payload = { ok: false, status: 'waiting', date: null, capturedAt: null, rows: [], error: null }
    this.timer = null
    this.running = false
    this.generating = null
  }

  async load() {
    try {
      const saved = JSON.parse(await readFile(this.cachePath, 'utf8'))
      if (saved?.rows) this.payload = saved
    } catch {}
  }

  async persist() {
    await mkdir(dirname(this.cachePath), { recursive: true })
    const temp = `${this.cachePath}.tmp`
    await writeFile(temp, JSON.stringify(this.payload), 'utf8')
    await rename(temp, this.cachePath)
  }

  async start() {
    if (this.running) return
    this.running = true
    await this.load()
    await this.check().catch(() => {})
    this.schedule()
  }

  stop() {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
  }

  schedule() {
    if (!this.running) return
    this.timer = setTimeout(async () => {
      await this.check().catch(() => {})
      this.schedule()
    }, this.checkMs)
    this.timer.unref?.()
  }

  async get() {
    await this.check().catch(() => {})
    return this.currentPayload()
  }

  currentPayload() {
    const now = kstParts()
    const currentDay = now.day
    const marketMinute = now.hour * 60 + now.minute
    if (this.payload?.ok && this.payload.date === currentDay) return this.payload
    return {
      ok: false,
      status: marketMinute < FINALIZE_MINUTE ? 'waiting' : this.generating ? 'generating' : 'pending',
      date: currentDay,
      capturedAt: null,
      targetTime: '15:20',
      rows: [],
      error: this.payload?.error ?? null,
    }
  }

  async check() {
    const now = kstParts()
    const marketMinute = now.hour * 60 + now.minute
    if (marketMinute < FINALIZE_MINUTE) return this.currentPayload()
    if (this.payload?.ok && this.payload.date === now.day) return this.payload
    if (!this.client.configured) return this.currentPayload()
    if (this.generating) return this.generating
    this.generating = this.generate(now.day).finally(() => { this.generating = null })
    return this.generating
  }

  async generate(day) {
    try {
      const rankingPayload = await this.client.request('/api/v1/rankings?type=MARKET_TRADING_AMOUNT&marketCountry=KR&duration=1d&count=150', { priority: 'critical', dedupe: false })
      const rawRankings = rankingRecords(rankingPayload)
      const symbols = rawRankings.map((item) => item?.symbol ?? item?.stock?.symbol).filter(Boolean)
      const metaPayload = symbols.length ? await this.client.request(`/api/v1/stocks?symbols=${encodeURIComponent(symbols.join(','))}`, { priority: 'background' }).catch(() => null) : null
      const metaMap = new Map(stockRecords(metaPayload).map((item) => {
        const meta = metaOf(item)
        return [meta.symbol, meta]
      }).filter(([symbol]) => symbol))

      const stocks = rawRankings
        .map((item) => {
          const symbol = item?.symbol ?? item?.stock?.symbol ?? null
          return rankingItem(item, metaMap.get(symbol))
        })
        .filter((item) => item.symbol && item.name && isIndividualStock(item))
        .slice(0, 100)

      const newsBatches = await Promise.all(articleQueries(stocks).map((query) => fetchNewsQuery(query).catch(() => [])))
      const articles = newsBatches.flat()
      const chartMap = new Map()

      await mapLimit(stocks, 4, async (stock) => {
        const query = new URLSearchParams({ symbol: stock.symbol, interval: '1m', count: '400', adjusted: 'true' })
        const payload = await this.client.request(`/api/v1/candles?${query.toString()}`, { priority: 'background', dedupe: false }).catch(() => null)
        chartMap.set(stock.symbol, buildIntradayLine(candleRecords(payload)))
        await sleep(40)
      })

      const rows = sortDailyIssueRows(stocks.map((stock) => {
        const issue = summarizeStockIssues(stock, articles)
        const themes = themesForStock(stock.symbol, stock.name)
        return {
          symbol: stock.symbol,
          name: stock.name,
          market: stock.market,
          theme: themes.length ? themes.join(' · ') : '기타',
          price: stock.price,
          changeRate: stock.changeRate,
          tradingAmount: stock.tradingAmount,
          issueSummary: issue.summary,
          articleCount: issue.articleCount,
          sources: issue.sources,
          links: issue.links,
          intraday: chartMap.get(stock.symbol) ?? [],
        }
      }))

      this.payload = {
        ok: true,
        status: 'finalized',
        date: day,
        targetTime: '15:20',
        capturedAt: new Date().toISOString(),
        source: '토스증권 Open API 거래대금 랭킹/1분봉 + Google News RSS',
        sort: 'changeRate-desc',
        rows,
        error: null,
      }
      await this.persist().catch(() => {})
      return this.payload
    } catch (error) {
      this.payload = { ...this.payload, error: error instanceof Error ? error.message : String(error) }
      return this.currentPayload()
    }
  }
}

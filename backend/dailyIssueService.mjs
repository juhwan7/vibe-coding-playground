import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { themesForStock } from './themeCatalog.mjs'
import { cachedDescriptionForStock, classifyStockSector } from './stockClassification.mjs'
import { collapseNewsIssues, parseNewsRss } from './featureNewsService.mjs'
import { sleep } from './tossClient.mjs'

const NEWS_URL = 'https://news.google.com/rss/search'
const FINALIZE_MINUTE = 15 * 60 + 31
const TARGET_CLOSE_TIME = '15:30'
const REGULAR_SESSION_START_MINUTE = 9 * 60
const REGULAR_SESSION_END_MINUTE = 15 * 60 + 30
const TWO_DAY_BACKFILL_MAX_PAGES = 6
const DAILY_CONTEXT_COUNT = 30
const STOCK_META_CHUNK_SIZE = 25
const DAILY_ISSUE_SCHEMA_VERSION = 5
const EXCHANGE_TRADED_NAME = /(ETF|ETN|KODEX|TIGER|RISE|ACE|PLUS|SOL|HANARO|KOSEF|TIMEFOLIO|ARIRANG|FOCUS|KBSTAR|리츠|스팩|인프라)/i
const POSITIVE_NEWS_CUE = /(상승|강세|급등|상한가|오름세|랠리|수혜|호재|기대감|부각|신고가)/i
const BUSINESS_HINT = /(주력|주요|사업|영위|생산|제조|판매|개발|서비스|플랫폼|제품|매출|반도체|메모리|HBM|DRAM|NAND|배터리|이차전지|2차전지|자동차|바이오|의약|원전|조선|방산|전력|변압기|금융|은행|증권|보험|통신|게임|화학|철강|건설|로봇|콘텐츠|유통)/i
const HISTORY_HINT = /(설립|상호|최대주주|사명|변경|편입|인수)/

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
    openPrice: number(candle.openPrice),
    highPrice: number(candle.highPrice),
    lowPrice: number(candle.lowPrice),
    closePrice: number(candle.closePrice),
    volume: number(candle.volume),
  })).filter((candle) => candle.timestamp && [candle.openPrice, candle.highPrice, candle.lowPrice, candle.closePrice].every((value) => value != null))
}

function mergeCandles(existing = [], incoming = []) {
  const byTimestamp = new Map()
  for (const candle of [...existing, ...incoming]) {
    if (!candle?.timestamp || candle.closePrice == null) continue
    byTimestamp.set(candle.timestamp, candle)
  }
  return [...byTimestamp.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

function marketMinute(timestamp) {
  const { hour, minute } = kstParts(timestamp)
  return hour * 60 + minute
}

function hasFullPreviousTradingDay(candles = []) {
  const session = candles.filter((candle) => {
    const minute = marketMinute(candle.timestamp)
    return minute >= REGULAR_SESSION_START_MINUTE && minute <= REGULAR_SESSION_END_MINUTE
  })
  const days = [...new Set(session.map((candle) => kstParts(candle.timestamp).day))].sort()
  if (days.length < 2) return false
  const previousDay = days.at(-2)
  const previous = session.filter((candle) => kstParts(candle.timestamp).day === previousDay)
  if (!previous.length) return false
  const firstMinute = Math.min(...previous.map((candle) => marketMinute(candle.timestamp)))
  return firstMinute <= REGULAR_SESSION_START_MINUTE + 2
}

function ohlcPoint(candle) {
  const open = number(candle?.openPrice)
  const high = number(candle?.highPrice)
  const low = number(candle?.lowPrice)
  const close = number(candle?.closePrice)
  if (!candle?.timestamp || [open, high, low, close].some((value) => value == null)) return null
  return { timestamp: candle.timestamp, open, high, low, close, volume: number(candle.volume) }
}

export function buildTwoDayIntraday(candles = [], dayCount = 2) {
  const ordered = [...candles]
    .filter((candle) => candle?.timestamp && candle.closePrice != null && Number.isFinite(Date.parse(candle.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const session = ordered.filter((candle) => {
    const minute = marketMinute(candle.timestamp)
    return minute >= REGULAR_SESSION_START_MINUTE && minute <= REGULAR_SESSION_END_MINUTE
  })
  const selectedDays = [...new Set(session.map((candle) => kstParts(candle.timestamp).day))]
    .sort()
    .slice(-Math.max(1, dayCount))

  return selectedDays.map((day) => ({
    date: day,
    points: session
      .filter((candle) => kstParts(candle.timestamp).day === day)
      .map(ohlcPoint)
      .filter(Boolean),
  })).filter((day) => day.points.length)
}

export function buildIntradayLine(candles = []) {
  return (buildTwoDayIntraday(candles, 1).at(-1)?.points ?? []).map((point) => ({ timestamp: point.timestamp, value: point.close }))
}

export function buildDailyBars(candles = [], count = DAILY_CONTEXT_COUNT) {
  return [...candles]
    .filter((candle) => candle?.timestamp && Number.isFinite(Date.parse(candle.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map(ohlcPoint)
    .filter(Boolean)
    .slice(-Math.max(1, count))
}

function normalizeIssueText(text = '') {
  return String(text).replace(/^\s*(?:\[[^\]]{1,30}\]\s*)+/g, '').replace(/\s+/g, ' ').trim()
}

function normalizeKrCode(symbol) {
  const match = String(symbol ?? '').trim().match(/(\d{6})$/)
  return match?.[1] ?? null
}

export function compactCompanySummary(description) {
  const text = String(description ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)
  const selected = (sentences.length ? sentences : [text])
    .map((sentence, index) => ({
      sentence,
      score: (BUSINESS_HINT.test(sentence) ? 5 : 0) + (/주력|주요 사업|주요사업/.test(sentence) ? 2 : 0) - (HISTORY_HINT.test(sentence) ? 3 : 0) - index * 0.01,
    }))
    .sort((a, b) => b.score - a.score)[0]?.sentence ?? text

  let concise = selected
    .replace(/^기업개요\s*/, '')
    .replace(/^(동사|당사|회사는)\s*/, '')
    .replace(/\s*(하고|하며)\s*있음\.?$/, '')
    .replace(/\s*영위하고\s*있음\.?$/, ' 영위')
    .replace(/\s*하는\s*기업임\.?$/, '')
    .replace(/\s*기업임\.?$/, '')
    .replace(/[.]$/, '')
    .trim()
  if (concise.length > 84) concise = `${concise.slice(0, 82).trim()}…`
  return concise || null
}

export function summarizeStockIssues(stock, articles = []) {
  const name = String(stock?.name ?? '').trim()
  if (!name) return { summary: '상승 이유 확인 안 됨', reasonType: 'unconfirmed', reasonTheme: null, articleCount: 0, sources: [], links: [] }
  const matched = articles.filter((article) => normalizeIssueText(article.title).toLowerCase().includes(name.toLowerCase()))
  const collapsed = collapseNewsIssues(matched)
    .sort((a, b) => ((b.sourceCount ?? 1) + (b.duplicateCount ?? 1)) - ((a.sourceCount ?? 1) + (a.duplicateCount ?? 1)) || Date.parse(b.publishedAt ?? 0) - Date.parse(a.publishedAt ?? 0))
    .slice(0, 3)
  if (!collapsed.length) {
    return {
      summary: (number(stock?.changeRate) ?? 0) > 0 ? '상승 이유 확인 안 됨' : '직접적인 당일 뉴스 재료 확인 안 됨',
      reasonType: 'unconfirmed',
      reasonTheme: null,
      articleCount: 0,
      sources: [],
      links: [],
    }
  }

  const summaries = []
  for (const issue of collapsed) {
    const clean = normalizeIssueText(issue.summary || issue.title)
    if (!clean) continue
    const key = clean.toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
    if (summaries.some((item) => item.key.includes(key) || key.includes(item.key))) continue
    summaries.push({ key, text: clean })
  }
  return {
    summary: summaries.map((item) => item.text).join(' · ').slice(0, 300) || '상승 이유 확인 안 됨',
    reasonType: 'direct-news',
    reasonTheme: null,
    articleCount: collapsed.reduce((sum, item) => sum + (item.duplicateCount ?? 1), 0),
    sources: [...new Set(collapsed.map((item) => item.source).filter(Boolean))].slice(0, 5),
    links: collapsed.map((item) => ({ title: item.title, link: item.link, source: item.source ?? '뉴스' })).slice(0, 3),
  }
}

export function buildThemeNewsEvidence(stocks = [], articles = []) {
  const evidence = new Map()
  for (const article of articles) {
    const title = normalizeIssueText(article?.title)
    if (!title || !POSITIVE_NEWS_CUE.test(title)) continue
    const lowerTitle = title.toLowerCase()
    for (const stock of stocks) {
      const name = String(stock?.name ?? '').trim()
      if (!name || (number(stock?.changeRate) ?? 0) <= 0 || !lowerTitle.includes(name.toLowerCase())) continue
      for (const theme of stock.themeLabels ?? []) {
        if (!theme || theme === '기타·개별주') continue
        const list = evidence.get(theme) ?? []
        list.push(article)
        evidence.set(theme, list)
      }
    }
  }
  return evidence
}

export function summarizeThemeFallback(stock, themeLabels = [], themeEvidence = new Map()) {
  if ((number(stock?.changeRate) ?? 0) <= 0) return null
  const candidates = themeLabels.flatMap((theme) => {
    const collapsed = collapseNewsIssues(themeEvidence.get(theme) ?? [])
      .sort((a, b) => ((b.sourceCount ?? 1) + (b.duplicateCount ?? 1)) - ((a.sourceCount ?? 1) + (a.duplicateCount ?? 1)) || Date.parse(b.publishedAt ?? 0) - Date.parse(a.publishedAt ?? 0))
      .slice(0, 3)
    if (!collapsed.length) return []
    return [{ theme, collapsed, score: collapsed.reduce((sum, item) => sum + (item.duplicateCount ?? 1), 0) }]
  }).sort((a, b) => b.score - a.score)

  const best = candidates[0]
  if (!best) return null
  const lead = normalizeIssueText(best.collapsed[0]?.summary || best.collapsed[0]?.title)
  return {
    summary: `${best.theme} 테마 동반 강세 영향으로 추정${lead ? ` · ${lead.slice(0, 170)}` : ''}`,
    reasonType: 'theme-news',
    reasonTheme: best.theme,
    articleCount: best.score,
    sources: [...new Set(best.collapsed.map((item) => item.source).filter(Boolean))].slice(0, 5),
    links: best.collapsed.map((item) => ({ title: item.title, link: item.link, source: item.source ?? '뉴스' })).slice(0, 3),
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
    this.payload = { ok: false, status: 'waiting', schemaVersion: DAILY_ISSUE_SCHEMA_VERSION, date: null, capturedAt: null, targetTime: TARGET_CLOSE_TIME, rows: [], error: null }
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

  isFinalForDay(day) {
    return Boolean(
      this.payload?.ok
      && this.payload.date === day
      && this.payload.schemaVersion === DAILY_ISSUE_SCHEMA_VERSION
      && this.payload.status === 'finalized'
      && this.payload.targetTime === TARGET_CLOSE_TIME
      && Array.isArray(this.payload.rows)
      && this.payload.rows.length,
    )
  }

  currentPayload() {
    const now = kstParts()
    const currentDay = now.day
    const currentMinute = now.hour * 60 + now.minute
    if (this.isFinalForDay(currentDay)) return this.payload

    const sameDay = this.payload?.date === currentDay
    const fallbackRows = sameDay && Array.isArray(this.payload?.rows) ? this.payload.rows : []
    const status = currentMinute < FINALIZE_MINUTE
      ? 'waiting'
      : this.generating ? 'generating' : 'pending'

    return {
      ...(sameDay ? this.payload : {}),
      ok: fallbackRows.length > 0,
      status,
      schemaVersion: DAILY_ISSUE_SCHEMA_VERSION,
      date: currentDay,
      capturedAt: sameDay ? this.payload?.capturedAt ?? null : null,
      targetTime: TARGET_CLOSE_TIME,
      rows: fallbackRows,
      stale: fallbackRows.length > 0,
      error: this.payload?.error ?? null,
    }
  }

  async check() {
    const now = kstParts()
    const currentMinute = now.hour * 60 + now.minute
    if (currentMinute < FINALIZE_MINUTE) return this.currentPayload()
    if (this.isFinalForDay(now.day)) return this.payload
    if (!this.client.configured) return this.currentPayload()
    if (this.generating) return this.currentPayload()
    this.generating = this.generate(now.day).finally(() => { this.generating = null })
    return this.currentPayload()
  }

  async fetchStockMetadata(symbols = []) {
    const metaMap = new Map()
    const unique = [...new Set(symbols.filter(Boolean))]
    for (let index = 0; index < unique.length; index += STOCK_META_CHUNK_SIZE) {
      const chunk = unique.slice(index, index + STOCK_META_CHUNK_SIZE)
      const payload = await this.client.request(`/api/v1/stocks?symbols=${encodeURIComponent(chunk.join(','))}`, { priority: 'background', dedupe: false }).catch(() => null)
      for (const item of stockRecords(payload)) {
        const meta = metaOf(item)
        if (meta.symbol) metaMap.set(meta.symbol, meta)
      }
      await sleep(20)
    }
    return metaMap
  }

  async fetchTwoTradingDayCandles(symbol) {
    let before = null
    let merged = []
    for (let page = 0; page < TWO_DAY_BACKFILL_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ symbol, interval: '1m', count: '200', adjusted: 'true' })
      if (before) query.set('before', before)
      const payload = await this.client.request(`/api/v1/candles?${query.toString()}`, { priority: 'background', dedupe: false }).catch(() => null)
      const candles = candleRecords(payload)
      if (!candles.length) break
      merged = mergeCandles(merged, candles)
      if (hasFullPreviousTradingDay(merged)) break
      const nextBefore = payload?.result?.nextBefore ?? null
      if (!nextBefore || nextBefore === before) break
      before = nextBefore
      await sleep(40)
    }
    return merged
  }

  async fetchDailyCandles(symbol) {
    const query = new URLSearchParams({ symbol, interval: '1d', count: String(DAILY_CONTEXT_COUNT), adjusted: 'true' })
    const payload = await this.client.request(`/api/v1/candles?${query.toString()}`, { priority: 'background', dedupe: false }).catch(() => null)
    return candleRecords(payload)
  }

  async generate(day) {
    try {
      const previousRows = this.payload?.date === day && Array.isArray(this.payload?.rows) ? this.payload.rows : []
      const previousBySymbol = new Map(previousRows.map((row) => [row.symbol, row]))
      const rankingPayload = await this.client.request('/api/v1/rankings?type=MARKET_TRADING_AMOUNT&marketCountry=KR&duration=1d&count=100', { priority: 'critical', dedupe: false })
      const rawRankings = rankingRecords(rankingPayload)
      if (!rawRankings.length) throw new Error('금일 거래대금 랭킹을 받지 못했습니다. 잠시 후 자동 재시도합니다.')

      const symbols = rawRankings.map((item) => item?.symbol ?? item?.stock?.symbol).filter(Boolean)
      const metaMap = await this.fetchStockMetadata(symbols)

      const stocks = rawRankings
        .map((item) => {
          const symbol = item?.symbol ?? item?.stock?.symbol ?? null
          return rankingItem(item, metaMap.get(symbol) ?? previousBySymbol.get(symbol))
        })
        .filter((item) => item.symbol && item.name && isIndividualStock(item))
        .slice(0, 100)
        .map((stock) => {
          const code = normalizeKrCode(stock.symbol)
          const description = code ? cachedDescriptionForStock(code) : null
          const catalogThemes = themesForStock(code ?? stock.symbol, stock.name, description)
          const sector = classifyStockSector({ symbol: code, name: stock.name, description })
          const themeLabels = [...new Set([...catalogThemes, sector.label].filter((label) => label && label !== '기타·개별주'))]
          return {
            ...stock,
            code,
            description,
            companySummary: compactCompanySummary(description),
            companySummarySource: description ? 'company-overview' : sector.source,
            displayTheme: catalogThemes.length ? catalogThemes.join(' · ') : sector.label,
            themeLabels,
          }
        })

      if (!stocks.length) throw new Error('TOP100 종목 메타데이터를 확인하지 못했습니다. 기존 데이터를 유지하고 자동 재시도합니다.')

      const newsBatches = await Promise.all(articleQueries(stocks).map((query) => fetchNewsQuery(query).catch(() => [])))
      const articles = newsBatches.flat()
      const themeEvidence = buildThemeNewsEvidence(stocks, articles)

      const baseRows = sortDailyIssueRows(stocks.map((stock) => {
        const directIssue = summarizeStockIssues(stock, articles)
        const issue = directIssue.reasonType === 'direct-news'
          ? directIssue
          : (summarizeThemeFallback(stock, stock.themeLabels, themeEvidence) ?? directIssue)
        const previous = previousBySymbol.get(stock.symbol)
        return {
          symbol: stock.symbol,
          name: stock.name,
          market: stock.market,
          theme: stock.displayTheme || '기타·개별주',
          companySummary: stock.companySummary,
          companySummarySource: stock.companySummarySource,
          price: stock.price,
          changeRate: stock.changeRate,
          tradingAmount: stock.tradingAmount,
          issueSummary: issue.summary,
          reasonType: issue.reasonType,
          reasonTheme: issue.reasonTheme,
          articleCount: issue.articleCount,
          sources: issue.sources,
          links: issue.links,
          intraday: previous?.intraday ?? [],
          daily: previous?.daily ?? [],
        }
      }))

      this.payload = {
        ok: true,
        status: 'generating',
        schemaVersion: DAILY_ISSUE_SCHEMA_VERSION,
        date: day,
        targetTime: TARGET_CLOSE_TIME,
        capturedAt: new Date().toISOString(),
        source: '15:30 종가 기준 TOP100·뉴스 정리 완료 · OHLC 차트 갱신 중',
        sort: 'changeRate-desc',
        rows: baseRows,
        stale: true,
        error: null,
      }
      await this.persist().catch(() => {})

      let completed = 0
      const chartStocks = sortDailyIssueRows(stocks)
      await mapLimit(chartStocks, 4, async (stock) => {
        const [minuteCandles, dailyCandles] = await Promise.all([
          this.fetchTwoTradingDayCandles(stock.symbol),
          this.fetchDailyCandles(stock.symbol),
        ])
        const chart = {
          intraday: buildTwoDayIntraday(minuteCandles, 2),
          daily: buildDailyBars(dailyCandles, DAILY_CONTEXT_COUNT),
        }
        this.payload = {
          ...this.payload,
          rows: (this.payload.rows ?? []).map((row) => row.symbol === stock.symbol ? { ...row, ...chart } : row),
        }
        completed += 1
        if (completed % 10 === 0) await this.persist().catch(() => {})
        await sleep(40)
      })

      this.payload = {
        ...this.payload,
        ok: true,
        status: 'finalized',
        targetTime: TARGET_CLOSE_TIME,
        capturedAt: new Date().toISOString(),
        source: '토스증권 Open API 15:30 종가 거래대금 랭킹/전일+오늘 실제 1분 OHLC/최근 30거래일 일봉 OHLC + Google News RSS + Npay/FnGuide 기업개요 캐시',
        stale: false,
        error: null,
      }
      await this.persist().catch(() => {})
      return this.payload
    } catch (error) {
      this.payload = {
        ...this.payload,
        status: 'pending',
        targetTime: TARGET_CLOSE_TIME,
        stale: Array.isArray(this.payload?.rows) && this.payload.rows.length > 0,
        error: error instanceof Error ? error.message : String(error),
      }
      await this.persist().catch(() => {})
      return this.currentPayload()
    }
  }
}
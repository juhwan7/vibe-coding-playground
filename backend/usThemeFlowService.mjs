import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { buildUsThemeGroups } from './usThemeCatalog.mjs'
import { sleep } from './tossClient.mjs'

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function rankingItem(item) {
  const rate = item?.price?.changeRate != null ? number(item.price.changeRate) : number(item?.changeRate)
  return {
    rank: number(item?.rank),
    symbol: item?.symbol ?? item?.stock?.symbol ?? null,
    name: item?.name ?? item?.stockName ?? item?.stock?.name ?? null,
    market: item?.market ?? item?.stock?.market ?? null,
    currency: item?.currency ?? 'USD',
    lastPrice: number(item?.price?.lastPrice ?? item?.lastPrice),
    basePrice: number(item?.price?.basePrice ?? item?.basePrice),
    changeRate: rate != null ? rate * (Math.abs(rate) <= 1 ? 100 : 1) : null,
    tradingAmount: number(item?.tradingAmount),
    tradingVolume: number(item?.tradingVolume),
  }
}

const US_RANKING_CANDIDATES = [
  {
    type: 'MARKET_TRADING_AMOUNT',
    duration: '1d',
    source: 'market-1d',
    label: '미국 시장 전체 · 1일 거래대금',
    isMarketWide: true,
  },
  {
    type: 'MARKET_TRADING_AMOUNT',
    duration: 'realtime',
    source: 'market-realtime',
    label: '미국 시장 전체 · 실시간 거래대금',
    isMarketWide: true,
  },
  {
    type: 'TOSS_SECURITIES_TRADING_AMOUNT',
    duration: '1d',
    source: 'toss-1d-fallback',
    label: '토스증권 체결 · 1일 거래대금 (시장전체 랭킹 미집계 시 대체)',
    isMarketWide: false,
  },
]

export async function loadUsRanking(client) {
  const attempts = []
  let lastError = null

  for (const candidate of US_RANKING_CANDIDATES) {
    const query = new URLSearchParams({
      type: candidate.type,
      marketCountry: 'US',
      duration: candidate.duration,
      count: '100',
    })
    try {
      const payload = await client.request(`/api/v1/rankings?${query.toString()}`)
      const rankings = (payload?.result?.rankings ?? []).map(rankingItem).filter((item) => item.symbol)
      attempts.push({
        type: candidate.type,
        duration: candidate.duration,
        source: candidate.source,
        count: rankings.length,
        rankedAt: payload?.result?.rankedAt ?? null,
        error: null,
      })
      if (rankings.length) return { ...candidate, payload, rankings, attempts, error: null }
    } catch (error) {
      lastError = error
      attempts.push({
        type: candidate.type,
        duration: candidate.duration,
        source: candidate.source,
        count: 0,
        rankedAt: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    payload: null,
    rankings: [],
    attempts,
    source: null,
    label: null,
    isMarketWide: false,
    type: null,
    duration: null,
    error: lastError instanceof Error
      ? lastError.message
      : '토스증권 미국 거래대금 랭킹이 현재 모든 조회 방식에서 빈 배열을 반환했습니다.',
  }
}

function stockRecords(payload) {
  const result = payload?.result
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.stocks)) return result.stocks
  if (Array.isArray(result?.items)) return result.items
  if (Array.isArray(result?.records)) return result.records
  return []
}

function stockMeta(item) {
  return {
    symbol: item?.symbol ?? item?.stock?.symbol ?? null,
    name: item?.name ?? item?.stockName ?? item?.displayName ?? item?.shortName ?? item?.stock?.name ?? null,
    englishName: item?.englishName ?? null,
    market: item?.market ?? item?.marketName ?? item?.exchange ?? item?.stock?.market ?? null,
    securityType: item?.securityType ?? null,
    isCommonShare: item?.isCommonShare ?? null,
    currency: item?.currency ?? 'USD',
  }
}

function candleRecords(payload) {
  const candles = payload?.result?.candles
  if (!Array.isArray(candles)) return []
  return candles.map((candle) => {
    const open = number(candle.openPrice)
    const high = number(candle.highPrice)
    const low = number(candle.lowPrice)
    const close = number(candle.closePrice)
    const volume = number(candle.volume) ?? 0
    const prices = [open, high, low, close].filter((value) => value != null)
    const averagePrice = prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : close
    return {
      timestamp: candle.timestamp ?? null,
      closePrice: close,
      volume,
      tradingAmount: averagePrice != null ? averagePrice * volume : 0,
    }
  }).filter((candle) => candle.timestamp && candle.closePrice != null)
}

function usDateKey(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp))
}

function usMinuteOfDay(timestamp) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(timestamp))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

function isRegularCandle(candle) {
  const minute = usMinuteOfDay(candle.timestamp)
  return minute >= 570 && minute <= 960
}

function mergeCandles(existing, incoming, maxItems = 5000) {
  const map = new Map()
  for (const candle of [...existing, ...incoming]) {
    if (!candle?.timestamp || candle.closePrice == null || !isRegularCandle(candle)) continue
    map.set(candle.timestamp, {
      timestamp: candle.timestamp,
      closePrice: number(candle.closePrice),
      volume: number(candle.volume) ?? 0,
      tradingAmount: number(candle.tradingAmount) ?? ((number(candle.closePrice) ?? 0) * (number(candle.volume) ?? 0)),
    })
  }
  const merged = [...map.values()]
    .filter((candle) => candle.closePrice != null)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const days = [...new Set(merged.map((candle) => usDateKey(candle.timestamp)))].sort()
  const keepDays = new Set(days.slice(-5))
  return merged.filter((candle) => keepDays.has(usDateKey(candle.timestamp))).slice(-maxItems)
}

function hasFullPreviousTradingDay(candles) {
  const days = [...new Set(candles.map((candle) => usDateKey(candle.timestamp)))].sort()
  if (days.length < 2) return false
  const previousDay = days[days.length - 2]
  const previous = candles.filter((candle) => usDateKey(candle.timestamp) === previousDay)
  if (!previous.length) return false
  const minutes = previous.map((candle) => usMinuteOfDay(candle.timestamp))
  return Math.min(...minutes) <= 575 && Math.max(...minutes) >= 950
}

function recentTradingDayFilter(memberSeries, count = 2) {
  const days = [...new Set(memberSeries.flatMap(({ candles }) => candles.map((candle) => usDateKey(candle.timestamp))))].sort()
  const selected = new Set(days.slice(-count))
  return memberSeries.map(({ symbol, candles }) => ({
    symbol,
    candles: candles.filter((candle) => selected.has(usDateKey(candle.timestamp)) && isRegularCandle(candle)),
  }))
}

function bucket3m(timestamp) {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) return null
  return Math.floor(time / 180000) * 180000
}

function nearestDelta(points, minutes) {
  if (!points.length) return null
  const last = points[points.length - 1]
  const target = Date.parse(last.timestamp) - minutes * 60000
  let nearest = null
  let nearestGap = Infinity
  for (const point of points) {
    if (point.day !== last.day) continue
    const gap = Math.abs(Date.parse(point.timestamp) - target)
    if (gap < nearestGap) {
      nearest = point
      nearestGap = gap
    }
  }
  if (!nearest || nearestGap > 15 * 60000) return null
  return last.value - nearest.value
}

export function aggregateUsThemeSeries(memberSeries) {
  const buckets = new Map()
  for (const { symbol, candles } of memberSeries) {
    if (!candles?.length) continue
    const baseline = candles.find((candle) => candle.closePrice != null)?.closePrice
    if (!baseline) continue
    const perBucket = new Map()
    for (const candle of candles) {
      const key = bucket3m(candle.timestamp)
      if (key == null || candle.closePrice == null) continue
      const current = perBucket.get(key) ?? { timestamp: new Date(key).toISOString(), value: null, volume: 0, tradingAmount: 0 }
      current.value = (candle.closePrice / baseline - 1) * 100
      current.volume += candle.volume ?? 0
      current.tradingAmount += candle.tradingAmount ?? (candle.closePrice * (candle.volume ?? 0))
      perBucket.set(key, current)
    }
    for (const [key, point] of perBucket) {
      const aggregate = buckets.get(key) ?? { timestamp: point.timestamp, values: [], volume: 0, tradingAmount: 0, symbols: new Set() }
      aggregate.values.push(point.value)
      aggregate.volume += point.volume
      aggregate.tradingAmount += point.tradingAmount
      aggregate.symbols.add(symbol)
      buckets.set(key, aggregate)
    }
  }

  return [...buckets.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((bucket) => ({
      timestamp: bucket.timestamp,
      value: bucket.values.reduce((sum, value) => sum + value, 0) / Math.max(1, bucket.values.length),
      volume: bucket.volume,
      tradingAmount: bucket.tradingAmount,
      memberCount: bucket.symbols.size,
      day: usDateKey(bucket.timestamp),
    }))
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

function usSessionActive() {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date())
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  return hour >= 4 && hour <= 20
}

export class UsThemeFlowService {
  constructor(client, {
    refreshMs = 60000,
    cachePath = process.env.US_THEME_CANDLE_CACHE_PATH || '/app/data/us-theme-candles.json',
  } = {}) {
    this.client = client
    this.refreshMs = refreshMs
    this.cachePath = cachePath
    this.stockMeta = new Map()
    this.metaUpdatedAt = 0
    this.candleCache = new Map()
    this.cacheLoaded = false
    this.payload = {
      ok: false,
      updatedAt: null,
      rankedAt: null,
      marketTradingAmount: null,
      topRankings: [],
      themes: [],
      stage: 'initializing',
      rankingSource: null,
      rankingLabel: null,
      rankingAttempts: [],
      error: '초기화 중',
    }
    this.timer = null
    this.running = false
    this.refreshing = false
  }

  async start() {
    if (this.running) return
    this.running = true
    await this.loadPersistedCache().catch(() => {})
    await this.refresh().catch(() => {})
    this.schedule()
  }

  stop() {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
  }

  schedule() {
    if (!this.running) return
    this.timer = setTimeout(async () => {
      await this.refresh().catch(() => {})
      this.schedule()
    }, usSessionActive() ? this.refreshMs : Math.max(this.refreshMs, 300000))
    this.timer.unref?.()
  }

  async loadPersistedCache() {
    if (this.cacheLoaded) return
    this.cacheLoaded = true
    try {
      const text = await readFile(this.cachePath, 'utf8')
      const saved = JSON.parse(text)
      for (const [symbol, candles] of Object.entries(saved?.candles ?? {})) {
        if (Array.isArray(candles)) this.candleCache.set(symbol, mergeCandles([], candles))
      }
    } catch {
      // 첫 실행이거나 캐시가 없으면 Toss 분봉으로 백필한다.
    }
  }

  async persistCache() {
    await mkdir(dirname(this.cachePath), { recursive: true })
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      candles: Object.fromEntries([...this.candleCache.entries()].map(([symbol, candles]) => [symbol, candles])),
    }
    const tempPath = `${this.cachePath}.tmp`
    await writeFile(tempPath, JSON.stringify(payload), 'utf8')
    await rename(tempPath, this.cachePath)
  }

  async ensureMeta(symbols) {
    if (!symbols.length) return
    const missing = symbols.some((symbol) => !this.stockMeta.has(symbol))
    if (!missing && Date.now() - this.metaUpdatedAt < 6 * 60 * 60 * 1000) return
    const encoded = encodeURIComponent(symbols.join(','))
    const payload = await this.client.request(`/api/v1/stocks?symbols=${encoded}`)
    for (const record of stockRecords(payload)) {
      const meta = stockMeta(record)
      if (meta.symbol) this.stockMeta.set(meta.symbol, meta)
    }
    this.metaUpdatedAt = Date.now()
  }

  enrichRanking(item) {
    const meta = item?.symbol ? this.stockMeta.get(item.symbol) : null
    return {
      ...item,
      name: meta?.name ?? item?.name ?? item?.symbol ?? null,
      englishName: meta?.englishName ?? null,
      market: meta?.market ?? item?.market ?? null,
      securityType: meta?.securityType ?? null,
      isCommonShare: meta?.isCommonShare ?? null,
      currency: meta?.currency ?? item?.currency ?? 'USD',
    }
  }

  async backfillTwoTradingDays(symbol) {
    let before = null
    let merged = this.candleCache.get(symbol) ?? []
    for (let page = 0; page < 14; page += 1) {
      const query = new URLSearchParams({ symbol, interval: '1m', count: '200', adjusted: 'true' })
      if (before) query.set('before', before)
      const payload = await this.client.request(`/api/v1/candles?${query.toString()}`)
      const candles = candleRecords(payload)
      if (!candles.length) break
      merged = mergeCandles(merged, candles)
      const next = payload?.result?.nextBefore ?? null
      if (hasFullPreviousTradingDay(merged)) break
      if (!next || next === before) break
      before = next
      await sleep(150)
    }
    this.candleCache.set(symbol, merged)
  }

  async refreshSymbol(symbol) {
    const existing = this.candleCache.get(symbol) ?? []
    if (!existing.length || !hasFullPreviousTradingDay(existing)) return this.backfillTwoTradingDays(symbol)
    const query = new URLSearchParams({ symbol, interval: '1m', count: '30', adjusted: 'true' })
    const payload = await this.client.request(`/api/v1/candles?${query.toString()}`)
    this.candleCache.set(symbol, mergeCandles(existing, candleRecords(payload)))
  }

  async refresh() {
    if (this.refreshing || !this.client.configured) return this.payload
    this.refreshing = true
    try {
      const rankingResult = await loadUsRanking(this.client)
      const rankings = rankingResult.rankings ?? []
      if (!rankings.length) {
        this.payload = {
          ...this.payload,
          ok: false,
          updatedAt: new Date().toISOString(),
          stage: 'ranking-empty',
          rankingSource: null,
          rankingLabel: null,
          rankingAttempts: rankingResult.attempts ?? [],
          error: rankingResult.error || '미국 거래대금 랭킹을 아직 받지 못했습니다.',
        }
        return this.payload
      }

      const symbols = rankings.map((item) => item.symbol).filter(Boolean)
      await this.ensureMeta(symbols).catch(() => {})
      const topRankings = rankings.map((item) => this.enrichRanking(item))
      const marketTradingAmount = topRankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
      const groups = buildUsThemeGroups(topRankings, { limit: 50, minMembers: 3, maxThemes: 10 })
      const rankedAt = rankingResult.payload?.result?.rankedAt ?? null

      // Publish TOP100 immediately. Theme charts can continue filling from persisted/backfilled candles.
      this.payload = {
        ...this.payload,
        ok: true,
        updatedAt: new Date().toISOString(),
        rankedAt,
        marketTradingAmount,
        topRankings,
        stage: 'rankings-ready',
        rankingSource: rankingResult.source,
        rankingLabel: rankingResult.label,
        rankingIsMarketWide: rankingResult.isMarketWide,
        rankingAttempts: rankingResult.attempts,
        error: null,
      }

      const chartSymbols = [...new Set(groups.flatMap((group) => group.members.map((member) => member.symbol).filter(Boolean)))]
      const chartFailures = []
      await mapLimit(chartSymbols, 2, async (symbol) => {
        try {
          await this.refreshSymbol(symbol)
        } catch (error) {
          chartFailures.push({ symbol, error: error instanceof Error ? error.message : String(error) })
        }
        await sleep(200)
      })
      await this.persistCache().catch(() => {})

      const themes = groups.map((group) => {
        const members = group.members.map((member) => this.enrichRanking(member))
        const recentSeries = recentTradingDayFilter(members.map((member) => ({ symbol: member.symbol, candles: this.candleCache.get(member.symbol) ?? [] })), 2)
        const points = aggregateUsThemeSeries(recentSeries)
        return {
          name: group.name,
          tradingAmount: group.tradingAmount,
          memberCount: members.length,
          members,
          points,
          currentValue: points.at(-1)?.value ?? null,
          change1h: nearestDelta(points, 60),
          change3h: nearestDelta(points, 180),
          startDay: points[0]?.day ?? null,
          endDay: points.at(-1)?.day ?? null,
        }
      })

      this.payload = {
        ok: true,
        marketCountry: 'US',
        currency: 'USD',
        updatedAt: new Date().toISOString(),
        rankedAt,
        marketTradingAmount,
        topRankings,
        themes,
        stage: themes.some((theme) => theme.points.length >= 2) ? 'ready' : 'rankings-ready',
        rankingSource: rankingResult.source,
        rankingLabel: rankingResult.label,
        rankingIsMarketWide: rankingResult.isMarketWide,
        rankingAttempts: rankingResult.attempts,
        chartFailures,
        criteria: {
          rankingLimit: 50,
          minMembers: 3,
          candleInterval: '1m',
          aggregateInterval: '3m',
          weighting: 'equal-return',
          ranking: `${rankingResult.type}/US/${rankingResult.duration}`,
          chartSession: 'US regular 09:30-16:00 ET',
          historyTradingDays: 2,
          persisted: true,
        },
        error: null,
      }
      return this.payload
    } catch (error) {
      this.payload = {
        ...this.payload,
        ok: false,
        stage: 'error',
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }
      return this.payload
    } finally {
      this.refreshing = false
    }
  }
}

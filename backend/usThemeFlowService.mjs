import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { selectUsThemeGroups } from './usThemeCatalog.mjs'
import { sleep } from './tossClient.mjs'

const EXCHANGE_TRADED_NAME = /(ETF|ETN|SPDR|ISHARES|PROSHARES|DIREXION|VANGUARD|INVESCO|ARK\s|GLOBAL X|WISDOMTREE|VANECK)/i
const EXCHANGE_TRADED_SYMBOLS = new Set([
  'SPY','QQQ','IWM','DIA','VOO','VTI','IVV','TQQQ','SQQQ','SOXL','SOXS','UVXY','VXX','XLF','XLE','XLK','XLV','SMH','IBIT','FBTC',
])
const LIVE_SAMPLE_INTERVAL_MS = 30_000
const ONE_MINUTE_MS = 60_000
const LIVE_CACHE_MAX_ITEMS = 4_500

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
    englishName: item?.englishName ?? item?.stock?.englishName ?? null,
    market: item?.market ?? item?.marketName ?? item?.exchange ?? item?.stock?.market ?? null,
    securityType: item?.securityType ?? item?.stock?.securityType ?? null,
    isCommonShare: item?.isCommonShare ?? item?.stock?.isCommonShare ?? null,
    currency: item?.currency ?? item?.stock?.currency ?? 'USD',
  }
}

export function isUsIndividualStock(item = {}) {
  const symbol = String(item?.symbol ?? '').trim().toUpperCase()
  const securityType = String(item?.securityType ?? '').trim().toUpperCase()
  if (securityType) return securityType === 'STOCK'
  if (EXCHANGE_TRADED_SYMBOLS.has(symbol)) return false
  const name = `${item?.name ?? ''} ${item?.englishName ?? ''}`.trim()
  return !EXCHANGE_TRADED_NAME.test(name)
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

function priceRecords(payload) {
  const result = payload?.result
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.prices)) return result.prices
  if (Array.isArray(result?.items)) return result.items
  if (Array.isArray(result?.records)) return result.records
  return []
}

export async function loadUsLivePrices(client, symbols, fallbackTimestamp = new Date().toISOString()) {
  const unique = [...new Set((symbols ?? []).map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean))]
  if (!unique.length) return []
  const encoded = encodeURIComponent(unique.join(','))
  const payload = await client.request(`/api/v1/prices?symbols=${encoded}`)
  return priceRecords(payload).map((item) => {
    const sourceTimestamp = item?.timestamp ?? item?.price?.timestamp ?? null
    return {
      symbol: item?.symbol ?? item?.stock?.symbol ?? null,
      lastPrice: number(item?.lastPrice ?? item?.price?.lastPrice),
      timestamp: sourceTimestamp ?? fallbackTimestamp,
      timestampVerified: Boolean(sourceTimestamp),
    }
  }).filter((item) => item.symbol && item.lastPrice != null && item.timestamp)
}

function usDateKey(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp))
}

function usTimeParts(timestamp) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(timestamp))
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { hour: get('hour'), minute: get('minute'), second: get('second') }
}

function usMinuteOfDay(timestamp) {
  const { hour, minute } = usTimeParts(timestamp)
  return hour * 60 + minute
}

function isRegularTimestamp(timestamp) {
  const { hour, minute, second } = usTimeParts(timestamp)
  const totalSeconds = hour * 3600 + minute * 60 + second
  return totalSeconds >= (9 * 3600 + 30 * 60) && totalSeconds <= 16 * 3600
}

export function isUsPostMarketTimestamp(timestamp) {
  const { hour, minute, second } = usTimeParts(timestamp)
  const totalSeconds = hour * 3600 + minute * 60 + second
  return totalSeconds > 16 * 3600 && totalSeconds <= 20 * 3600
}

function isLiveSampleTimestamp(timestamp) {
  return isRegularTimestamp(timestamp) || isUsPostMarketTimestamp(timestamp)
}

function isRegularCandle(candle) {
  return Boolean(candle?.timestamp) && isRegularTimestamp(candle.timestamp)
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

function bucket30s(timestamp) {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) return null
  return Math.floor(time / LIVE_SAMPLE_INTERVAL_MS) * LIVE_SAMPLE_INTERVAL_MS
}

function bucket1m(timestamp) {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) return null
  return Math.floor(time / ONE_MINUTE_MS) * ONE_MINUTE_MS
}

export function mergeUsLivePriceSamples(existing, incoming, maxItems = LIVE_CACHE_MAX_ITEMS) {
  const map = new Map()
  for (const sample of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!sample?.timestamp || sample.lastPrice == null || !isLiveSampleTimestamp(sample.timestamp)) continue
    if (isUsPostMarketTimestamp(sample.timestamp) && sample.timestampVerified === false) continue
    const bucket = bucket30s(sample.timestamp)
    if (bucket == null) continue
    const timestamp = new Date(bucket).toISOString()
    map.set(timestamp, {
      timestamp,
      observedAt: sample.observedAt ?? sample.timestamp,
      lastPrice: number(sample.lastPrice),
      timestampVerified: sample.timestampVerified ?? true,
    })
  }
  const merged = [...map.values()]
    .filter((sample) => sample.lastPrice != null)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const days = [...new Set(merged.map((sample) => usDateKey(sample.timestamp)))].sort()
  const keepDays = new Set(days.slice(-5))
  return merged.filter((sample) => keepDays.has(usDateKey(sample.timestamp))).slice(-maxItems)
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

function weightedAverage(values, weights) {
  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(0, Number(weight) || 0), 0)
  if (totalWeight > 0) {
    return values.reduce((sum, value, index) => sum + value * Math.max(0, Number(weights[index]) || 0), 0) / totalWeight
  }
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

export function aggregateUsThemeSeries(memberSeries) {
  const buckets = new Map()
  for (const { symbol, candles } of memberSeries) {
    if (!candles?.length) continue
    const baseline = candles.find((candle) => candle.closePrice != null)?.closePrice
    if (!baseline) continue
    const perBucket = new Map()
    for (const candle of candles) {
      const key = bucket1m(candle.timestamp)
      if (key == null || candle.closePrice == null) continue
      const current = perBucket.get(key) ?? { timestamp: new Date(key).toISOString(), value: null, volume: 0, tradingAmount: 0 }
      current.value = (candle.closePrice / baseline - 1) * 100
      current.volume += candle.volume ?? 0
      current.tradingAmount += candle.tradingAmount ?? (candle.closePrice * (candle.volume ?? 0))
      perBucket.set(key, current)
    }
    for (const [key, point] of perBucket) {
      const aggregate = buckets.get(key) ?? { timestamp: point.timestamp, values: [], weights: [], volume: 0, tradingAmount: 0, symbols: new Set() }
      aggregate.values.push(point.value)
      aggregate.weights.push(Math.max(0, Number(point.tradingAmount) || 0))
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
      value: weightedAverage(bucket.values, bucket.weights),
      volume: bucket.volume,
      tradingAmount: bucket.tradingAmount,
      memberCount: bucket.symbols.size,
      day: usDateKey(bucket.timestamp),
      source: '1m-backfill',
    }))
}

export function aggregateUsLiveThemeSeries(memberSeries) {
  const buckets = new Map()
  for (const { symbol, candles = [], samples = [], weight = 0 } of memberSeries) {
    if (!samples.length) continue
    const baseline = candles.find((candle) => candle.closePrice != null)?.closePrice ?? samples.find((sample) => sample.lastPrice != null)?.lastPrice
    if (!baseline) continue
    for (const sample of samples) {
      const key = bucket30s(sample.timestamp)
      if (key == null || sample.lastPrice == null) continue
      const aggregate = buckets.get(key) ?? { timestamp: new Date(key).toISOString(), values: [], weights: [], symbols: new Set() }
      aggregate.values.push((sample.lastPrice / baseline - 1) * 100)
      aggregate.weights.push(Math.max(0, Number(weight) || 0))
      aggregate.symbols.add(symbol)
      buckets.set(key, aggregate)
    }
  }

  return [...buckets.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((bucket) => ({
      timestamp: bucket.timestamp,
      value: weightedAverage(bucket.values, bucket.weights),
      volume: 0,
      tradingAmount: null,
      memberCount: bucket.symbols.size,
      day: usDateKey(bucket.timestamp),
      source: '30s-live',
    }))
}

export function aggregateUsAfterHoursThemeSeries(memberSeries) {
  const buckets = new Map()
  for (const { symbol, regularClose, samples = [], weight = 0 } of memberSeries) {
    if (!regularClose || !samples.length) continue
    for (const sample of samples) {
      if (!isUsPostMarketTimestamp(sample.timestamp) || sample.timestampVerified === false || sample.lastPrice == null) continue
      const key = bucket30s(sample.timestamp)
      if (key == null) continue
      const aggregate = buckets.get(key) ?? {
        timestamp: new Date(key).toISOString(), values: [], weights: [], symbols: new Set(),
      }
      aggregate.values.push((sample.lastPrice / regularClose - 1) * 100)
      aggregate.weights.push(Math.max(0, Number(weight) || 0))
      aggregate.symbols.add(symbol)
      buckets.set(key, aggregate)
    }
  }

  return [...buckets.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((bucket) => ({
      timestamp: bucket.timestamp,
      value: weightedAverage(bucket.values, bucket.weights),
      volume: 0,
      tradingAmount: null,
      memberCount: bucket.symbols.size,
      day: usDateKey(bucket.timestamp),
      source: '30s-after-hours',
    }))
}

export function mergeUsThemePoints(historyPoints = [], livePoints = []) {
  const map = new Map()
  for (const point of historyPoints) map.set(point.timestamp, point)
  for (const point of livePoints) map.set(point.timestamp, point)
  return [...map.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
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
  const { hour } = usTimeParts(new Date().toISOString())
  return hour >= 4 && hour <= 20
}

function usRegularSessionActive() {
  const now = new Date()
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return isRegularTimestamp(now.toISOString())
}

function usPostMarketSessionActive() {
  const now = new Date()
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return isUsPostMarketTimestamp(now.toISOString())
}

function usLiveSamplingActive() {
  return usRegularSessionActive() || usPostMarketSessionActive()
}

export class UsThemeFlowService {
  constructor(client, {
    refreshMs = 60000,
    liveSampleMs = LIVE_SAMPLE_INTERVAL_MS,
    cachePath = process.env.US_THEME_CANDLE_CACHE_PATH || '/app/data/us-theme-candles.json',
  } = {}) {
    this.client = client
    this.refreshMs = refreshMs
    this.liveSampleMs = liveSampleMs
    this.cachePath = cachePath
    this.stockMeta = new Map()
    this.metaUpdatedAt = 0
    this.candleCache = new Map()
    this.livePriceCache = new Map()
    this.cacheLoaded = false
    this.activeGroups = []
    this.regularSnapshot = null
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
    this.liveTimer = null
    this.running = false
    this.refreshing = false
    this.liveSampling = false
  }

  async start() {
    if (this.running) return
    this.running = true
    await this.loadPersistedCache().catch(() => {})
    await this.refresh().catch(() => {})
    await this.sampleLivePrices().catch(() => {})
    this.schedule()
    this.scheduleLiveSampling()
  }

  stop() {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    if (this.liveTimer) clearTimeout(this.liveTimer)
  }

  schedule() {
    if (!this.running) return
    this.timer = setTimeout(async () => {
      await this.refresh().catch(() => {})
      this.schedule()
    }, usSessionActive() ? this.refreshMs : Math.max(this.refreshMs, 300000))
    this.timer.unref?.()
  }

  scheduleLiveSampling() {
    if (!this.running) return
    const delay = usLiveSamplingActive() ? this.liveSampleMs : 300000
    this.liveTimer = setTimeout(async () => {
      await this.sampleLivePrices().catch(() => {})
      this.scheduleLiveSampling()
    }, delay)
    this.liveTimer.unref?.()
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
      for (const [symbol, samples] of Object.entries(saved?.livePrices ?? {})) {
        if (Array.isArray(samples)) this.livePriceCache.set(symbol, mergeUsLivePriceSamples([], samples))
      }
      if (saved?.regularSnapshot && typeof saved.regularSnapshot === 'object') {
        this.regularSnapshot = saved.regularSnapshot
      }
    } catch {
      // 첫 실행이거나 캐시가 없으면 Toss 1분봉으로 백필한다.
    }
  }

  async persistCache() {
    await mkdir(dirname(this.cachePath), { recursive: true })
    const payload = {
      version: 2,
      savedAt: new Date().toISOString(),
      candles: Object.fromEntries([...this.candleCache.entries()].map(([symbol, candles]) => [symbol, candles])),
      livePrices: Object.fromEntries([...this.livePriceCache.entries()].map(([symbol, samples]) => [symbol, samples])),
      regularSnapshot: this.regularSnapshot,
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

  buildThemes(groups = this.activeGroups) {
    return groups.map((group) => {
      const members = group.members.map((member) => this.enrichRanking(member)).filter(isUsIndividualStock)
      const recentSeries = recentTradingDayFilter(members.map((member) => ({
        symbol: member.symbol,
        candles: this.candleCache.get(member.symbol) ?? [],
      })), 2)
      const historyPoints = aggregateUsThemeSeries(recentSeries)
      const visibleDays = new Set(historyPoints.map((point) => point.day))
      const liveSeries = members.map((member) => {
        const candles = recentSeries.find((entry) => entry.symbol === member.symbol)?.candles ?? []
        const samples = (this.livePriceCache.get(member.symbol) ?? []).filter((sample) =>
          isRegularTimestamp(sample.timestamp) && (!visibleDays.size || visibleDays.has(usDateKey(sample.timestamp))))
        return { symbol: member.symbol, candles, samples, weight: member.tradingAmount ?? 0 }
      })
      const livePoints = aggregateUsLiveThemeSeries(liveSeries)
      const points = mergeUsThemePoints(historyPoints, livePoints)
      return {
        name: group.name,
        tradingAmount: members.reduce((sum, member) => sum + (member.tradingAmount ?? 0), 0),
        memberCount: members.length,
        members,
        points,
        selectionBasis: group.selectionBasis,
        rankingLimit: 50,
        currentValue: points.at(-1)?.value ?? null,
        change1h: nearestDelta(points, 60),
        change3h: nearestDelta(points, 180),
        startDay: points[0]?.day ?? null,
        endDay: points.at(-1)?.day ?? null,
      }
    }).slice(0, 5)
  }

  captureRegularSnapshot({ rankedAt, marketTradingAmount, topRankings, groups }) {
    if (!usRegularSessionActive()) return
    const capturedAt = new Date().toISOString()
    this.regularSnapshot = {
      day: usDateKey(rankedAt ?? capturedAt),
      capturedAt,
      rankedAt: rankedAt ?? capturedAt,
      marketTradingAmount,
      topRankings: topRankings.map((item) => ({ ...item })),
      groups: groups.map((group) => ({
        ...group,
        members: group.members.map((member) => ({ ...member })),
      })),
    }
  }

  buildRegularSessionSummary(themes = this.buildThemes(), source = 'reconstructed-current-ranking') {
    const regularPoints = themes.flatMap((theme) => theme.points ?? []).filter((point) => isRegularTimestamp(point.timestamp))
    const days = [...new Set(regularPoints.map((point) => point.day))].sort()
    const day = days.at(-1) ?? this.regularSnapshot?.day ?? null
    const themeSummaries = themes.map((theme) => {
      const points = (theme.points ?? [])
        .filter((point) => (!day || point.day === day) && isRegularTimestamp(point.timestamp))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      const first = points[0] ?? null
      const last = points.at(-1) ?? null
      return {
        name: theme.name,
        memberCount: theme.memberCount,
        tradingAmount: theme.tradingAmount,
        sessionChange: first && last ? last.value - first.value : null,
        closeValue: last?.value ?? null,
        closedAt: last?.timestamp ?? null,
      }
    })
    const closedAt = themeSummaries.map((item) => item.closedAt).filter(Boolean).sort().at(-1) ?? null
    return { day, closedAt, source, themes: themeSummaries }
  }

  buildAfterHours(groups = this.activeGroups, rankings = this.payload.topRankings ?? []) {
    const rankingItems = (rankings ?? [])
      .map((item) => this.enrichRanking(item))
      .filter(isUsIndividualStock)
      .filter((item) => Boolean(item.symbol))
      .slice(0, 50)

    const themeBySymbol = new Map()
    for (const group of groups) {
      for (const member of group.members ?? []) {
        if (member?.symbol && !themeBySymbol.has(member.symbol)) themeBySymbol.set(member.symbol, group.name)
      }
    }

    const allSymbols = [...new Set([
      ...rankingItems.map((item) => item.symbol).filter(Boolean),
      ...groups.flatMap((group) => group.members.map((member) => member.symbol).filter(Boolean)),
    ])]
    const regularDays = [...new Set(allSymbols.flatMap((symbol) => [
      ...(this.candleCache.get(symbol) ?? []).filter(isRegularCandle).map((candle) => usDateKey(candle.timestamp)),
      ...(this.livePriceCache.get(symbol) ?? [])
        .filter((sample) => isRegularTimestamp(sample.timestamp) && sample.timestampVerified !== false)
        .map((sample) => usDateKey(sample.timestamp)),
    ]))].sort()
    const sessionDay = this.regularSnapshot?.day ?? regularDays.at(-1) ?? null
    const rankingBySymbol = new Map(rankingItems.map((item) => [item.symbol, item]))
    const regularCloseInfo = new Map()

    const resolveRegularClose = (member) => {
      const symbol = member?.symbol
      if (!symbol) return { price: null, source: null }
      if (regularCloseInfo.has(symbol)) return regularCloseInfo.get(symbol)

      const regularCandles = (this.candleCache.get(symbol) ?? [])
        .filter((candle) => (!sessionDay || usDateKey(candle.timestamp) === sessionDay) && isRegularCandle(candle))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      const candleClose = number(regularCandles.at(-1)?.closePrice)
      if (candleClose != null) {
        const resolved = { price: candleClose, source: '1m-close' }
        regularCloseInfo.set(symbol, resolved)
        return resolved
      }

      const regularSamples = (this.livePriceCache.get(symbol) ?? [])
        .filter((sample) => (!sessionDay || usDateKey(sample.timestamp) === sessionDay)
          && isRegularTimestamp(sample.timestamp)
          && sample.timestampVerified !== false)
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      const sampleClose = number(regularSamples.at(-1)?.lastPrice)
      if (sampleClose != null) {
        const resolved = { price: sampleClose, source: '30s-regular-sample' }
        regularCloseInfo.set(symbol, resolved)
        return resolved
      }

      const snapshotPrice = number(rankingBySymbol.get(symbol)?.lastPrice ?? member?.lastPrice)
      const resolved = { price: snapshotPrice, source: snapshotPrice == null ? null : 'regular-snapshot' }
      regularCloseInfo.set(symbol, resolved)
      return resolved
    }

    const afterSamplesFor = (symbol) => (this.livePriceCache.get(symbol) ?? [])
      .filter((sample) => (!sessionDay || usDateKey(sample.timestamp) === sessionDay)
        && isUsPostMarketTimestamp(sample.timestamp)
        && sample.timestampVerified !== false)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))

    const rankingRows = rankingItems.map((member, index) => {
      const { price: regularClose, source: regularCloseSource } = resolveRegularClose(member)
      const samples = afterSamplesFor(member.symbol)
      const latest = samples.at(-1) ?? null
      const afterHoursPrice = number(latest?.lastPrice)
      const afterHoursChangeRate = regularClose != null && afterHoursPrice != null
        ? (afterHoursPrice / regularClose - 1) * 100
        : null
      return {
        regularRank: index + 1,
        symbol: member.symbol,
        name: member.name ?? member.englishName ?? member.symbol,
        market: member.market ?? 'US',
        regularTradingAmount: number(member.tradingAmount),
        regularChangeRate: number(member.changeRate),
        regularClose,
        regularCloseSource,
        afterHoursPrice,
        afterHoursChangeRate,
        sampledAt: latest?.timestamp ?? null,
      }
    })

    const themes = groups.map((group) => {
      const members = group.members.map((member) => this.enrichRanking(member)).filter(isUsIndividualStock)
      const memberSeries = []
      for (const member of members) {
        const { price: regularClose } = resolveRegularClose(member)
        if (regularClose == null) continue
        const samples = afterSamplesFor(member.symbol)
        if (!samples.length) continue
        memberSeries.push({ symbol: member.symbol, regularClose, samples, weight: member.tradingAmount ?? 0 })
      }
      const points = aggregateUsAfterHoursThemeSeries(memberSeries)
      return {
        name: group.name,
        regularMemberCount: members.length,
        observedMemberCount: memberSeries.length,
        currentValue: points.at(-1)?.value ?? null,
        sampledAt: points.at(-1)?.timestamp ?? null,
        points,
      }
    }).slice(0, 5)

    const movers = rankingRows
      .filter((item) => item.afterHoursChangeRate != null)
      .map((item) => ({ ...item, theme: themeBySymbol.get(item.symbol) ?? '기타' }))
      .sort((a, b) => Math.abs(b.afterHoursChangeRate) - Math.abs(a.afterHoursChangeRate))
      .slice(0, 15)
    const latestSampledAt = rankingRows.map((item) => item.sampledAt).filter(Boolean).sort().at(-1) ?? null
    return {
      sessionDay,
      active: usPostMarketSessionActive(),
      observedSymbols: rankingRows.filter((item) => item.afterHoursChangeRate != null).length,
      sampledAt: latestSampledAt,
      themes,
      movers,
      rankings: rankingRows,
      source: 'verified-current-price-samples',
      note: 'TOP50 순위·거래대금·정규장 등락률은 정규장 스냅샷을 고정합니다. 애프터 등락률은 정규장 1분 종가를 우선 기준으로 하며, 없으면 마지막 검증 정규장 샘플/스냅샷 가격을 기준으로 실제 애프터 가격 샘플만 계산합니다. 애프터 거래대금은 추정하지 않습니다.',
    }
  }

  async sampleLivePrices() {
    if (this.liveSampling || this.refreshing || !this.client.configured || !usLiveSamplingActive() || !this.activeGroups.length) return this.payload
    this.liveSampling = true
    try {
      const rankingSymbols = (this.payload.topRankings ?? this.regularSnapshot?.topRankings ?? [])
        .slice(0, 50)
        .map((item) => item.symbol)
        .filter(Boolean)
      const themeSymbols = this.activeGroups.flatMap((group) => group.members.map((member) => member.symbol).filter(Boolean))
      const symbols = [...new Set([...rankingSymbols, ...themeSymbols])]
      const chunks = []
      for (let index = 0; index < symbols.length; index += 25) chunks.push(symbols.slice(index, index + 25))
      const batches = await Promise.all(chunks.map((chunk) => loadUsLivePrices(this.client, chunk).catch(() => [])))
      const samples = batches.flat()
      for (const sample of samples) {
        const existing = this.livePriceCache.get(sample.symbol) ?? []
        this.livePriceCache.set(sample.symbol, mergeUsLivePriceSamples(existing, [sample]))
      }
      if (samples.length) {
        const themes = this.buildThemes()
        this.payload = {
          ...this.payload,
          ok: true,
          updatedAt: new Date().toISOString(),
          themes,
          regularSession: this.buildRegularSessionSummary(themes, this.regularSnapshot ? 'captured-regular-snapshot' : 'reconstructed-current-ranking'),
          afterHours: this.buildAfterHours(this.activeGroups, this.payload.topRankings ?? this.regularSnapshot?.topRankings ?? []),
          stage: themes.some((theme) => theme.points.length >= 2) ? 'ready' : this.payload.stage,
          liveSampledAt: new Date().toISOString(),
          liveSampleCount: samples.length,
        }
      }
      return this.payload
    } finally {
      this.liveSampling = false
    }
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
      const enrichedRankings = rankings.map((item) => this.enrichRanking(item))
      const topRankings = enrichedRankings.filter(isUsIndividualStock).slice(0, 50)
      const marketTradingAmount = topRankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
      const groups = selectUsThemeGroups(topRankings, { limit: 50, targetCount: 5 })
      const rankedAt = rankingResult.payload?.result?.rankedAt ?? null
      this.captureRegularSnapshot({ rankedAt, marketTradingAmount, topRankings, groups })
      const useRegularSnapshot = !usRegularSessionActive() && Boolean(this.regularSnapshot?.topRankings?.length && this.regularSnapshot?.groups?.length)
      const displayTopRankings = useRegularSnapshot ? this.regularSnapshot.topRankings : topRankings
      const displayGroups = useRegularSnapshot ? this.regularSnapshot.groups : groups
      const displayMarketTradingAmount = useRegularSnapshot ? this.regularSnapshot.marketTradingAmount : marketTradingAmount
      const displayRankedAt = useRegularSnapshot ? this.regularSnapshot.rankedAt : rankedAt
      this.activeGroups = displayGroups

      this.payload = {
        ...this.payload,
        ok: true,
        updatedAt: new Date().toISOString(),
        rankedAt: displayRankedAt,
        marketTradingAmount: displayMarketTradingAmount,
        topRankings: displayTopRankings,
        stage: 'rankings-ready',
        rankingSource: rankingResult.source,
        rankingLabel: rankingResult.label,
        rankingIsMarketWide: rankingResult.isMarketWide,
        rankingAttempts: rankingResult.attempts,
        error: null,
      }

      const chartSymbols = [...new Set(displayGroups.flatMap((group) => group.members.map((member) => member.symbol).filter(Boolean)))]
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

      const themes = this.buildThemes(displayGroups)
      this.payload = {
        ok: true,
        marketCountry: 'US',
        currency: 'USD',
        updatedAt: new Date().toISOString(),
        rankedAt: displayRankedAt,
        marketTradingAmount: displayMarketTradingAmount,
        topRankings: displayTopRankings,
        themes,
        regularSession: this.buildRegularSessionSummary(themes, useRegularSnapshot ? 'captured-regular-snapshot' : (usRegularSessionActive() ? 'live-regular' : 'reconstructed-current-ranking')),
        afterHours: this.buildAfterHours(displayGroups, displayTopRankings),
        regularSnapshotCapturedAt: this.regularSnapshot?.capturedAt ?? null,
        regularSnapshotSource: useRegularSnapshot ? 'captured-regular-snapshot' : (usRegularSessionActive() ? 'live-regular' : 'reconstructed-current-ranking'),
        stage: themes.some((theme) => theme.points.length >= 2) ? 'ready' : 'rankings-ready',
        rankingSource: rankingResult.source,
        rankingLabel: rankingResult.label,
        rankingIsMarketWide: rankingResult.isMarketWide,
        rankingAttempts: rankingResult.attempts,
        chartFailures,
        liveSampledAt: this.payload.liveSampledAt ?? null,
        liveSampleCount: this.payload.liveSampleCount ?? 0,
        criteria: {
          rankingLimit: 50,
          targetThemeCount: 5,
          excludeExchangeTradedProducts: true,
          preferredMinMembers: 3,
          fallbackMinMembers: 1,
          candleInterval: '1m',
          livePriceInterval: '30s',
          aggregateInterval: '30s-live+1m-backfill',
          weighting: '1m actual turnover; 30s live uses current cumulative member turnover',
          ranking: `${rankingResult.type}/US/${rankingResult.duration}`,
          chartSession: 'US regular 09:30-16:00 ET only',
          afterHoursSession: 'US after-hours 16:00-20:00 ET; regular TOP50 30s verified price samples; 1m regular close preferred baseline=0%',
          dataSeparation: 'regular detail is not duplicated in after-hours; after-hours exposes delta/flow only',
          regularSnapshot: 'freeze TOP50 order + turnover + regular change and five themes after regular close; persisted for comparison',
          historyTradingDays: 2,
          persisted: true,
          liveSamplingPersisted: true,
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

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
  return priceRecords(payload).map((item) => ({
    symbol: item?.symbol ?? item?.stock?.symbol ?? null,
    lastPrice: number(item?.lastPrice ?? item?.price?.lastPrice),
    timestamp: item?.timestamp ?? item?.price?.timestamp ?? fallbackTimestamp,
  })).filter((item) => item.symbol && item.lastPrice != null && item.timestamp)
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
    if (!sample?.timestamp || sample.lastPrice == null || !isRegularTimestamp(sample.timestamp)) continue
    const bucket = bucket30s(sample.timestamp)
    if (bucket == null) continue
    const timestamp = new Date(bucket).toISOString()
    map.set(timestamp, {
      timestamp,
      observedAt: sample.observedAt ?? sample.timestamp,
      lastPrice: number(sample.lastPrice),
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
    const delay = usRegularSessionActive() ? this.liveSampleMs : 300000
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
        const samples = (this.livePriceCache.get(member.symbol) ?? []).filter((sample) => !visibleDays.size || visibleDays.has(usDateKey(sample.timestamp)))
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

  async sampleLivePrices() {
    if (this.liveSampling || this.refreshing || !this.client.configured || !usRegularSessionActive() || !this.activeGroups.length) return this.payload
    this.liveSampling = true
    try {
      const symbols = [...new Set(this.activeGroups.flatMap((group) => group.members.map((member) => member.symbol).filter(Boolean)))]
      const samples = await loadUsLivePrices(this.client, symbols)
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
      this.activeGroups = groups
      const rankedAt = rankingResult.payload?.result?.rankedAt ?? null

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

      const themes = this.buildThemes(groups)
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
          chartSession: 'US regular 09:30-16:00 ET',
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

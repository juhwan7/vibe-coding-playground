import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { buildThemeGroups } from './themeCatalog.mjs'
import { sleep } from './tossClient.mjs'

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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
    market: item?.market ?? item?.marketName ?? item?.exchange ?? item?.stock?.market ?? null,
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

function dateKey(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp))
}

function minuteOfDay(timestamp) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(timestamp))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

function mergeCandles(existing, incoming, maxItems = 3600) {
  const map = new Map()
  for (const candle of [...existing, ...incoming]) {
    if (!candle?.timestamp || candle.closePrice == null) continue
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
  const days = [...new Set(merged.map((candle) => dateKey(candle.timestamp)))].sort()
  const keepDays = new Set(days.slice(-5))
  return merged.filter((candle) => keepDays.has(dateKey(candle.timestamp))).slice(-maxItems)
}

function hasFullPreviousTradingDay(candles) {
  const days = [...new Set(candles.map((candle) => dateKey(candle.timestamp)))].sort()
  if (days.length < 2) return false
  const previousDay = days[days.length - 2]
  const previous = candles.filter((candle) => dateKey(candle.timestamp) === previousDay)
  if (!previous.length) return false
  return Math.min(...previous.map((candle) => minuteOfDay(candle.timestamp))) <= 545
}

function recentTradingDayFilter(memberSeries, count = 2) {
  const days = [...new Set(memberSeries.flatMap(({ candles }) => candles.map((candle) => dateKey(candle.timestamp))))].sort()
  const selected = new Set(days.slice(-count))
  return memberSeries.map(({ symbol, candles }) => ({
    symbol,
    candles: candles.filter((candle) => selected.has(dateKey(candle.timestamp))),
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
    const gap = Math.abs(Date.parse(point.timestamp) - target)
    if (gap < nearestGap) {
      nearest = point
      nearestGap = gap
    }
  }
  if (!nearest || nearestGap > 15 * 60000) return null
  return last.value - nearest.value
}

export function aggregateThemeSeries(memberSeries) {
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
      day: dateKey(bucket.timestamp),
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

export class ThemeFlowService {
  constructor(client, getSnapshot, {
    refreshMs = 60000,
    cachePath = process.env.THEME_CANDLE_CACHE_PATH || '/app/data/theme-candles.json',
  } = {}) {
    this.client = client
    this.getSnapshot = getSnapshot
    this.refreshMs = refreshMs
    this.cachePath = cachePath
    this.stockMeta = new Map()
    this.metaUpdatedAt = 0
    this.candleCache = new Map()
    this.cacheLoaded = false
    this.payload = { ok: false, updatedAt: null, topRankings: [], themes: [], error: '초기화 중' }
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
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date()))
    const active = hour >= 8 && hour <= 20
    this.timer = setTimeout(async () => {
      await this.refresh().catch(() => {})
      this.schedule()
    }, active ? this.refreshMs : Math.max(this.refreshMs, 300000))
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
      // 첫 실행이거나 이전 캐시가 없으면 API 백필로 시작한다.
    }
  }

  async persistCache() {
    await mkdir(dirname(this.cachePath), { recursive: true })
    const payload = {
      version: 2,
      savedAt: new Date().toISOString(),
      candles: Object.fromEntries([...this.candleCache.entries()].map(([symbol, candles]) => [symbol, candles])),
    }
    const tempPath = `${this.cachePath}.tmp`
    await writeFile(tempPath, JSON.stringify(payload), 'utf8')
    await rename(tempPath, this.cachePath)
  }

  async ensureMeta(symbols) {
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
      market: meta?.market ?? item?.market ?? null,
    }
  }

  async backfillTwoTradingDays(symbol) {
    let before = null
    let merged = this.candleCache.get(symbol) ?? []
    for (let page = 0; page < 10; page += 1) {
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
      await sleep(100)
    }
    this.candleCache.set(symbol, merged)
  }

  async refreshSymbol(symbol) {
    const existing = this.candleCache.get(symbol) ?? []
    if (!existing.length || !hasFullPreviousTradingDay(existing)) return this.backfillTwoTradingDays(symbol)
    const query = new URLSearchParams({ symbol, interval: '1m', count: '20', adjusted: 'true' })
    const payload = await this.client.request(`/api/v1/candles?${query.toString()}`)
    this.candleCache.set(symbol, mergeCandles(existing, candleRecords(payload)))
  }

  async refresh() {
    if (this.refreshing || !this.client.configured) return this.payload
    const snapshot = this.getSnapshot?.()
    if (!snapshot?.ok || !(snapshot.topRankings?.length)) return this.payload
    this.refreshing = true
    try {
      const symbols = snapshot.topRankings.slice(0, 100).map((item) => item.symbol).filter(Boolean)
      await this.ensureMeta(symbols).catch(() => {})
      const topRankings = snapshot.topRankings.map((item) => this.enrichRanking(item))
      const groups = buildThemeGroups(topRankings, { limit: 50, minMembers: 3, maxThemes: 7 })
      const chartSymbols = [...new Set(groups.flatMap((group) => group.members.map((member) => member.symbol).filter(Boolean)))]

      await mapLimit(chartSymbols, 3, async (symbol) => {
        await this.refreshSymbol(symbol).catch(() => {})
        await sleep(120)
      })
      await this.persistCache().catch(() => {})

      const themes = groups.map((group) => {
        const members = group.members.map((member) => this.enrichRanking(member))
        const recentSeries = recentTradingDayFilter(members.map((member) => ({ symbol: member.symbol, candles: this.candleCache.get(member.symbol) ?? [] })), 2)
        const points = aggregateThemeSeries(recentSeries)
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
        updatedAt: new Date().toISOString(),
        sourceUpdatedAt: snapshot.updatedAt ?? null,
        topRankings,
        themes,
        criteria: {
          rankingLimit: 50,
          minMembers: 3,
          candleInterval: '1m',
          aggregateInterval: '3m',
          weighting: 'equal-return',
          tradingAmount: 'market-ranking-1d',
          historyTradingDays: 2,
          persisted: true,
        },
        error: null,
      }
      return this.payload
    } catch (error) {
      this.payload = { ...this.payload, ok: this.payload.ok, error: error instanceof Error ? error.message : String(error) }
      return this.payload
    } finally {
      this.refreshing = false
    }
  }
}

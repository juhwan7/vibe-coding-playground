import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { buildThemeGroups } from './themeCatalog.mjs'
import { sleep } from './tossClient.mjs'

const EXCHANGE_TRADED_NAME = /(ETF|ETN|KODEX|TIGER|RISE|ACE|PLUS|SOL|HANARO|KOSEF|TIMEFOLIO|ARIRANG|FOCUS|KBSTAR)/i

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
    securityType: item?.securityType ?? item?.stock?.securityType ?? null,
    isCommonShare: item?.isCommonShare ?? item?.stock?.isCommonShare ?? null,
    status: item?.status ?? item?.stock?.status ?? null,
  }
}

export function isIndividualStock(item = {}) {
  const securityType = String(item?.securityType ?? '').trim().toUpperCase()
  if (securityType) return securityType === 'STOCK'
  const name = String(item?.name ?? '')
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
      openPrice: open ?? close,
      highPrice: high ?? close,
      lowPrice: low ?? close,
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
    const closePrice = number(candle.closePrice)
    if (closePrice == null) continue
    const openPrice = number(candle.openPrice) ?? closePrice
    const highPrice = number(candle.highPrice) ?? Math.max(openPrice, closePrice)
    const lowPrice = number(candle.lowPrice) ?? Math.min(openPrice, closePrice)
    map.set(candle.timestamp, {
      timestamp: candle.timestamp,
      openPrice,
      highPrice,
      lowPrice,
      closePrice,
      volume: number(candle.volume) ?? 0,
      tradingAmount: number(candle.tradingAmount) ?? (closePrice * (number(candle.volume) ?? 0)),
    })
  }
  const merged = [...map.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
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

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value))
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null
}

export function aggregateThemeSeries(memberSeries) {
  const buckets = new Map()

  for (const { symbol, candles } of memberSeries) {
    const ordered = [...(candles ?? [])].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    if (!ordered.length) continue
    const baseline = ordered.find((candle) => candle.closePrice != null)?.closePrice
    if (!baseline) continue
    const perBucket = new Map()

    for (const candle of ordered) {
      const key = bucket3m(candle.timestamp)
      const closePrice = number(candle.closePrice)
      if (key == null || closePrice == null) continue
      const openPrice = number(candle.openPrice) ?? closePrice
      const highPrice = number(candle.highPrice) ?? Math.max(openPrice, closePrice)
      const lowPrice = number(candle.lowPrice) ?? Math.min(openPrice, closePrice)
      const openValue = (openPrice / baseline - 1) * 100
      const highValue = (highPrice / baseline - 1) * 100
      const lowValue = (lowPrice / baseline - 1) * 100
      const closeValue = (closePrice / baseline - 1) * 100
      const current = perBucket.get(key) ?? {
        timestamp: new Date(key).toISOString(),
        openValue: null,
        highValue: -Infinity,
        lowValue: Infinity,
        closeValue: null,
        volume: 0,
        tradingAmount: 0,
      }
      if (current.openValue == null) current.openValue = openValue
      current.highValue = Math.max(current.highValue, highValue)
      current.lowValue = Math.min(current.lowValue, lowValue)
      current.closeValue = closeValue
      current.volume += number(candle.volume) ?? 0
      current.tradingAmount += number(candle.tradingAmount) ?? closePrice * (number(candle.volume) ?? 0)
      perBucket.set(key, current)
    }

    for (const [key, point] of perBucket) {
      const aggregate = buckets.get(key) ?? {
        timestamp: point.timestamp,
        opens: [],
        highs: [],
        lows: [],
        closes: [],
        volume: 0,
        tradingAmount: 0,
        symbols: new Set(),
      }
      if (point.openValue != null) aggregate.opens.push(point.openValue)
      if (Number.isFinite(point.highValue)) aggregate.highs.push(point.highValue)
      if (Number.isFinite(point.lowValue)) aggregate.lows.push(point.lowValue)
      if (point.closeValue != null) aggregate.closes.push(point.closeValue)
      aggregate.volume += point.volume
      aggregate.tradingAmount += point.tradingAmount
      aggregate.symbols.add(symbol)
      buckets.set(key, aggregate)
    }
  }

  return [...buckets.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((bucket) => {
      const openValue = average(bucket.opens)
      const highValue = average(bucket.highs)
      const lowValue = average(bucket.lows)
      const closeValue = average(bucket.closes)
      return {
        timestamp: bucket.timestamp,
        value: closeValue,
        openValue,
        highValue,
        lowValue,
        closeValue,
        volume: bucket.volume,
        tradingAmount: bucket.tradingAmount,
        memberCount: bucket.symbols.size,
        day: dateKey(bucket.timestamp),
      }
    }).filter((point) => point.value != null)
}

export function aggregateStockCandles(candles = []) {
  const ordered = [...candles]
    .filter((candle) => candle?.timestamp && candle?.closePrice != null)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  if (!ordered.length) return []
  const latestDay = dateKey(ordered.at(-1).timestamp)
  const buckets = new Map()

  for (const candle of ordered) {
    if (dateKey(candle.timestamp) !== latestDay) continue
    const key = bucket3m(candle.timestamp)
    if (key == null) continue
    const closePrice = number(candle.closePrice)
    if (closePrice == null) continue
    const openPrice = number(candle.openPrice) ?? closePrice
    const highPrice = number(candle.highPrice) ?? Math.max(openPrice, closePrice)
    const lowPrice = number(candle.lowPrice) ?? Math.min(openPrice, closePrice)
    const current = buckets.get(key) ?? {
      timestamp: new Date(key).toISOString(),
      day: latestDay,
      openPrice,
      highPrice,
      lowPrice,
      closePrice,
      volume: 0,
      tradingAmount: 0,
    }
    current.highPrice = Math.max(current.highPrice, highPrice)
    current.lowPrice = Math.min(current.lowPrice, lowPrice)
    current.closePrice = closePrice
    current.volume += number(candle.volume) ?? 0
    current.tradingAmount += number(candle.tradingAmount) ?? closePrice * (number(candle.volume) ?? 0)
    buckets.set(key, current)
  }

  return [...buckets.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

export function selectThemeGroups(rankings, { targetCount = 4 } = {}) {
  const selected = []
  const seen = new Set()
  const tiers = [
    { limit: 50, minMembers: 3, basis: 'TOP50 3종+' },
    { limit: 50, minMembers: 2, basis: 'TOP50 2종 보강' },
    { limit: 100, minMembers: 2, basis: 'TOP100 2종 보강' },
    { limit: 100, minMembers: 1, basis: 'TOP100 1종 보강' },
  ]

  for (const tier of tiers) {
    const candidates = buildThemeGroups(rankings, {
      limit: Math.min(tier.limit, rankings.length),
      minMembers: tier.minMembers,
      maxThemes: 32,
    })
    for (const group of candidates) {
      if (seen.has(group.name)) continue
      seen.add(group.name)
      selected.push({ ...group, selectionBasis: tier.basis, rankingLimit: tier.limit })
      if (selected.length >= targetCount) return selected
    }
  }

  return selected
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
      version: 4,
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
      securityType: meta?.securityType ?? item?.securityType ?? null,
      isCommonShare: meta?.isCommonShare ?? item?.isCommonShare ?? null,
      status: meta?.status ?? item?.status ?? null,
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

  stockChart(symbol) {
    const normalized = String(symbol ?? '').trim()
    if (!/^\d{6}$/.test(normalized)) return { ok: false, error: '올바른 국내 종목코드가 아닙니다.', points: [] }
    const meta = this.stockMeta.get(normalized)
    if (meta && !isIndividualStock(meta)) return { ok: false, error: '개별주식만 조회합니다.', points: [] }
    const points = aggregateStockCandles(this.candleCache.get(normalized) ?? [])
    if (!points.length) return { ok: false, symbol: normalized, name: meta?.name ?? normalized, interval: '3m', points: [], error: '저장된 3분봉이 아직 없습니다.' }
    return {
      ok: true,
      symbol: normalized,
      name: meta?.name ?? normalized,
      market: meta?.market ?? null,
      securityType: meta?.securityType ?? null,
      interval: '3m',
      day: points.at(-1)?.day ?? null,
      updatedAt: points.at(-1)?.timestamp ?? null,
      points,
      source: 'Raspberry Pi 저장 1분봉 → 3분 OHLC 집계',
    }
  }

  async refresh() {
    if (this.refreshing || !this.client.configured) return this.payload
    const snapshot = this.getSnapshot?.()
    if (!snapshot?.ok || !(snapshot.topRankings?.length)) return this.payload
    this.refreshing = true
    try {
      const symbols = snapshot.topRankings.slice(0, 100).map((item) => item.symbol).filter(Boolean)
      await this.ensureMeta(symbols).catch(() => {})
      const enrichedRankings = snapshot.topRankings.map((item) => this.enrichRanking(item))
      const topRankings = enrichedRankings.filter(isIndividualStock).slice(0, 100)
      const groups = selectThemeGroups(topRankings, { targetCount: 4 })
      const chartSymbols = [...new Set(groups.flatMap((group) => group.members.map((member) => member.symbol).filter(Boolean)))]

      await mapLimit(chartSymbols, 3, async (symbol) => {
        await this.refreshSymbol(symbol).catch(() => {})
        await sleep(120)
      })
      await this.persistCache().catch(() => {})

      const themes = groups.map((group) => {
        const members = group.members.map((member) => this.enrichRanking(member)).filter(isIndividualStock)
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
          selectionBasis: group.selectionBasis ?? null,
          rankingLimit: group.rankingLimit ?? null,
        }
      })

      this.payload = {
        ok: true,
        updatedAt: new Date().toISOString(),
        sourceUpdatedAt: snapshot.updatedAt ?? null,
        topRankings,
        themes,
        filteredOutCount: Math.max(0, enrichedRankings.length - topRankings.length),
        criteria: {
          rankingLimit: 50,
          fallbackRankingLimit: 100,
          primaryMinMembers: 3,
          themeCount: 4,
          instrumentFilter: 'securityType=STOCK',
          candleInterval: '1m',
          aggregateInterval: '3m',
          weighting: 'equal-return',
          chart: 'averaged-OHLC-candles',
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

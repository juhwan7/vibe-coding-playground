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
  return Array.isArray(candles) ? candles : []
}

function mergeCandles(existing, incoming, maxItems = 920) {
  const map = new Map()
  for (const candle of [...existing, ...incoming]) {
    if (!candle?.timestamp) continue
    map.set(candle.timestamp, {
      timestamp: candle.timestamp,
      closePrice: number(candle.closePrice),
      volume: number(candle.volume) ?? 0,
    })
  }
  return [...map.values()]
    .filter((candle) => candle.closePrice != null)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-maxItems)
}

function bucket3m(timestamp) {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) return null
  return Math.floor(time / 180000) * 180000
}

function dateKey(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp))
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
      const current = perBucket.get(key) ?? { timestamp: new Date(key).toISOString(), value: null, volume: 0 }
      current.value = (candle.closePrice / baseline - 1) * 100
      current.volume += candle.volume ?? 0
      perBucket.set(key, current)
    }
    for (const [key, point] of perBucket) {
      const aggregate = buckets.get(key) ?? { timestamp: point.timestamp, values: [], volume: 0, symbols: new Set() }
      aggregate.values.push(point.value)
      aggregate.volume += point.volume
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
  constructor(client, getSnapshot, { refreshMs = 180000 } = {}) {
    this.client = client
    this.getSnapshot = getSnapshot
    this.refreshMs = refreshMs
    this.stockMeta = new Map()
    this.metaUpdatedAt = 0
    this.candleCache = new Map()
    this.payload = { ok: false, updatedAt: null, topRankings: [], themes: [], error: '초기화 중' }
    this.timer = null
    this.running = false
    this.refreshing = false
  }

  async start() {
    if (this.running) return
    this.running = true
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
    }, this.refreshMs)
    this.timer.unref?.()
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

  async loadInitial(symbol) {
    let before = null
    let merged = []
    for (let page = 0; page < 4; page += 1) {
      const query = new URLSearchParams({ symbol, interval: '1m', count: '200', adjusted: 'true' })
      if (before) query.set('before', before)
      const payload = await this.client.request(`/api/v1/candles?${query.toString()}`)
      const candles = candleRecords(payload)
      if (!candles.length) break
      merged = mergeCandles(merged, candles)
      const next = payload?.result?.nextBefore ?? null
      if (!next || next === before) break
      before = next
      await sleep(60)
    }
    this.candleCache.set(symbol, merged)
  }

  async refreshSymbol(symbol) {
    if (!this.candleCache.has(symbol)) return this.loadInitial(symbol)
    const query = new URLSearchParams({ symbol, interval: '1m', count: '200', adjusted: 'true' })
    const payload = await this.client.request(`/api/v1/candles?${query.toString()}`)
    this.candleCache.set(symbol, mergeCandles(this.candleCache.get(symbol) ?? [], candleRecords(payload)))
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

      await mapLimit(chartSymbols, 4, async (symbol) => {
        await this.refreshSymbol(symbol).catch(() => {})
        await sleep(80)
      })

      const themes = groups.map((group) => {
        const members = group.members.map((member) => this.enrichRanking(member))
        const points = aggregateThemeSeries(members.map((member) => ({ symbol: member.symbol, candles: this.candleCache.get(member.symbol) ?? [] })))
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
        criteria: { rankingLimit: 50, minMembers: 3, candleInterval: '1m', aggregateInterval: '3m', weighting: 'equal-return' },
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

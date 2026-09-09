import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ThemeFlowService, aggregateStockCandles, isIndividualStock, selectThemeGroups } from './themeFlowService.mjs'
import { aggregateTradingAmountWeightedThemeSeries } from './themeWeightedSeries.mjs'
import { stockMeta, stockRecords, validStockName } from './stockMetadata.mjs'
import { sleep } from './tossClient.mjs'

const DEFAULT_MAX_CACHE_LOAD_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_CACHE_SYMBOLS = 80
const DEFAULT_MAX_CANDLES_PER_SYMBOL = 1600
const DEFAULT_PERSIST_MIN_MS = 5 * 60 * 1000

function dateKey(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp))
}

function recentTradingDayFilter(memberSeries, count = 2) {
  const days = [...new Set(memberSeries.flatMap(({ candles }) => (candles ?? []).map((candle) => dateKey(candle.timestamp))))].sort()
  const selected = new Set(days.slice(-count))
  return memberSeries.map(({ symbol, candles }) => ({
    symbol,
    candles: (candles ?? []).filter((candle) => selected.has(dateKey(candle.timestamp))),
  }))
}

function nearestDelta(points, minutes) {
  if (!points.length) return null
  const last = points.at(-1)
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

function latestTimestamp(candles = []) {
  let latest = 0
  for (const candle of candles) {
    const value = Date.parse(candle?.timestamp ?? '')
    if (Number.isFinite(value) && value > latest) latest = value
  }
  return latest
}

function trimCandles(candles = [], maxItems = DEFAULT_MAX_CANDLES_PER_SYMBOL) {
  const map = new Map()
  for (const candle of candles) {
    if (!candle?.timestamp || candle?.closePrice == null) continue
    map.set(candle.timestamp, candle)
  }
  return [...map.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-maxItems)
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

export class ThemeFlowServiceFive extends ThemeFlowService {
  constructor(client, getSnapshot, options = {}) {
    super(client, getSnapshot, options)
    this.maxCacheLoadBytes = Math.max(1024, Number(process.env.THEME_CACHE_MAX_LOAD_BYTES || options.maxCacheLoadBytes || DEFAULT_MAX_CACHE_LOAD_BYTES))
    this.maxCacheSymbols = Math.max(5, Number(process.env.THEME_CACHE_MAX_SYMBOLS || options.maxCacheSymbols || DEFAULT_MAX_CACHE_SYMBOLS))
    this.maxCandlesPerSymbol = Math.max(400, Number(process.env.THEME_CACHE_MAX_CANDLES_PER_SYMBOL || options.maxCandlesPerSymbol || DEFAULT_MAX_CANDLES_PER_SYMBOL))
    this.persistMinMs = Math.max(0, Number(process.env.THEME_CACHE_PERSIST_MIN_MS || options.persistMinMs || DEFAULT_PERSIST_MIN_MS))
    this.lastCachePersistAt = 0
    this.activeChartSymbols = []
    this.recentChartSymbols = []
    this.cacheGuard = {
      loadSkippedOversize: false,
      skippedBytes: 0,
      loadedSymbols: 0,
      prunedSymbols: 0,
    }
  }

  cacheStats() {
    let candles = 0
    for (const items of this.candleCache.values()) candles += items?.length ?? 0
    return {
      symbols: this.candleCache.size,
      candles,
      maxSymbols: this.maxCacheSymbols,
      maxCandlesPerSymbol: this.maxCandlesPerSymbol,
      maxLoadBytes: this.maxCacheLoadBytes,
      persistMinMs: this.persistMinMs,
      ...this.cacheGuard,
    }
  }

  async loadPersistedCache() {
    if (this.cacheLoaded) return
    this.cacheLoaded = true
    try {
      const info = await stat(this.cachePath)
      if (info.size > this.maxCacheLoadBytes) {
        this.cacheGuard.loadSkippedOversize = true
        this.cacheGuard.skippedBytes = info.size
        return
      }

      const text = await readFile(this.cachePath, 'utf8')
      const saved = JSON.parse(text)
      const entries = Object.entries(saved?.candles ?? {})
        .filter(([, candles]) => Array.isArray(candles) && candles.length)
        .sort((a, b) => latestTimestamp(b[1]) - latestTimestamp(a[1]))
        .slice(0, this.maxCacheSymbols)

      for (const [symbol, candles] of entries) {
        this.candleCache.set(symbol, trimCandles(candles, this.maxCandlesPerSymbol))
      }
      this.cacheGuard.loadedSymbols = this.candleCache.size
    } catch {
      // 첫 실행, 이전 캐시 없음, 손상된 캐시는 API 백필로 복구한다.
    }
  }

  pruneCandleCache(activeSymbols = []) {
    const active = new Set(activeSymbols.map((symbol) => String(symbol ?? '').trim()).filter(Boolean))
    const recent = this.recentChartSymbols.map((symbol) => String(symbol ?? '').trim()).filter(Boolean)
    const keep = new Set([...active, ...recent])
    const candidates = [...this.candleCache.entries()]
      .sort((a, b) => latestTimestamp(b[1]) - latestTimestamp(a[1]))

    for (const [symbol] of candidates) {
      if (keep.size >= this.maxCacheSymbols) break
      keep.add(symbol)
    }

    let pruned = 0
    for (const [symbol, candles] of [...this.candleCache.entries()]) {
      if (!keep.has(symbol)) {
        this.candleCache.delete(symbol)
        pruned += 1
        continue
      }
      this.candleCache.set(symbol, trimCandles(candles, this.maxCandlesPerSymbol))
    }
    this.cacheGuard.prunedSymbols += pruned
    return pruned
  }

  async persistCache({ force = false } = {}) {
    const now = Date.now()
    if (!force && this.lastCachePersistAt && now - this.lastCachePersistAt < this.persistMinMs) return

    this.pruneCandleCache(this.activeChartSymbols)
    await mkdir(dirname(this.cachePath), { recursive: true })
    const payload = {
      version: 5,
      savedAt: new Date(now).toISOString(),
      candles: Object.fromEntries([...this.candleCache.entries()]),
    }
    const tempPath = `${this.cachePath}.tmp`
    await writeFile(tempPath, JSON.stringify(payload), 'utf8')
    await rename(tempPath, this.cachePath)
    this.lastCachePersistAt = now
    this.cacheGuard.loadSkippedOversize = false
    this.cacheGuard.skippedBytes = 0
  }

  ingestMeta(payload) {
    for (const record of stockRecords(payload)) {
      const meta = stockMeta(record)
      if (meta.symbol) this.stockMeta.set(meta.symbol, meta)
    }
  }

  unresolvedMeta(symbols = []) {
    return symbols.filter((symbol) => !validStockName(this.stockMeta.get(symbol)?.name, symbol))
  }

  async ensureMeta(symbols = []) {
    const unique = [...new Set(symbols.map((symbol) => String(symbol ?? '').trim()).filter(Boolean))]
    if (!unique.length) return
    const missing = unique.filter((symbol) => !this.stockMeta.has(symbol))
    if (!missing.length && Date.now() - this.metaUpdatedAt < 6 * 60 * 60 * 1000 && !this.unresolvedMeta(unique).length) return
    const targets = missing.length ? missing : unique

    try {
      const payload = await this.client.request(`/api/v1/stocks?symbols=${encodeURIComponent(targets.join(','))}`)
      this.ingestMeta(payload)
    } catch {
      // Smaller retries below preserve service availability if the large request fails.
    }

    let unresolved = this.unresolvedMeta(targets)
    for (let index = 0; index < unresolved.length; index += 10) {
      const chunk = unresolved.slice(index, index + 10)
      try {
        const payload = await this.client.request(`/api/v1/stocks?symbols=${encodeURIComponent(chunk.join(','))}`)
        this.ingestMeta(payload)
      } catch {}
      if (index + 10 < unresolved.length) await sleep(80)
    }

    unresolved = this.unresolvedMeta(targets)
    await mapLimit(unresolved, 2, async (symbol) => {
      try {
        const payload = await this.client.request(`/api/v1/stocks?symbols=${encodeURIComponent(symbol)}`)
        this.ingestMeta(payload)
      } catch {}
      await sleep(100)
    })

    this.metaUpdatedAt = Date.now()
  }

  rememberChartSymbol(symbol) {
    const normalized = String(symbol ?? '').trim()
    if (!normalized) return
    this.recentChartSymbols = [normalized, ...this.recentChartSymbols.filter((item) => item !== normalized)].slice(0, 10)
  }

  async stockChartReady(symbol, { fallbackName = null } = {}) {
    const normalized = String(symbol ?? '').trim()
    if (!/^\d{6}$/.test(normalized)) return { ok: false, error: '올바른 국내 종목코드가 아닙니다.', points: [] }

    this.rememberChartSymbol(normalized)
    await this.ensureMeta([normalized]).catch(() => {})
    const meta = this.stockMeta.get(normalized)
    if (meta && !isIndividualStock(meta)) return { ok: false, error: '개별주식만 조회합니다.', points: [] }

    let points = aggregateStockCandles(this.candleCache.get(normalized) ?? [])
    if (!points.length) {
      await this.refreshSymbol(normalized).catch(() => {})
      this.pruneCandleCache([...this.activeChartSymbols, normalized])
      points = aggregateStockCandles(this.candleCache.get(normalized) ?? [])
      if (points.length) await this.persistCache({ force: true }).catch(() => {})
    }

    const name = meta?.name ?? fallbackName ?? normalized
    if (!points.length) {
      return {
        ok: false,
        symbol: normalized,
        name,
        interval: '3m',
        points: [],
        error: '3분 선차트용 장중 데이터를 아직 확보하지 못했습니다.',
      }
    }

    return {
      ok: true,
      symbol: normalized,
      name,
      market: meta?.market ?? null,
      securityType: meta?.securityType ?? null,
      interval: '3m',
      day: points.at(-1)?.day ?? null,
      updatedAt: points.at(-1)?.timestamp ?? null,
      points,
      source: 'Raspberry Pi 저장 1분봉 → 3분 종가 선차트',
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
      const groups = selectThemeGroups(topRankings, { targetCount: 5 })
      const chartSymbols = [...new Set(groups.flatMap((group) => group.members.map((member) => member.symbol).filter(Boolean)))]
      this.activeChartSymbols = chartSymbols

      await mapLimit(chartSymbols, 3, async (symbol) => {
        await this.refreshSymbol(symbol).catch(() => {})
        await sleep(120)
      })
      this.pruneCandleCache(chartSymbols)
      await this.persistCache().catch(() => {})

      const themes = groups.map((group) => {
        const members = group.members.map((member) => this.enrichRanking(member)).filter(isIndividualStock)
        const recentSeries = recentTradingDayFilter(
          members.map((member) => ({ symbol: member.symbol, candles: this.candleCache.get(member.symbol) ?? [] })),
          2,
        )
        const points = aggregateTradingAmountWeightedThemeSeries(recentSeries)
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
          weighting: '3m-trading-amount-weighted-return',
          dominantWeightPercent: points.at(-1)?.dominantWeightPercent ?? null,
        }
      })

      this.payload = {
        ok: true,
        updatedAt: new Date().toISOString(),
        sourceUpdatedAt: snapshot.updatedAt ?? null,
        topRankings,
        themes,
        filteredOutCount: Math.max(0, enrichedRankings.length - topRankings.length),
        unresolvedNameCount: topRankings.filter((item) => !validStockName(item.name, item.symbol)).length,
        cache: this.cacheStats(),
        criteria: {
          rankingLimit: 50,
          fallbackRankingLimit: 100,
          primaryMinMembers: 3,
          themeCount: 5,
          instrumentFilter: 'securityType=STOCK',
          candleInterval: '1m',
          aggregateInterval: '3m',
          weighting: '3m-trading-amount-weighted-return',
          chart: 'weighted-close-line',
          tradingAmount: 'market-ranking-1d + intraday-3m-weight',
          historyTradingDays: 2,
          persisted: true,
          cacheGuard: 'oversize-skip + active/recent-symbol-prune + 5m-persist-throttle',
        },
        error: null,
      }
      return this.payload
    } catch (error) {
      this.payload = { ...this.payload, ok: this.payload.ok, cache: this.cacheStats(), error: error instanceof Error ? error.message : String(error) }
      return this.payload
    } finally {
      this.refreshing = false
    }
  }
}

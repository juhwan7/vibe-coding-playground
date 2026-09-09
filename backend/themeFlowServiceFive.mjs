import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ThemeFlowService, aggregateStockCandles, isIndividualStock, selectThemeGroups } from './themeFlowService.mjs'
import { aggregateTradingAmountWeightedThemeSeries } from './themeWeightedSeries.mjs'
import { repairMissingIntradayHistory } from './themeGapRepair.mjs'
import { stockMeta, stockRecords, validStockName } from './stockMetadata.mjs'
import { sleep } from './tossClient.mjs'

const DEFAULT_MAX_CACHE_LOAD_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_CACHE_SYMBOLS = 80
const DEFAULT_MAX_CANDLES_PER_SYMBOL = 1600
const DEFAULT_PERSIST_MIN_MS = 5 * 60 * 1000
const TRACKING_START_MINUTE = 8 * 60
const EXTENDED_SESSION_START_MINUTE = 15 * 60 + 30
const EXTENDED_SESSION_END_MINUTE = 20 * 60

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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

function mergeChartCandles(regularCandles = [], observedSamples = [], maxItems = DEFAULT_MAX_CANDLES_PER_SYMBOL) {
  const map = new Map()
  // 동일 분에 Toss 실제 1분봉과 관측 표본이 모두 있으면 실제 1분봉을 우선한다.
  for (const candle of observedSamples) {
    if (candle?.timestamp && candle?.closePrice != null) map.set(candle.timestamp, candle)
  }
  for (const candle of regularCandles) {
    if (candle?.timestamp && candle?.closePrice != null) map.set(candle.timestamp, candle)
  }
  return [...map.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-maxItems)
}

/**
 * 15:30~20:00에는 과거 1분봉이 제공되지 않는 구간을 임의 보간하지 않는다.
 * 실제 랭킹에서 관측한 현재가를 1분 표본으로 저장하고, 거래대금/거래량 가중치는
 * 직전 누적값과 현재 누적값의 증가분만 사용한다. 첫 관측 또는 누적값 역행 시 0으로 둔다.
 */
export function buildExtendedSessionQuoteObservation({ ranking, timestamp, previous = null } = {}) {
  const parsedAt = Date.parse(timestamp ?? '')
  const lastPrice = number(ranking?.lastPrice)
  if (!Number.isFinite(parsedAt) || lastPrice == null) return { counter: previous, sample: null }

  const day = dateKey(timestamp)
  const minute = minuteOfDay(timestamp)
  if (minute < TRACKING_START_MINUTE || minute > EXTENDED_SESSION_END_MINUTE) return { counter: previous, sample: null }

  const currentAmount = number(ranking?.tradingAmount)
  const currentVolume = number(ranking?.tradingVolume)
  const sameDay = previous?.day === day
  const previousAmount = sameDay ? number(previous?.cumulativeTradingAmount) : null
  const previousVolume = sameDay ? number(previous?.cumulativeTradingVolume) : null
  const effectiveAmount = currentAmount == null
    ? previousAmount
    : previousAmount == null ? currentAmount : Math.max(previousAmount, currentAmount)
  const effectiveVolume = currentVolume == null
    ? previousVolume
    : previousVolume == null ? currentVolume : Math.max(previousVolume, currentVolume)

  const counter = {
    day,
    cumulativeTradingAmount: effectiveAmount,
    cumulativeTradingVolume: effectiveVolume,
    observedAt: timestamp,
  }

  if (minute < EXTENDED_SESSION_START_MINUTE) return { counter, sample: null }

  const tradingAmount = previousAmount != null && effectiveAmount != null ? Math.max(0, effectiveAmount - previousAmount) : 0
  const volume = previousVolume != null && effectiveVolume != null ? Math.max(0, effectiveVolume - previousVolume) : 0
  const bucketTimestamp = new Date(Math.floor(parsedAt / 60000) * 60000).toISOString()

  return {
    counter,
    sample: {
      timestamp: bucketTimestamp,
      closePrice: lastPrice,
      volume,
      tradingAmount,
      cumulativeTradingAmount: effectiveAmount,
      cumulativeTradingVolume: effectiveVolume,
      observedQuote: true,
      source: 'market-ranking-observed-quote',
    },
  }
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
    this.gapRepairDiagnostics = new Map()
    this.extendedQuoteSamples = new Map()
    this.extendedQuoteCounters = new Map()
    this.cacheGuard = {
      loadSkippedOversize: false,
      skippedBytes: 0,
      loadedSymbols: 0,
      prunedSymbols: 0,
    }
  }

  cacheStats() {
    let candles = 0
    let extendedQuoteSamples = 0
    for (const items of this.candleCache.values()) candles += items?.length ?? 0
    for (const items of this.extendedQuoteSamples.values()) extendedQuoteSamples += items?.length ?? 0
    const pendingGapSymbols = [...this.gapRepairDiagnostics.values()].filter((item) => (item?.afterGapCount ?? 0) > 0).length
    return {
      symbols: this.candleCache.size,
      candles,
      extendedQuoteSamples,
      extendedQuoteSymbols: this.extendedQuoteSamples.size,
      maxSymbols: this.maxCacheSymbols,
      maxCandlesPerSymbol: this.maxCandlesPerSymbol,
      maxLoadBytes: this.maxCacheLoadBytes,
      persistMinMs: this.persistMinMs,
      pendingGapSymbols,
      gapRepairs: Object.fromEntries([...this.gapRepairDiagnostics.entries()]),
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

      const extendedEntries = Object.entries(saved?.extendedQuoteSamples ?? {})
        .filter(([, samples]) => Array.isArray(samples) && samples.length)
        .sort((a, b) => latestTimestamp(b[1]) - latestTimestamp(a[1]))
        .slice(0, this.maxCacheSymbols)
      for (const [symbol, samples] of extendedEntries) {
        this.extendedQuoteSamples.set(symbol, trimCandles(samples, this.maxCandlesPerSymbol))
      }

      for (const [symbol, counter] of Object.entries(saved?.extendedQuoteCounters ?? {})) {
        if (counter && typeof counter === 'object') this.extendedQuoteCounters.set(symbol, counter)
      }
      this.cacheGuard.loadedSymbols = this.candleCache.size
    } catch {
      // 첫 실행, 이전 캐시 없음, 손상된 캐시는 API 백필과 새 관측 표본으로 복구한다.
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
        this.gapRepairDiagnostics.delete(symbol)
        this.extendedQuoteSamples.delete(symbol)
        this.extendedQuoteCounters.delete(symbol)
        pruned += 1
        continue
      }
      this.candleCache.set(symbol, trimCandles(candles, this.maxCandlesPerSymbol))
      if (this.extendedQuoteSamples.has(symbol)) {
        this.extendedQuoteSamples.set(symbol, trimCandles(this.extendedQuoteSamples.get(symbol), this.maxCandlesPerSymbol))
      }
    }
    for (const symbol of [...this.extendedQuoteSamples.keys()]) {
      if (!keep.has(symbol)) this.extendedQuoteSamples.delete(symbol)
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
      version: 6,
      savedAt: new Date(now).toISOString(),
      candles: Object.fromEntries([...this.candleCache.entries()]),
      extendedQuoteSamples: Object.fromEntries([...this.extendedQuoteSamples.entries()]),
      extendedQuoteCounters: Object.fromEntries([...this.extendedQuoteCounters.entries()]),
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

  chartCandles(symbol) {
    return mergeChartCandles(
      this.candleCache.get(symbol) ?? [],
      this.extendedQuoteSamples.get(symbol) ?? [],
      this.maxCandlesPerSymbol,
    )
  }

  captureExtendedSessionSamples(snapshot, observedSymbols = [], sampleSymbols = []) {
    const timestamp = snapshot?.updatedAt
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return 0
    const bySymbol = new Map((snapshot?.topRankings ?? []).filter((item) => item?.symbol).map((item) => [item.symbol, item]))
    const sampleSet = new Set(sampleSymbols)
    let captured = 0

    for (const symbol of observedSymbols) {
      const ranking = bySymbol.get(symbol)
      if (!ranking) continue
      const previous = this.extendedQuoteCounters.get(symbol) ?? null
      const observation = buildExtendedSessionQuoteObservation({ ranking, timestamp, previous })
      if (observation.counter) this.extendedQuoteCounters.set(symbol, observation.counter)
      if (!sampleSet.has(symbol) || !observation.sample) continue

      const map = new Map((this.extendedQuoteSamples.get(symbol) ?? []).map((sample) => [sample.timestamp, sample]))
      map.set(observation.sample.timestamp, observation.sample)
      this.extendedQuoteSamples.set(
        symbol,
        [...map.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-this.maxCandlesPerSymbol),
      )
      captured += 1
    }
    return captured
  }

  async refreshSymbol(symbol) {
    let baseError = null
    try {
      await super.refreshSymbol(symbol)
    } catch (error) {
      // 최신 20개 갱신이나 구형 공백 복구가 실패해도 전체 nextBefore 백필은 반드시 실행한다.
      baseError = error instanceof Error ? error.message : String(error)
    }

    const existing = this.candleCache.get(symbol) ?? []
    let result = null
    try {
      result = await repairMissingIntradayHistory({
        client: this.client,
        symbol,
        existing,
        maxItems: this.maxCandlesPerSymbol,
        maxPages: 12,
      })
    } catch (error) {
      const repairError = error instanceof Error ? error.message : String(error)
      result = {
        candles: existing,
        repaired: false,
        beforeGapCount: null,
        afterGapCount: null,
        pages: 0,
        requests: 0,
        exhausted: false,
        error: repairError,
        oldestTimestamp: existing[0]?.timestamp ?? null,
        newestTimestamp: existing.at(-1)?.timestamp ?? null,
        remainingGaps: [],
      }
    }

    this.candleCache.set(symbol, result.candles)
    this.gapRepairDiagnostics.set(symbol, {
      checkedAt: new Date().toISOString(),
      beforeGapCount: result.beforeGapCount,
      afterGapCount: result.afterGapCount,
      pages: result.pages,
      requests: result.requests,
      repaired: result.repaired,
      exhausted: result.exhausted ?? false,
      oldestTimestamp: result.oldestTimestamp ?? result.candles[0]?.timestamp ?? null,
      newestTimestamp: result.newestTimestamp ?? result.candles.at(-1)?.timestamp ?? null,
      error: result.error ?? baseError,
      baseError,
      remainingGaps: (result.remainingGaps ?? []).slice(0, 4),
    })
    return result.candles
  }

  async stockChartReady(symbol, { fallbackName = null } = {}) {
    const normalized = String(symbol ?? '').trim()
    if (!/^\d{6}$/.test(normalized)) return { ok: false, error: '올바른 국내 종목코드가 아닙니다.', points: [] }

    this.rememberChartSymbol(normalized)
    await this.ensureMeta([normalized]).catch(() => {})
    const meta = this.stockMeta.get(normalized)
    if (meta && !isIndividualStock(meta)) return { ok: false, error: '개별주식만 조회합니다.', points: [] }

    let points = aggregateStockCandles(this.chartCandles(normalized))
    if (!points.length) {
      await this.refreshSymbol(normalized).catch(() => {})
      this.pruneCandleCache([...this.activeChartSymbols, normalized])
      points = aggregateStockCandles(this.chartCandles(normalized))
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
      source: '정규장 실제 1분봉 + NXT 실제 현재가 관측 표본 → 3분 종가 선차트',
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
      this.captureExtendedSessionSamples(snapshot, symbols, chartSymbols)
      this.pruneCandleCache(chartSymbols)
      await this.persistCache().catch(() => {})

      const themes = groups.map((group) => {
        const members = group.members.map((member) => this.enrichRanking(member)).filter(isIndividualStock)
        const recentSeries = recentTradingDayFilter(
          members.map((member) => ({ symbol: member.symbol, candles: this.chartCandles(member.symbol) })),
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
          candleInterval: '1m + observed NXT quote samples',
          aggregateInterval: '3m',
          weighting: '3m-trading-amount-weighted-return',
          chart: 'weighted-close-line',
          tradingAmount: 'market-ranking-1d/realtime + observed cumulative delta',
          historyTradingDays: 2,
          gapRepair: '15m+ regular-session gap -> latest page + API nextBefore cursor chain full backfill',
          afterMarketSampling: '15:30-20:00 actual observed quote + cumulative turnover delta, no interpolation',
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

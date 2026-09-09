import { ThemeFlowService, aggregateStockCandles, isIndividualStock, selectThemeGroups } from './themeFlowService.mjs'
import { aggregateTradingAmountWeightedThemeSeries } from './themeWeightedSeries.mjs'
import { sleep } from './tossClient.mjs'

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
  async stockChartReady(symbol, { fallbackName = null } = {}) {
    const normalized = String(symbol ?? '').trim()
    if (!/^\d{6}$/.test(normalized)) return { ok: false, error: '올바른 국내 종목코드가 아닙니다.', points: [] }

    await this.ensureMeta([normalized]).catch(() => {})
    const meta = this.stockMeta.get(normalized)
    if (meta && !isIndividualStock(meta)) return { ok: false, error: '개별주식만 조회합니다.', points: [] }

    let points = aggregateStockCandles(this.candleCache.get(normalized) ?? [])
    if (!points.length) {
      await this.refreshSymbol(normalized).catch(() => {})
      points = aggregateStockCandles(this.candleCache.get(normalized) ?? [])
      if (points.length) await this.persistCache().catch(() => {})
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

      await mapLimit(chartSymbols, 3, async (symbol) => {
        await this.refreshSymbol(symbol).catch(() => {})
        await sleep(120)
      })
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

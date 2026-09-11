import { WATCHLIST, WATCH_SYMBOLS } from './watchlist.mjs'
import { TossApiError, sleep } from './tossClient.mjs'
import { StockMetadataCache, directNameFromRanking } from './stockMetadata.mjs'

const NON_INDIVIDUAL_RANKING_NAME = /(ETF|ETN|KODEX|TIGER|RISE|ACE|PLUS|SOL|HANARO|KOSEF|TIMEFOLIO|ARIRANG|FOCUS|KBSTAR|리츠|스팩|인프라)/i
const TRACKING_START_SECONDS = 8 * 60 * 60
const TRACKING_END_SECONDS = 20 * 60 * 60
const NXT_AFTER_START_SECONDS = 15 * 60 * 60 + 30 * 60
const NXT_FINALIZE_END_SECONDS = 20 * 60 * 60 + 30 * 60

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function maxNumber(...values) {
  const clean = values.map(number).filter((value) => value != null)
  return clean.length ? Math.max(...clean) : null
}

function kstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

function kstSecondOfDay(date = new Date()) {
  const { hour, minute, second } = kstParts(date)
  return hour * 60 * 60 + minute * 60 + second
}

export function domesticCollectionActive(date = new Date()) {
  const total = kstSecondOfDay(date)
  return total >= TRACKING_START_SECONDS && total <= TRACKING_END_SECONDS
}

export function nxtAfterMarketActive(date = new Date()) {
  const total = kstSecondOfDay(date)
  return total >= NXT_AFTER_START_SECONDS && total <= TRACKING_END_SECONDS
}

export function nxtRealtimeRankingActive(date = new Date()) {
  const total = kstSecondOfDay(date)
  return total >= NXT_AFTER_START_SECONDS && total <= NXT_FINALIZE_END_SECONDS
}

export function marketSessionLabel(date = new Date()) {
  const { hour, minute } = kstParts(date)
  const total = hour * 60 + minute
  if (total >= 480 && total < 530) return 'NXT PRE · 08:00~08:50'
  if (total >= 540 && total < 920) return 'KRX + NXT · 통합 장중'
  if (total >= 920 && total < 930) return 'KRX 종가 구간'
  if (total >= 930 && total <= 1200) return 'NXT AFTER · 15:30~20:00'
  if (total > 1200 && total <= 1230) return 'NXT 종료 정산 · 최종 거래대금 확인'
  return '시장 대기 · 08:00~20:00 추적'
}

function formatApiError(error) {
  if (error instanceof TossApiError && error.status === 403) return '토스증권 Open API 허용 IP에 이 Docker 서버의 공인 IP를 등록해야 합니다.'
  if (error instanceof TossApiError && error.code === 'credentials-missing') return error.message
  return error instanceof Error ? error.message : String(error)
}

function extractDaily(candlesPayload) {
  const candles = candlesPayload?.result?.candles ?? []
  if (!Array.isArray(candles) || candles.length === 0) return null
  const current = candles[0]
  const previous = candles[1] ?? null
  const open = number(current.openPrice)
  const high = number(current.highPrice)
  const low = number(current.lowPrice)
  const close = number(current.closePrice)
  const volume = number(current.volume)
  const previousClose = previous ? number(previous.closePrice) : null
  const prices = [open, high, low, close].filter((value) => value != null)
  const avgPrice = prices.reduce((sum, value) => sum + value, 0) / Math.max(1, prices.length)
  return {
    previousClose,
    volume,
    estimatedTradingAmount: volume != null && Number.isFinite(avgPrice) ? volume * avgPrice : null,
    timestamp: current.timestamp ?? null,
  }
}

function firstRecord(payload) {
  const result = payload?.result
  if (Array.isArray(result)) return result[0] ?? null
  if (Array.isArray(result?.records)) return result.records[0] ?? null
  if (Array.isArray(result?.items)) return result.items[0] ?? null
  return result ?? null
}

function pickNumber(object, keys) {
  if (!object || typeof object !== 'object') return null
  for (const key of keys) {
    const value = number(object[key])
    if (value != null) return value
  }
  return null
}

function investorValue(record, side, unit) {
  const group = record?.[side]
  const amountKeys = ['netBuyAmount', 'netPurchaseAmount', 'netAmount', 'netBuyingAmount']
  const volumeKeys = ['netBuyVolume', 'netPurchaseVolume', 'netVolume', 'netBuyingVolume']
  const direct = unit === 'amount'
    ? [`${side}NetBuyAmount`, `${side}NetPurchaseAmount`]
    : [`${side}NetBuyVolume`, `${side}NetPurchaseVolume`]
  return pickNumber(group, unit === 'amount' ? amountKeys : volumeKeys) ?? pickNumber(record, direct)
}

function programValue(record, side) {
  const candidates = side === 'nonArbitrage'
    ? ['nonArbitrage', 'nonarbitrage', 'nonArb', 'nonArbitrageTrading']
    : ['arbitrage', 'arb', 'arbitrageTrading']
  for (const key of candidates) {
    const group = record?.[key]
    const value = pickNumber(group, ['netBuyVolume', 'netVolume', 'netPurchaseVolume'])
    if (value != null) return value
  }
  const directKeys = side === 'nonArbitrage'
    ? ['nonArbitrageNetBuyVolume', 'nonArbitrageNetVolume']
    : ['arbitrageNetBuyVolume', 'arbitrageNetVolume']
  return pickNumber(record, directKeys)
}

export function rankingItem(item, fallbackName = null) {
  const rate = item?.price?.changeRate != null ? number(item.price.changeRate) : number(item?.changeRate)
  return {
    symbol: item?.symbol ?? item?.stock?.symbol ?? null,
    name: directNameFromRanking(item) ?? fallbackName,
    market: item?.market ?? item?.marketName ?? item?.exchange ?? item?.stock?.market ?? item?.stock?.marketName ?? null,
    lastPrice: number(item?.price?.lastPrice ?? item?.lastPrice),
    changeRate: rate != null ? rate * (Math.abs(rate) <= 1 ? 100 : 1) : null,
    tradingAmount: number(item?.tradingAmount),
    tradingVolume: number(item?.tradingVolume),
  }
}

function rankingRecords(payload) {
  const rankings = payload?.result?.rankings
  return Array.isArray(rankings) ? rankings : []
}

/**
 * `1d`는 기존 당일 누적 기준으로 유지하고, NXT 애프터마켓에서는 `realtime` 랭킹도 함께 본다.
 * 두 응답의 거래대금을 더하지 않고 종목별 더 큰 실제 값을 사용한다. 이렇게 하면 realtime이
 * 짧은 구간 값으로 작게 내려와도 기존 누적값을 훼손하지 않고, 애프터마켓 누적값이 더 커질 때만 반영된다.
 */
export function mergeMarketTradingAmountRankings(dailyItems = [], realtimeItems = [], fallbackNameForSymbol = null) {
  const daily = new Map(dailyItems.map((item) => [item?.symbol ?? item?.stock?.symbol ?? null, item]).filter(([symbol]) => symbol))
  const realtime = new Map(realtimeItems.map((item) => [item?.symbol ?? item?.stock?.symbol ?? null, item]).filter(([symbol]) => symbol))
  const symbols = [...new Set([...daily.keys(), ...realtime.keys()])]

  return symbols.map((symbol) => {
    const fallbackName = typeof fallbackNameForSymbol === 'function' ? fallbackNameForSymbol(symbol) : null
    const dailyItem = daily.get(symbol)
    const realtimeItem = realtime.get(symbol)
    const dailyParsed = dailyItem ? rankingItem(dailyItem, fallbackName) : null
    const realtimeParsed = realtimeItem ? rankingItem(realtimeItem, dailyParsed?.name ?? fallbackName) : null
    const dailyAmount = number(dailyParsed?.tradingAmount)
    const realtimeAmount = number(realtimeParsed?.tradingAmount)
    const tradingAmount = maxNumber(dailyAmount, realtimeAmount)
    const tradingVolume = maxNumber(dailyParsed?.tradingVolume, realtimeParsed?.tradingVolume)
    const realtimeWon = realtimeAmount != null && (dailyAmount == null || realtimeAmount > dailyAmount)

    return {
      symbol,
      name: realtimeParsed?.name ?? dailyParsed?.name ?? fallbackName,
      market: realtimeParsed?.market ?? dailyParsed?.market ?? null,
      lastPrice: realtimeParsed?.lastPrice ?? dailyParsed?.lastPrice ?? null,
      changeRate: realtimeParsed?.changeRate ?? dailyParsed?.changeRate ?? null,
      tradingAmount,
      tradingVolume,
      tradingAmountSource: realtimeWon ? 'market-ranking-realtime' : dailyAmount != null ? 'market-ranking-1d' : realtimeAmount != null ? 'market-ranking-realtime' : null,
      rankingAmounts: {
        daily: dailyAmount,
        realtime: realtimeAmount,
      },
    }
  }).sort((a, b) => (b.tradingAmount ?? -Infinity) - (a.tradingAmount ?? -Infinity))
}

export function isDisplayableIndividualRanking(item = {}) {
  const symbol = String(item?.symbol ?? '').trim()
  const name = String(item?.name ?? '').trim()
  const securityType = String(item?.securityType ?? '').trim().toUpperCase()
  if (!/^\d{6}$/.test(symbol) || !name || name === symbol || /^\d{6}$/.test(name)) return false
  if (securityType && securityType !== 'STOCK') return false
  return !NON_INDIVIDUAL_RANKING_NAME.test(name)
}

export class MarketCollector {
  constructor(client, { fastMs = 60000, slowMs = 60000 } = {}) {
    this.client = client
    this.fastMs = fastMs
    this.slowMs = slowMs
    this.daily = new Map()
    this.investor = new Map()
    this.indexDaily = new Map()
    this.marketInvestors = { KOSPI: null, KOSDAQ: null, total: null }
    this.program = new Map()
    this.rankingNames = new Map()
    this.stockMetadata = new StockMetadataCache({ chunkSize: 10 })
    this.snapshot = null
    this.lastError = null
    this.lastSlowAt = 0
    this.slowRefreshing = false
    this.running = false
    this.timer = null
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
    const active = domesticCollectionActive()
    this.timer = setTimeout(async () => {
      await this.refresh().catch(() => {})
      this.schedule()
    }, active ? this.fastMs : 300000)
  }

  triggerSlowRefresh() {
    if (this.slowRefreshing || Date.now() - this.lastSlowAt <= this.slowMs) return
    this.slowRefreshing = true
    this.lastSlowAt = Date.now()
    void this.refreshSlow()
      .catch(() => {})
      .finally(() => { this.slowRefreshing = false })
  }

  async refresh() {
    if (!this.client.configured) {
      this.lastError = 'TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 환경변수가 없습니다.'
      this.snapshot = this.degradedSnapshot()
      return this.snapshot
    }

    try {
      const symbols = encodeURIComponent(WATCH_SYMBOLS.join(','))
      const realtimeRankingActive = nxtRealtimeRankingActive()
      const realtimeRankingPromise = realtimeRankingActive
        ? this.client.request('/api/v1/rankings?type=MARKET_TRADING_AMOUNT&marketCountry=KR&duration=realtime&count=100').catch(() => null)
        : Promise.resolve(null)
      const [pricesPayload, rankingPayload, realtimeRankingPayload, indicesPayload] = await Promise.all([
        this.client.request(`/api/v1/prices?symbols=${symbols}`),
        this.client.request('/api/v1/rankings?type=MARKET_TRADING_AMOUNT&marketCountry=KR&duration=1d&count=100'),
        realtimeRankingPromise,
        this.client.request('/api/v1/market-indicators/prices?symbols=KOSPI%2CKOSDAQ'),
      ])

      const prices = new Map((pricesPayload?.result ?? []).map((item) => [item.symbol, item]))
      const dailyRankings = rankingRecords(rankingPayload)
      const realtimeRankings = rankingRecords(realtimeRankingPayload)
      const rankingSymbols = [...new Set(
        [...dailyRankings, ...realtimeRankings]
          .map((item) => item?.symbol ?? item?.stock?.symbol ?? null)
          .filter(Boolean),
      )]
      await this.stockMetadata.ensure(this.client, rankingSymbols).catch(() => {})

      const dailyRankingMap = new Map(dailyRankings.map((item) => [item?.symbol ?? item?.stock?.symbol ?? null, item]).filter(([symbol]) => symbol))
      const realtimeRankingMap = new Map(realtimeRankings.map((item) => [item?.symbol ?? item?.stock?.symbol ?? null, item]).filter(([symbol]) => symbol))
      const normalizedRankings = mergeMarketTradingAmountRankings(
        dailyRankings,
        realtimeRankings,
        (symbol) => this.stockMetadata.get(symbol)?.name ?? this.rankingNames.get(symbol) ?? null,
      ).map((item) => {
        const meta = item.symbol ? this.stockMetadata.get(item.symbol) : null
        const enriched = {
          ...item,
          name: meta?.name ?? item.name ?? null,
          market: meta?.market ?? item.market ?? null,
          securityType: meta?.securityType ?? null,
          isCommonShare: meta?.isCommonShare ?? null,
          status: meta?.status ?? null,
        }
        if (enriched.symbol && enriched.name) this.rankingNames.set(enriched.symbol, enriched.name)
        return enriched
      }).filter(isDisplayableIndividualRanking).slice(0, 100)
      const rankingMap = new Map(normalizedRankings.map((item) => [item.symbol, item]))
      const indices = new Map((indicesPayload?.result ?? []).map((item) => [item.symbol, item]))
      const stocks = {}

      for (const info of WATCHLIST) {
        const price = prices.get(info.symbol)
        const ranking = rankingMap.get(info.symbol)
        const rawDailyRanking = dailyRankingMap.get(info.symbol)
        const rawRealtimeRanking = realtimeRankingMap.get(info.symbol)
        const daily = this.daily.get(info.symbol)
        const flow = this.investor.get(info.symbol)
        const lastPrice = number(price?.lastPrice ?? ranking?.lastPrice)
        const basePrice = number(rawRealtimeRanking?.price?.basePrice ?? rawDailyRanking?.price?.basePrice) ?? daily?.previousClose ?? null
        const changeRate = number(ranking?.changeRate)
          ?? (lastPrice != null && basePrice ? ((lastPrice / basePrice) - 1) * 100 : null)
        const exactTradingAmount = number(ranking?.tradingAmount)
        const tradingVolume = number(ranking?.tradingVolume) ?? daily?.volume ?? null
        const tradingAmount = exactTradingAmount ?? daily?.estimatedTradingAmount ?? null

        stocks[info.symbol] = {
          symbol: info.symbol,
          name: info.name,
          market: info.market,
          lastPrice,
          basePrice,
          changeRate,
          tradingAmount,
          tradingVolume,
          foreignNetBuyVolume: flow?.foreigner ?? null,
          institutionNetBuyVolume: flow?.institution ?? null,
          updatedAt: price?.timestamp ?? daily?.timestamp ?? null,
          tradingAmountSource: exactTradingAmount != null ? ranking?.tradingAmountSource ?? 'market-ranking-1d' : tradingAmount != null ? 'ohlcv-estimate' : null,
        }
      }

      const indexResult = {}
      for (const symbol of ['KOSPI', 'KOSDAQ']) {
        const current = indices.get(symbol)
        const lastPrice = number(current?.lastPrice)
        const basePrice = this.indexDaily.get(symbol)?.previousClose ?? null
        indexResult[symbol] = {
          lastPrice,
          changeRate: lastPrice != null && basePrice ? ((lastPrice / basePrice) - 1) * 100 : null,
          updatedAt: current?.timestamp ?? null,
        }
      }

      const programValues = [...this.program.values()]
      const programSummary = {
        arbitrageNetBuyVolume: programValues.reduce((sum, item) => sum + (item.arbitrage ?? 0), 0),
        nonArbitrageNetBuyVolume: programValues.reduce((sum, item) => sum + (item.nonArbitrage ?? 0), 0),
        symbolCount: programValues.length,
        coverage: `tracked-${WATCH_SYMBOLS.length}`,
        unit: 'shares',
      }

      this.lastError = null
      this.snapshot = {
        ok: true,
        mode: 'live',
        updatedAt: new Date().toISOString(),
        marketSession: marketSessionLabel(),
        error: null,
        indices: indexResult,
        stocks,
        topRankings: normalizedRankings,
        marketTradingAmount: normalizedRankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0),
        marketTradingAmountCoverage: 'top100-source-stock-only',
        marketInvestors: this.marketInvestors,
        programSummary,
        futures: {
          available: false,
          source: null,
          priceChangeRate: null,
          tradingStrength: null,
          tradingVolume: null,
          openInterest: null,
          foreignNetContracts: null,
          institutionNetContracts: null,
        },
        rankingDuration: realtimeRankings.length ? '1d+realtime' : '1d',
        rankingPolicy: realtimeRankings.length ? 'per-symbol-max-with-realtime-through-20:30-finalize' : '1d',
        rankedAt: realtimeRankingPayload?.result?.rankedAt ?? rankingPayload?.result?.rankedAt ?? null,
        rankingRankedAt: {
          daily: rankingPayload?.result?.rankedAt ?? null,
          realtime: realtimeRankingPayload?.result?.rankedAt ?? null,
        },
      }

      // Publish the fast snapshot immediately. Slower daily/investor/program data
      // is collected in the background and will be folded into the next 1-minute snapshot.
      this.triggerSlowRefresh()
      return this.snapshot
    } catch (error) {
      this.lastError = formatApiError(error)
      if (this.snapshot?.ok) {
        this.snapshot = { ...this.snapshot, mode: 'degraded', error: this.lastError, updatedAt: new Date().toISOString() }
        return this.snapshot
      }
      this.snapshot = this.degradedSnapshot()
      return this.snapshot
    }
  }

  degradedSnapshot() {
    return {
      ok: false,
      mode: 'degraded',
      updatedAt: new Date().toISOString(),
      marketSession: marketSessionLabel(),
      error: this.lastError,
      indices: {},
      stocks: {},
      topRankings: [],
      marketTradingAmount: null,
      marketTradingAmountCoverage: 'top100-source-stock-only',
      marketInvestors: this.marketInvestors,
      programSummary: null,
      futures: { available: false, source: null },
      rankingDuration: '1d',
      rankingPolicy: '1d',
      rankedAt: null,
      rankingRankedAt: { daily: null, realtime: null },
    }
  }

  async refreshSlow() {
    const jobs = [
      ...WATCH_SYMBOLS.map((symbol) => async () => {
        const payload = await this.client.request(`/api/v1/candles?symbol=${symbol}&interval=1d&count=2`)
        const daily = extractDaily(payload)
        if (daily) this.daily.set(symbol, daily)
      }),
      ...['KOSPI', 'KOSDAQ'].map((symbol) => async () => {
        const payload = await this.client.request(`/api/v1/market-indicators/${symbol}/candles?interval=1d&count=2`)
        const daily = extractDaily(payload)
        if (daily) this.indexDaily.set(symbol, daily)
      }),
    ]

    for (let index = 0; index < jobs.length; index += 8) {
      await Promise.all(jobs.slice(index, index + 8).map((job) => job().catch(() => null)))
      if (index + 8 < jobs.length) await sleep(500)
    }

    for (const symbol of WATCH_SYMBOLS) {
      try {
        const payload = await this.client.request(`/api/v1/stocks/${symbol}/investor-trading?count=1`)
        const record = firstRecord(payload)
        this.investor.set(symbol, {
          foreigner: investorValue(record, 'foreigner', 'volume'),
          institution: investorValue(record, 'institution', 'volume'),
          updatedAt: record?.updatedAt ?? record?.date ?? null,
        })
      } catch {
        // 일부 시점에 잠정치가 없더라도 시세 수집은 계속한다.
      }
      await sleep(120)
    }

    for (const symbol of ['KOSPI', 'KOSDAQ']) {
      try {
        const payload = await this.client.request(`/api/v1/market-indicators/${symbol}/investor-trading?count=1`)
        const record = firstRecord(payload)
        this.marketInvestors[symbol] = {
          foreignerNetBuyAmount: investorValue(record, 'foreigner', 'amount'),
          institutionNetBuyAmount: investorValue(record, 'institution', 'amount'),
          individualNetBuyAmount: investorValue(record, 'individual', 'amount'),
          updatedAt: record?.updatedAt ?? record?.date ?? null,
        }
      } catch {
        this.marketInvestors[symbol] = this.marketInvestors[symbol] ?? null
      }
      await sleep(120)
    }

    const investorMarkets = ['KOSPI', 'KOSDAQ'].map((symbol) => this.marketInvestors[symbol]).filter(Boolean)
    this.marketInvestors.total = investorMarkets.length ? {
      foreignerNetBuyAmount: investorMarkets.reduce((sum, item) => sum + (item.foreignerNetBuyAmount ?? 0), 0),
      institutionNetBuyAmount: investorMarkets.reduce((sum, item) => sum + (item.institutionNetBuyAmount ?? 0), 0),
      individualNetBuyAmount: investorMarkets.reduce((sum, item) => sum + (item.individualNetBuyAmount ?? 0), 0),
      coverage: investorMarkets.length === 2 ? 'KOSPI+KOSDAQ' : 'partial',
    } : null

    for (const symbol of WATCH_SYMBOLS) {
      try {
        const payload = await this.client.request(`/api/v1/stocks/${symbol}/program-trades?count=1`)
        const record = firstRecord(payload)
        this.program.set(symbol, {
          arbitrage: programValue(record, 'arbitrage'),
          nonArbitrage: programValue(record, 'nonArbitrage'),
          updatedAt: record?.updatedAt ?? record?.date ?? null,
        })
      } catch {
        // 프로그램매매 데이터가 없는 종목은 집계에서 제외한다.
      }
      await sleep(120)
    }
  }
}
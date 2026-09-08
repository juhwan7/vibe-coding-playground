import { WATCHLIST, WATCH_SYMBOLS } from './watchlist.mjs'
import { TossApiError, sleep } from './tossClient.mjs'

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function kstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

export function marketSessionLabel(date = new Date()) {
  const { hour, minute } = kstParts(date)
  const total = hour * 60 + minute
  if (total >= 480 && total < 530) return 'NXT PRE · 08:00~08:50'
  if (total >= 540 && total < 920) return 'KRX + NXT · 통합 장중'
  if (total >= 920 && total < 930) return 'KRX 종가 구간'
  if (total >= 940 && total < 1200) return 'NXT AFTER · 15:40~20:00'
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

function rankingItem(item) {
  const rate = item?.price?.changeRate != null ? number(item.price.changeRate) : number(item?.changeRate)
  return {
    symbol: item?.symbol ?? item?.stock?.symbol ?? null,
    name: item?.name ?? item?.stockName ?? item?.stock?.name ?? null,
    market: item?.market ?? item?.stock?.market ?? null,
    lastPrice: number(item?.price?.lastPrice ?? item?.lastPrice),
    changeRate: rate != null ? rate * (Math.abs(rate) <= 1 ? 100 : 1) : null,
    tradingAmount: number(item?.tradingAmount),
    tradingVolume: number(item?.tradingVolume),
  }
}

export class MarketCollector {
  constructor(client, { fastMs = 5000, slowMs = 60000 } = {}) {
    this.client = client
    this.fastMs = fastMs
    this.slowMs = slowMs
    this.daily = new Map()
    this.investor = new Map()
    this.indexDaily = new Map()
    this.marketInvestors = { KOSPI: null, KOSDAQ: null, total: null }
    this.program = new Map()
    this.snapshot = null
    this.lastError = null
    this.lastSlowAt = 0
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
    const { hour } = kstParts()
    const active = hour >= 7 && hour <= 20
    this.timer = setTimeout(async () => {
      await this.refresh().catch(() => {})
      this.schedule()
    }, active ? this.fastMs : 60000)
  }

  async refresh() {
    if (!this.client.configured) {
      this.lastError = 'TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 환경변수가 없습니다.'
      this.snapshot = this.degradedSnapshot()
      return this.snapshot
    }

    try {
      if (Date.now() - this.lastSlowAt > this.slowMs) {
        await this.refreshSlow()
        this.lastSlowAt = Date.now()
      }
      const symbols = encodeURIComponent(WATCH_SYMBOLS.join(','))
      const [pricesPayload, rankingPayload, indicesPayload] = await Promise.all([
        this.client.request(`/api/v1/prices?symbols=${symbols}`),
        this.client.request('/api/v1/rankings?type=MARKET_TRADING_AMOUNT&marketCountry=KR&duration=realtime&count=100'),
        this.client.request('/api/v1/market-indicators/prices?symbols=KOSPI%2CKOSDAQ'),
      ])

      const prices = new Map((pricesPayload?.result ?? []).map((item) => [item.symbol, item]))
      const rankings = rankingPayload?.result?.rankings ?? []
      const rankingMap = new Map(rankings.map((item) => [item.symbol, item]))
      const indices = new Map((indicesPayload?.result ?? []).map((item) => [item.symbol, item]))
      const stocks = {}

      for (const info of WATCHLIST) {
        const price = prices.get(info.symbol)
        const ranking = rankingMap.get(info.symbol)
        const daily = this.daily.get(info.symbol)
        const flow = this.investor.get(info.symbol)
        const lastPrice = number(price?.lastPrice ?? ranking?.price?.lastPrice)
        const basePrice = number(ranking?.price?.basePrice) ?? daily?.previousClose ?? null
        const changeRate = ranking?.price?.changeRate != null
          ? number(ranking.price.changeRate) * 100
          : lastPrice != null && basePrice ? ((lastPrice / basePrice) - 1) * 100 : null
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
          tradingAmountSource: exactTradingAmount != null ? 'ranking' : tradingAmount != null ? 'ohlcv-estimate' : null,
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
        topRankings: rankings.map(rankingItem).filter((item) => item.symbol),
        marketTradingAmount: rankings.reduce((sum, item) => sum + (number(item.tradingAmount) ?? 0), 0),
        marketTradingAmountCoverage: 'top100',
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
        rankedAt: rankingPayload?.result?.rankedAt ?? null,
      }
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
      marketTradingAmountCoverage: 'top100',
      marketInvestors: this.marketInvestors,
      programSummary: null,
      futures: { available: false, source: null },
      rankedAt: null,
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

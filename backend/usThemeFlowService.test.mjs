import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUsThemeGroups, selectUsThemeGroups } from './usThemeCatalog.mjs'
import {
  aggregateUsAfterHoursThemeSeries,
  aggregateUsLiveThemeSeries,
  aggregateUsThemeSeries,
  isUsIndividualStock,
  isUsPostMarketTimestamp,
  loadUsLivePrices,
  loadUsRanking,
  mergeUsLivePriceSamples,
  mergeUsThemePoints,
} from './usThemeFlowService.mjs'

test('buildUsThemeGroups requires three US top50 members and sorts by turnover', () => {
  const rankings = [
    { symbol: 'NVDA', tradingAmount: 100 },
    { symbol: 'AMD', tradingAmount: 80 },
    { symbol: 'AVGO', tradingAmount: 60 },
    { symbol: 'MSFT', tradingAmount: 90 },
    { symbol: 'META', tradingAmount: 70 },
    { symbol: 'GOOGL', tradingAmount: 50 },
    { symbol: 'TSLA', tradingAmount: 200 },
  ]
  const groups = buildUsThemeGroups(rankings, { limit: 50, minMembers: 3, maxThemes: 10 })
  assert.equal(groups.length, 2)
  assert.equal(groups[0].name, 'AI 반도체')
  assert.equal(groups[0].members.length, 3)
  assert.equal(groups[0].tradingAmount, 240)
  assert.equal(groups[1].name, 'AI 플랫폼·빅테크')
  assert.equal(groups[1].tradingAmount, 210)
})

test('selectUsThemeGroups fixes the US board to five themes using only top50 stocks', () => {
  const rankings = [
    { symbol: 'NVDA', tradingAmount: 500 }, { symbol: 'AMD', tradingAmount: 480 }, { symbol: 'AVGO', tradingAmount: 460 },
    { symbol: 'MSFT', tradingAmount: 440 }, { symbol: 'META', tradingAmount: 420 }, { symbol: 'GOOGL', tradingAmount: 400 },
    { symbol: 'PLTR', tradingAmount: 380 }, { symbol: 'CRM', tradingAmount: 360 }, { symbol: 'NOW', tradingAmount: 340 },
    { symbol: 'TSLA', tradingAmount: 320 }, { symbol: 'RIVN', tradingAmount: 300 }, { symbol: 'GM', tradingAmount: 280 },
    { symbol: 'JPM', tradingAmount: 260 }, { symbol: 'BAC', tradingAmount: 240 }, { symbol: 'GS', tradingAmount: 220 },
    ...Array.from({ length: 35 }, (_, index) => ({ symbol: `ZZ${index}`, tradingAmount: 200 - index })),
    { symbol: 'XOM', tradingAmount: 9999 }, { symbol: 'CVX', tradingAmount: 9998 }, { symbol: 'COP', tradingAmount: 9997 },
  ]
  const groups = selectUsThemeGroups(rankings, { targetCount: 5, limit: 50 })
  assert.equal(groups.length, 5)
  assert.deepEqual(groups.map((group) => group.name), [
    'AI 반도체', 'AI 플랫폼·빅테크', 'AI 소프트웨어', '전기차·자율주행', '금융·결제',
  ])
  assert.equal(groups.some((group) => group.members.some((member) => member.symbol === 'XOM')), false)
})

test('US individual-stock filter excludes ETF and ETN metadata before TOP50 is built', () => {
  assert.equal(isUsIndividualStock({ symbol: 'NVDA', name: 'NVIDIA', securityType: 'STOCK' }), true)
  assert.equal(isUsIndividualStock({ symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', securityType: 'ETF' }), false)
  assert.equal(isUsIndividualStock({ symbol: 'QQQ', name: 'Invesco QQQ Trust' }), false)
  assert.equal(isUsIndividualStock({ symbol: 'TEST', name: 'Example ETN' }), false)
})

test('aggregateUsThemeSeries keeps real one-minute points and uses actual minute turnover weights', () => {
  const memberSeries = [
    {
      symbol: 'NVDA',
      candles: [
        { timestamp: '2026-09-08T13:30:00.000Z', closePrice: 100, volume: 10, tradingAmount: 1000 },
        { timestamp: '2026-09-08T13:31:00.000Z', closePrice: 101, volume: 10, tradingAmount: 1010 },
        { timestamp: '2026-09-08T13:33:00.000Z', closePrice: 102, volume: 10, tradingAmount: 1020 },
      ],
    },
    {
      symbol: 'AMD',
      candles: [
        { timestamp: '2026-09-08T13:30:00.000Z', closePrice: 200, volume: 5, tradingAmount: 1000 },
        { timestamp: '2026-09-08T13:31:00.000Z', closePrice: 198, volume: 5, tradingAmount: 990 },
        { timestamp: '2026-09-08T13:33:00.000Z', closePrice: 204, volume: 5, tradingAmount: 1020 },
      ],
    },
  ]
  const points = aggregateUsThemeSeries(memberSeries)
  assert.equal(points.length, 3)
  assert.equal(points[0].memberCount, 2)
  assert.equal(points[0].tradingAmount, 2000)
  assert.ok(Math.abs(points[0].value) < 1e-9)
  assert.ok(Math.abs(points[1].value - 0.01) < 1e-9)
  assert.ok(Math.abs(points[2].value - 2) < 1e-9)
  assert.equal(points[2].source, '1m-backfill')
})

test('30-second live samples remain separate real observations and use stable member turnover weights', () => {
  const points = aggregateUsLiveThemeSeries([
    {
      symbol: 'NVDA',
      weight: 300,
      candles: [{ timestamp: '2026-09-09T13:30:00.000Z', closePrice: 100 }],
      samples: [
        { timestamp: '2026-09-09T13:30:00.000Z', lastPrice: 101 },
        { timestamp: '2026-09-09T13:30:30.000Z', lastPrice: 102 },
      ],
    },
    {
      symbol: 'AMD',
      weight: 100,
      candles: [{ timestamp: '2026-09-09T13:30:00.000Z', closePrice: 200 }],
      samples: [
        { timestamp: '2026-09-09T13:30:00.000Z', lastPrice: 198 },
        { timestamp: '2026-09-09T13:30:30.000Z', lastPrice: 202 },
      ],
    },
  ])
  assert.equal(points.length, 2)
  assert.equal(points[0].timestamp, '2026-09-09T13:30:00.000Z')
  assert.equal(points[1].timestamp, '2026-09-09T13:30:30.000Z')
  assert.ok(Math.abs(points[0].value - 0.5) < 1e-9)
  assert.ok(Math.abs(points[1].value - 1.75) < 1e-9)
  assert.equal(points[0].tradingAmount, null)
  assert.equal(points[0].source, '30s-live')
})

test('live price cache buckets real observations at 30 seconds without inventing midpoint prices', () => {
  const samples = mergeUsLivePriceSamples([], [
    { timestamp: '2026-09-09T13:30:12.000Z', lastPrice: 100 },
    { timestamp: '2026-09-09T13:30:43.000Z', lastPrice: 101 },
  ])
  assert.deepEqual(samples.map((sample) => sample.timestamp), [
    '2026-09-09T13:30:00.000Z',
    '2026-09-09T13:30:30.000Z',
  ])
  assert.deepEqual(samples.map((sample) => sample.lastPrice), [100, 101])
})

test('live points replace the same historical timestamp while untouched history remains', () => {
  const merged = mergeUsThemePoints(
    [
      { timestamp: '2026-09-09T13:30:00.000Z', value: 1, source: '1m-backfill' },
      { timestamp: '2026-09-09T13:31:00.000Z', value: 2, source: '1m-backfill' },
    ],
    [
      { timestamp: '2026-09-09T13:30:00.000Z', value: 1.2, source: '30s-live' },
      { timestamp: '2026-09-09T13:30:30.000Z', value: 1.5, source: '30s-live' },
    ],
  )
  assert.equal(merged.length, 3)
  assert.equal(merged[0].value, 1.2)
  assert.equal(merged[1].timestamp, '2026-09-09T13:30:30.000Z')
  assert.equal(merged[2].value, 2)
})

test('loadUsLivePrices batches symbols into the real current-price endpoint', async () => {
  const calls = []
  const client = {
    async request(path) {
      calls.push(path)
      return { result: [
        { symbol: 'NVDA', lastPrice: 180, timestamp: '2026-09-09T13:30:12.000Z' },
        { symbol: 'AMD', lastPrice: 150, timestamp: '2026-09-09T13:30:13.000Z' },
      ] }
    },
  }
  const prices = await loadUsLivePrices(client, ['NVDA', 'AMD'])
  assert.equal(calls.length, 1)
  assert.ok(calls[0].startsWith('/api/v1/prices?symbols='))
  assert.equal(prices.length, 2)
  assert.equal(prices[0].lastPrice, 180)
})

test('loadUsRanking falls back from empty 1d market ranking to realtime market ranking', async () => {
  const calls = []
  const client = {
    async request(path) {
      calls.push(path)
      if (path.includes('duration=1d')) return { result: { rankings: [], rankedAt: null } }
      return { result: { rankings: [{ symbol: 'NVDA', tradingAmount: 100 }], rankedAt: '2026-09-09T00:00:00Z' } }
    },
  }
  const result = await loadUsRanking(client)
  assert.equal(result.source, 'market-realtime')
  assert.equal(result.isMarketWide, true)
  assert.equal(result.rankings.length, 1)
  assert.equal(result.attempts.length, 2)
  assert.equal(calls.length, 2)
})

test('loadUsRanking labels Toss-specific turnover as a non-market-wide final fallback', async () => {
  const client = {
    async request(path) {
      if (path.includes('type=TOSS_SECURITIES_TRADING_AMOUNT')) {
        return { result: { rankings: [{ symbol: 'TSLA', tradingAmount: 200 }], rankedAt: '2026-09-09T00:00:00Z' } }
      }
      return { result: { rankings: [], rankedAt: null } }
    },
  }
  const result = await loadUsRanking(client)
  assert.equal(result.source, 'toss-1d-fallback')
  assert.equal(result.isMarketWide, false)
  assert.equal(result.rankings[0].symbol, 'TSLA')
  assert.equal(result.attempts.length, 3)
})


test('US after-hours starts strictly after 16:00 ET and includes exactly 20:00 ET', () => {
  assert.equal(isUsPostMarketTimestamp('2026-09-09T20:00:00.000Z'), false)
  assert.equal(isUsPostMarketTimestamp('2026-09-09T20:00:30.000Z'), true)
  assert.equal(isUsPostMarketTimestamp('2026-09-10T00:00:00.000Z'), true)
  assert.equal(isUsPostMarketTimestamp('2026-09-10T00:00:30.000Z'), false)
})

test('live cache keeps regular and verified after-hours but drops premarket and unverified after-hours', () => {
  const samples = mergeUsLivePriceSamples([], [
    { timestamp: '2026-09-09T12:00:00.000Z', lastPrice: 99, timestampVerified: true },
    { timestamp: '2026-09-09T13:30:12.000Z', lastPrice: 100, timestampVerified: true },
    { timestamp: '2026-09-09T20:00:30.000Z', lastPrice: 101, timestampVerified: true },
    { timestamp: '2026-09-09T20:01:00.000Z', lastPrice: 102, timestampVerified: false },
  ])
  assert.deepEqual(samples.map((sample) => sample.timestamp), [
    '2026-09-09T13:30:00.000Z',
    '2026-09-09T20:00:30.000Z',
  ])
})

test('after-hours theme series uses regular close as zero baseline and does not duplicate regular turnover', () => {
  const points = aggregateUsAfterHoursThemeSeries([
    {
      symbol: 'NVDA', regularClose: 100, weight: 300,
      samples: [
        { timestamp: '2026-09-09T20:00:30.000Z', lastPrice: 101, timestampVerified: true },
        { timestamp: '2026-09-09T20:01:00.000Z', lastPrice: 102, timestampVerified: true },
      ],
    },
    {
      symbol: 'AMD', regularClose: 200, weight: 100,
      samples: [
        { timestamp: '2026-09-09T20:00:30.000Z', lastPrice: 198, timestampVerified: true },
        { timestamp: '2026-09-09T20:01:00.000Z', lastPrice: 202, timestampVerified: true },
      ],
    },
  ])
  assert.equal(points.length, 2)
  assert.ok(Math.abs(points[0].value - 0.5) < 1e-9)
  assert.ok(Math.abs(points[1].value - 1.75) < 1e-9)
  assert.equal(points[0].tradingAmount, null)
  assert.equal(points[0].source, '30s-after-hours')
})

test('loadUsLivePrices marks fallback timestamps unverified so they cannot masquerade as after-hours prints', async () => {
  const client = { async request() { return { result: [{ symbol: 'NVDA', lastPrice: 181 }] } } }
  const prices = await loadUsLivePrices(client, ['NVDA'], '2026-09-09T20:30:00.000Z')
  assert.equal(prices[0].timestamp, '2026-09-09T20:30:00.000Z')
  assert.equal(prices[0].timestampVerified, false)
})

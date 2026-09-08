import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUsThemeGroups } from './usThemeCatalog.mjs'
import { aggregateUsThemeSeries, loadUsRanking } from './usThemeFlowService.mjs'

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

test('aggregateUsThemeSeries normalizes members and averages them into 3-minute buckets', () => {
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
  assert.equal(points.length, 2)
  assert.equal(points[0].memberCount, 2)
  assert.equal(points[0].tradingAmount, 4000)
  assert.ok(Math.abs(points[0].value - 0) < 1e-9)
  assert.ok(Math.abs(points[1].value - 2) < 1e-9)
  assert.equal(points[1].tradingAmount, 2040)
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

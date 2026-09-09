import test from 'node:test'
import assert from 'node:assert/strict'
import { buildThemeGroups } from './themeCatalog.mjs'
import { ThemeFlowService, aggregateStockCandles, aggregateThemeSeries, findIntradayCandleGaps, isIndividualStock, selectThemeGroups } from './themeFlowService.mjs'

test('buildThemeGroups requires at least three top50 members and sorts by turnover', () => {
  const rankings = [
    { symbol: '000660', name: 'SK하이닉스', tradingAmount: 500 },
    { symbol: '005930', name: '삼성전자', tradingAmount: 400 },
    { symbol: '042700', name: '한미반도체', tradingAmount: 300 },
    { symbol: '034020', name: '두산에너빌리티', tradingAmount: 250 },
    { symbol: '052690', name: '한전기술', tradingAmount: 200 },
    { symbol: '051600', name: '한전KPS', tradingAmount: 150 },
    { symbol: '373220', name: 'LG에너지솔루션', tradingAmount: 100 },
    { symbol: '006400', name: '삼성SDI', tradingAmount: 90 },
  ]
  const groups = buildThemeGroups(rankings)
  assert.equal(groups[0].name, '반도체')
  assert.equal(groups[0].members.length, 3)
  assert.ok(groups.some((group) => group.name === '원전'))
  assert.ok(!groups.some((group) => group.name === '2차전지'))
})

test('individual-stock filter excludes ETF and ETN instrument metadata', () => {
  assert.equal(isIndividualStock({ name: '삼성전자', securityType: 'STOCK' }), true)
  assert.equal(isIndividualStock({ name: 'KODEX 200', securityType: 'ETF' }), false)
  assert.equal(isIndividualStock({ name: '예시 ETN', securityType: 'ETN' }), false)
  assert.equal(isIndividualStock({ name: 'KODEX 코스닥150레버리지' }), false)
  assert.equal(isIndividualStock({ name: 'SK하이닉스' }), true)
})

test('selectThemeGroups keeps four strongest qualified themes and replaces the weakest challenger', () => {
  const base = [
    { symbol: '000660', name: 'SK하이닉스', tradingAmount: 500 },
    { symbol: '005930', name: '삼성전자', tradingAmount: 400 },
    { symbol: '042700', name: '한미반도체', tradingAmount: 300 },
    { symbol: '034020', name: '두산에너빌리티', tradingAmount: 350 },
    { symbol: '052690', name: '한전기술', tradingAmount: 300 },
    { symbol: '126720', name: '수산인더스트리', tradingAmount: 250 },
    { symbol: '012450', name: '한화에어로스페이스', tradingAmount: 260 },
    { symbol: '079550', name: 'LIG넥스원', tradingAmount: 240 },
    { symbol: '047810', name: '한국항공우주', tradingAmount: 220 },
    { symbol: '042660', name: '한화오션', tradingAmount: 210 },
    { symbol: '009540', name: 'HD한국조선해양', tradingAmount: 200 },
    { symbol: '329180', name: 'HD현대중공업', tradingAmount: 190 },
    { symbol: '196170', name: '알테오젠', tradingAmount: 180 },
    { symbol: '298380', name: '에이비엘바이오', tradingAmount: 170 },
    { symbol: '068270', name: '셀트리온', tradingAmount: 160 },
  ]

  const first = selectThemeGroups(base, { targetCount: 4 })
  assert.equal(first.length, 4)
  assert.deepEqual(first.map((group) => group.name), ['반도체', '방산', '원전', '조선'])

  const strongerBio = base.map((item) => ['196170', '298380', '068270'].includes(item.symbol) ? { ...item, tradingAmount: item.tradingAmount + 250 } : item)
  const next = selectThemeGroups(strongerBio, { targetCount: 4 })
  assert.equal(next.length, 4)
  assert.ok(next.some((group) => group.name === '바이오'))
  assert.ok(!next.some((group) => group.name === '조선'))
})

test('aggregateThemeSeries normalizes each stock then averages into 3-minute buckets', () => {
  const series = aggregateThemeSeries([
    { symbol: 'A', candles: [
      { timestamp: '2026-09-08T09:00:00+09:00', closePrice: 100, volume: 10 },
      { timestamp: '2026-09-08T09:02:00+09:00', closePrice: 103, volume: 20 },
      { timestamp: '2026-09-08T09:03:00+09:00', closePrice: 106, volume: 30 },
    ] },
    { symbol: 'B', candles: [
      { timestamp: '2026-09-08T09:00:00+09:00', closePrice: 200, volume: 15 },
      { timestamp: '2026-09-08T09:02:00+09:00', closePrice: 202, volume: 25 },
      { timestamp: '2026-09-08T09:03:00+09:00', closePrice: 204, volume: 35 },
    ] },
  ])
  assert.equal(series.length, 2)
  assert.equal(series[0].memberCount, 2)
  assert.ok(Math.abs(series[0].value - 2) < 0.001)
  assert.ok(Math.abs(series[1].value - 4) < 0.001)
})

test('aggregateStockCandles makes latest-day 3-minute OHLC candles', () => {
  const series = aggregateStockCandles([
    { timestamp: '2026-09-08T09:00:00+09:00', openPrice: 90, highPrice: 91, lowPrice: 89, closePrice: 90, volume: 1, tradingAmount: 90 },
    { timestamp: '2026-09-09T09:00:00+09:00', openPrice: 100, highPrice: 102, lowPrice: 99, closePrice: 101, volume: 10, tradingAmount: 1010 },
    { timestamp: '2026-09-09T09:01:00+09:00', openPrice: 101, highPrice: 104, lowPrice: 100, closePrice: 103, volume: 20, tradingAmount: 2060 },
    { timestamp: '2026-09-09T09:02:00+09:00', openPrice: 103, highPrice: 105, lowPrice: 102, closePrice: 104, volume: 30, tradingAmount: 3120 },
    { timestamp: '2026-09-09T09:03:00+09:00', openPrice: 104, highPrice: 106, lowPrice: 103, closePrice: 105, volume: 40, tradingAmount: 4200 },
  ])
  assert.equal(series.length, 2)
  assert.equal(series[0].openPrice, 100)
  assert.equal(series[0].highPrice, 105)
  assert.equal(series[0].lowPrice, 99)
  assert.equal(series[0].closePrice, 104)
  assert.equal(series[0].volume, 60)
  assert.equal(series[1].openPrice, 104)
  assert.equal(series[1].closePrice, 105)
  assert.equal(series[0].day, '2026-09-09')
})

function minuteCandles(day, startMinute, endMinute, basePrice = 100) {
  const result = []
  for (let minute = startMinute; minute <= endMinute; minute += 1) {
    const hour = Math.floor(minute / 60)
    const min = minute % 60
    const timestamp = `${day}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`
    const closePrice = basePrice + (minute - startMinute) * 0.01
    result.push({ timestamp, openPrice: closePrice, highPrice: closePrice, lowPrice: closePrice, closePrice, volume: 10 })
  }
  return result
}

test('findIntradayCandleGaps detects only long gaps inside the regular session', () => {
  const candles = [
    ...minuteCandles('2026-09-08', 9 * 60, 9 * 60 + 1),
    { timestamp: '2026-09-09T08:00:00+09:00', closePrice: 100 },
    { timestamp: '2026-09-09T09:00:00+09:00', closePrice: 100 },
    { timestamp: '2026-09-09T09:03:00+09:00', closePrice: 101 },
    { timestamp: '2026-09-09T10:00:00+09:00', closePrice: 102 },
    { timestamp: '2026-09-09T15:20:00+09:00', closePrice: 103 },
    { timestamp: '2026-09-09T18:00:00+09:00', closePrice: 104 },
  ]

  const gaps = findIntradayCandleGaps(candles)
  assert.equal(gaps.length, 2)
  assert.equal(gaps[0].from, '2026-09-09T09:03:00+09:00')
  assert.equal(gaps[0].to, '2026-09-09T10:00:00+09:00')
  assert.equal(gaps[1].from, '2026-09-09T10:00:00+09:00')
  assert.equal(gaps[1].to, '2026-09-09T15:20:00+09:00')
})

test('refreshSymbol backfills a missing intraday range instead of leaving the theme chart broken', async () => {
  const calls = []
  const client = {
    configured: true,
    async request(path) {
      calls.push(path)
      const url = new URL(`https://example.test${path}`)
      const before = url.searchParams.get('before')
      if (!before) {
        return {
          result: {
            candles: minuteCandles('2026-09-09', 15 * 60 + 20, 15 * 60 + 25, 120),
            nextBefore: 'cursor-1',
          },
        }
      }
      if (before === 'cursor-1') {
        return {
          result: {
            candles: minuteCandles('2026-09-09', 11 * 60 + 1, 15 * 60 + 19, 110),
            nextBefore: 'cursor-2',
          },
        }
      }
      if (before === 'cursor-2') {
        return {
          result: {
            candles: minuteCandles('2026-09-09', 9 * 60 + 1, 11 * 60, 100),
            nextBefore: null,
          },
        }
      }
      throw new Error(`unexpected candle cursor: ${before}`)
    },
  }

  const service = new ThemeFlowService(client, () => null)
  service.candleCache.set('005930', [
    { timestamp: '2026-09-08T09:00:00+09:00', closePrice: 95, volume: 10 },
    { timestamp: '2026-09-09T09:00:00+09:00', closePrice: 100, volume: 10 },
    { timestamp: '2026-09-09T11:00:00+09:00', closePrice: 110, volume: 10 },
  ])

  assert.equal(findIntradayCandleGaps(service.candleCache.get('005930')).length, 1)
  await service.refreshSymbol('005930')

  const repaired = service.candleCache.get('005930')
  assert.equal(findIntradayCandleGaps(repaired).length, 0)
  assert.ok(calls.some((path) => path.includes('before=cursor-1')))
  assert.ok(calls.some((path) => path.includes('before=cursor-2')))
  assert.ok(repaired.some((candle) => candle.timestamp === '2026-09-09T13:30:00+09:00'))
})

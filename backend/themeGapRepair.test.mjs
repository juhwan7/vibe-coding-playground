import test from 'node:test'
import assert from 'node:assert/strict'
import { repairMissingIntradayHistory } from './themeGapRepair.mjs'
import { findIntradayCandleGaps } from './themeFlowService.mjs'

function minuteCandles(day, startMinute, endMinute, basePrice = 100) {
  const result = []
  for (let minute = startMinute; minute <= endMinute; minute += 1) {
    const hour = Math.floor(minute / 60)
    const min = minute % 60
    const timestamp = `${day}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`
    const closePrice = basePrice + (minute - startMinute) * 0.01
    result.push({
      timestamp,
      openPrice: String(closePrice),
      highPrice: String(closePrice),
      lowPrice: String(closePrice),
      closePrice: String(closePrice),
      volume: '10',
    })
  }
  return result
}

test('missing morning is repaired by following Toss nextBefore cursors from the latest page', async () => {
  const calls = []
  const client = {
    async request(path, options) {
      calls.push({ path, options })
      const url = new URL(`https://example.test${path}`)
      const before = url.searchParams.get('before')

      // 첫 페이지는 기존 오후 데이터와 거의 겹친다. 공백 모양이 바뀌지 않아도
      // nextBefore가 있으면 중단하지 않고 다음 페이지로 진행해야 한다.
      if (!before) {
        return {
          result: {
            candles: minuteCandles('2026-09-09', 14 * 60, 15 * 60 + 30, 130),
            nextBefore: 'cursor-afternoon',
          },
        }
      }

      if (before === 'cursor-afternoon') {
        return {
          result: {
            candles: minuteCandles('2026-09-09', 10 * 60, 13 * 60 + 59, 110),
            nextBefore: 'cursor-morning',
          },
        }
      }

      if (before === 'cursor-morning') {
        return {
          result: {
            candles: minuteCandles('2026-09-09', 9 * 60, 9 * 60 + 59, 100),
            nextBefore: 'cursor-yesterday',
          },
        }
      }

      throw new Error(`unexpected before cursor: ${before}`)
    },
  }

  const existing = [
    ...minuteCandles('2026-09-08', 9 * 60, 15 * 60 + 30, 90),
    ...minuteCandles('2026-09-09', 13 * 60, 15 * 60, 120),
  ]

  assert.equal(findIntradayCandleGaps(existing).at(-1)?.edge, 'session-start')

  const result = await repairMissingIntradayHistory({
    client,
    symbol: '006400',
    existing,
    maxItems: 1600,
    maxPages: 8,
  })

  assert.equal(result.afterGapCount, 0)
  assert.equal(result.repaired, true)
  assert.equal(result.pages, 3)
  assert.equal(result.error, null)
  assert.ok(result.candles.some((candle) => candle.timestamp === '2026-09-09T09:00:00+09:00'))
  assert.ok(calls[0].path.includes('count=200'))
  assert.equal(new URL(`https://example.test${calls[0].path}`).searchParams.get('before'), null)
  assert.equal(new URL(`https://example.test${calls[1].path}`).searchParams.get('before'), 'cursor-afternoon')
  assert.equal(new URL(`https://example.test${calls[2].path}`).searchParams.get('before'), 'cursor-morning')
  assert.equal(calls[0].options?.dedupe, false)
})

test('complete intraday history makes no extra candle API request', async () => {
  let requests = 0
  const client = {
    async request() {
      requests += 1
      throw new Error('should not be called')
    },
  }
  const existing = [
    ...minuteCandles('2026-09-08', 9 * 60, 15 * 60 + 30, 90),
    ...minuteCandles('2026-09-09', 9 * 60, 15 * 60, 100),
  ]

  const result = await repairMissingIntradayHistory({ client, symbol: '006400', existing })
  assert.equal(result.afterGapCount, 0)
  assert.equal(result.requests, 0)
  assert.equal(requests, 0)
})

test('API failure keeps the existing cache instead of erasing the chart', async () => {
  const existing = [
    ...minuteCandles('2026-09-08', 9 * 60, 15 * 60 + 30, 90),
    ...minuteCandles('2026-09-09', 13 * 60, 15 * 60, 120),
  ]
  const client = {
    async request() {
      throw new Error('rate limited')
    },
  }

  const result = await repairMissingIntradayHistory({ client, symbol: '006400', existing })
  assert.equal(result.error, 'rate limited')
  assert.equal(result.requests, 0)
  assert.equal(result.candles.length, existing.length)
  assert.ok(result.afterGapCount > 0)
})

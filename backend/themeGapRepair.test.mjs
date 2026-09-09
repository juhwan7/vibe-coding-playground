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

test('missing morning is repaired by querying the right edge of the actual gap directly', async () => {
  const calls = []
  const client = {
    async request(path) {
      calls.push(path)
      const url = new URL(`https://example.test${path}`)
      const before = url.searchParams.get('before')

      if (before === '2026-09-09T13:00:00+09:00') {
        return {
          result: {
            candles: minuteCandles('2026-09-09', 9 * 60 + 41, 13 * 60, 110),
            nextBefore: '2026-09-09T09:40:00+09:00',
          },
        }
      }

      if (before === '2026-09-09T09:41:00+09:00') {
        return {
          result: {
            candles: minuteCandles('2026-09-09', 9 * 60, 9 * 60 + 41, 100),
            nextBefore: null,
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
  assert.equal(result.pages, 2)
  assert.ok(result.candles.some((candle) => candle.timestamp === '2026-09-09T09:00:00+09:00'))
  assert.ok(calls[0].includes('count=200'))
  assert.ok(calls[0].includes('before=2026-09-09T13%3A00%3A00%2B09%3A00'))
  assert.ok(calls[1].includes('before=2026-09-09T09%3A41%3A00%2B09%3A00'))
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

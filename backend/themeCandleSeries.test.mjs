import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateThemeSeries } from './themeFlowService.mjs'

test('aggregateThemeSeries returns true averaged 3-minute OHLC values', () => {
  const points = aggregateThemeSeries([
    { symbol: 'A', candles: [
      { timestamp: '2026-09-09T09:00:00+09:00', openPrice: 100, highPrice: 102, lowPrice: 99, closePrice: 101, volume: 1 },
      { timestamp: '2026-09-09T09:01:00+09:00', openPrice: 101, highPrice: 104, lowPrice: 100, closePrice: 103, volume: 1 },
      { timestamp: '2026-09-09T09:02:00+09:00', openPrice: 103, highPrice: 105, lowPrice: 102, closePrice: 104, volume: 1 },
    ] },
    { symbol: 'B', candles: [
      { timestamp: '2026-09-09T09:00:00+09:00', openPrice: 200, highPrice: 202, lowPrice: 198, closePrice: 201, volume: 1 },
      { timestamp: '2026-09-09T09:01:00+09:00', openPrice: 201, highPrice: 206, lowPrice: 200, closePrice: 204, volume: 1 },
      { timestamp: '2026-09-09T09:02:00+09:00', openPrice: 204, highPrice: 208, lowPrice: 203, closePrice: 206, volume: 1 },
    ] },
  ])

  assert.equal(points.length, 1)
  const candle = points[0]
  assert.ok(Math.abs(candle.openValue - (-0.7438055)) < 0.001)
  assert.ok(Math.abs(candle.highValue - 3.7214915) < 0.001)
  assert.ok(Math.abs(candle.lowValue - (-1.7363675)) < 0.001)
  assert.ok(Math.abs(candle.closeValue - 2.7289295) < 0.001)
  assert.ok(Math.abs(candle.value - candle.closeValue) < 0.001)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateTradingAmountWeightedThemeSeries } from './themeWeightedSeries.mjs'

function candle(timestamp, closePrice, tradingAmount) {
  return { timestamp, openPrice: closePrice, highPrice: closePrice, lowPrice: closePrice, closePrice, volume: 1, tradingAmount }
}

test('high-turnover falling member dominates theme return', () => {
  const points = aggregateTradingAmountWeightedThemeSeries([
    {
      symbol: 'A',
      candles: [
        candle('2026-09-09T00:00:00.000Z', 100, 10),
        candle('2026-09-09T00:03:00.000Z', 105, 10),
      ],
    },
    {
      symbol: 'B',
      candles: [
        candle('2026-09-09T00:00:00.000Z', 100, 90),
        candle('2026-09-09T00:03:00.000Z', 95, 90),
      ],
    },
  ])

  const last = points.at(-1)
  assert.ok(last)
  assert.ok(last.value < -3.9 && last.value > -4.1, `expected about -4%, got ${last.value}`)
  assert.ok(last.dominantWeightPercent >= 89)
})

test('falls back to equal return when turnover is missing', () => {
  const points = aggregateTradingAmountWeightedThemeSeries([
    {
      symbol: 'A',
      candles: [candle('2026-09-09T00:00:00.000Z', 100, 0), candle('2026-09-09T00:03:00.000Z', 104, 0)],
    },
    {
      symbol: 'B',
      candles: [candle('2026-09-09T00:00:00.000Z', 100, 0), candle('2026-09-09T00:03:00.000Z', 98, 0)],
    },
  ])

  const last = points.at(-1)
  assert.ok(last)
  assert.ok(last.value > 0.99 && last.value < 1.01, `expected about +1%, got ${last.value}`)
})

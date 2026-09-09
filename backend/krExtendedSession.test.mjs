import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExtendedSessionQuoteObservation } from './themeFlowServiceFive.mjs'

test('15:30 전에는 누적값 기준점만 저장하고 차트 표본은 만들지 않는다', () => {
  const result = buildExtendedSessionQuoteObservation({
    ranking: { lastPrice: 470000, tradingAmount: 9_200_000_000_000, tradingVolume: 20_000_000 },
    timestamp: '2026-09-09T15:29:00+09:00',
  })

  assert.equal(result.sample, null)
  assert.equal(result.counter.day, '2026-09-09')
  assert.equal(result.counter.cumulativeTradingAmount, 9_200_000_000_000)
})

test('15:30 이후에는 실제 현재가와 누적 거래대금 증가분만 표본으로 만든다', () => {
  const previous = {
    day: '2026-09-09',
    cumulativeTradingAmount: 9_200_000_000_000,
    cumulativeTradingVolume: 20_000_000,
    observedAt: '2026-09-09T15:29:00+09:00',
  }
  const result = buildExtendedSessionQuoteObservation({
    ranking: { lastPrice: 475000, tradingAmount: 9_260_000_000_000, tradingVolume: 20_120_000 },
    timestamp: '2026-09-09T15:30:42+09:00',
    previous,
  })

  assert.equal(result.sample.timestamp, '2026-09-09T06:30:00.000Z')
  assert.equal(result.sample.closePrice, 475000)
  assert.equal(result.sample.tradingAmount, 60_000_000_000)
  assert.equal(result.sample.volume, 120_000)
  assert.equal(result.sample.observedQuote, true)
})

test('누적 거래대금이 일시적으로 역행하면 음수 거래대금을 만들지 않는다', () => {
  const previous = {
    day: '2026-09-09',
    cumulativeTradingAmount: 10_300_000_000_000,
    cumulativeTradingVolume: 22_000_000,
    observedAt: '2026-09-09T18:00:00+09:00',
  }
  const result = buildExtendedSessionQuoteObservation({
    ranking: { lastPrice: 474000, tradingAmount: 9_900_000_000_000, tradingVolume: 21_500_000 },
    timestamp: '2026-09-09T18:01:00+09:00',
    previous,
  })

  assert.equal(result.sample.tradingAmount, 0)
  assert.equal(result.sample.volume, 0)
  assert.equal(result.counter.cumulativeTradingAmount, 10_300_000_000_000)
  assert.equal(result.counter.cumulativeTradingVolume, 22_000_000)
})

test('20시 이후에는 추가 차트 표본을 만들지 않는다', () => {
  const previous = {
    day: '2026-09-09',
    cumulativeTradingAmount: 10_500_000_000_000,
    cumulativeTradingVolume: 22_500_000,
    observedAt: '2026-09-09T20:00:00+09:00',
  }
  const result = buildExtendedSessionQuoteObservation({
    ranking: { lastPrice: 476000, tradingAmount: 10_510_000_000_000, tradingVolume: 22_520_000 },
    timestamp: '2026-09-09T20:01:00+09:00',
    previous,
  })

  assert.equal(result.sample, null)
  assert.deepEqual(result.counter, previous)
})
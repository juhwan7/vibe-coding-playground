import test from 'node:test'
import assert from 'node:assert/strict'
import { buildThemeGroups } from './themeCatalog.mjs'
import { aggregateThemeSeries } from './themeFlowService.mjs'

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

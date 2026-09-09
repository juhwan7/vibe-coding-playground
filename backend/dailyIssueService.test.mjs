import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIntradayLine, buildTwoDayIntraday, sortDailyIssueRows, summarizeStockIssues } from './dailyIssueService.mjs'

test('buildIntradayLine keeps latest trading day and compresses to 5-minute closes', () => {
  const points = buildIntradayLine([
    { timestamp: '2026-09-08T09:00:00+09:00', closePrice: 90 },
    { timestamp: '2026-09-09T09:00:00+09:00', closePrice: 100 },
    { timestamp: '2026-09-09T09:04:00+09:00', closePrice: 104 },
    { timestamp: '2026-09-09T09:05:00+09:00', closePrice: 103 },
    { timestamp: '2026-09-09T09:09:00+09:00', closePrice: 106 },
  ])
  assert.equal(points.length, 2)
  assert.equal(points[0].value, 104)
  assert.equal(points[1].value, 106)
})

test('buildTwoDayIntraday keeps only the latest two trading days as separate real-data series', () => {
  const days = buildTwoDayIntraday([
    { timestamp: '2026-09-07T09:00:00+09:00', closePrice: 80 },
    { timestamp: '2026-09-08T09:00:00+09:00', closePrice: 90 },
    { timestamp: '2026-09-08T09:04:00+09:00', closePrice: 94 },
    { timestamp: '2026-09-08T09:05:00+09:00', closePrice: 93 },
    { timestamp: '2026-09-09T09:00:00+09:00', closePrice: 100 },
    { timestamp: '2026-09-09T09:04:00+09:00', closePrice: 104 },
    { timestamp: '2026-09-09T09:05:00+09:00', closePrice: 103 },
  ])
  assert.deepEqual(days.map((day) => day.date), ['2026-09-08', '2026-09-09'])
  assert.deepEqual(days[0].points.map((point) => point.value), [94, 93])
  assert.deepEqual(days[1].points.map((point) => point.value), [104, 103])
})

test('summarizeStockIssues combines duplicate same-stock reports and keeps sources', () => {
  const result = summarizeStockIssues({ name: '삼성전자' }, [
    { title: '[특징주] 삼성전자 HBM 공급 기대에 강세', link: 'https://example.com/a', source: 'A경제', publishedAt: '2026-09-09T01:00:00Z' },
    { title: '삼성전자, HBM 공급 기대감에 상승', link: 'https://example.com/b', source: 'B뉴스', publishedAt: '2026-09-09T01:10:00Z' },
    { title: '다른 종목 기사', link: 'https://example.com/c', source: 'C뉴스', publishedAt: '2026-09-09T01:20:00Z' },
  ])
  assert.match(result.summary, /삼성전자/)
  assert.ok(result.articleCount >= 1)
  assert.ok(result.sources.length >= 1)
})

test('summarizeStockIssues never invents a reason when no direct article exists', () => {
  const result = summarizeStockIssues({ name: '예시기업' }, [])
  assert.equal(result.summary, '직접적인 당일 뉴스 재료 확인 안 됨')
  assert.equal(result.articleCount, 0)
})

test('sortDailyIssueRows orders by change rate descending then turnover', () => {
  const rows = sortDailyIssueRows([
    { name: 'B', changeRate: 3, tradingAmount: 300 },
    { name: 'A', changeRate: 8, tradingAmount: 100 },
    { name: 'C', changeRate: 3, tradingAmount: 500 },
  ])
  assert.deepEqual(rows.map((row) => row.name), ['A', 'C', 'B'])
})

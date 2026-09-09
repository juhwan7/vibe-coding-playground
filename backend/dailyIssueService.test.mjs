import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDailyBars,
  buildIntradayLine,
  buildThemeNewsEvidence,
  buildTwoDayIntraday,
  compactCompanySummary,
  sortDailyIssueRows,
  summarizeStockIssues,
  summarizeThemeFallback,
} from './dailyIssueService.mjs'

function candle(timestamp, openPrice, highPrice, lowPrice, closePrice, volume = 1000) {
  return { timestamp, openPrice, highPrice, lowPrice, closePrice, volume }
}

test('buildIntradayLine keeps every real 1-minute close from the latest trading day', () => {
  const points = buildIntradayLine([
    candle('2026-09-08T09:00:00+09:00', 89, 91, 88, 90),
    candle('2026-09-09T09:00:00+09:00', 99, 101, 98, 100),
    candle('2026-09-09T09:01:00+09:00', 100, 102, 99, 101),
    candle('2026-09-09T09:02:00+09:00', 101, 103, 100, 102),
  ])
  assert.deepEqual(points.map((point) => point.value), [100, 101, 102])
})

test('buildTwoDayIntraday keeps latest two trading days separate and preserves every real 1-minute OHLC bar', () => {
  const days = buildTwoDayIntraday([
    candle('2026-09-07T09:00:00+09:00', 79, 81, 78, 80),
    candle('2026-09-08T09:00:00+09:00', 89, 91, 88, 90),
    candle('2026-09-08T09:01:00+09:00', 90, 92, 89, 91),
    candle('2026-09-08T09:02:00+09:00', 91, 93, 90, 92),
    candle('2026-09-09T09:00:00+09:00', 99, 101, 98, 100),
    candle('2026-09-09T09:01:00+09:00', 100, 102, 99, 101),
    candle('2026-09-09T09:02:00+09:00', 101, 103, 100, 102),
  ])
  assert.deepEqual(days.map((day) => day.date), ['2026-09-08', '2026-09-09'])
  assert.deepEqual(days[0].points.map((point) => point.close), [90, 91, 92])
  assert.deepEqual(days[1].points.map((point) => point.close), [100, 101, 102])
  assert.deepEqual(days[1].points[0], {
    timestamp: '2026-09-09T09:00:00+09:00',
    open: 99,
    high: 101,
    low: 98,
    close: 100,
    volume: 1000,
  })
})

test('buildDailyBars keeps only the latest requested real daily OHLC bars', () => {
  const bars = buildDailyBars([
    candle('2026-09-05T15:30:00+09:00', 80, 85, 78, 84, 10000),
    candle('2026-09-08T15:30:00+09:00', 84, 90, 82, 89, 12000),
    candle('2026-09-09T15:20:00+09:00', 89, 94, 87, 93, 14000),
  ], 2)
  assert.deepEqual(bars.map((bar) => bar.timestamp), ['2026-09-08T15:30:00+09:00', '2026-09-09T15:20:00+09:00'])
  assert.deepEqual(bars[1], {
    timestamp: '2026-09-09T15:20:00+09:00',
    open: 89,
    high: 94,
    low: 87,
    close: 93,
    volume: 14000,
  })
})

test('compactCompanySummary prefers the core business sentence over company history', () => {
  const summary = compactCompanySummary('1999년 설립되었음. 메모리 반도체와 HBM 제품을 생산하고 판매하는 사업을 영위하고 있음. 최대주주가 변경되었음.')
  assert.match(summary, /메모리 반도체|HBM/)
  assert.doesNotMatch(summary, /설립/)
})

test('summarizeStockIssues marks same-stock articles as direct news', () => {
  const result = summarizeStockIssues({ name: '삼성전자', changeRate: 4 }, [
    { title: '[특징주] 삼성전자 HBM 공급 기대에 강세', link: 'https://example.com/a', source: 'A경제', publishedAt: '2026-09-09T01:00:00Z' },
    { title: '삼성전자, HBM 공급 기대감에 상승', link: 'https://example.com/b', source: 'B뉴스', publishedAt: '2026-09-09T01:10:00Z' },
    { title: '다른 종목 기사', link: 'https://example.com/c', source: 'C뉴스', publishedAt: '2026-09-09T01:20:00Z' },
  ])
  assert.match(result.summary, /삼성전자/)
  assert.equal(result.reasonType, 'direct-news')
  assert.ok(result.articleCount >= 1)
  assert.ok(result.sources.length >= 1)
})

test('same-theme rising stock articles become a clearly marked inference fallback', () => {
  const stocks = [
    { name: '대상기업', changeRate: 8, themeLabels: ['반도체'] },
    { name: '동종기업', changeRate: 12, themeLabels: ['반도체'] },
  ]
  const articles = [
    { title: '[특징주] 동종기업 HBM 수요 기대에 급등', link: 'https://example.com/theme', source: '테스트뉴스', publishedAt: '2026-09-09T02:00:00Z' },
  ]
  const evidence = buildThemeNewsEvidence(stocks, articles)
  const fallback = summarizeThemeFallback(stocks[0], stocks[0].themeLabels, evidence)
  assert.equal(fallback?.reasonType, 'theme-news')
  assert.equal(fallback?.reasonTheme, '반도체')
  assert.match(fallback?.summary ?? '', /반도체 테마 동반 강세.*추정/)
  assert.equal(fallback?.links?.[0]?.link, 'https://example.com/theme')
})

test('summarizeStockIssues never invents a reason when no direct or theme evidence exists', () => {
  const result = summarizeStockIssues({ name: '예시기업', changeRate: 6 }, [])
  assert.equal(result.summary, '상승 이유 확인 안 됨')
  assert.equal(result.reasonType, 'unconfirmed')
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
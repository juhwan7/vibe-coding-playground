import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildThemeNewsEvidence,
  buildTwoDayMinuteLine,
  compactCompanySummary,
  sortDailyIssueRows,
  summarizeStockIssues,
  summarizeThemeFallback,
} from './dailyIssueService.mjs'

test('buildTwoDayMinuteLine keeps every real minute from the latest two trading days', () => {
  const points = buildTwoDayMinuteLine([
    { timestamp: '2026-09-07T09:00:00+09:00', closePrice: 80 },
    { timestamp: '2026-09-08T09:00:00+09:00', closePrice: 90 },
    { timestamp: '2026-09-08T09:01:00+09:00', closePrice: 91 },
    { timestamp: '2026-09-09T09:00:00+09:00', closePrice: 100 },
    { timestamp: '2026-09-09T09:01:00+09:00', closePrice: 101 },
    { timestamp: '2026-09-09T09:02:00+09:00', closePrice: 102 },
  ])
  assert.deepEqual(points.map((point) => point.value), [90, 91, 100, 101, 102])
})

test('buildTwoDayMinuteLine excludes candles outside the 09:00~15:20 digest window', () => {
  const points = buildTwoDayMinuteLine([
    { timestamp: '2026-09-08T08:59:00+09:00', closePrice: 89 },
    { timestamp: '2026-09-08T09:00:00+09:00', closePrice: 90 },
    { timestamp: '2026-09-09T15:20:00+09:00', closePrice: 110 },
    { timestamp: '2026-09-09T15:21:00+09:00', closePrice: 111 },
  ])
  assert.deepEqual(points.map((point) => point.value), [90, 110])
})

test('compactCompanySummary prefers a business sentence over company history', () => {
  const summary = compactCompanySummary('1999년 설립되었음. 메모리 반도체와 HBM 제품을 생산하고 판매하는 사업을 영위하고 있음. 최대주주가 변경되었음.')
  assert.match(summary, /메모리 반도체|HBM/)
  assert.doesNotMatch(summary, /설립/)
})

test('summarizeStockIssues combines duplicate same-stock reports and keeps sources', () => {
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

test('same-theme rising stock articles become a clearly marked fallback reason', () => {
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

test('summarizeStockIssues never invents a reason when no direct or theme article exists', () => {
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

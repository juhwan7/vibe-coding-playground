import test from 'node:test'
import assert from 'node:assert/strict'
import { selectThemeGroups } from './themeFlowService.mjs'
import { filterNewsToday, mergeDailyNews } from './featureNewsTodayService.mjs'
import { kstSixStart } from './featureNewsService.mjs'

test('theme board can maintain five strongest qualified themes including optical communications', () => {
  const rankings = [
    { symbol: '000660', name: 'SK하이닉스', tradingAmount: 900 },
    { symbol: '005930', name: '삼성전자', tradingAmount: 850 },
    { symbol: '042700', name: '한미반도체', tradingAmount: 800 },
    { symbol: '034020', name: '두산에너빌리티', tradingAmount: 760 },
    { symbol: '052690', name: '한전기술', tradingAmount: 720 },
    { symbol: '051600', name: '한전KPS', tradingAmount: 680 },
    { symbol: '012450', name: '한화에어로스페이스', tradingAmount: 640 },
    { symbol: '079550', name: 'LIG넥스원', tradingAmount: 600 },
    { symbol: '047810', name: '한국항공우주', tradingAmount: 560 },
    { symbol: '010170', name: '대한광통신', tradingAmount: 540 },
    { symbol: '046970', name: '우리로', tradingAmount: 500 },
    { symbol: '380540', name: '옵티코어', tradingAmount: 470 },
    { symbol: '042660', name: '한화오션', tradingAmount: 420 },
    { symbol: '009540', name: 'HD한국조선해양', tradingAmount: 390 },
    { symbol: '329180', name: 'HD현대중공업', tradingAmount: 360 },
  ]

  const groups = selectThemeGroups(rankings, { targetCount: 5 })
  assert.equal(groups.length, 5)
  assert.ok(groups.some((group) => group.name === '광통신'))
  assert.deepEqual(new Set(groups.map((group) => group.name)), new Set(['반도체', '원전', '방산', '광통신', '조선']))
})

test('market brief starts at 06:00 KST', () => {
  const now = Date.parse('2026-09-09T11:00:00+09:00')
  assert.equal(new Date(kstSixStart(now)).toISOString(), '2026-09-08T21:00:00.000Z')

  const items = filterNewsToday([
    { title: '새벽 뉴스', publishedAt: '2026-09-09T05:59:59+09:00' },
    { title: '6시 뉴스', publishedAt: '2026-09-09T06:00:00+09:00' },
    { title: '장전 뉴스', publishedAt: '2026-09-09T08:20:00+09:00' },
  ], now)

  assert.deepEqual(items.map((item) => item.title), ['6시 뉴스', '장전 뉴스'])
})

test('market brief keeps earlier non-duplicate candidates across refreshes', () => {
  const now = Date.parse('2026-09-09T11:00:00+09:00')
  const first = mergeDailyNews([], [
    { title: '광통신 수주', link: 'https://example.com/a', publishedAt: '2026-09-09T06:30:00+09:00' },
  ], now)
  const second = mergeDailyNews(first, [
    { title: '원전 투자 발표', link: 'https://example.com/b', publishedAt: '2026-09-09T10:30:00+09:00' },
    { title: '광통신 수주 재전송', link: 'https://example.com/a', publishedAt: '2026-09-09T06:30:00+09:00' },
  ], now)

  assert.equal(second.length, 2)
  assert.deepEqual(second.map((item) => item.link), ['https://example.com/a', 'https://example.com/b'])
})

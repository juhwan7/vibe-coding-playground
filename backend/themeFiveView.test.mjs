import test from 'node:test'
import assert from 'node:assert/strict'
import { selectThemeGroups } from './themeFlowService.mjs'
import { filterNewsToday, kstDayStart } from './featureNewsTodayService.mjs'

test('theme board can maintain five strongest qualified themes', () => {
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
    { symbol: '042660', name: '한화오션', tradingAmount: 520 },
    { symbol: '009540', name: 'HD한국조선해양', tradingAmount: 480 },
    { symbol: '329180', name: 'HD현대중공업', tradingAmount: 440 },
    { symbol: '196170', name: '알테오젠', tradingAmount: 400 },
    { symbol: '298380', name: '에이비엘바이오', tradingAmount: 360 },
    { symbol: '068270', name: '셀트리온', tradingAmount: 320 },
  ]

  const groups = selectThemeGroups(rankings, { targetCount: 5 })
  assert.equal(groups.length, 5)
  assert.deepEqual(new Set(groups.map((group) => group.name)), new Set(['반도체', '원전', '방산', '조선', '바이오']))
  for (let index = 1; index < groups.length; index += 1) {
    assert.ok(groups[index - 1].tradingAmount >= groups[index].tradingAmount)
  }
})

test('market brief keeps important news from midnight KST, including pre-06:00 items', () => {
  const now = Date.parse('2026-09-09T11:00:00+09:00')
  assert.equal(new Date(kstDayStart(now)).toISOString(), '2026-09-08T15:00:00.000Z')

  const items = filterNewsToday([
    { title: '전날', publishedAt: '2026-09-08T23:59:59+09:00' },
    { title: '자정 직후', publishedAt: '2026-09-09T00:10:00+09:00' },
    { title: '새벽 뉴스', publishedAt: '2026-09-09T05:40:00+09:00' },
    { title: '장전 뉴스', publishedAt: '2026-09-09T08:20:00+09:00' },
  ], now)

  assert.deepEqual(items.map((item) => item.title), ['자정 직후', '새벽 뉴스', '장전 뉴스'])
})

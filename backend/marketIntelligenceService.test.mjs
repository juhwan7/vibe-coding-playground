import test from 'node:test'
import assert from 'node:assert/strict'
import { MarketIntelligenceService, freshness, gradeNewsPayload } from './marketIntelligenceService.mjs'

test('freshness separates live and stale payloads', () => {
  const now = Date.parse('2026-09-09T03:00:00.000Z')
  assert.equal(freshness('2026-09-09T02:59:55.000Z', 10, { now }).status, 'live')
  assert.equal(freshness('2026-09-09T02:50:00.000Z', 10, { now }).status, 'stale')
  assert.equal(freshness('2026-09-09T02:59:55.000Z', 10, { now, mode: 'startup-cache' }).status, 'fallback')
})

test('news evidence never upgrades a single ordinary article to verified', () => {
  const payload = gradeNewsPayload({
    items: [
      { title: '기업 신규 계약', source: '단일매체', sourceCount: 1 },
      { title: '기업 신규 계약', source: '복수보도', sourceCount: 3 },
      { title: '공시 신규 계약', source: '한국거래소 공시', sourceCount: 1 },
    ],
  })
  assert.equal(payload.items[0].evidence.grade, 'C')
  assert.equal(payload.items[1].evidence.grade, 'B')
  assert.equal(payload.items[2].evidence.grade, 'A')
})

test('theme intelligence exposes five stabilized themes', () => {
  const service = new MarketIntelligenceService({ themeCount: 5 })
  const theme = (name, amount, currentValue) => ({
    name,
    tradingAmount: amount,
    currentValue,
    change1h: 0.5,
    members: [
      { symbol: '999991', name: `${name}A`, tradingAmount: amount * 0.6, changeRate: 2 },
      { symbol: '999992', name: `${name}B`, tradingAmount: amount * 0.4, changeRate: 1 },
    ],
  })
  const result = service.enrichThemes({ themes: [
    theme('A', 5e12, 2), theme('B', 4e12, 1.8), theme('C', 3e12, 1.5), theme('D', 2e12, 1.2), theme('E', 1e12, 1),
  ] }, Date.parse('2026-09-09T03:00:00.000Z'))
  assert.equal(result.length, 5)
  assert.ok(result.every((item) => Number.isFinite(item.strengthScore)))
})

test('theme rank keeps the incumbent when the challenger lead is ambiguous', () => {
  const service = new MarketIntelligenceService({ themeCount: 2, rankPromotionMargin: 0.02, rankImmediateMargin: 0.08, rankConfirmations: 3 })
  service.selectedNames = ['조선', '2차전지']

  for (let index = 0; index < 6; index += 1) {
    const themes = service.stabilizeThemeOrder([
      { name: '조선', strengthScore: index % 2 ? 100.4 : 100 },
      { name: '2차전지', strengthScore: index % 2 ? 100 : 101 },
    ])
    service.selectedNames = themes.map((theme) => theme.name)
    assert.deepEqual(service.selectedNames, ['조선', '2차전지'])
  }
})

test('theme rank promotes only after a meaningful lead is confirmed three times', () => {
  const service = new MarketIntelligenceService({ themeCount: 2, rankPromotionMargin: 0.02, rankImmediateMargin: 0.08, rankConfirmations: 3 })
  service.selectedNames = ['조선', '2차전지']

  for (let confirmation = 1; confirmation <= 3; confirmation += 1) {
    const themes = service.stabilizeThemeOrder([
      { name: '조선', strengthScore: 100 },
      { name: '2차전지', strengthScore: 103 },
    ])
    service.selectedNames = themes.map((theme) => theme.name)
    if (confirmation < 3) assert.deepEqual(service.selectedNames, ['조선', '2차전지'])
    else assert.deepEqual(service.selectedNames, ['2차전지', '조선'])
  }
})

test('theme rank promotes immediately when the challenger is decisively stronger', () => {
  const service = new MarketIntelligenceService({ themeCount: 2, rankPromotionMargin: 0.02, rankImmediateMargin: 0.08, rankConfirmations: 3 })
  service.selectedNames = ['조선', '2차전지']
  const themes = service.stabilizeThemeOrder([
    { name: '조선', strengthScore: 100 },
    { name: '2차전지', strengthScore: 109 },
  ])
  assert.deepEqual(themes.map((theme) => theme.name), ['2차전지', '조선'])
})

test('data quality flags a severely incomplete turnover ranking', () => {
  const service = new MarketIntelligenceService()
  const snapshot = {
    updatedAt: new Date().toISOString(),
    mode: 'live',
    marketTradingAmount: 100,
    topRankings: Array.from({ length: 20 }, (_, index) => ({ symbol: String(index).padStart(6, '0'), changeRate: index })),
  }
  const quality = service.dataQuality(snapshot, { updatedAt: new Date().toISOString() })
  assert.equal(quality.level, 'critical')
  assert.ok(quality.issues.some((issue) => issue.code === 'ranking-count'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLiveThemePayload } from './themeLiveView.mjs'

test('TOP100에 현재 주도 여부와 무관하게 검증된 전체 테마 분류를 전달한다', () => {
  const payload = {
    ok: true,
    updatedAt: '2026-09-09T06:00:00.000Z',
    topRankings: [
      { symbol: '035420', name: 'NAVER', changeRate: 1, tradingAmount: 100 },
      { symbol: '005380', name: '현대차', changeRate: 2, tradingAmount: 90 },
      { symbol: '999999', name: '미분류종목', changeRate: 0, tradingAmount: 80 },
    ],
    themes: [],
  }
  const snapshot = {
    updatedAt: '2026-09-09T06:00:10.000Z',
    topRankings: payload.topRankings,
  }

  const result = buildLiveThemePayload(payload, snapshot)

  assert.deepEqual(result.topRankings[0].catalogThemes, ['인터넷·게임'])
  assert.deepEqual(result.topRankings[1].catalogThemes, ['자동차'])
  assert.deepEqual(result.topRankings[2].catalogThemes, [])
})

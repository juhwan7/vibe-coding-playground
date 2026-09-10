import { describe, expect, it } from 'vitest'
import { chartEventPosition, marketBreadthLabel, turnoverHeat } from './ThemeFlowSaasEnhancer'

describe('국내 테마 흐름 SaaS 보조 계산', () => {
  it('시장 확산도를 넓음, 보통, 좁음으로 구분한다', () => {
    expect(marketBreadthLabel(67)).toBe('넓음')
    expect(marketBreadthLabel(52)).toBe('보통')
    expect(marketBreadthLabel(38)).toBe('좁음')
    expect(marketBreadthLabel(null)).toBe('확인 중')
  })

  it('TOP100 히트 강도는 거래대금 비중이 클수록 진해진다', () => {
    expect(turnoverHeat(10, 10)).toBeGreaterThan(turnoverHeat(5, 10))
    expect(turnoverHeat(5, 10)).toBeGreaterThan(turnoverHeat(1, 10))
  })

  it('이벤트 위치를 08시부터 20시까지의 거래일 축에 맞춘다', () => {
    const points = [
      { timestamp: '2026-09-08T09:00:00+09:00', day: '2026-09-08' },
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09' },
    ]
    const position = chartEventPosition('2026-09-09T14:00:00+09:00', points)
    expect(position).not.toBeNull()
    expect(position!).toBeCloseTo(0.75, 5)
  })

  it('차트 기간 밖 뉴스는 이벤트 마커 위치를 만들지 않는다', () => {
    const points = [
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09' },
    ]
    expect(chartEventPosition('2026-09-10T10:00:00+09:00', points)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { smoothUsThemeTrend, splitUsThemeLineSegments, usMarketBreadth, usThemeConcentration, usThemeStrengthClass, usTurnoverHeat } from './usThemeFlowSaas'

describe('미국 테마 흐름 SaaS 계산', () => {
  it('상승 종목 비중으로 시장 확산도를 계산한다', () => {
    expect(usMarketBreadth([{ changeRate: 1 }, { changeRate: 2 }, { changeRate: -1 }])).toMatchObject({ label: '넓음', advancers: 2, total: 3 })
    expect(usMarketBreadth([{ changeRate: 1 }, { changeRate: -1 }]).label).toBe('보통')
    expect(usMarketBreadth([{ changeRate: -1 }, { changeRate: -2 }]).label).toBe('좁음')
    expect(usMarketBreadth([]).label).toBe('확인 중')
  })

  it('테마 거래대금에서 최대 종목 집중도를 계산한다', () => {
    const concentration = usThemeConcentration({ tradingAmount: 1000, members: [{ tradingAmount: 600 }, { tradingAmount: 250 }, { tradingAmount: 150 }] })
    expect(concentration).toBe(60)
  })

  it('TOP100 거래대금이 클수록 히트 농도가 진해진다', () => {
    expect(usTurnoverHeat(100, 100)).toBeGreaterThan(usTurnoverHeat(50, 100))
    expect(usTurnoverHeat(50, 100)).toBeGreaterThan(usTurnoverHeat(10, 100))
  })

  it('테마 강도에 맞는 시각 등급을 반환한다', () => {
    expect(usThemeStrengthClass(6)).toBe('theme-strength-hot')
    expect(usThemeStrengthClass(2)).toBe('theme-strength-warm')
    expect(usThemeStrengthClass(-1)).toBe('theme-strength-negative')
    expect(usThemeStrengthClass(0.1)).toBe('theme-strength-flat')
  })

  it('15분을 넘는 데이터 공백과 거래일 변경에서는 차트 선을 끊는다', () => {
    const points = [
      { timestamp: '2026-09-08T14:30:00Z', day: '2026-09-08' },
      { timestamp: '2026-09-08T14:33:00Z', day: '2026-09-08' },
      { timestamp: '2026-09-08T15:00:00Z', day: '2026-09-08' },
      { timestamp: '2026-09-09T14:30:00Z', day: '2026-09-09' },
    ]
    const segments = splitUsThemeLineSegments(points)
    expect(segments).toHaveLength(3)
    expect(segments[0]).toHaveLength(2)
  })

  it('30초 실시간 값의 순간 튐은 90초 추세선에서 완화하고 방향은 유지한다', () => {
    const trend = smoothUsThemeTrend([
      { timestamp: '2026-09-09T13:30:00Z', day: '2026-09-09', value: 0 },
      { timestamp: '2026-09-09T13:30:30Z', day: '2026-09-09', value: 3 },
      { timestamp: '2026-09-09T13:31:00Z', day: '2026-09-09', value: 0.4 },
      { timestamp: '2026-09-09T13:31:30Z', day: '2026-09-09', value: 0.8 },
    ])
    expect(trend).toHaveLength(4)
    expect(trend[1].trendValue).toBeGreaterThan(0)
    expect(trend[1].trendValue).toBeLessThan(3)
    expect(trend[3].trendValue).toBeGreaterThan(trend[0].trendValue)
  })

  it('거래일이 바뀌면 이전 추세를 끌고 오지 않고 새 값에서 다시 시작한다', () => {
    const trend = smoothUsThemeTrend([
      { timestamp: '2026-09-08T19:59:30Z', day: '2026-09-08', value: 4 },
      { timestamp: '2026-09-09T13:30:00Z', day: '2026-09-09', value: -1 },
    ])
    expect(trend[1].trendValue).toBe(-1)
  })
})

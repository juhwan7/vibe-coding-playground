import { describe, expect, it } from 'vitest'
import { splitUsThemeLineSegments, usMarketBreadth, usThemeConcentration, usThemeStrengthClass, usTurnoverHeat } from './usThemeFlowSaas'

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
})

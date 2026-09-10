import { describe, expect, it } from 'vitest'
import { chartEventPosition, lifecycleStageIndex, marketBreadthLabel, themeRankMovements, turnoverHeat } from './ThemeFlowSaasEnhancer'

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


  it('테마 순위 이동을 상승·하락·신규로 구분한다', () => {
    const movements = themeRankMovements(['반도체', '원전', '로봇'], ['원전', '반도체', '바이오'])
    expect(movements['원전']).toMatchObject({ kind: 'up', delta: 1, label: '↑1' })
    expect(movements['반도체']).toMatchObject({ kind: 'down', delta: 1, label: '↓1' })
    expect(movements['바이오']).toMatchObject({ kind: 'new', label: 'NEW' })
  })

  it('첫 관측에서는 모든 테마를 신규 진입으로 오인하지 않는다', () => {
    const movements = themeRankMovements([], ['원전', '반도체'])
    expect(movements['원전'].kind).toBe('same')
    expect(movements['반도체'].kind).toBe('same')
  })

  it('생명주기 단계는 실제 상태 문자열만 단계 위치로 변환한다', () => {
    expect(lifecycleStageIndex('출현')).toBe(0)
    expect(lifecycleStageIndex('주도')).toBe(2)
    expect(lifecycleStageIndex('이탈')).toBe(5)
    expect(lifecycleStageIndex('유지')).toBe(-1)
    expect(lifecycleStageIndex(null)).toBe(-1)
  })

  it('차트 기간 밖 뉴스는 이벤트 마커 위치를 만들지 않는다', () => {
    const points = [
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09' },
    ]
    expect(chartEventPosition('2026-09-10T10:00:00+09:00', points)).toBeNull()
  })
})

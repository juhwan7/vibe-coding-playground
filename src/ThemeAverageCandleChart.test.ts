import { describe, expect, it } from 'vitest'
import { appendTenSecondPoint, splitThemeLineSegments } from './ThemeAverageCandleChart'

describe('appendTenSecondPoint', () => {
  it('실시간 값을 10초 버킷으로 맞춰 누적한다', () => {
    const first = appendTenSecondPoint([], '2026-09-09T09:00:17+09:00', 1.23)
    const second = appendTenSecondPoint(first, '2026-09-09T09:00:28+09:00', 1.41)

    expect(first[0].timestamp).toBe('2026-09-09T00:00:10.000Z')
    expect(second).toHaveLength(2)
    expect(second[1].timestamp).toBe('2026-09-09T00:00:20.000Z')
    expect(second[1].value).toBe(1.41)
    expect(second[1].intervalSeconds).toBe(10)
  })

  it('같은 10초 버킷은 최신 값으로 교체하고 날짜가 바뀌면 이전 장 데이터는 버린다', () => {
    const first = appendTenSecondPoint([], '2026-09-09T09:00:11+09:00', 1)
    const replaced = appendTenSecondPoint(first, '2026-09-09T09:00:19+09:00', 2)
    const nextDay = appendTenSecondPoint(replaced, '2026-09-10T09:00:11+09:00', 3)

    expect(replaced).toHaveLength(1)
    expect(replaced[0].value).toBe(2)
    expect(nextDay).toHaveLength(1)
    expect(nextDay[0].day).toBe('2026-09-10')
    expect(nextDay[0].value).toBe(3)
  })
})

describe('splitThemeLineSegments', () => {
  it('같은 날 45초를 초과하는 10초 데이터 공백은 서로 다른 선분으로 나눈다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T09:00:10+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T09:01:10+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T09:01:20+09:00', day: '2026-09-09' },
    ])

    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(2)
    expect(segments[1]).toHaveLength(2)
  })

  it('정상적인 10초 간격과 40초 이내의 짧은 누락은 한 선분으로 유지한다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T09:00:10+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T09:00:40+09:00', day: '2026-09-09' },
    ])

    expect(segments).toHaveLength(1)
    expect(segments[0]).toHaveLength(3)
  })

  it('날짜가 바뀌면 시간 차이가 짧아도 선을 연결하지 않는다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-08T19:59:50+09:00', day: '2026-09-08' },
      { timestamp: '2026-09-09T08:00:00+09:00', day: '2026-09-09' },
    ])

    expect(segments).toHaveLength(2)
  })
})
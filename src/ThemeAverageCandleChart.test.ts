import { describe, expect, it } from 'vitest'
import { appendTenSecondPoint, mergeThemeSeries, splitThemeLineSegments } from './ThemeAverageCandleChart'

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

describe('mergeThemeSeries', () => {
  it('기존 3분 이력을 유지하면서 첫 실시간 포인트부터 10초 데이터로 이어 붙인다', () => {
    const merged = mergeThemeSeries([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09', value: 1 },
      { timestamp: '2026-09-09T09:03:00+09:00', day: '2026-09-09', value: 1.2 },
      { timestamp: '2026-09-09T09:06:00+09:00', day: '2026-09-09', value: 1.3 },
    ], [
      { timestamp: '2026-09-09T09:03:10+09:00', day: '2026-09-09', value: 1.21, live: true, intervalSeconds: 10 },
      { timestamp: '2026-09-09T09:03:20+09:00', day: '2026-09-09', value: 1.25, live: true, intervalSeconds: 10 },
    ])

    expect(merged.map((point) => point.timestamp)).toEqual([
      '2026-09-09T09:00:00+09:00',
      '2026-09-09T09:03:00+09:00',
      '2026-09-09T09:03:10+09:00',
      '2026-09-09T09:03:20+09:00',
    ])
    expect(merged.at(-1)?.value).toBe(1.25)
    expect(merged.at(-1)?.live).toBe(true)
    expect(splitThemeLineSegments(merged)).toHaveLength(1)
  })

  it('실시간 포인트가 아직 없어도 기존 이력은 그대로 반환한다', () => {
    const historical = [
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09', value: 1 },
      { timestamp: '2026-09-09T09:03:00+09:00', day: '2026-09-09', value: 1.1 },
    ]
    expect(mergeThemeSeries(historical, [])).toEqual(historical)
  })
})

describe('splitThemeLineSegments', () => {
  it('같은 날 45초를 초과하는 10초 실시간 데이터 공백은 서로 다른 선분으로 나눈다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09', live: true },
      { timestamp: '2026-09-09T09:00:10+09:00', day: '2026-09-09', live: true },
      { timestamp: '2026-09-09T09:01:10+09:00', day: '2026-09-09', live: true },
      { timestamp: '2026-09-09T09:01:20+09:00', day: '2026-09-09', live: true },
    ])

    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(2)
    expect(segments[1]).toHaveLength(2)
  })

  it('정상적인 10초 간격과 40초 이내의 짧은 실시간 누락은 한 선분으로 유지한다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09', live: true },
      { timestamp: '2026-09-09T09:00:10+09:00', day: '2026-09-09', live: true },
      { timestamp: '2026-09-09T09:00:40+09:00', day: '2026-09-09', live: true },
    ])

    expect(segments).toHaveLength(1)
    expect(segments[0]).toHaveLength(3)
  })

  it('기존 3분 이력은 45초 기준으로 잘리지 않고 선으로 계속 표시한다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T09:03:00+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T09:06:00+09:00', day: '2026-09-09' },
    ])

    expect(segments).toHaveLength(1)
    expect(segments[0]).toHaveLength(3)
  })

  it('날짜가 바뀌면 시간 차이가 짧아도 선을 연결하지 않는다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-08T19:59:50+09:00', day: '2026-09-08', live: true },
      { timestamp: '2026-09-09T08:00:00+09:00', day: '2026-09-09', live: true },
    ])

    expect(segments).toHaveLength(2)
  })
})
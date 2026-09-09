import { describe, expect, it } from 'vitest'
import {
  appendTenSecondPoint,
  mergeThemeSeries,
  resampleThemeSeries30s,
  splitThemeLineSegments,
} from './ThemeAverageCandleChart'

describe('appendTenSecondPoint', () => {
  it('실시간 원천 값을 10초 버킷으로 맞춰 누적한다', () => {
    const first = appendTenSecondPoint([], '2026-09-09T09:00:17+09:00', 1.23)
    const second = appendTenSecondPoint(first, '2026-09-09T09:00:28+09:00', 1.41)

    expect(first[0].timestamp).toBe('2026-09-09T00:00:10.000Z')
    expect(second).toHaveLength(2)
    expect(second[1].timestamp).toBe('2026-09-09T00:00:20.000Z')
    expect(second[1].value).toBe(1.41)
    expect(second[1].intervalSeconds).toBe(10)
  })

  it('같은 10초 버킷은 최신 값으로 교체하고 날짜가 바뀌면 이전 장 실시간 데이터는 버린다', () => {
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
  it('기존 이력을 유지하면서 첫 실시간 원천 포인트부터 이어 붙인다', () => {
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
  })

  it('실시간 포인트가 아직 없어도 기존 이력은 그대로 반환한다', () => {
    const historical = [
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09', value: 1 },
      { timestamp: '2026-09-09T09:03:00+09:00', day: '2026-09-09', value: 1.1 },
    ]
    expect(mergeThemeSeries(historical, [])).toEqual(historical)
  })
})

describe('resampleThemeSeries30s', () => {
  it('기존 3분 간격 두 값 사이를 30초 간격으로 만들고 비어 있는 값은 직전 값으로 채운다', () => {
    const points = resampleThemeSeries30s([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09', value: 1 },
      { timestamp: '2026-09-09T09:03:00+09:00', day: '2026-09-09', value: 1.3 },
    ])

    expect(points).toHaveLength(7)
    expect(points.map((point) => point.timestamp)).toEqual([
      '2026-09-09T00:00:00.000Z',
      '2026-09-09T00:00:30.000Z',
      '2026-09-09T00:01:00.000Z',
      '2026-09-09T00:01:30.000Z',
      '2026-09-09T00:02:00.000Z',
      '2026-09-09T00:02:30.000Z',
      '2026-09-09T00:03:00.000Z',
    ])
    expect(points.slice(0, -1).map((point) => point.value)).toEqual([1, 1, 1, 1, 1, 1])
    expect(points[1].filled).toBe(true)
    expect(points.at(-1)?.value).toBe(1.3)
    expect(points.at(-1)?.filled).toBe(false)
    expect(points.every((point) => point.intervalSeconds === 30)).toBe(true)
  })

  it('같은 30초 구간에 실제 원천 값이 여러 개면 가장 마지막 값을 사용한다', () => {
    const points = resampleThemeSeries30s([
      { timestamp: '2026-09-09T09:00:05+09:00', day: '2026-09-09', value: 1 },
      { timestamp: '2026-09-09T09:00:24+09:00', day: '2026-09-09', value: 1.2 },
      { timestamp: '2026-09-09T09:00:41+09:00', day: '2026-09-09', value: 1.4 },
    ])

    expect(points).toHaveLength(2)
    expect(points[0].timestamp).toBe('2026-09-09T00:00:00.000Z')
    expect(points[0].value).toBe(1.2)
    expect(points[1].timestamp).toBe('2026-09-09T00:00:30.000Z')
    expect(points[1].value).toBe(1.4)
  })

  it('긴 장중 공백도 30초마다 이전 값으로 채워 선이 끊기지 않게 한다', () => {
    const points = resampleThemeSeries30s([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09', value: 2 },
      { timestamp: '2026-09-09T09:02:00+09:00', day: '2026-09-09', value: 2.5 },
    ])

    expect(points).toHaveLength(5)
    expect(points.map((point) => point.value)).toEqual([2, 2, 2, 2, 2.5])
    expect(splitThemeLineSegments(points)).toHaveLength(1)
  })

  it('날짜가 바뀌는 구간은 이전 값으로 채워서 연결하지 않는다', () => {
    const points = resampleThemeSeries30s([
      { timestamp: '2026-09-08T15:29:30+09:00', day: '2026-09-08', value: 1 },
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09', value: 2 },
    ])

    expect(points).toHaveLength(2)
    expect(splitThemeLineSegments(points)).toHaveLength(2)
  })
})

describe('splitThemeLineSegments', () => {
  it('30초 표시 데이터는 정상적으로 하나의 선으로 유지한다', () => {
    const points = resampleThemeSeries30s([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09', value: 1 },
      { timestamp: '2026-09-09T09:03:00+09:00', day: '2026-09-09', value: 1.2 },
      { timestamp: '2026-09-09T09:06:00+09:00', day: '2026-09-09', value: 1.3 },
    ])

    const segments = splitThemeLineSegments(points)
    expect(segments).toHaveLength(1)
    expect(segments[0].length).toBeGreaterThan(3)
  })

  it('날짜가 바뀌면 시간 차이와 무관하게 선을 연결하지 않는다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-08T06:29:30.000Z', day: '2026-09-08' },
      { timestamp: '2026-09-09T00:00:00.000Z', day: '2026-09-09' },
    ])

    expect(segments).toHaveLength(2)
  })
})
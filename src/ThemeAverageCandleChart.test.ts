import { describe, expect, it } from 'vitest'
import { splitThemeLineSegments } from './ThemeAverageCandleChart'

describe('splitThemeLineSegments', () => {
  it('같은 날 15분을 초과하는 데이터 공백은 서로 다른 선분으로 나눈다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T09:03:00+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T13:30:00+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T13:33:00+09:00', day: '2026-09-09' },
    ])

    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(2)
    expect(segments[1]).toHaveLength(2)
  })

  it('정상적인 3분 간격과 짧은 누락은 한 선분으로 유지한다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-09T09:00:00+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T09:03:00+09:00', day: '2026-09-09' },
      { timestamp: '2026-09-09T09:12:00+09:00', day: '2026-09-09' },
    ])

    expect(segments).toHaveLength(1)
    expect(segments[0]).toHaveLength(3)
  })

  it('날짜가 바뀌면 시간 차이가 짧아도 선을 연결하지 않는다', () => {
    const segments = splitThemeLineSegments([
      { timestamp: '2026-09-08T19:59:00+09:00', day: '2026-09-08' },
      { timestamp: '2026-09-09T08:00:00+09:00', day: '2026-09-09' },
    ])

    expect(segments).toHaveLength(2)
  })
})

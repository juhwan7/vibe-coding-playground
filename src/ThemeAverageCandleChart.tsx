import { useEffect, useMemo, useState } from 'react'

type ThemePoint = {
  timestamp: string
  value: number
  closeValue?: number | null
  day: string
  live?: boolean
  intervalSeconds?: number
  filled?: boolean
}

type ThemeGroup = {
  name: string
  points: ThemePoint[]
  currentValue?: number | null
  liveUpdatedAt?: string | null
}

const SESSION_START = 8 * 60
const SESSION_MINUTES = 12 * 60
const TEN_SECOND_MS = 10 * 1000
const THIRTY_SECOND_MS = 30 * 1000
const DISPLAY_MAX_LINE_GAP_MS = 90 * 1000
const MAX_SAFE_FORWARD_FILL_MS = 3 * 60 * 1000
const MAX_LIVE_POINTS = 4500
const LIVE_STORAGE_PREFIX = 'k-market-theme-10s-v1:'

function timeParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 8)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  const second = Number(parts.find((part) => part.type === 'second')?.value ?? 0)
  return { hour, minute, second, total: hour * 60 + minute + second / 60 }
}

function kstDay(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

function compactDay(day?: string | null) {
  if (!day) return '-'
  const [, month, date] = day.split('-')
  return `${month}/${date}`
}

function displayClock(iso?: string | null) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(iso))
}

function fmtRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function storageKey(themeName: string) {
  return `${LIVE_STORAGE_PREFIX}${encodeURIComponent(themeName)}`
}

function normalizeStoredPoint(point: Partial<ThemePoint>): ThemePoint | null {
  const timestamp = String(point.timestamp ?? '')
  const value = Number(point.value)
  if (!Number.isFinite(Date.parse(timestamp)) || !Number.isFinite(value)) return null
  return {
    timestamp,
    value,
    closeValue: value,
    day: point.day || kstDay(timestamp),
    live: true,
    intervalSeconds: 10,
  }
}

function readLiveSeries(themeName: string) {
  if (typeof window === 'undefined') return [] as ThemePoint[]
  try {
    const raw = window.localStorage.getItem(storageKey(themeName))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const today = kstDay(new Date().toISOString())
    return parsed
      .map((point) => normalizeStoredPoint(point))
      .filter((point): point is ThemePoint => point != null && point.day === today)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      .slice(-MAX_LIVE_POINTS)
  } catch {
    return []
  }
}

function writeLiveSeries(themeName: string, points: ThemePoint[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(themeName), JSON.stringify(points.slice(-MAX_LIVE_POINTS)))
  } catch {
    // 저장공간이 부족해도 현재 탭의 실시간 차트는 계속 동작한다.
  }
}

export function appendTenSecondPoint(source: ThemePoint[], timestamp: string, value: number) {
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed) || !Number.isFinite(value)) return [...source]
  const bucketTimestamp = new Date(Math.floor(parsed / TEN_SECOND_MS) * TEN_SECOND_MS).toISOString()
  const day = kstDay(bucketTimestamp)
  const map = new Map<string, ThemePoint>()

  for (const point of source) {
    if (point.day !== day || !Number.isFinite(Date.parse(point.timestamp)) || !Number.isFinite(point.value)) continue
    map.set(point.timestamp, point)
  }
  map.set(bucketTimestamp, {
    timestamp: bucketTimestamp,
    value,
    closeValue: value,
    day,
    live: true,
    intervalSeconds: 10,
  })

  return [...map.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-MAX_LIVE_POINTS)
}

export function mergeThemeSeries(historical: ThemePoint[], live: ThemePoint[]) {
  const historyPoints = [...historical]
    .filter((point) => point?.timestamp && Number.isFinite(Date.parse(point.timestamp)) && Number.isFinite(point.value))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const livePoints = [...live]
    .filter((point) => point?.timestamp && Number.isFinite(Date.parse(point.timestamp)) && Number.isFinite(point.value))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))

  if (!historyPoints.length) return livePoints.map((point) => ({ ...point, live: true, intervalSeconds: 10 }))
  if (!livePoints.length) return historyPoints

  // 서버가 과거 1분봉을 뒤늦게 백필하면 복구된 이력을 정답으로 취급한다.
  // 브라우저 localStorage에 남은 과거의 평평한 실시간 값이 복구 이력을 덮지 못하게 하고,
  // 서버 이력의 마지막 시각 이후에만 10초 실시간 값을 이어 붙인다.
  const lastHistoricalAt = Date.parse(historyPoints.at(-1)!.timestamp)
  const merged = new Map<string, ThemePoint>()
  for (const point of historyPoints) merged.set(point.timestamp, { ...point, live: false })
  for (const point of livePoints) {
    if (Date.parse(point.timestamp) > lastHistoricalAt) {
      merged.set(point.timestamp, { ...point, live: true, intervalSeconds: 10 })
    }
  }

  return [...merged.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

export function resampleThemeSeries30s(source: ThemePoint[]) {
  const valid = [...source]
    .filter((point) => point?.timestamp && Number.isFinite(Date.parse(point.timestamp)) && Number.isFinite(point.value))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const grouped = new Map<string, ThemePoint[]>()

  for (const point of valid) {
    const day = point.day || kstDay(point.timestamp)
    const dayPoints = grouped.get(day) ?? []
    dayPoints.push(point)
    grouped.set(day, dayPoints)
  }

  const result: ThemePoint[] = []
  for (const [day, dayPoints] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const latestByBucket = new Map<number, { point: ThemePoint; sourceTime: number }>()
    for (const point of dayPoints) {
      const sourceTime = Date.parse(point.timestamp)
      const bucketTime = Math.floor(sourceTime / THIRTY_SECOND_MS) * THIRTY_SECOND_MS
      const existing = latestByBucket.get(bucketTime)
      if (!existing || sourceTime >= existing.sourceTime) {
        latestByBucket.set(bucketTime, { point, sourceTime })
      }
    }

    const bucketTimes = [...latestByBucket.keys()].sort((a, b) => a - b)
    let previousBucket: number | null = null
    let previousPoint: ThemePoint | null = null

    for (const bucketTime of bucketTimes) {
      const actual = latestByBucket.get(bucketTime)?.point
      if (!actual) continue

      // 정상 3분 이력 사이의 30초 표시값만 직전값으로 보간한다.
      // 3분을 넘는 공백은 데이터 누락일 가능성이 있으므로 평평한 선을 만들지 않는다.
      if (previousBucket != null && previousPoint && bucketTime - previousBucket <= MAX_SAFE_FORWARD_FILL_MS) {
        for (let fillTime = previousBucket + THIRTY_SECOND_MS; fillTime < bucketTime; fillTime += THIRTY_SECOND_MS) {
          result.push({
            ...previousPoint,
            timestamp: new Date(fillTime).toISOString(),
            day,
            closeValue: previousPoint.value,
            intervalSeconds: 30,
            filled: true,
          })
        }
      }

      const normalized = {
        ...actual,
        timestamp: new Date(bucketTime).toISOString(),
        day,
        closeValue: actual.value,
        intervalSeconds: 30,
        filled: false,
      }
      result.push(normalized)
      previousBucket = bucketTime
      previousPoint = normalized
    }
  }

  return result
}

export function splitThemeLineSegments<T extends { timestamp: string; day: string }>(source: T[], maxGapMs = DISPLAY_MAX_LINE_GAP_MS) {
  const points = [...source].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const segments: T[][] = []
  let current: T[] = []

  for (const point of points) {
    const previous = current.at(-1)
    const currentTime = Date.parse(point.timestamp)
    const previousTime = previous ? Date.parse(previous.timestamp) : NaN
    const shouldBreak = Boolean(previous) && (
      previous?.day !== point.day
      || !Number.isFinite(currentTime)
      || !Number.isFinite(previousTime)
      || currentTime - previousTime > maxGapMs
    )

    if (shouldBreak) {
      if (current.length) segments.push(current)
      current = []
    }
    current.push(point)
  }

  if (current.length) segments.push(current)
  return segments
}

export default function ThemeAverageCandleChart({ theme, accent }: { theme: ThemeGroup; accent: string }) {
  const [livePoints, setLivePoints] = useState<ThemePoint[]>(() => readLiveSeries(theme.name))

  useEffect(() => {
    setLivePoints(readLiveSeries(theme.name))
  }, [theme.name])

  useEffect(() => {
    const timestamp = theme.liveUpdatedAt
    const value = theme.currentValue
    if (!timestamp || value == null || !Number.isFinite(value)) return
    setLivePoints((current) => {
      const next = appendTenSecondPoint(current, timestamp, value)
      const before = current.at(-1)
      const after = next.at(-1)
      if (before?.timestamp === after?.timestamp && before?.value === after?.value && current.length === next.length) return current
      writeLiveSeries(theme.name, next)
      return next
    })
  }, [theme.currentValue, theme.liveUpdatedAt, theme.name])

  const hasLiveSource = livePoints.length > 0
  const points = useMemo(() => {
    return resampleThemeSeries30s(mergeThemeSeries(theme.points ?? [], livePoints))
      .map((point) => ({ ...point, lineValue: point.value }))
      .filter((point) => Number.isFinite(point.lineValue))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  }, [livePoints, theme.points])

  if (!points.length) return <div className="theme-chart-empty">테마 거래대금 가중 30초 선차트 데이터 수집 중</div>

  const width = 900
  const height = 258
  const chartTop = 20
  const chartBottom = 214
  const days = [...new Set(points.map((point) => point.day))].sort()
  const domainMinutes = Math.max(SESSION_MINUTES, days.length * SESSION_MINUTES)
  const values = points.map((point) => point.lineValue)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const rawRange = Math.max(0, rawMax - rawMin)
  const center = (rawMax + rawMin) / 2

  // 실제 퍼센트 값은 그대로 두고 세로축 여백만 강하게 줄인다.
  // 작은 변화도 화면 높이를 충분히 사용하되 완전히 평평한 구간의 과도한 확대는 막는다.
  const minVisibleRange = Math.max(0.015, Math.abs(center) * 0.002)
  const visibleRange = Math.max(rawRange, minVisibleRange)
  const pad = visibleRange * 0.035
  const lo = center - visibleRange / 2 - pad
  const hi = center + visibleRange / 2 + pad
  const range = Math.max(0.0001, hi - lo)
  const y = (value: number) => chartBottom - ((value - lo) / range) * (chartBottom - chartTop)
  const xForTimestamp = (timestamp: string, day: string) => {
    const dayIndex = Math.max(0, days.indexOf(day))
    const minute = Math.max(0, Math.min(SESSION_MINUTES, timeParts(timestamp).total - SESSION_START))
    return (dayIndex * SESSION_MINUTES + minute) / domainMinutes * width
  }
  const xForMinute = (dayIndex: number, minute: number) => (dayIndex * SESSION_MINUTES + minute) / domainMinutes * width
  const ticks = days.flatMap((day, dayIndex) => Array.from({ length: 13 }, (_, index) => 8 + index).map((hour) => ({ day, dayIndex, hour, minute: (hour - 8) * 60 })))
  const lineSegments = splitThemeLineSegments(points)
  const latest = points.at(-1)!
  const latestX = xForTimestamp(latest.timestamp, latest.day)
  const latestY = y(latest.lineValue)
  const currentLabelWidth = 100
  const currentLabelHeight = 26
  const currentLabelX = latestX > width - currentLabelWidth - 14 ? latestX - currentLabelWidth - 10 : latestX + 10
  const currentLabelY = Math.max(chartTop + 4, Math.min(chartBottom - currentLabelHeight - 4, latestY - currentLabelHeight / 2))
  const chartModeLabel = '테마 거래대금 가중 30초 선차트'
  const chartModeDetail = hasLiveSource
    ? '10초 원천값 → 30초 표시 · 서버 복구 이력 우선 · 장시간 누락은 연결 안 함'
    : '기존 기록 → 30초 표시 · 장시간 누락은 연결 안 함'

  return <div className="theme-chart-wrap theme-chart-emphasis" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-chart-title">
      <span className="theme-chart-name">{chartModeLabel} <small>{chartModeDetail}</small></span>
      <div className="theme-chart-metrics">
        <span>구간 고점 <b>{fmtRate(rawMax)}</b></span>
        <span>구간 저점 <b>{fmtRate(rawMin)}</b></span>
      </div>
    </div>
    <svg className="theme-chart theme-chart-expanded" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${theme.name} 구성종목 거래대금 가중 30초 선차트`}>
      {[.25, .5, .75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={chartTop + (chartBottom - chartTop) * ratio} y2={chartTop + (chartBottom - chartTop) * ratio} className="theme-chart-grid" />)}
      {lo < 0 && hi > 0 && <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="theme-zero-line" />}
      {ticks.map((tick) => {
        const x = xForMinute(tick.dayIndex, tick.minute)
        return <g key={`${tick.day}-${tick.hour}`}>
          <line x1={x} x2={x} y1={chartTop} y2={chartBottom} className={tick.hour === 8 ? 'theme-day-line' : 'theme-hour-line'} />
          <text x={Math.min(width - 34, x + 3)} y="250" className="theme-hour-label">{String(tick.hour).padStart(2, '0')}:00</text>
        </g>
      })}
      {days.map((day, dayIndex) => <text key={`${day}-label`} x={xForMinute(dayIndex, 0) + 4} y="15" className="theme-day-label">{compactDay(day)} {dayIndex === days.length - 1 ? '오늘' : '전일'}</text>)}
      <text x={width - 5} y={chartTop + 10} textAnchor="end" className="theme-candle-price-label">{fmtRate(hi)}</text>
      <text x={width - 5} y={chartBottom - 4} textAnchor="end" className="theme-candle-price-label">{fmtRate(lo)}</text>
      <line x1={latestX} x2={latestX} y1={chartTop} y2={chartBottom} className="theme-current-guide" />
      {lineSegments.map((segment, index) => {
        if (segment.length < 2) return null
        const polyline = segment.map((point) => `${xForTimestamp(point.timestamp, point.day)},${y(point.lineValue)}`).join(' ')
        return <polyline key={`${segment[0].timestamp}-${index}`} points={polyline} className="theme-average-line" fill="none" />
      })}
      <circle cx={latestX} cy={latestY} r="9" className="theme-average-current-halo" aria-hidden="true" />
      <circle cx={latestX} cy={latestY} r="4.8" className="theme-average-current-dot">
        <title>{`${compactDay(latest.day)} ${displayClock(latest.timestamp)} · ${fmtRate(latest.lineValue)}`}</title>
      </circle>
      <g className="theme-current-label" transform={`translate(${currentLabelX} ${currentLabelY})`}>
        <rect width={currentLabelWidth} height={currentLabelHeight} rx="6" />
        <text x="9" y="17">현재 {fmtRate(latest.lineValue)}</text>
      </g>
    </svg>
  </div>
}
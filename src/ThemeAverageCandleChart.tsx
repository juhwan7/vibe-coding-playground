type ThemePoint = {
  timestamp: string
  value: number
  closeValue?: number | null
  day: string
}

type ThemeGroup = {
  name: string
  points: ThemePoint[]
}

const SESSION_START = 8 * 60
const SESSION_MINUTES = 12 * 60

function timeParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 8)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return { hour, minute, total: hour * 60 + minute }
}

function compactDay(day?: string | null) {
  if (!day) return '-'
  const [, month, date] = day.split('-')
  return `${month}/${date}`
}

function fmtRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

export default function ThemeAverageCandleChart({ theme, accent }: { theme: ThemeGroup; accent: string }) {
  const points = (theme.points ?? [])
    .map((point) => ({ ...point, lineValue: point.value }))
    .filter((point) => Number.isFinite(point.lineValue))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))

  if (!points.length) return <div className="theme-chart-empty">테마 거래대금 가중 3분 선차트 데이터 수집 중</div>

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
  const ticks = days.flatMap((day, dayIndex) => [8, 10, 12, 14, 16, 18, 20].map((hour) => ({ day, dayIndex, hour, minute: (hour - 8) * 60 })))
  const perDay = days.map((day) => points.filter((point) => point.day === day))
  const latest = points.at(-1)!

  return <div className="theme-chart-wrap theme-chart-emphasis" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-chart-title">
      <span className="theme-chart-name">테마 거래대금 가중 3분 선차트 <small>강한 자동 확대축 · 실제 가중 등락률</small></span>
      <div className="theme-chart-metrics">
        <span>구간 고점 <b>{fmtRate(rawMax)}</b></span>
        <span>구간 저점 <b>{fmtRate(rawMin)}</b></span>
      </div>
    </div>
    <svg className="theme-chart theme-chart-expanded" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${theme.name} 구성종목 거래대금 가중 3분 선차트`}>
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
      {perDay.map((dayPoints, index) => {
        const polyline = dayPoints.map((point) => `${xForTimestamp(point.timestamp, point.day)},${y(point.lineValue)}`).join(' ')
        return <polyline key={days[index]} points={polyline} className="theme-average-line" fill="none" />
      })}
      <circle cx={xForTimestamp(latest.timestamp, latest.day)} cy={y(latest.lineValue)} r="4.2" className="theme-average-current-dot">
        <title>{`${compactDay(latest.day)} · ${fmtRate(latest.lineValue)}`}</title>
      </circle>
    </svg>
  </div>
}

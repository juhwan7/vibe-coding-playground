type ThemePoint = {
  timestamp: string
  value: number
  openValue?: number | null
  highValue?: number | null
  lowValue?: number | null
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

function timeLabel(iso?: string | null) {
  if (!iso) return '-'
  const { hour, minute } = timeParts(iso)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
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
  const points = (theme.points ?? []).filter((point) => Number.isFinite(point.value))
  if (!points.length) return <div className="theme-chart-empty">테마 평균 3분봉 데이터 수집 중</div>

  const width = 900
  const height = 190
  const chartTop = 24
  const chartBottom = 146
  const days = [...new Set(points.map((point) => point.day))].sort()
  const domainMinutes = Math.max(SESSION_MINUTES, days.length * SESSION_MINUTES)
  const candleValues = points.flatMap((point) => [
    point.lowValue ?? point.value,
    point.highValue ?? point.value,
    point.openValue ?? point.value,
    point.closeValue ?? point.value,
  ]).filter(Number.isFinite)
  const rawMin = Math.min(...candleValues)
  const rawMax = Math.max(...candleValues)
  const rawRange = Math.max(0, rawMax - rawMin)
  const minVisibleRange = Math.max(0.08, Math.abs((rawMax + rawMin) / 2) * 0.015)
  const visibleRange = Math.max(rawRange, minVisibleRange)
  const center = (rawMax + rawMin) / 2
  const pad = visibleRange * 0.08
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
  const candleWidth = Math.max(1.6, Math.min(5.2, width / Math.max(1, points.length) * 0.72))
  const ticks = days.flatMap((day, dayIndex) => [8, 10, 12, 14, 16, 18, 20].map((hour) => ({ day, dayIndex, hour, minute: (hour - 8) * 60 })))

  return <div className="theme-chart-wrap" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-chart-title">
      <span className="theme-chart-name">테마 평균 3분봉 <small>자동 확대축 · 실제 평균 등락률</small></span>
      <div className="theme-chart-metrics">
        <span>구간 고점 <b>{fmtRate(rawMax)}</b></span>
        <span>구간 저점 <b>{fmtRate(rawMin)}</b></span>
      </div>
    </div>
    <svg className="theme-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${theme.name} 구성종목 평균 3분 캔들 차트`}>
      {[.25, .5, .75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={chartTop + (chartBottom - chartTop) * ratio} y2={chartTop + (chartBottom - chartTop) * ratio} className="theme-chart-grid" />)}
      {lo < 0 && hi > 0 && <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="theme-zero-line" />}
      {ticks.map((tick) => {
        const x = xForMinute(tick.dayIndex, tick.minute)
        return <g key={`${tick.day}-${tick.hour}`}>
          <line x1={x} x2={x} y1={chartTop} y2={chartBottom} className={tick.hour === 8 ? 'theme-day-line' : 'theme-hour-line'} />
          <text x={Math.min(width - 30, x + 3)} y="182" className="theme-hour-label">{String(tick.hour).padStart(2, '0')}:00</text>
        </g>
      })}
      {days.map((day, dayIndex) => <text key={`${day}-label`} x={xForMinute(dayIndex, 0) + 4} y="15" className="theme-day-label">{compactDay(day)} {dayIndex === days.length - 1 ? '오늘' : '전일'}</text>)}
      <text x={width - 5} y={chartTop + 8} textAnchor="end" className="theme-candle-price-label">{fmtRate(hi)}</text>
      <text x={width - 5} y={chartBottom - 3} textAnchor="end" className="theme-candle-price-label">{fmtRate(lo)}</text>
      {points.map((point) => {
        const open = point.openValue ?? point.value
        const high = point.highValue ?? Math.max(open, point.value)
        const low = point.lowValue ?? Math.min(open, point.value)
        const close = point.closeValue ?? point.value
        const cx = xForTimestamp(point.timestamp, point.day)
        const openY = y(open)
        const closeY = y(close)
        const highY = y(high)
        const lowY = y(low)
        const direction = close >= open ? 'up' : 'down'
        const bodyY = Math.min(openY, closeY)
        const bodyHeight = Math.max(1.2, Math.abs(closeY - openY))
        return <g key={point.timestamp}>
          <line x1={cx} x2={cx} y1={highY} y2={lowY} className={`theme-candle-wick ${direction}`} />
          <rect x={Math.max(0, cx - candleWidth / 2)} y={bodyY} width={candleWidth} height={bodyHeight} className={`theme-candle-body ${direction}`}>
            <title>{`${compactDay(point.day)} ${timeLabel(point.timestamp)} · 시 ${fmtRate(open)} 고 ${fmtRate(high)} 저 ${fmtRate(low)} 종 ${fmtRate(close)}`}</title>
          </rect>
        </g>
      })}
    </svg>
  </div>
}

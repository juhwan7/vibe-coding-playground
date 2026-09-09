import { useEffect, useMemo, useState } from 'react'

type ThemePoint = {
  timestamp: string
  value: number
  closeValue?: number | null
  day: string
}

type ThemeMember = {
  symbol?: string | null
  name?: string | null
}

type ThemeGroup = {
  name: string
  points: ThemePoint[]
  members?: ThemeMember[]
  dominantWeightPercent?: number | null
}

type NewsMatch = {
  symbol?: string | null
  name?: string | null
}

type NewsItem = {
  title: string
  summary?: string | null
  publishedAt?: string | null
  matches?: NewsMatch[] | null
}

type NewsPayload = {
  ok?: boolean
  items?: NewsItem[]
}

const SESSION_START = 8 * 60
const SESSION_MINUTES = 12 * 60
const MAX_LINE_GAP_MS = 15 * 60 * 1000
const FEATURE_NEWS_TTL_MS = 180000
const THEME_ALIASES: Record<string, string[]> = {
  반도체: ['HBM', '메모리', '파운드리'],
  '2차전지': ['배터리', '이차전지'],
  전력기기: ['전력', '변압기', '전선'],
  원전: ['원자력', '에너빌리티'],
  조선: ['LNG선', '선박'],
  방산: ['방위산업', '무기체계'],
}

let featureNewsCache: NewsItem[] = []
let featureNewsCacheUntil = 0
let featureNewsRequest: Promise<NewsItem[]> | null = null

function timeParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 8)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return { hour, minute, total: hour * 60 + minute }
}

function kstDay(iso?: string | null) {
  const parsed = Date.parse(iso ?? '')
  if (!Number.isFinite(parsed)) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(parsed))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function displayClock(iso?: string | null) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
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

async function loadFeatureNews() {
  if (Date.now() < featureNewsCacheUntil) return featureNewsCache
  if (featureNewsRequest) return featureNewsRequest
  featureNewsRequest = fetch('/api/market/feature-news', { headers: { Accept: 'application/json' } })
    .then(async (response) => response.ok ? await response.json() as NewsPayload : null)
    .then((payload) => {
      if (payload?.items?.length) featureNewsCache = payload.items
      featureNewsCacheUntil = Date.now() + FEATURE_NEWS_TTL_MS
      return featureNewsCache
    })
    .catch(() => featureNewsCache)
    .finally(() => { featureNewsRequest = null })
  return featureNewsRequest
}

export function newsMatchesTheme(theme: ThemeGroup, item: NewsItem) {
  const text = `${item.title ?? ''} ${item.summary ?? ''}`.toLowerCase()
  const members = theme.members ?? []
  const memberSymbols = new Set(members.map((member) => String(member.symbol ?? '').trim()).filter(Boolean))
  if (item.matches?.some((match) => memberSymbols.has(String(match.symbol ?? '').trim()))) return true

  const tokens = [theme.name, ...(THEME_ALIASES[theme.name] ?? []), ...members.map((member) => String(member.name ?? '').trim()).filter(Boolean)]
  return tokens.some((token) => token.length >= 2 && text.includes(token.toLowerCase()))
}

export function splitThemeLineSegments<T extends { timestamp: string; day: string }>(source: T[], maxGapMs = MAX_LINE_GAP_MS) {
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
  const [newsItems, setNewsItems] = useState<NewsItem[]>(featureNewsCache)
  const points = (theme.points ?? [])
    .map((point) => ({ ...point, lineValue: point.value }))
    .filter((point) => Number.isFinite(point.lineValue))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const days = [...new Set(points.map((point) => point.day))].sort()
  const daysKey = days.join('|')

  useEffect(() => {
    let active = true
    let timer: number | undefined
    const refresh = async () => {
      const items = await loadFeatureNews()
      if (active) setNewsItems(items)
      if (active) timer = window.setTimeout(refresh, FEATURE_NEWS_TTL_MS)
    }
    void refresh()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  const eventItems = useMemo(() => newsItems
    .filter((item) => {
      const day = kstDay(item.publishedAt)
      if (!day || !days.includes(day) || !newsMatchesTheme(theme, item)) return false
      const total = timeParts(item.publishedAt ?? '').total
      return total >= SESSION_START && total <= SESSION_START + SESSION_MINUTES
    })
    .sort((a, b) => Date.parse(a.publishedAt ?? '') - Date.parse(b.publishedAt ?? ''))
    .slice(-4), [newsItems, theme, daysKey])

  if (!points.length) return <div className="theme-chart-empty">테마 거래대금 가중 3분 선차트 데이터 수집 중</div>

  const width = 900
  const height = 258
  const chartTop = 20
  const chartBottom = 214
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
  const lineSegments = splitThemeLineSegments(points)
  const latest = points.at(-1)!
  const latestX = xForTimestamp(latest.timestamp, latest.day)
  const latestY = y(latest.lineValue)
  const currentLabelWidth = 100
  const currentLabelHeight = 26
  const currentLabelX = latestX > width - currentLabelWidth - 14 ? latestX - currentLabelWidth - 10 : latestX + 10
  const currentLabelY = Math.max(chartTop + 4, Math.min(chartBottom - currentLabelHeight - 4, latestY - currentLabelHeight / 2))
  const concentration = Math.max(0, Math.min(100, theme.dominantWeightPercent ?? 0))

  return <div className="theme-chart-wrap theme-chart-emphasis" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-chart-title">
      <span className="theme-chart-name">테마 거래대금 가중 3분 선차트 <small>강한 자동 확대축 · 실제 가중 등락률</small></span>
      <div className="theme-chart-metrics">
        {theme.dominantWeightPercent != null && <div className="theme-concentration-chip" title="테마 거래대금 중 가장 큰 개별주가 차지하는 비중">
          <span>집중도</span><span className="theme-concentration-track"><i style={{ width: `${concentration}%` }} /></span><b>{concentration.toFixed(0)}%</b>
        </div>}
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
      {eventItems.map((item, index) => {
        const day = kstDay(item.publishedAt)
        if (!day) return null
        const x = xForTimestamp(item.publishedAt ?? '', day)
        return <g className="theme-event-marker" key={`${item.publishedAt}-${index}`}>
          <line x1={x} x2={x} y1={chartTop + 14} y2={chartBottom} className="theme-event-line" />
          <circle cx={x} cy={chartTop + 14} r="7" className="theme-event-dot" />
          <text x={x} y={chartTop + 17} textAnchor="middle" className="theme-event-label">N</text>
          <title>{`${displayClock(item.publishedAt)} · ${item.summary || item.title}`}</title>
        </g>
      })}
      <line x1={latestX} x2={latestX} y1={chartTop} y2={chartBottom} className="theme-current-guide" />
      {lineSegments.map((segment, index) => {
        if (segment.length < 2) return null
        const polyline = segment.map((point) => `${xForTimestamp(point.timestamp, point.day)},${y(point.lineValue)}`).join(' ')
        return <polyline key={`${segment[0].timestamp}-${index}`} points={polyline} className="theme-average-line" fill="none" />
      })}
      <circle cx={latestX} cy={latestY} r="9" className="theme-average-current-halo" aria-hidden="true" />
      <circle cx={latestX} cy={latestY} r="4.8" className="theme-average-current-dot">
        <title>{`${compactDay(latest.day)} · ${fmtRate(latest.lineValue)}`}</title>
      </circle>
      <g className="theme-current-label" transform={`translate(${currentLabelX} ${currentLabelY})`}>
        <rect width={currentLabelWidth} height={currentLabelHeight} rx="6" />
        <text x="9" y="17">현재 {fmtRate(latest.lineValue)}</text>
      </g>
    </svg>
  </div>
}

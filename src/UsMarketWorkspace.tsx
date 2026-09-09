import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import './marketWorkspace.css'
import { smoothUsThemeTrend, splitUsThemeLineSegments, usMarketBreadth, usThemeConcentration, usThemeStrengthClass, usTurnoverHeat } from './usThemeFlowSaas'

type RankingItem = {
  symbol: string | null
  name: string | null
  englishName?: string | null
  market: string | null
  currency?: string | null
  lastPrice: number | null
  changeRate: number | null
  tradingAmount: number | null
  tradingVolume: number | null
}

type ThemePoint = {
  timestamp: string
  value: number
  volume: number
  tradingAmount?: number | null
  memberCount: number
  day: string
  source?: '30s-live' | '1m-backfill' | string
}

type ThemeGroup = {
  name: string
  tradingAmount: number
  memberCount: number
  members: RankingItem[]
  points: ThemePoint[]
  currentValue: number | null
  change1h: number | null
  change3h: number | null
  startDay: string | null
  endDay: string | null
}

type UsThemeFlowResponse = {
  ok?: boolean
  stage?: string
  updatedAt?: string | null
  liveSampledAt?: string | null
  liveSampleCount?: number | null
  rankedAt?: string | null
  marketTradingAmount?: number | null
  topRankings?: RankingItem[]
  themes?: ThemeGroup[]
  regularSession?: {
    day?: string | null
    closedAt?: string | null
    source?: string | null
    themes?: Array<{ name: string; memberCount: number; tradingAmount: number; sessionChange: number | null; closeValue: number | null; closedAt: string | null }>
  }
  afterHours?: {
    sessionDay?: string | null
    active?: boolean
    observedSymbols?: number
    sampledAt?: string | null
    source?: string
    note?: string
    themes?: Array<{ name: string; regularMemberCount: number; observedMemberCount: number; currentValue: number | null; sampledAt: string | null; points: ThemePoint[] }>
    movers?: Array<{ symbol: string; name: string; market: string; theme: string; regularClose: number; afterHoursPrice: number; afterHoursChangeRate: number; sampledAt: string }>
  }
  regularSnapshotCapturedAt?: string | null
  regularSnapshotSource?: string | null
  error?: string | null
}

const ACCENTS = ['#ff4d6d', '#39a0ff', '#37d67a', '#9d6cff', '#ff9a3d']
const SESSION_START = 9 * 60 + 30
const SESSION_MINUTES = 390
const SESSION_START_SECONDS = SESSION_START * 60
const SESSION_SECONDS = SESSION_MINUTES * 60
const SESSION_TICKS = [600, 660, 720, 780, 840, 900, 960]

function fmtUsdAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 1 : 2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${Math.round(value).toLocaleString()}`
}

function fmtUsdPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: value < 10 ? 2 : 0, maximumFractionDigits: 2 })}`
}

function fmtRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function fmtShare(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value.toFixed(value < 1 ? 2 : 1)}%`
}

function displayKstTime(iso?: string | null) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso))
}

function usTimeParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 9)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 30)
  const second = Number(parts.find((part) => part.type === 'second')?.value ?? 0)
  return { hour, minute, second, total: hour * 60 + minute, totalSeconds: hour * 3600 + minute * 60 + second }
}

function etTimeLabel(iso?: string | null) {
  if (!iso) return '-'
  const { hour, minute, second } = usTimeParts(iso)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

function compactDay(day?: string | null) {
  if (!day) return '-'
  const [, month, date] = day.split('-')
  return `${month}/${date}`
}

function kstTickLabel(points: ThemePoint[], day: string, targetMinute: number) {
  const sameDay = points.filter((point) => point.day === day)
  if (!sameDay.length) return '-'
  const anchor = sameDay[0]
  const anchorSeconds = usTimeParts(anchor.timestamp).totalSeconds
  const targetTime = Date.parse(anchor.timestamp) + (targetMinute * 60 - anchorSeconds) * 1000
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(targetTime))
}

function themeIcon(name: string) {
  if (name.includes('반도체')) return '▦'
  if (name.includes('원전') || name.includes('전력')) return 'ϟ'
  if (name.includes('양자')) return '◫'
  if (name.includes('우주') || name.includes('방산')) return '✦'
  if (name.includes('전기차')) return '◇'
  if (name.includes('암호화폐')) return '◆'
  if (name.includes('금융')) return '▥'
  if (name.includes('바이오')) return '◉'
  if (name.includes('에너지')) return '●'
  if (name.includes('로봇')) return '⌘'
  if (name.includes('클라우드') || name.includes('데이터센터')) return '▤'
  if (name.includes('소비') || name.includes('유통')) return '▣'
  if (name.includes('미디어') || name.includes('스트리밍')) return '▶'
  return '■'
}

function UsThemeChart({ theme, accent }: { theme: ThemeGroup; accent: string }) {
  const points = [...(theme.points ?? [])].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  if (points.length < 2) return <div className="theme-chart-empty">미국 과거 1분봉 + 30초 실시간 가격 준비 중</div>

  const trendPoints = smoothUsThemeTrend(points)
  const width = 900
  const height = 196
  const chartTop = 20
  const chartBottom = 150
  const turnoverTop = 162
  const turnoverBottom = 174
  const days = [...new Set(points.map((point) => point.day))].sort()
  const domainSeconds = Math.max(SESSION_SECONDS, days.length * SESSION_SECONDS)
  const xForPoint = (point: ThemePoint) => {
    const dayIndex = Math.max(0, days.indexOf(point.day))
    const elapsed = Math.max(0, Math.min(SESSION_SECONDS, usTimeParts(point.timestamp).totalSeconds - SESSION_START_SECONDS))
    return (dayIndex * SESSION_SECONDS + elapsed) / domainSeconds * width
  }
  const xForMinute = (dayIndex: number, minute: number) => (dayIndex * SESSION_SECONDS + (minute * 60 - SESSION_START_SECONDS)) / domainSeconds * width

  const trendValues = trendPoints.map((point) => point.trendValue)
  const min = Math.min(...trendValues)
  const max = Math.max(...trendValues)
  const pad = Math.max(.18, (max - min) * .1)
  const lo = min - pad
  const hi = max + pad
  const range = Math.max(.01, hi - lo)
  const y = (value: number) => chartBottom - ((value - lo) / range) * (chartBottom - chartTop)
  const lineSegments = splitUsThemeLineSegments(trendPoints)
  const turnoverPoints = points.filter((point) => (point.tradingAmount ?? 0) > 0)
  const maxTurnover = Math.max(1, ...turnoverPoints.map((point) => point.tradingAmount ?? 0))
  const turnoverPeak = turnoverPoints.reduce<ThemePoint | null>((best, point) => !best || (point.tradingAmount ?? 0) > (best.tradingAmount ?? 0) ? point : best, null)
  let risePeak: { point: (typeof trendPoints)[number]; delta: number } | null = null
  for (let index = 1; index < trendPoints.length; index += 1) {
    if (trendPoints[index].day !== trendPoints[index - 1].day) continue
    const delta = trendPoints[index].trendValue - trendPoints[index - 1].trendValue
    if (!risePeak || delta > risePeak.delta) risePeak = { point: trendPoints[index], delta }
  }

  const eventMarkers = [
    turnoverPeak ? {
      key: `turnover-${turnoverPeak.timestamp}`,
      timestamp: turnoverPeak.timestamp,
      className: 'is-turnover',
      label: `${etTimeLabel(turnoverPeak.timestamp)} ET · 실제 1분 거래대금 피크 ${fmtUsdAmount(turnoverPeak.tradingAmount)}`,
    } : null,
    risePeak && risePeak.delta > 0 ? {
      key: `rise-${risePeak.point.timestamp}`,
      timestamp: risePeak.point.timestamp,
      className: 'is-rise',
      label: `${etTimeLabel(risePeak.point.timestamp)} ET · 90초 추세 상승 ${fmtRate(risePeak.delta)}`,
    } : null,
  ].filter((marker): marker is { key: string; timestamp: string; className: string; label: string } => Boolean(marker))

  return <div className="theme-chart-wrap us-theme-chart-wrap" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-chart-title">
      <span className="theme-chart-name">30초 실시간 테마 추세 · ET / KST <small>실제 30초 현재가 샘플 + 과거 실제 1분봉 · 90초 추세 완화</small></span>
      <div className="theme-chart-metrics">
        <span>1분 거래대금 피크 <b>{etTimeLabel(turnoverPeak?.timestamp)} ET · {fmtUsdAmount(turnoverPeak?.tradingAmount)}</b></span>
        <span>추세 상승 피크 <b>{etTimeLabel(risePeak?.point.timestamp)} ET · {fmtRate(risePeak?.delta)}</b></span>
      </div>
    </div>
    <svg className="theme-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${theme.name} 미국 개별주 TOP50 테마 30초 실시간 추세 차트`}>
      {[.25, .5, .75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={chartTop + (chartBottom - chartTop) * ratio} y2={chartTop + (chartBottom - chartTop) * ratio} className="theme-chart-grid" />)}
      {lo < 0 && hi > 0 && <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="theme-zero-line" />}
      {days.flatMap((day, dayIndex) => SESSION_TICKS.map((minute) => ({ day, dayIndex, minute }))).map((tick) => {
        const x = xForMinute(tick.dayIndex, tick.minute)
        const labelX = Math.max(24, Math.min(width - 24, x))
        const et = `${String(Math.floor(tick.minute / 60)).padStart(2, '0')}:00`
        const kst = kstTickLabel(points, tick.day, tick.minute)
        return <g key={`${tick.day}-${tick.minute}`}>
          <line x1={x} x2={x} y1={chartTop} y2={turnoverBottom} className="theme-hour-line" />
          <text x={labelX} y="184" textAnchor="middle" className="theme-hour-label">
            <tspan x={labelX}>ET {et}</tspan>
            <tspan x={labelX} dy="9">KST {kst}</tspan>
          </text>
        </g>
      })}
      {days.slice(1).map((day, index) => {
        const x = xForMinute(index + 1, SESSION_START)
        return <g key={day}><line x1={x} x2={x} y1="0" y2={height} className="theme-day-separator" /><text x={x + 6} y="15" className="theme-day-label">{compactDay(day)} 오늘</text></g>
      })}
      <text x="4" y="15" className="theme-day-label">{compactDay(days[0])} 전일 · 미국 동부시간</text>
      <text x="4" y={turnoverTop - 3} className="theme-turnover-label">실제 1분 거래대금 · 축소 표시</text>
      {turnoverPoints.map((point) => {
        const x = xForPoint(point)
        const barHeight = Math.max(.7, ((point.tradingAmount ?? 0) / maxTurnover) * (turnoverBottom - turnoverTop))
        return <rect key={`${point.timestamp}-amount`} x={Math.max(0, x - .65)} y={turnoverBottom - barHeight} width="1.3" height={barHeight} opacity="0.42" className="theme-volume-bar"><title>{`${compactDay(point.day)} ${etTimeLabel(point.timestamp)} ET · 평균 ${fmtRate(point.value)} · 실제 1분 거래대금 ${fmtUsdAmount(point.tradingAmount)}`}</title></rect>
      })}
      {lineSegments.map((segment, index) => {
        if (segment.length < 2) return null
        const path = segment.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${xForPoint(point).toFixed(1)},${y(point.trendValue).toFixed(1)}`).join(' ')
        return <path key={`${segment[0].timestamp}-${index}`} d={path} className="theme-price-line" style={{ strokeWidth: 2.8 }} />
      })}
      {trendPoints.filter((_, index) => index % Math.max(1, Math.floor(trendPoints.length / 90)) === 0).map((point) => <circle key={`${point.timestamp}-c`} cx={xForPoint(point)} cy={y(point.trendValue)} r="1.45" className="theme-price-dot"><title>{`${compactDay(point.day)} ${etTimeLabel(point.timestamp)} ET · 원값 ${fmtRate(point.value)} · 추세 ${fmtRate(point.trendValue)} · ${point.source === '30s-live' ? '30초 실시간' : '1분 백필'}`}</title></circle>)}
    </svg>
    {eventMarkers.length > 0 && <div className="theme-event-layer us-theme-event-layer">
      {eventMarkers.map((marker) => {
        const point = points.find((item) => item.timestamp === marker.timestamp)
        if (!point) return null
        return <button key={marker.key} className={`theme-event-marker us-theme-event-marker ${marker.className}`} type="button" style={{ left: `${xForPoint(point) / width * 100}%` }} data-label={marker.label} title={marker.label} aria-label={marker.label}><i /></button>
      })}
    </div>}
  </div>
}

function AfterHoursSparkline({ points, accent }: { points: ThemePoint[]; accent: string }) {
  const sorted = [...(points ?? [])].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  if (sorted.length < 2) return <span className="us-after-spark-empty">실제 샘플 대기</span>
  const width = 220
  const height = 46
  const values = [0, ...sorted.map((point) => point.value)]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = Math.max(.08, (hi - lo) * .14)
  const min = lo - pad
  const max = hi + pad
  const range = Math.max(.01, max - min)
  const start = Date.parse(sorted[0].timestamp)
  const end = Math.max(start + 1, Date.parse(sorted.at(-1)!.timestamp))
  const x = (timestamp: string) => (Date.parse(timestamp) - start) / (end - start) * width
  const y = (value: number) => height - 4 - ((value - min) / range) * (height - 8)
  const path = sorted.map((point, index) => `${index ? 'L' : 'M'}${x(point.timestamp).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ')
  return <svg className="us-after-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="정규장 종료 후 테마 변화 흐름" style={{ ['--theme-accent' as string]: accent } as CSSProperties}>
    <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="us-after-zero" />
    <path d={path} className="us-after-line" />
  </svg>
}

function UsThemeRow({ theme, rank }: { theme: ThemeGroup; rank: number }) {
  const accent = ACCENTS[(rank - 1) % ACCENTS.length]
  const members = [...theme.members].sort((a, b) => (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0)).slice(0, 7)
  const concentration = usThemeConcentration(theme)
  const rowClass = `theme-strength-row theme-saas-row ${usThemeStrengthClass(theme.currentValue)}${rank === 1 ? ' theme-leader-row' : ''}`

  return <article className={rowClass} style={{ ['--theme-accent' as string]: accent } as CSSProperties} data-testid={rank === 1 ? 'us-theme-leader' : undefined}>
    <div className="theme-summary-cell">
      <div className="theme-rank-line"><b>{rank}</b><span className="theme-icon">{themeIcon(theme.name)}</span><h2>{theme.name}</h2></div>
      <p>{theme.memberCount}개 종목 · ETF/ETN 제외 TOP50</p>
      <strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.currentValue)}</strong>
      <div><span>1일 누적 거래대금 합계</span><b>{fmtUsdAmount(theme.tradingAmount)}</b></div>
      {concentration != null && <div className="theme-concentration-stat"><span>최대 종목 거래대금 비중</span><b>{concentration.toFixed(0)}%</b><span className="theme-concentration-track" aria-label={`최대 종목 거래대금 비중 ${concentration.toFixed(0)}%`}><i style={{ width: `${concentration}%` }} /></span></div>}
    </div>

    <div className="theme-members-cell">
      <div className="theme-cell-title">포함 종목 <span>({theme.memberCount}) · 거래대금 순</span></div>
      <div className="theme-member-list">
        {members.map((member, index) => <div key={member.symbol ?? index}><b>{index + 1}</b><span>{member.symbol} · {member.name ?? member.englishName ?? ''}</span><strong>{fmtUsdAmount(member.tradingAmount)}</strong></div>)}
      </div>
    </div>

    <UsThemeChart theme={theme} accent={accent} />

    <div className="theme-window-stats">
      <div><span>전일 시작 대비</span><strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.currentValue)}</strong></div>
      <div><span>최근 3시간</span><strong className={(theme.change3h ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.change3h)}</strong></div>
      <div><span>최근 1시간</span><strong className={(theme.change1h ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.change1h)}</strong></div>
    </div>
  </article>
}

export default function UsMarketWorkspace() {
  const [flow, setFlow] = useState<UsThemeFlowResponse>({ ok: false, themes: [], topRankings: [] })

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        const response = await fetch('/api/market/us-theme-flow', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null)
        if (response) {
          const payload = await response.json().catch(() => null) as UsThemeFlowResponse | null
          if (payload) setFlow(payload)
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      } finally {
        timer = window.setTimeout(load, flow.ok ? 30000 : 5000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [flow.ok])

  const rankings = useMemo(() => (flow.topRankings ?? []).filter((item): item is RankingItem & { symbol: string } => Boolean(item.symbol)).slice(0, 50), [flow.topRankings])
  const themes = (flow.themes ?? []).slice(0, 5)
  const topAmount = Math.max(1, rankings[0]?.tradingAmount ?? 1)
  const totalAmount = flow.marketTradingAmount ?? rankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
  const breadth = useMemo(() => usMarketBreadth(rankings), [rankings])
  const leadConcentration = usThemeConcentration(themes[0])
  const regularSession = flow.regularSession
  const afterHours = flow.afterHours
  const regularThemeMap = useMemo(() => new Map((regularSession?.themes ?? []).map((theme) => [theme.name, theme])), [regularSession?.themes])
  const afterThemeMap = useMemo(() => new Map((afterHours?.themes ?? []).map((theme) => [theme.name, theme])), [afterHours?.themes])
  const afterMovers = afterHours?.movers ?? []
  const themeMembership = useMemo(() => {
    const map = new Map<string, { name: string; accent: string }>()
    themes.forEach((theme, themeIndex) => {
      const accent = ACCENTS[themeIndex % ACCENTS.length]
      theme.members.forEach((member) => {
        if (member.symbol && !map.has(member.symbol)) map.set(member.symbol, { name: theme.name, accent })
      })
    })
    return map
  }, [themes])

  return <div className="market-workspace theme-flow-workspace us-theme-workspace">
    <section className="workspace-main">
      <section className="us-session-compare panel" data-testid="us-session-compare">
        <header className="us-session-compare-head">
          <div>
            <p>REGULAR CLOSE → AFTER HOURS</p>
            <h1>전날 밤 정규장 마감과 정규장 이후 변화</h1>
            <small>정규장 상세 데이터는 아래에서 한 번만 보여주고, 여기의 애프터 영역은 16:00 ET 종가를 0% 기준으로 한 이후 실제 가격 변화만 표시합니다.</small>
          </div>
          <div className="us-session-status">
            <span>정규장 {regularSession?.day ? compactDay(regularSession.day) : '-'}</span><b>→</b>
            <span className={afterHours?.active ? 'flow-live' : ''}>애프터 {afterHours?.active ? '진행 중' : afterMovers.length ? '최근 기록' : '수집 대기'}</span>
          </div>
        </header>
        <div className="us-session-compare-grid">
          <div className="us-session-column-head">테마</div>
          <div className="us-session-column-head">정규장 하루</div>
          <div className="us-session-column-head">정규장 이후</div>
          <div className="us-session-column-head">16:00 ET 이후 흐름</div>
          {themes.map((theme, index) => {
            const regular = regularThemeMap.get(theme.name)
            const after = afterThemeMap.get(theme.name)
            const accent = ACCENTS[index % ACCENTS.length]
            return <div className="us-session-compare-row" key={`session-${theme.name}`} style={{ ['--theme-accent' as string]: accent } as CSSProperties}>
              <div className="us-session-theme"><i /><strong>{theme.name}</strong><small>{regular?.memberCount ?? theme.memberCount}종목</small></div>
              <strong className={(regular?.sessionChange ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(regular?.sessionChange)}</strong>
              <div className="us-after-value"><strong className={(after?.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(after?.currentValue)}</strong><small>{after?.observedMemberCount ? `${after.observedMemberCount}종목 실제 샘플` : '변화분만 표시'}</small></div>
              <AfterHoursSparkline points={after?.points ?? []} accent={accent} />
            </div>
          })}
        </div>
        <div className="us-session-foot">
          <span>정규장 마감 <b>{displayKstTime(regularSession?.closedAt)}</b></span>
          <span>애프터 최근 샘플 <b>{displayKstTime(afterHours?.sampledAt)}</b></span>
          <span>애프터 관측 종목 <b>{afterHours?.observedSymbols ?? 0}</b></span>
          <span>애프터 거래대금 <b>표시 안 함 · 검증값 없음</b></span>
        </div>
        {flow.regularSnapshotSource === 'reconstructed-current-ranking' && <div className="us-session-data-note">이번 세션은 정규장 스냅샷 기능 배포 전 데이터라 테마 구성은 현재 랭킹으로 복원했습니다. 다음 정규장부터 16:00 ET 직전 구성이 별도 저장됩니다.</div>}
      </section>

      <section className="theme-strength-board panel" data-testid="us-theme-strength-board">
        <header className="theme-board-head">
          <div>
            <p>US REGULAR SESSION / STOCK TOP 50</p>
            <h1>미국 정규장 기록 <span>(09:30~16:00 ET · ETF/ETN 제외)</span></h1>
            <small>이 영역은 정규장 상황만 보존합니다. TOP50·5개 주도 테마·정규장 1분봉과 정규장 중 실제 30초 가격만 사용하며, 16:00 ET 이후 값은 위 비교 영역과 애프터 변동 목록에만 따로 표시합니다.</small>
          </div>
          <div className="theme-board-controls">
            <span className={flow.ok ? 'flow-live' : 'flow-loading'}>{flow.stage === 'ready' ? '● 30초 실시간' : flow.ok ? '● TOP50 개별주 연결 · 차트 복원 중' : '● 데이터 준비 중'}</span>
            <div className="segmented-control"><button className="active">정규장 2거래일</button><button disabled>3일</button><button disabled>5일</button></div>
          </div>
        </header>

        <div className="theme-saas-summary-bar us-theme-saas-summary-bar" data-testid="us-market-pulse">
          <div className="theme-saas-summary-lead"><span className="theme-saas-kicker">US MARKET PULSE</span><strong>현재 미국 시장 주도 테마 5</strong></div>
          <div className="theme-saas-leaders">
            {themes.slice(0, 3).map((theme, index) => <span className={`theme-saas-leader-chip theme-saas-leader-${index + 1}`} key={theme.name}><b>{index + 1}</b><span>{theme.name}</span><strong>{fmtRate(theme.currentValue)}</strong></span>)}
            {!themes.length && <span className="theme-saas-summary-empty">미국 테마 순위 계산 중</span>}
          </div>
          <div className="theme-saas-summary-metrics">
            <span><small>1위 테마 집중도</small><b>{leadConcentration == null ? '-' : `${leadConcentration.toFixed(1)}%`}</b></span>
            <span><small>TOP50 상승 확산도</small><b>{breadth.percent == null ? '확인 중' : `${breadth.label} · ${breadth.percent.toFixed(0)}%`}</b></span>
            <span><small>TOP50 거래대금</small><b>{fmtUsdAmount(totalAmount)}</b></span>
          </div>
        </div>

        <div className="theme-method-strip"><span>유니버스 <b>ETF/ETN 제외 · 개별주 TOP50</b></span><span>테마 <b>5개 고정 · 거래대금 합계 순</b></span><span>정규장 차트 <b>09:30~16:00 ET만 · 애프터 제외</b></span><span>최신화 <b>30초 · {displayKstTime(flow.liveSampledAt ?? flow.updatedAt)}</b></span></div>

        <div className="theme-strength-list" data-testid="us-fixed-five-themes">
          {themes.map((theme, index) => <UsThemeRow key={theme.name} theme={theme} rank={index + 1} />)}
          {!themes.length && <div className="workspace-empty theme-empty"><strong>미국 TOP50 테마 추세 차트를 준비하고 있습니다.</strong><span>ETF/ETN 제거 → 개별주 TOP50 → 5개 테마 → 실제 1분봉 복원 → 장중 30초 현재가 실시간 샘플 순서로 생성됩니다.</span>{flow.error && <small>{flow.error}</small>}</div>}
        </div>
      </section>

      <section className="market-bottom-strip" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="market-mini-panel panel"><span>정규장 스냅샷 TOP50 거래대금</span><strong>{fmtUsdAmount(totalAmount)}</strong><b>{rankings.length}/50 종목 · ETF/ETN 제외</b></div>
        <div className="market-mini-panel panel"><span>테마 생성 기준</span><strong>TOP50 · 5개 고정</strong><b>3종 이상 우선 · 부족 시 TOP50 내부 후보로 보강</b></div>
        <div className="market-mini-panel panel"><span>중앙 추세 차트</span><strong>30초 실시간 · 90초 완화</strong><b>거래대금 영역 축소 · 과거는 실제 1분봉</b></div>
      </section>
    </section>

    <aside className="top100-rail panel" data-testid="us-top100-ranking">
      <div className="top100-tabs"><button className="active">정규장 거래대금 TOP50</button><button disabled>ETF/ETN 제외</button></div>
      <section className="us-after-movers" data-testid="us-after-hours-movers">
        <div className="us-after-movers-head"><div><p>AFTER HOURS DELTA</p><h3>정규장 이후 변동 종목</h3></div><span>16:00 ET 종가 대비</span></div>
        {afterMovers.slice(0, 10).map((item, index) => <div className="us-after-mover" key={`after-${item.symbol}`}>
          <b>{index + 1}</b>
          <div><strong>{item.symbol} · {item.name}</strong><small>{item.theme} · 종가 {fmtUsdPrice(item.regularClose)} → {fmtUsdPrice(item.afterHoursPrice)}</small></div>
          <strong className={item.afterHoursChangeRate >= 0 ? 'up' : 'down'}>{fmtRate(item.afterHoursChangeRate)}</strong>
        </div>)}
        {!afterMovers.length && <div className="us-after-empty">검증된 16:00 ET 이후 가격 샘플을 기다리고 있습니다. 정규장 데이터를 복사해 채우지 않습니다.</div>}
      </section>
      <div className="top100-head"><div><p>REGULAR SESSION TURNOVER / 1 DAY</p><h2>정규장 거래대금 TOP50 · 개별주만</h2></div><span>{displayKstTime(flow.rankedAt ?? flow.updatedAt)}</span></div>
      <div className="top100-list-head"><span>순위</span><span>종목명</span><span>등락률</span><span>거래대금</span></div>
      <div className="top100-list">
        {rankings.map((item, index) => {
          const amount = item.tradingAmount ?? 0
          const width = amount / topAmount * 100
          const share = totalAmount > 0 ? amount / totalAmount * 100 : null
          const themeInfo = themeMembership.get(item.symbol)
          const rowStyle = {
            ['--top100-heat-alpha' as string]: usTurnoverHeat(amount, topAmount),
            ...(themeInfo ? { ['--top100-theme-accent' as string]: themeInfo.accent } : {}),
          } as CSSProperties
          return <div className={`top100-row${themeInfo ? ' top100-row-themed' : ''}`} style={rowStyle} key={`${item.symbol}-${index}`}>
            <b>{index + 1}</b>
            <div className="top100-stock">
              <strong>{item.symbol} · {item.name ?? item.englishName ?? item.symbol}</strong>
              <small><span className="top100-stock-meta">{item.market ?? 'US'} · {fmtUsdPrice(item.lastPrice)}</span>{themeInfo && <span className="top100-theme-label">{themeInfo.name}</span>}</small>
              <div className="top100-mini-track"><i style={{ width: `${width}%` }} /></div>
            </div>
            <strong className={`top100-rate ${(item.changeRate ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtRate(item.changeRate)}</strong>
            <div className="top100-amount"><strong>{fmtUsdAmount(item.tradingAmount)}</strong><span className="top100-share">TOP50 {fmtShare(share)}</span></div>
          </div>
        })}
        {!rankings.length && <div className="workspace-empty">미국 ETF/ETN 제외 개별주 TOP50 데이터 연결 대기 중</div>}
      </div>
    </aside>
  </div>
}
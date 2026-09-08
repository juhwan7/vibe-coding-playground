import { useEffect, useMemo, useState } from 'react'
import './marketWorkspace.css'

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
  tradingAmount?: number
  memberCount: number
  day: string
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
  rankedAt?: string | null
  marketTradingAmount?: number | null
  topRankings?: RankingItem[]
  themes?: ThemeGroup[]
  error?: string | null
}

const ACCENTS = ['#ff4d6d', '#39a0ff', '#37d67a', '#9d6cff', '#ff9a3d', '#31c6d4', '#f6d365', '#e879f9', '#22c55e', '#f97316']
const SESSION_START = 9 * 60 + 30
const SESSION_MINUTES = 390
const SESSION_TICKS = [570, 630, 690, 750, 810, 870, 930, 960]

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

function displayKstTime(iso?: string | null) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

function usTimeParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 9)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 30)
  return { hour, minute, total: hour * 60 + minute }
}

function etTimeLabel(iso?: string | null) {
  if (!iso) return '-'
  const { hour, minute } = usTimeParts(iso)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
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
  const anchorMinute = usTimeParts(anchor.timestamp).total
  const targetTime = Date.parse(anchor.timestamp) + (targetMinute - anchorMinute) * 60000
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
  return '■'
}

function UsThemeChart({ theme, accent }: { theme: ThemeGroup; accent: string }) {
  const points = theme.points ?? []
  if (points.length < 2) return <div className="theme-chart-empty">미국 전일 + 오늘 1분봉 복원 중</div>

  const width = 900
  const height = 190
  const chartTop = 22
  const chartBottom = 128
  const turnoverTop = 140
  const turnoverBottom = 174
  const days = [...new Set(points.map((point) => point.day))].sort()
  const domainMinutes = Math.max(SESSION_MINUTES, days.length * SESSION_MINUTES)
  const xForPoint = (point: ThemePoint) => {
    const dayIndex = Math.max(0, days.indexOf(point.day))
    const minute = Math.max(0, Math.min(SESSION_MINUTES, usTimeParts(point.timestamp).total - SESSION_START))
    return (dayIndex * SESSION_MINUTES + minute) / domainMinutes * width
  }
  const xForMinute = (dayIndex: number, minute: number) => (dayIndex * SESSION_MINUTES + (minute - SESSION_START)) / domainMinutes * width

  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = Math.max(.35, (max - min) * .15)
  const lo = min - pad
  const hi = max + pad
  const range = Math.max(.01, hi - lo)
  const y = (value: number) => chartBottom - ((value - lo) / range) * (chartBottom - chartTop)
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xForPoint(point).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ')
  const maxTurnover = Math.max(1, ...points.map((point) => point.tradingAmount ?? 0))
  const turnoverPeak = points.reduce<ThemePoint | null>((best, point) => !best || (point.tradingAmount ?? 0) > (best.tradingAmount ?? 0) ? point : best, null)
  let risePeak: { point: ThemePoint; delta: number } | null = null
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].day !== points[index - 1].day) continue
    const delta = points[index].value - points[index - 1].value
    if (!risePeak || delta > risePeak.delta) risePeak = { point: points[index], delta }
  }

  return <div className="theme-chart-wrap" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-chart-title">
      <span className="theme-chart-name">테마 평균 3분 차트 · ET / KST</span>
      <div className="theme-chart-metrics">
        <span>최대 3분 거래대금 <b>{etTimeLabel(turnoverPeak?.timestamp)} ET · {fmtUsdAmount(turnoverPeak?.tradingAmount)}</b></span>
        <span>최대 3분 상승 <b>{etTimeLabel(risePeak?.point.timestamp)} ET · {fmtRate(risePeak?.delta)}</b></span>
      </div>
    </div>
    <svg className="theme-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${theme.name} 미국 거래대금 상위50 포함종목 전일과 오늘 3분 평균 차트`}>
      {[.25, .5, .75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={chartTop + (chartBottom - chartTop) * ratio} y2={chartTop + (chartBottom - chartTop) * ratio} className="theme-chart-grid" />)}
      {lo < 0 && hi > 0 && <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="theme-zero-line" />}
      {days.flatMap((day, dayIndex) => SESSION_TICKS.map((minute) => ({ day, dayIndex, minute }))).map((tick) => {
        const x = xForMinute(tick.dayIndex, tick.minute)
        const et = `${String(Math.floor(tick.minute / 60)).padStart(2, '0')}:${String(tick.minute % 60).padStart(2, '0')}`
        const kst = kstTickLabel(points, tick.day, tick.minute)
        return <g key={`${tick.day}-${tick.minute}`}>
          <line x1={x} x2={x} y1={chartTop} y2={turnoverBottom} className={tick.minute === SESSION_START ? 'theme-day-line' : 'theme-hour-line'} />
          <text x={Math.min(width - 62, x + 3)} y="187" className="theme-hour-label">{et}/{kst}</text>
        </g>
      })}
      {days.slice(1).map((day, index) => {
        const x = xForMinute(index + 1, SESSION_START)
        return <g key={day}><line x1={x} x2={x} y1="0" y2={height} className="theme-day-separator" /><text x={x + 6} y="15" className="theme-day-label">{compactDay(day)} 오늘</text></g>
      })}
      <text x="4" y="15" className="theme-day-label">{compactDay(days[0])} 전일 · 미국 동부시간</text>
      <text x="4" y={turnoverTop - 3} className="theme-turnover-label">3분 거래대금(USD)</text>
      {points.map((point) => {
        const x = xForPoint(point)
        const barHeight = Math.max(1, ((point.tradingAmount ?? 0) / maxTurnover) * (turnoverBottom - turnoverTop))
        return <rect key={`${point.timestamp}-amount`} x={Math.max(0, x - 1.2)} y={turnoverBottom - barHeight} width="2.4" height={barHeight} className="theme-volume-bar"><title>{`${compactDay(point.day)} ${etTimeLabel(point.timestamp)} ET · KST ${displayKstTime(point.timestamp)} · 평균 ${fmtRate(point.value)} · 3분 거래대금 ${fmtUsdAmount(point.tradingAmount)}`}</title></rect>
      })}
      <path d={path} className="theme-price-line" />
      {points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 80)) === 0).map((point) => <circle key={`${point.timestamp}-c`} cx={xForPoint(point)} cy={y(point.value)} r="1.7" className="theme-price-dot"><title>{`${compactDay(point.day)} ${etTimeLabel(point.timestamp)} ET · ${fmtRate(point.value)}`}</title></circle>)}
    </svg>
  </div>
}

function UsThemeRow({ theme, rank }: { theme: ThemeGroup; rank: number }) {
  const accent = ACCENTS[(rank - 1) % ACCENTS.length]
  const members = [...theme.members].sort((a, b) => (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0)).slice(0, 7)
  return <article className="theme-strength-row" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-summary-cell">
      <div className="theme-rank-line"><b>{rank}</b><span className="theme-icon">{themeIcon(theme.name)}</span><h2>{theme.name}</h2></div>
      <p>{theme.memberCount}개 종목 · 미국 거래대금 50위 내</p>
      <strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.currentValue)}</strong>
      <div><span>1일 누적 거래대금 합계</span><b>{fmtUsdAmount(theme.tradingAmount)}</b></div>
    </div>

    <div className="theme-members-cell">
      <div className="theme-cell-title">포함 종목 <span>({theme.memberCount})</span></div>
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
        timer = window.setTimeout(load, flow.ok ? 60000 : 5000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [flow.ok])

  const rankings = useMemo(() => (flow.topRankings ?? []).filter((item): item is RankingItem & { symbol: string } => Boolean(item.symbol)).slice(0, 100), [flow.topRankings])
  const themes = flow.themes ?? []
  const topAmount = Math.max(1, rankings[0]?.tradingAmount ?? 1)
  const totalAmount = flow.marketTradingAmount ?? rankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)

  return <div className="market-workspace theme-flow-workspace us-theme-workspace">
    <section className="workspace-main">
      <section className="theme-strength-board panel" data-testid="us-theme-strength-board">
        <header className="theme-board-head">
          <div>
            <p>US THEME ROTATION / TOP 50</p>
            <h1>미국 테마 강도 비교 <span>(1일 누적 거래대금 상위 50 기준)</span></h1>
            <small>미국 거래대금 상위 50종목에서 같은 테마가 3종 이상일 때 표시합니다. 전일과 오늘 정규장 1분봉을 Raspberry Pi에 저장·복원하고, 구성종목을 기준시점 0%로 정규화해 3분 평균 수익률과 3분 거래대금을 함께 표시합니다.</small>
          </div>
          <div className="theme-board-controls">
            <span className={flow.ok ? 'flow-live' : 'flow-loading'}>{flow.stage === 'ready' ? '● 1분 최신화' : flow.ok ? '● TOP100 연결 · 차트 복원 중' : '● 데이터 준비 중'}</span>
            <div className="segmented-control"><button className="active">전일 + 오늘</button><button disabled>3일</button><button disabled>5일</button></div>
          </div>
        </header>

        <div className="theme-method-strip"><span>선정조건 <b>미국 TOP50 내 3종+</b></span><span>정렬 <b>테마 거래대금 합계</b></span><span>차트 <b>정규장 3분 평균 · ET/KST</b></span><span>최신화 <b>1분 · {displayKstTime(flow.updatedAt)}</b></span></div>

        <div className="theme-strength-list">
          {themes.map((theme, index) => <UsThemeRow key={theme.name} theme={theme} rank={index + 1} />)}
          {!themes.length && <div className="workspace-empty theme-empty"><strong>미국 테마 평균 차트를 준비하고 있습니다.</strong><span>미국 거래대금 TOP100 → 종목명 확인 → TOP50 내 같은 테마 3종 이상 → 전일·오늘 정규장 1분봉 복원 → 3분 평균 계산 순서로 생성됩니다.</span>{flow.error && <small>{flow.error}</small>}</div>}
        </div>
      </section>

      <section className="market-bottom-strip" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="market-mini-panel panel"><span>미국 TOP100 1일 누적 거래대금</span><strong>{fmtUsdAmount(totalAmount)}</strong><b>{rankings.length}/100 종목</b></div>
        <div className="market-mini-panel panel"><span>테마 생성 기준</span><strong>TOP50 · 3종+</strong><b>테마별 거래대금 합계 순</b></div>
        <div className="market-mini-panel panel"><span>차트 시간</span><strong>09:30~16:00 ET</strong><b>1분봉 저장 → 3분 평균 · KST 병기</b></div>
      </section>
    </section>

    <aside className="top100-rail panel" data-testid="us-top100-ranking">
      <div className="top100-tabs"><button className="active">미국 1일 거래대금 TOP100</button><button disabled>테마 요약</button></div>
      <div className="top100-head"><div><p>US MARKET TURNOVER / 1 DAY</p><h2>미국 거래대금 TOP100</h2></div><span>{displayKstTime(flow.rankedAt ?? flow.updatedAt)}</span></div>
      <div className="top100-list-head"><span>순위</span><span>종목명</span><span>등락률</span><span>거래대금</span></div>
      <div className="top100-list">
        {rankings.map((item, index) => {
          const amount = item.tradingAmount ?? 0
          const width = amount / topAmount * 100
          return <div className="top100-row" key={`${item.symbol}-${index}`}>
            <b>{index + 1}</b>
            <div className="top100-stock"><strong>{item.symbol} · {item.name ?? item.englishName ?? item.symbol}</strong><small>{item.market ?? 'US'} · {fmtUsdPrice(item.lastPrice)}</small><div className="top100-mini-track"><i style={{ width: `${width}%` }} /></div></div>
            <strong className={`top100-rate ${(item.changeRate ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtRate(item.changeRate)}</strong>
            <strong className="top100-amount">{fmtUsdAmount(item.tradingAmount)}</strong>
          </div>
        })}
        {!rankings.length && <div className="workspace-empty">미국 TOP100 데이터 연결 대기 중</div>}
      </div>
    </aside>
  </div>
}

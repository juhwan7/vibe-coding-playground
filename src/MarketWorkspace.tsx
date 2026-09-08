import { useEffect, useMemo, useState } from 'react'
import MarketDashboard from './MarketDashboard'
import './marketWorkspace.css'

type RankingItem = {
  symbol: string | null
  name: string | null
  market: string | null
  lastPrice: number | null
  changeRate: number | null
  tradingAmount: number | null
  tradingVolume: number | null
}

type IndexPoint = { lastPrice?: number | null; changeRate?: number | null }
type InvestorTotal = { foreignerNetBuyAmount?: number | null; institutionNetBuyAmount?: number | null }

type Snapshot = {
  ok?: boolean
  updatedAt?: string
  topRankings?: RankingItem[]
  marketTradingAmount?: number | null
  indices?: { KOSPI?: IndexPoint; KOSDAQ?: IndexPoint }
  marketInvestors?: { total?: InvestorTotal | null } | null
}

type ThemePoint = {
  timestamp: string
  value: number
  volume: number
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

type ThemeFlowResponse = {
  ok?: boolean
  updatedAt?: string | null
  sourceUpdatedAt?: string | null
  topRankings?: RankingItem[]
  themes?: ThemeGroup[]
  error?: string | null
}

const ACCENTS = ['#ff4d6d', '#39a0ff', '#37d67a', '#9d6cff', '#ff9a3d', '#31c6d4', '#f6d365']

function fmtAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(value >= 10_000_000_000_000 ? 1 : 2)}조`
  if (value >= 100_000_000) return `${Math.round(value / 100_000_000).toLocaleString()}억`
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString()}만`
  return Math.round(value).toLocaleString()
}

function fmtRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function fmtWon(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(2)}조`
  if (abs >= 100_000_000) return `${sign}${Math.round(abs / 100_000_000).toLocaleString()}억`
  return `${sign}${Math.round(abs).toLocaleString()}원`
}

function displayTime(iso?: string | null) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso))
}

function compactDay(day?: string | null) {
  if (!day) return '-'
  const [, month, date] = day.split('-')
  return `${month}/${date}`
}

function themeIcon(name: string) {
  if (name === '반도체') return '▦'
  if (name === '원전') return '◉'
  if (name === '전력기기') return 'ϟ'
  if (name === '2차전지') return '▣'
  if (name === '바이오') return '◆'
  if (name === '방산') return '✦'
  if (name === '조선') return '◈'
  if (name === '자동차') return '◇'
  if (name === '금융') return '▥'
  if (name === '로봇') return '⌘'
  return '●'
}

function ThemeChart({ theme, accent }: { theme: ThemeGroup; accent: string }) {
  const points = theme.points ?? []
  if (points.length < 2) return <div className="theme-chart-empty">3분봉 데이터 수집 중</div>

  const width = 720
  const height = 154
  const chartTop = 10
  const chartBottom = 116
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = Math.max(.35, (max - min) * .15)
  const lo = min - pad
  const hi = max + pad
  const range = Math.max(.01, hi - lo)
  const maxVolume = Math.max(1, ...points.map((point) => point.volume || 0))
  const x = (index: number) => index / Math.max(1, points.length - 1) * width
  const y = (value: number) => chartBottom - ((value - lo) / range) * (chartBottom - chartTop)
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ')

  const dayBreaks: Array<{ index: number; day: string }> = []
  points.forEach((point, index) => {
    if (index === 0 || point.day !== points[index - 1].day) dayBreaks.push({ index, day: point.day })
  })

  return <div className="theme-chart-wrap" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-chart-title">테마 평균 차트 <span>3분봉</span></div>
    <svg className="theme-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${theme.name} 거래대금 상위50 포함종목 3분 평균 차트`}>
      {[.25, .5, .75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={chartTop + (chartBottom - chartTop) * ratio} y2={chartTop + (chartBottom - chartTop) * ratio} className="theme-chart-grid" />)}
      {lo < 0 && hi > 0 && <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="theme-zero-line" />}
      {dayBreaks.slice(1).map(({ index, day }) => <g key={`${day}-${index}`}><line x1={x(index)} x2={x(index)} y1="0" y2={height} className="theme-day-line" /><text x={x(index) + 8} y="16" className="theme-day-label">{compactDay(day)}</text></g>)}
      {points.map((point, index) => {
        const barHeight = Math.max(1, (point.volume / maxVolume) * 26)
        return <rect key={`${point.timestamp}-v`} x={Math.max(0, x(index) - 1)} y={height - barHeight} width="2.2" height={barHeight} className="theme-volume-bar" />
      })}
      <path d={path} className="theme-price-line" />
      {points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 70)) === 0).map((point, index) => <circle key={`${point.timestamp}-c`} cx={x(points.indexOf(point))} cy={y(point.value)} r="1.8" className="theme-price-dot" />)}
    </svg>
    <div className="theme-chart-axis"><span>{compactDay(points[0]?.day)}</span><span>전일 포함</span><span>{compactDay(points.at(-1)?.day)}</span></div>
  </div>
}

function ThemeRow({ theme, rank }: { theme: ThemeGroup; rank: number }) {
  const accent = ACCENTS[(rank - 1) % ACCENTS.length]
  const members = [...theme.members].sort((a, b) => (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0)).slice(0, 7)
  return <article className="theme-strength-row" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-summary-cell">
      <div className="theme-rank-line"><b>{rank}</b><span className="theme-icon">{themeIcon(theme.name)}</span><h2>{theme.name}</h2></div>
      <p>{theme.memberCount}개 종목 · 거래대금 50위 내</p>
      <strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.currentValue)}</strong>
      <div><span>거래대금 합계</span><b>{fmtAmount(theme.tradingAmount)}</b></div>
    </div>

    <div className="theme-members-cell">
      <div className="theme-cell-title">포함 종목 <span>({theme.memberCount})</span></div>
      <div className="theme-member-list">
        {members.map((member, index) => <div key={member.symbol ?? index}><b>{index + 1}</b><span>{member.name ?? member.symbol}</span><strong>{fmtAmount(member.tradingAmount)}</strong></div>)}
      </div>
    </div>

    <ThemeChart theme={theme} accent={accent} />

    <div className="theme-window-stats">
      <div><span>24H</span><strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.currentValue)}</strong></div>
      <div><span>3H</span><strong className={(theme.change3h ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.change3h)}</strong></div>
      <div><span>1H</span><strong className={(theme.change1h ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.change1h)}</strong></div>
    </div>
  </article>
}

export default function MarketWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [themeFlow, setThemeFlow] = useState<ThemeFlowResponse>({ ok: false, themes: [], topRankings: [] })

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    let themeTick = 0
    const load = async () => {
      try {
        const snapshotResponse = await fetch('/api/market/snapshot', { signal: controller.signal, headers: { Accept: 'application/json' } })
        if (snapshotResponse.ok) setSnapshot(await snapshotResponse.json() as Snapshot)
        if (themeTick % 3 === 0) {
          const themeResponse = await fetch('/api/market/theme-flow', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null)
          if (themeResponse) {
            const payload = await themeResponse.json().catch(() => null) as ThemeFlowResponse | null
            if (payload) setThemeFlow(payload)
          }
        }
        themeTick += 1
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      } finally {
        timer = window.setTimeout(load, 5000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const rankings = useMemo(() => {
    const enriched = themeFlow.topRankings?.length ? themeFlow.topRankings : snapshot?.topRankings ?? []
    return enriched.filter((item): item is RankingItem & { symbol: string } => Boolean(item.symbol)).slice(0, 100)
  }, [themeFlow.topRankings, snapshot?.topRankings])
  const themes = themeFlow.themes ?? []
  const topAmount = Math.max(1, rankings[0]?.tradingAmount ?? 1)
  const totalAmount = snapshot?.marketTradingAmount ?? rankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
  const investors = snapshot?.marketInvestors?.total
  const kospi = snapshot?.indices?.KOSPI
  const kosdaq = snapshot?.indices?.KOSDAQ

  return <div className="market-workspace theme-flow-workspace">
    <section className="workspace-main">
      <section className="theme-strength-board panel" data-testid="theme-strength-board">
        <header className="theme-board-head">
          <div>
            <p>THEME ROTATION / TOP 50</p>
            <h1>테마 강도 비교 <span>(거래대금 상위 50 기준)</span></h1>
            <small>거래대금 상위 50종목 중 같은 테마가 3종 이상일 때 표시합니다. 구성종목별 가격을 기준시점 0%로 정규화한 뒤 3분 단위 수익률을 단순평균합니다.</small>
          </div>
          <div className="theme-board-controls">
            <span className={themeFlow.ok ? 'flow-live' : 'flow-loading'}>{themeFlow.ok ? '● LIVE 3MIN' : '● 3분봉 준비 중'}</span>
            <div className="segmented-control"><button className="active">전일 포함(24H)</button><button disabled>3일</button><button disabled>5일</button></div>
          </div>
        </header>

        <div className="theme-method-strip"><span>선정조건 <b>TOP50 내 3종+</b></span><span>정렬 <b>테마별 거래대금 합계</b></span><span>차트 <b>3분 평균 수익률</b></span><span>업데이트 <b>{displayTime(themeFlow.updatedAt)}</b></span></div>

        <div className="theme-strength-list">
          {themes.map((theme, index) => <ThemeRow key={theme.name} theme={theme} rank={index + 1} />)}
          {!themes.length && <div className="workspace-empty theme-empty"><strong>테마 평균 차트를 준비하고 있습니다.</strong><span>TOP50 종목명 확인 → 테마 3종 이상 묶음 → 1분봉 수집 → 3분 평균 계산 순서로 생성됩니다.</span>{themeFlow.error && <small>{themeFlow.error}</small>}</div>}
        </div>
      </section>

      <section className="market-bottom-strip">
        <div className="market-mini-panel panel"><span>코스피</span><strong>{kospi?.lastPrice?.toLocaleString() ?? '-'}</strong><b className={(kospi?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(kospi?.changeRate)}</b></div>
        <div className="market-mini-panel panel"><span>코스닥</span><strong>{kosdaq?.lastPrice?.toLocaleString() ?? '-'}</strong><b className={(kosdaq?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(kosdaq?.changeRate)}</b></div>
        <div className="market-mini-panel panel"><span>TOP100 거래대금</span><strong>{fmtAmount(totalAmount)}</strong><b>{rankings.length}/100 종목</b></div>
        <div className="market-mini-panel panel"><span>외국인 현물 순매수</span><strong className={(investors?.foreignerNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtWon(investors?.foreignerNetBuyAmount)}</strong><b>코스피+코스닥</b></div>
        <div className="market-mini-panel panel"><span>기관 현물 순매수</span><strong className={(investors?.institutionNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtWon(investors?.institutionNetBuyAmount)}</strong><b>코스피+코스닥</b></div>
      </section>

      <details className="deep-market-details panel">
        <summary><span><b>시장 전체 상세 대시보드</b><small>시장지도 · 동시간 비교 · 프로그램 · 수급 · 종목 상세</small></span><strong>펼치기 / 접기</strong></summary>
        <div className="deep-market-body"><MarketDashboard /></div>
      </details>
    </section>

    <aside className="top100-rail panel" data-testid="top100-ranking">
      <div className="top100-tabs"><button className="active">거래대금 TOP100</button><button disabled>테마 요약</button></div>
      <div className="top100-head"><div><p>MARKET TURNOVER</p><h2>거래대금 TOP100</h2></div><span>{displayTime(snapshot?.updatedAt)}</span></div>
      <div className="top100-list-head"><span>순위</span><span>종목명</span><span>등락률</span><span>거래대금</span></div>
      <div className="top100-list">
        {rankings.map((item, index) => {
          const amount = item.tradingAmount ?? 0
          const width = amount / topAmount * 100
          return <div className="top100-row" key={`${item.symbol}-${index}`}>
            <b>{index + 1}</b>
            <div className="top100-stock"><strong>{item.name ?? item.symbol}</strong><small>{item.symbol} · {item.lastPrice?.toLocaleString() ?? '-'}</small><div className="top100-mini-track"><i style={{ width: `${width}%` }} /></div></div>
            <strong className={`top100-rate ${(item.changeRate ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtRate(item.changeRate)}</strong>
            <strong className="top100-amount">{fmtAmount(item.tradingAmount)}</strong>
          </div>
        })}
        {!rankings.length && <div className="workspace-empty">TOP100 실시간 데이터 연결 대기 중</div>}
      </div>
    </aside>
  </div>
}

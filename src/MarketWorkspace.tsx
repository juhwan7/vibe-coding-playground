import { useEffect, useMemo, useRef, useState } from 'react'
import MarketDashboard from './MarketDashboard'
import ThemeAverageCandleChart from './ThemeAverageCandleChart'
import './marketWorkspace.css'
import './marketWorkspaceEnhancements.css'

type RankingItem = {
  symbol: string | null
  name: string | null
  market: string | null
  securityType?: string | null
  isCommonShare?: boolean | null
  status?: string | null
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
  marketTradingAmountCoverage?: string | null
  indices?: { KOSPI?: IndexPoint; KOSDAQ?: IndexPoint }
  marketInvestors?: { total?: InvestorTotal | null } | null
}

type ThemePoint = {
  timestamp: string
  value: number
  openValue?: number | null
  highValue?: number | null
  lowValue?: number | null
  closeValue?: number | null
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
  selectionBasis?: string | null
  rankingLimit?: number | null
}

type ThemeFlowResponse = {
  ok?: boolean
  updatedAt?: string | null
  sourceUpdatedAt?: string | null
  topRankings?: RankingItem[]
  themes?: ThemeGroup[]
  filteredOutCount?: number
  error?: string | null
}

type StockCandlePoint = {
  timestamp: string
  day?: string | null
  openPrice: number
  highPrice: number
  lowPrice: number
  closePrice: number
  volume?: number
  tradingAmount?: number
}

type StockChartPayload = {
  ok?: boolean
  symbol?: string | null
  name?: string | null
  market?: string | null
  interval?: string | null
  day?: string | null
  updatedAt?: string | null
  source?: string | null
  points?: StockCandlePoint[]
  error?: string | null
}

const ACCENTS = ['#ff4d6d', '#39a0ff', '#37d67a', '#9d6cff']
const SESSION_START = 8 * 60
const SESSION_MINUTES = 12 * 60
const NON_STOCK_NAME = /(ETF|ETN|KODEX|TIGER|RISE|ACE|PLUS|SOL|HANARO|KOSEF|TIMEFOLIO|ARIRANG|FOCUS|KBSTAR|리츠|스팩|인프라)/i

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

function isIndividualStock(item: RankingItem) {
  const type = String(item.securityType ?? '').toUpperCase()
  if (type) return type === 'STOCK'
  return !NON_STOCK_NAME.test(String(item.name ?? ''))
}

function StockCandleChart({ payload, accent }: { payload: StockChartPayload; accent: string }) {
  const points = payload.points ?? []
  if (!points.length) return <div className="theme-stock-preview-loading"><strong>{payload.name ?? payload.symbol} 3분봉 없음</strong><span>{payload.error ?? '저장된 3분봉을 아직 준비하지 못했습니다.'}</span></div>

  const width = 900
  const height = 190
  const chartTop = 24
  const chartBottom = 146
  const prices = points.flatMap((point) => [point.lowPrice, point.highPrice]).filter(Number.isFinite)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const rawRange = Math.max(0, maxPrice - minPrice)
  const visibleRange = Math.max(rawRange, Math.max(1, Math.abs((maxPrice + minPrice) / 2) * .002))
  const center = (maxPrice + minPrice) / 2
  const pad = visibleRange * .08
  const lo = center - visibleRange / 2 - pad
  const hi = center + visibleRange / 2 + pad
  const range = Math.max(1, hi - lo)
  const y = (price: number) => chartBottom - ((price - lo) / range) * (chartBottom - chartTop)
  const x = (point: StockCandlePoint) => Math.max(0, Math.min(width, (timeParts(point.timestamp).total - SESSION_START) / SESSION_MINUTES * width))
  const candleWidth = Math.max(1.8, Math.min(5.5, width / Math.max(1, points.length) * .72))
  const first = points[0]
  const last = points.at(-1)!
  const dayChange = first.openPrice ? (last.closePrice / first.openPrice - 1) * 100 : null
  const ticks = [8, 10, 12, 14, 16, 18, 20]

  return <div className="theme-chart-wrap" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-chart-title">
      <span className="theme-chart-name">{payload.name ?? payload.symbol} 3분봉 <span className="theme-stock-preview-badge">5초 미리보기</span></span>
      <div className="theme-chart-metrics">
        <span>현재가 <b>{last.closePrice.toLocaleString()}</b></span>
        <span>장 시작 대비 <b>{fmtRate(dayChange)}</b></span>
      </div>
    </div>
    <svg className="theme-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${payload.name ?? payload.symbol} 당일 3분봉 차트`}>
      {[.25, .5, .75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={chartTop + (chartBottom - chartTop) * ratio} y2={chartTop + (chartBottom - chartTop) * ratio} className="theme-chart-grid" />)}
      {ticks.map((hour) => {
        const tx = (hour - 8) / 12 * width
        return <g key={hour}><line x1={tx} x2={tx} y1={chartTop} y2={chartBottom} className={hour === 8 ? 'theme-day-line' : 'theme-hour-line'} /><text x={Math.min(width - 30, tx + 3)} y="182" className="theme-hour-label">{String(hour).padStart(2, '0')}:00</text></g>
      })}
      <text x="4" y="15" className="theme-day-label">{compactDay(payload.day)} · 3분 OHLC</text>
      <text x={width - 5} y={chartTop + 8} textAnchor="end" className="theme-candle-price-label">{Math.round(hi).toLocaleString()}</text>
      <text x={width - 5} y={chartBottom - 3} textAnchor="end" className="theme-candle-price-label">{Math.round(lo).toLocaleString()}</text>
      {points.map((point) => {
        const cx = x(point)
        const openY = y(point.openPrice)
        const closeY = y(point.closePrice)
        const highY = y(point.highPrice)
        const lowY = y(point.lowPrice)
        const direction = point.closePrice >= point.openPrice ? 'up' : 'down'
        const bodyY = Math.min(openY, closeY)
        const bodyHeight = Math.max(1.2, Math.abs(closeY - openY))
        return <g key={point.timestamp}>
          <line x1={cx} x2={cx} y1={highY} y2={lowY} className={`theme-candle-wick ${direction}`} />
          <rect x={cx - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} className={`theme-candle-body ${direction}`}>
            <title>{`${timeLabel(point.timestamp)} · 시 ${point.openPrice.toLocaleString()} 고 ${point.highPrice.toLocaleString()} 저 ${point.lowPrice.toLocaleString()} 종 ${point.closePrice.toLocaleString()}`}</title>
          </rect>
        </g>
      })}
    </svg>
  </div>
}

function ThemeRow({ theme, rank }: { theme: ThemeGroup; rank: number }) {
  const accent = ACCENTS[(rank - 1) % ACCENTS.length]
  const members = [...theme.members].filter(isIndividualStock).sort((a, b) => (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0)).slice(0, 7)
  const [stockPreview, setStockPreview] = useState<StockChartPayload | null>(null)
  const [previewLoadingName, setPreviewLoadingName] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewTimer = useRef<number | null>(null)
  const requestSequence = useRef(0)

  useEffect(() => () => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current)
  }, [])

  const showStockChart = async (member: RankingItem) => {
    if (!member.symbol) return
    requestSequence.current += 1
    const sequence = requestSequence.current
    if (previewTimer.current) window.clearTimeout(previewTimer.current)
    setStockPreview(null)
    setPreviewError(null)
    setPreviewLoadingName(member.name ?? member.symbol)
    try {
      const response = await fetch(`/api/market/theme-stock-chart?symbol=${encodeURIComponent(member.symbol)}`, { headers: { Accept: 'application/json' } })
      const payload = await response.json().catch(() => null) as StockChartPayload | null
      if (sequence !== requestSequence.current) return
      if (!payload?.ok || !payload.points?.length) {
        setPreviewError(payload?.error ?? '저장된 3분봉을 아직 불러오지 못했습니다.')
        previewTimer.current = window.setTimeout(() => setPreviewError(null), 2500)
        return
      }
      setStockPreview(payload)
      previewTimer.current = window.setTimeout(() => {
        setStockPreview(null)
        setPreviewError(null)
      }, 5000)
    } catch (error) {
      if (sequence !== requestSequence.current) return
      setPreviewError(error instanceof Error ? error.message : String(error))
      previewTimer.current = window.setTimeout(() => setPreviewError(null), 2500)
    } finally {
      if (sequence === requestSequence.current) setPreviewLoadingName(null)
    }
  }

  return <article className="theme-strength-row" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-summary-cell">
      <div className="theme-rank-line"><b>{rank}</b><span className="theme-icon">{themeIcon(theme.name)}</span><h2>{theme.name}</h2></div>
      <p>{theme.memberCount}개 개별주 · {theme.selectionBasis ?? 'TOP50 3종+'}</p>
      <strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.currentValue)}</strong>
      <div><span>1일 누적 거래대금 합계</span><b>{fmtAmount(theme.tradingAmount)}</b></div>
    </div>

    <div className="theme-members-cell">
      <div className="theme-cell-title">포함 개별주 <span>({theme.memberCount}) · 클릭 시 3분봉 5초</span></div>
      <div className="theme-member-list">
        {members.map((member, index) => <button key={member.symbol ?? index} type="button" onClick={() => void showStockChart(member)} title={`${member.name ?? member.symbol} 3분봉 5초 보기`}>
          <b>{index + 1}</b><span>{member.name ?? member.symbol}</span><strong>{fmtAmount(member.tradingAmount)}</strong>
        </button>)}
      </div>
    </div>

    {previewLoadingName
      ? <div className="theme-stock-preview-loading"><strong>{previewLoadingName} 3분봉 불러오는 중</strong><span>Pi에 저장된 1분봉을 3분봉으로 묶어 표시합니다.</span></div>
      : stockPreview
        ? <StockCandleChart payload={stockPreview} accent={accent} />
        : previewError
          ? <div className="theme-stock-preview-loading"><strong>3분봉을 표시하지 못했습니다.</strong><span>{previewError}</span></div>
          : <ThemeAverageCandleChart theme={theme} accent={accent} />}

    <div className="theme-window-stats">
      <div><span>전일 시작 대비</span><strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.currentValue)}</strong></div>
      <div><span>최근 3시간</span><strong className={(theme.change3h ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.change3h)}</strong></div>
      <div><span>최근 1시간</span><strong className={(theme.change1h ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(theme.change1h)}</strong></div>
    </div>
  </article>
}

export default function MarketWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [themeFlow, setThemeFlow] = useState<ThemeFlowResponse>({ ok: false, themes: [], topRankings: [] })

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        const [snapshotResponse, themeResponse] = await Promise.all([
          fetch('/api/market/snapshot', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
          fetch('/api/market/theme-flow', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
        ])
        if (snapshotResponse?.ok) setSnapshot(await snapshotResponse.json() as Snapshot)
        if (themeResponse) {
          const payload = await themeResponse.json().catch(() => null) as ThemeFlowResponse | null
          if (payload) setThemeFlow(payload)
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      } finally {
        timer = window.setTimeout(load, 10000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const rankings = useMemo(() => {
    const metadata = new Map((themeFlow.topRankings ?? []).filter((item) => item.symbol).map((item) => [item.symbol, item]))
    const live = snapshot?.topRankings?.length ? snapshot.topRankings : themeFlow.topRankings ?? []
    return live
      .map((item) => {
        const meta = item.symbol ? metadata.get(item.symbol) : null
        return meta ? { ...meta, ...item, securityType: meta.securityType ?? item.securityType } : item
      })
      .filter((item): item is RankingItem & { symbol: string } => Boolean(item.symbol) && isIndividualStock(item))
      .slice(0, 100)
  }, [themeFlow.topRankings, snapshot?.topRankings])
  const themes = (themeFlow.themes ?? []).slice(0, 4)
  const topAmount = Math.max(1, rankings[0]?.tradingAmount ?? 1)
  const totalAmount = rankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
  const investors = snapshot?.marketInvestors?.total
  const kospi = snapshot?.indices?.KOSPI
  const kosdaq = snapshot?.indices?.KOSDAQ

  return <div className="market-workspace theme-flow-workspace">
    <section className="workspace-main">
      <section className="theme-strength-board panel" data-testid="theme-strength-board">
        <header className="theme-board-head">
          <div>
            <p>THEME ROTATION / INDIVIDUAL STOCKS</p>
            <h1>테마 강도 비교 <span>(개별주식 거래대금 기준 · 4개 유지)</span></h1>
            <small>ETF·ETN·리츠 등 비개별주 상품은 제외합니다. 거래대금·현재가·등락률은 장중 10초마다 갱신하고, 테마 구성종목과 저장 1분봉은 1분 단위로 재계산합니다. 평균 차트는 실제 3분 OHLC를 사용하며 Y축만 자동 확대해 작은 평균 움직임도 잘 보이게 합니다.</small>
          </div>
          <div className="theme-board-controls">
            <span className={themeFlow.ok ? 'flow-live' : 'flow-loading'}>{themeFlow.ok ? '● 거래대금 10초 최신화' : '● 데이터 준비 중'}</span>
            <div className="segmented-control"><button className="active">전일 + 오늘</button><button disabled>3일</button><button disabled>5일</button></div>
          </div>
        </header>

        <div className="theme-method-strip"><span>대상 <b>개별주(STOCK)만</b></span><span>테마 <b>4개 · 강도순 자동교체</b></span><span>차트 <b>평균 3분 캔들 · 자동 확대축</b></span><span>최신화 <b>10초 · {displayTime(themeFlow.updatedAt)}</b></span></div>

        <div className="theme-strength-list">
          {themes.map((theme, index) => <ThemeRow key={theme.name} theme={theme} rank={index + 1} />)}
          {Array.from({ length: Math.max(0, 4 - themes.length) }, (_, index) => <div className="theme-strength-placeholder" key={`placeholder-${index}`}>테마 {themes.length + index + 1} 후보 계산 중 · 개별주 데이터가 확보되면 자동 채움</div>)}
        </div>
      </section>

      <section className="market-bottom-strip">
        <div className="market-mini-panel panel"><span>코스피</span><strong>{kospi?.lastPrice?.toLocaleString() ?? '-'}</strong><b className={(kospi?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(kospi?.changeRate)}</b></div>
        <div className="market-mini-panel panel"><span>코스닥</span><strong>{kosdaq?.lastPrice?.toLocaleString() ?? '-'}</strong><b className={(kosdaq?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(kosdaq?.changeRate)}</b></div>
        <div className="market-mini-panel panel"><span>거래대금 상위100 중 개별주 합계</span><strong>{fmtAmount(totalAmount)}</strong><b>{rankings.length}/100 종목 · ETF·ETN 등 제외</b></div>
        <div className="market-mini-panel panel"><span>외국인 현물 순매수</span><strong className={(investors?.foreignerNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtWon(investors?.foreignerNetBuyAmount)}</strong><b>코스피+코스닥</b></div>
        <div className="market-mini-panel panel"><span>기관 현물 순매수</span><strong className={(investors?.institutionNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtWon(investors?.institutionNetBuyAmount)}</strong><b>코스피+코스닥</b></div>
      </section>

      <details className="deep-market-details panel">
        <summary><span><b>시장 전체 상세 대시보드</b><small>시장지도 · 동시간 비교 · 프로그램 · 수급 · 종목 상세</small></span><strong>펼치기 / 접기</strong></summary>
        <div className="deep-market-body"><MarketDashboard /></div>
      </details>
    </section>

    <aside className="top100-rail panel" data-testid="top100-ranking">
      <div className="top100-tabs"><button className="active">1일 거래대금 · 개별주</button><button disabled>테마 요약</button></div>
      <div className="top100-head"><div><p>MARKET TURNOVER / STOCK ONLY</p><h2>거래대금 TOP100 · 개별주만</h2></div><span>{displayTime(snapshot?.updatedAt)}</span></div>
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
        {!rankings.length && <div className="workspace-empty">개별주 거래대금 데이터 연결 대기 중</div>}
      </div>
    </aside>
  </div>
}

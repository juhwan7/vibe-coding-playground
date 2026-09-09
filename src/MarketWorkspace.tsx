import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  stocks?: Record<string, RankingItem>
  indices?: { KOSPI?: IndexPoint; KOSDAQ?: IndexPoint }
  marketInvestors?: { total?: InvestorTotal | null } | null
}

type ThemePoint = {
  timestamp: string
  value: number
  closeValue?: number | null
  volume: number
  tradingAmount?: number
  memberCount: number
  dominantWeightPercent?: number | null
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
  dominantWeightPercent?: number | null
  selectionBasis?: string | null
}

type ThemeFlowResponse = {
  ok?: boolean
  updatedAt?: string | null
  topRankings?: RankingItem[]
  themes?: ThemeGroup[]
  error?: string | null
}

type StockCandlePoint = {
  timestamp: string
  day?: string | null
  openPrice: number
  highPrice: number
  lowPrice: number
  closePrice: number
}

type StockChartPayload = {
  ok?: boolean
  symbol?: string | null
  name?: string | null
  interval?: string | null
  day?: string | null
  points?: StockCandlePoint[]
  error?: string | null
}

const ACCENTS = ['#ff4d6d', '#39a0ff', '#37d67a', '#9d6cff', '#ff9d3d']
const SESSION_START = 8 * 60
const SESSION_MINUTES = 12 * 60
const NON_STOCK_NAME = /(ETF|ETN|KODEX|TIGER|RISE|ACE|PLUS|SOL|HANARO|KOSEF|TIMEFOLIO|ARIRANG|FOCUS|KBSTAR|리츠|스팩|인프라)/i

function fmtAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(value >= 10_000_000_000_000 ? 1 : 2)}조`
  if (value >= 100_000_000) return `${Math.round(value / 100_000_000).toLocaleString()}억`
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

function timeParts(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 8)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return { total: hour * 60 + minute }
}

function validStockName(name: string | null | undefined, symbol: string | null | undefined) {
  const value = String(name ?? '').trim()
  const code = String(symbol ?? '').trim()
  if (!value || value === code || /^\d{6}$/.test(value)) return null
  return value
}

function isIndividualStock(item: RankingItem) {
  const type = String(item.securityType ?? '').toUpperCase()
  if (type) return type === 'STOCK'
  return !NON_STOCK_NAME.test(String(item.name ?? ''))
}

function themeIcon(name: string) {
  if (name === '반도체') return '▦'
  if (name === '원전') return '◉'
  if (name === '전력기기') return 'ϟ'
  if (name === '방산') return '✦'
  if (name === '조선') return '◈'
  if (name === '바이오') return '◆'
  if (name === '광통신') return '◎'
  return '●'
}

function FlashValue({ value, className = '', children }: { value: string | number | null | undefined; className?: string; children: ReactNode }) {
  const previous = useRef(value)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (previous.current !== value && previous.current != null) setVersion((current) => current + 1)
    previous.current = value
  }, [value])
  return <span key={version} className={`value-flash ${className}`.trim()}>{children}</span>
}

function StockLineChart({ payload, accent }: { payload: StockChartPayload; accent: string }) {
  const points = (payload.points ?? []).filter((point) => Number.isFinite(point.closePrice)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  if (!points.length) return <div className="theme-stock-preview-loading"><strong>{payload.name ?? payload.symbol} 3분 선차트 없음</strong><span>{payload.error ?? '장중 데이터를 준비하지 못했습니다.'}</span></div>

  const width = 900
  const height = 230
  const top = 20
  const bottom = 188
  const prices = points.map((point) => point.closePrice)
  const rawMin = Math.min(...prices)
  const rawMax = Math.max(...prices)
  const center = (rawMin + rawMax) / 2
  const visibleRange = Math.max(rawMax - rawMin, Math.max(1, Math.abs(center) * .0008))
  const pad = visibleRange * .04
  const lo = center - visibleRange / 2 - pad
  const hi = center + visibleRange / 2 + pad
  const range = Math.max(1, hi - lo)
  const y = (price: number) => bottom - ((price - lo) / range) * (bottom - top)
  const x = (timestamp: string) => Math.max(0, Math.min(width, (timeParts(timestamp).total - SESSION_START) / SESSION_MINUTES * width))
  const polyline = points.map((point) => `${x(point.timestamp)},${y(point.closePrice)}`).join(' ')
  const first = points[0]
  const last = points.at(-1)!
  const change = first.closePrice ? (last.closePrice / first.closePrice - 1) * 100 : null

  return <div className="theme-chart-wrap" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-chart-title">
      <span className="theme-chart-name">{payload.name ?? payload.symbol} 3분 선차트 <span className="theme-stock-preview-badge">5초 미리보기</span></span>
      <div className="theme-chart-metrics"><span>현재가 <b>{last.closePrice.toLocaleString()}</b></span><span>구간 변화 <b>{fmtRate(change)}</b></span></div>
    </div>
    <svg className="theme-chart theme-chart-expanded" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${payload.name ?? payload.symbol} 3분 선차트`}>
      {[.25, .5, .75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={top + (bottom - top) * ratio} y2={top + (bottom - top) * ratio} className="theme-chart-grid" />)}
      {[8, 10, 12, 14, 16, 18, 20].map((hour) => {
        const tx = (hour - 8) / 12 * width
        return <g key={hour}><line x1={tx} x2={tx} y1={top} y2={bottom} className="theme-hour-line" /><text x={Math.min(width - 34, tx + 3)} y="222" className="theme-hour-label">{String(hour).padStart(2, '0')}:00</text></g>
      })}
      <text x={width - 5} y={top + 8} textAnchor="end" className="theme-candle-price-label">{Math.round(hi).toLocaleString()}</text>
      <text x={width - 5} y={bottom - 3} textAnchor="end" className="theme-candle-price-label">{Math.round(lo).toLocaleString()}</text>
      <polyline points={polyline} className="theme-stock-line" fill="none" />
      <circle cx={x(last.timestamp)} cy={y(last.closePrice)} r="3.8" className="theme-average-current-dot" />
    </svg>
  </div>
}

function ThemeRow({ theme, rank }: { theme: ThemeGroup; rank: number }) {
  const accent = ACCENTS[(rank - 1) % ACCENTS.length]
  const members = [...theme.members].filter(isIndividualStock).sort((a, b) => (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0)).slice(0, 7)
  const [stockPreview, setStockPreview] = useState<StockChartPayload | null>(null)
  const [loadingName, setLoadingName] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const showStockChart = async (member: RankingItem) => {
    if (!member.symbol) return
    if (timer.current) window.clearTimeout(timer.current)
    setLoadingName(validStockName(member.name, member.symbol) ?? member.symbol)
    setStockPreview(null)
    setPreviewError(null)
    try {
      const params = new URLSearchParams({ symbol: member.symbol })
      const memberName = validStockName(member.name, member.symbol)
      if (memberName) params.set('name', memberName)
      const response = await fetch(`/api/market/theme-stock-chart?${params.toString()}`, { headers: { Accept: 'application/json' } })
      const payload = await response.json().catch(() => null) as StockChartPayload | null
      if (!payload?.ok || !payload.points?.length) throw new Error(payload?.error ?? '3분 선차트 데이터를 불러오지 못했습니다.')
      const resolvedName = validStockName(payload.name, payload.symbol) ?? memberName ?? payload.symbol ?? member.symbol
      setStockPreview({ ...payload, name: resolvedName })
      timer.current = window.setTimeout(() => setStockPreview(null), 5000)
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error))
      timer.current = window.setTimeout(() => setPreviewError(null), 3500)
    } finally {
      setLoadingName(null)
    }
  }

  return <article className="theme-strength-row" style={{ ['--theme-accent' as string]: accent }}>
    <div className="theme-summary-cell">
      <div className="theme-rank-line"><b>{rank}</b><span className="theme-icon">{themeIcon(theme.name)}</span><h2>{theme.name}</h2></div>
      <p>{theme.memberCount}개 개별주 · {theme.selectionBasis ?? 'TOP50 3종+'}</p>
      <strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}><FlashValue value={theme.currentValue}>{fmtRate(theme.currentValue)}</FlashValue></strong>
      <div><span>1일 누적 거래대금 합계</span><b><FlashValue value={theme.tradingAmount}>{fmtAmount(theme.tradingAmount)}</FlashValue></b></div>
      {theme.dominantWeightPercent != null && <div><span>최대 종목 거래대금 비중</span><b>{theme.dominantWeightPercent.toFixed(0)}%</b></div>}
    </div>

    <div className="theme-members-cell">
      <div className="theme-cell-title">포함 개별주 <span>({theme.memberCount}) · 클릭 시 3분 선차트</span></div>
      <div className="theme-member-list">
        {members.map((member, index) => <button key={member.symbol ?? index} type="button" onClick={() => void showStockChart(member)}>
          <b>{index + 1}</b><span>{validStockName(member.name, member.symbol) ?? member.symbol}</span><strong><FlashValue value={member.tradingAmount}>{fmtAmount(member.tradingAmount)}</FlashValue></strong>
        </button>)}
      </div>
    </div>

    {loadingName
      ? <div className="theme-stock-preview-loading"><strong>{loadingName} 3분 선차트 불러오는 중</strong><span>캐시가 없으면 Pi에서 해당 종목 장중 데이터를 보강합니다.</span></div>
      : stockPreview
        ? <StockLineChart payload={stockPreview} accent={accent} />
        : previewError
          ? <div className="theme-stock-preview-loading"><strong>3분 선차트를 표시하지 못했습니다.</strong><span>{previewError}</span></div>
          : <ThemeAverageCandleChart theme={theme} accent={accent} />}

    <div className="theme-window-stats">
      <div><span>현재 가중평균</span><strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}><FlashValue value={theme.currentValue}>{fmtRate(theme.currentValue)}</FlashValue></strong></div>
      <div><span>최근 3시간</span><strong className={(theme.change3h ?? 0) >= 0 ? 'up' : 'down'}><FlashValue value={theme.change3h}>{fmtRate(theme.change3h)}</FlashValue></strong></div>
      <div><span>최근 1시간</span><strong className={(theme.change1h ?? 0) >= 0 ? 'up' : 'down'}><FlashValue value={theme.change1h}>{fmtRate(theme.change1h)}</FlashValue></strong></div>
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
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(load, 10000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const rankings = useMemo(() => {
    const metaItems = [
      ...(themeFlow.topRankings ?? []),
      ...(themeFlow.themes ?? []).flatMap((theme) => theme.members ?? []),
      ...Object.values(snapshot?.stocks ?? {}),
    ]
    const metadata = new Map<string, RankingItem[]>()
    for (const item of metaItems) {
      if (!item.symbol) continue
      const bucket = metadata.get(item.symbol) ?? []
      bucket.push(item)
      metadata.set(item.symbol, bucket)
    }

    const live = snapshot?.topRankings?.length ? snapshot.topRankings : themeFlow.topRankings ?? []
    return live.map((item) => {
      const candidates = item.symbol ? metadata.get(item.symbol) ?? [] : []
      const meta = candidates.find((candidate) => validStockName(candidate.name, candidate.symbol)) ?? candidates[0] ?? null
      const name = validStockName(item.name, item.symbol)
        ?? candidates.map((candidate) => validStockName(candidate.name, candidate.symbol)).find(Boolean)
        ?? null
      return {
        ...meta,
        ...item,
        name,
        market: item.market ?? meta?.market ?? null,
        securityType: item.securityType ?? meta?.securityType ?? null,
      } as RankingItem
    }).filter((item): item is RankingItem & { symbol: string } => Boolean(item.symbol) && isIndividualStock(item)).slice(0, 100)
  }, [themeFlow.topRankings, themeFlow.themes, snapshot?.topRankings, snapshot?.stocks])

  const themes = (themeFlow.themes ?? []).slice(0, 5)
  const topAmount = Math.max(1, rankings[0]?.tradingAmount ?? 1)
  const totalAmount = rankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
  const investors = snapshot?.marketInvestors?.total
  const kospi = snapshot?.indices?.KOSPI
  const kosdaq = snapshot?.indices?.KOSDAQ

  return <div className="market-workspace theme-flow-workspace">
    <section className="workspace-main">
      <section className="theme-strength-board panel" data-testid="theme-strength-board">
        <header className="theme-board-head">
          <div><p>THEME ROTATION / INDIVIDUAL STOCKS</p><h1>테마 강도 비교 <span>(개별주식 거래대금 기준 · 5개 유지)</span></h1><small>거래대금·현재가·등락률은 10초마다 갱신합니다. 테마는 5개를 유지하며 거래대금이 큰 종목의 등락이 테마선에 더 크게 반영됩니다.</small></div>
          <div className="theme-board-controls"><span className={themeFlow.ok ? 'flow-live' : 'flow-loading'}>{themeFlow.ok ? '● 거래대금 10초 최신화' : '● 데이터 준비 중'}</span></div>
        </header>

        <div className="theme-method-strip"><span>대상 <b>개별주(STOCK)만</b></span><span>테마 <b>5개 · 8% 또는 3회 확인 후 교체</b></span><span>차트 <b>거래대금 가중 3분 선차트 · 강한 자동 확대축</b></span><span>최신화 <b>10초 · {displayTime(themeFlow.updatedAt)}</b></span></div>
        <div className="theme-strength-list">
          {themes.map((theme, index) => <ThemeRow key={theme.name} theme={theme} rank={index + 1} />)}
          {Array.from({ length: Math.max(0, 5 - themes.length) }, (_, index) => <div className="theme-strength-placeholder" key={index}>테마 {themes.length + index + 1} 후보 계산 중</div>)}
        </div>
      </section>

      <section className="market-bottom-strip">
        <div className="market-mini-panel panel"><span>코스피</span><strong><FlashValue value={kospi?.lastPrice}>{kospi?.lastPrice?.toLocaleString() ?? '-'}</FlashValue></strong><b className={(kospi?.changeRate ?? 0) >= 0 ? 'up' : 'down'}><FlashValue value={kospi?.changeRate}>{fmtRate(kospi?.changeRate)}</FlashValue></b></div>
        <div className="market-mini-panel panel"><span>코스닥</span><strong><FlashValue value={kosdaq?.lastPrice}>{kosdaq?.lastPrice?.toLocaleString() ?? '-'}</FlashValue></strong><b className={(kosdaq?.changeRate ?? 0) >= 0 ? 'up' : 'down'}><FlashValue value={kosdaq?.changeRate}>{fmtRate(kosdaq?.changeRate)}</FlashValue></b></div>
        <div className="market-mini-panel panel"><span>상위100 개별주 합계</span><strong><FlashValue value={totalAmount}>{fmtAmount(totalAmount)}</FlashValue></strong><b>{rankings.length}/100</b></div>
        <div className="market-mini-panel panel"><span>외국인 현물 순매수</span><strong className={(investors?.foreignerNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}><FlashValue value={investors?.foreignerNetBuyAmount}>{fmtWon(investors?.foreignerNetBuyAmount)}</FlashValue></strong></div>
        <div className="market-mini-panel panel"><span>기관 현물 순매수</span><strong className={(investors?.institutionNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}><FlashValue value={investors?.institutionNetBuyAmount}>{fmtWon(investors?.institutionNetBuyAmount)}</FlashValue></strong></div>
      </section>

      <section className="deep-market-details deep-market-always-open panel">
        <div className="deep-market-static-head"><span><b>시장 전체 상세 대시보드</b><small>시장지도와 핵심 비교지표</small></span></div>
        <div className="deep-market-body"><MarketDashboard /></div>
      </section>
    </section>

    <aside className="top100-rail panel" data-testid="top100-ranking">
      <div className="top100-head"><div><p>MARKET TURNOVER / STOCK ONLY</p><h2>거래대금 TOP100 · 개별주만</h2></div><span>{displayTime(snapshot?.updatedAt)}</span></div>
      <div className="top100-list-head"><span>순위</span><span>종목명</span><span>등락률</span><span>거래대금</span></div>
      <div className="top100-list">
        {rankings.map((item, index) => {
          const amount = item.tradingAmount ?? 0
          const width = amount / topAmount * 100
          const displayName = validStockName(item.name, item.symbol)
          return <div className="top100-row" key={`${item.symbol}-${index}`}>
            <b>{index + 1}</b>
            <div className="top100-stock"><strong>{displayName ?? '종목명 확인 중'}</strong><small>{item.symbol} · <FlashValue value={item.lastPrice}>{item.lastPrice?.toLocaleString() ?? '-'}</FlashValue></small><div className="top100-mini-track"><i style={{ width: `${width}%` }} /></div></div>
            <strong className={`top100-rate ${(item.changeRate ?? 0) >= 0 ? 'up' : 'down'}`}><FlashValue value={item.changeRate}>{fmtRate(item.changeRate)}</FlashValue></strong>
            <strong className="top100-amount"><FlashValue value={item.tradingAmount}>{fmtAmount(item.tradingAmount)}</FlashValue></strong>
          </div>
        })}
      </div>
    </aside>
  </div>
}

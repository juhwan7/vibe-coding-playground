import { useEffect, useMemo, useState } from 'react'
import './marketDashboardEnhancements.css'

type RankingItem = {
  symbol?: string | null
  name?: string | null
  market?: string | null
  securityType?: string | null
  lastPrice?: number | null
  changeRate?: number | null
  tradingAmount?: number | null
}
type InvestorTotal = { foreignerNetBuyAmount?: number | null; institutionNetBuyAmount?: number | null }
type Snapshot = {
  ok?: boolean
  updatedAt?: string
  marketSession?: string
  marketTradingAmount?: number | null
  indices?: Record<string, { lastPrice?: number | null; changeRate?: number | null }>
  topRankings?: RankingItem[]
  marketInvestors?: { total?: InvestorTotal | null } | null
}
type ThemeFlow = {
  ok?: boolean
  topRankings?: RankingItem[]
  themes?: Array<{ name: string; tradingAmount?: number | null; currentValue?: number | null; memberCount?: number | null }>
}
type HistorySample = { updatedAt: string; marketTradingAmount?: number | null; topRankings?: RankingItem[] }
type HistoryResponse = { tradingDays?: number; samples?: HistorySample[] }

const NON_STOCK_NAME = /(ETF|ETN|KODEX|TIGER|RISE|ACE|PLUS|SOL|HANARO|KOSEF|TIMEFOLIO|ARIRANG|FOCUS|KBSTAR|리츠|스팩|인프라)/i

function validName(name?: string | null, symbol?: string | null) {
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
function signed(value?: number | null, suffix = '%') {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}`
}
function fmtAmount(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '-'
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}조`
  if (value >= 100_000_000) return `${Math.round(value / 100_000_000).toLocaleString()}억`
  return Math.round(value).toLocaleString()
}
function fmtWon(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '-'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(2)}조`
  if (abs >= 100_000_000) return `${sign}${Math.round(abs / 100_000_000).toLocaleString()}억`
  return `${sign}${Math.round(abs).toLocaleString()}원`
}
function dateKey(value: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}
function minuteOfDay(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value))
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
}
function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value))
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}
function pctDelta(current?: number | null, base?: number | null) {
  if (current == null || base == null || !Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null
  return (current / base - 1) * 100
}
function enrichRankings(primary: RankingItem[] = [], metadataRows: RankingItem[] = []) {
  const metadata = new Map<string, RankingItem>()
  for (const item of metadataRows) if (item.symbol) metadata.set(item.symbol, item)
  return primary.map((item) => {
    const meta = item.symbol ? metadata.get(item.symbol) : undefined
    return {
      ...meta,
      ...item,
      name: validName(item.name, item.symbol) ?? validName(meta?.name, item.symbol) ?? null,
      securityType: item.securityType ?? meta?.securityType ?? null,
      market: item.market ?? meta?.market ?? null,
    }
  }).filter((item) => item.symbol && isIndividualStock(item)).slice(0, 100)
}
function breadth(rows: RankingItem[]) {
  const valid = rows.filter((item) => item.changeRate != null && Number.isFinite(item.changeRate))
  const advancers = valid.filter((item) => (item.changeRate ?? 0) > 0).length
  const decliners = valid.filter((item) => (item.changeRate ?? 0) < 0).length
  return { advancers, decliners, unchanged: valid.length - advancers - decliners, count: valid.length, share: valid.length ? advancers / valid.length * 100 : null }
}
function concentration(rows: RankingItem[]) {
  const amounts = rows.map((item) => item.tradingAmount ?? 0).filter((value) => value > 0)
  const total = amounts.reduce((sum, value) => sum + value, 0)
  if (!total) return null
  return amounts.sort((a, b) => b - a).slice(0, 10).reduce((sum, value) => sum + value, 0) / total * 100
}
function directionShare(rows: RankingItem[]) {
  const valid = rows.filter((item) => item.tradingAmount != null && item.changeRate != null)
  const total = valid.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
  if (!total) return { up: null as number | null, down: null as number | null }
  const up = valid.filter((item) => (item.changeRate ?? 0) > 0).reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
  const down = valid.filter((item) => (item.changeRate ?? 0) < 0).reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
  return { up: up / total * 100, down: down / total * 100 }
}

export default function MarketDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot>({})
  const [themeFlow, setThemeFlow] = useState<ThemeFlow>({})
  const [history, setHistory] = useState<HistoryResponse>({ samples: [] })

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    let historyTick = 0
    const load = async () => {
      try {
        const [snapshotResponse, themeResponse] = await Promise.all([
          fetch('/api/market/snapshot', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
          fetch('/api/market/theme-flow', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
        ])
        if (snapshotResponse?.ok) setSnapshot(await snapshotResponse.json() as Snapshot)
        if (themeResponse) setThemeFlow(await themeResponse.json().catch(() => ({})) as ThemeFlow)
        if (historyTick % 6 === 0) {
          const historyResponse = await fetch('/api/market/history?days=7&resolution=5', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null)
          if (historyResponse?.ok) setHistory(await historyResponse.json() as HistoryResponse)
        }
        historyTick += 1
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(load, 10000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const rankings = useMemo(() => enrichRankings(snapshot.topRankings ?? themeFlow.topRankings ?? [], themeFlow.topRankings ?? []), [snapshot.topRankings, themeFlow.topRankings])
  const totalAmount = rankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
  const currentBreadth = breadth(rankings)
  const currentConcentration = concentration(rankings)
  const moneyDirection = directionShare(rankings)
  const topAmount = Math.max(1, rankings[0]?.tradingAmount ?? 1)
  const investorTotal = snapshot.marketInvestors?.total
  const kospi = snapshot.indices?.KOSPI
  const kosdaq = snapshot.indices?.KOSDAQ

  const referenceSamples = useMemo(() => {
    if (!snapshot.updatedAt) return []
    const today = dateKey(snapshot.updatedAt)
    const targetMinute = minuteOfDay(snapshot.updatedAt)
    const byDay = new Map<string, HistorySample[]>()
    for (const sample of history.samples ?? []) {
      const day = dateKey(sample.updatedAt)
      if (day === today) continue
      const bucket = byDay.get(day) ?? []
      bucket.push(sample)
      byDay.set(day, bucket)
    }
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 5).flatMap(([, samples]) => {
      const item = samples.reduce((best, sample) => Math.abs(minuteOfDay(sample.updatedAt) - targetMinute) < Math.abs(minuteOfDay(best.updatedAt) - targetMinute) ? sample : best)
      return Math.abs(minuteOfDay(item.updatedAt) - targetMinute) <= 10 ? [item] : []
    })
  }, [history.samples, snapshot.updatedAt])

  const referenceAmounts = referenceSamples.map((sample) => sample.marketTradingAmount ?? (sample.topRankings ?? []).reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0))
  const referenceBreadths = referenceSamples.map((sample) => breadth(sample.topRankings ?? []).share)
  const referenceConcentration = referenceSamples.map((sample) => concentration(sample.topRankings ?? []))
  const averageAmount = average(referenceAmounts)
  const averageBreadth = average(referenceBreadths)
  const averageConcentration = average(referenceConcentration)
  const themes = [...(themeFlow.themes ?? [])].sort((a, b) => (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0)).slice(0, 5)

  return <main className="top100-market-dashboard" data-testid="moneyflow-dashboard">
    <section className="top100-status">
      <span>{snapshot.ok ? '● TOSS LIVE' : '● 데이터 연결 대기'}</span><strong>{snapshot.marketSession ?? '국내 통합시장'}</strong><em>시장 폭·시장 지도는 고정 WATCHLIST가 아니라 거래대금 TOP100 개별주 기준</em>
    </section>

    <section className="top100-market-kpis">
      <div><span>KOSPI</span><strong>{kospi?.lastPrice?.toLocaleString() ?? '-'}</strong><b className={(kospi?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{signed(kospi?.changeRate)}</b></div>
      <div><span>KOSDAQ</span><strong>{kosdaq?.lastPrice?.toLocaleString() ?? '-'}</strong><b className={(kosdaq?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{signed(kosdaq?.changeRate)}</b></div>
      <div><span>TOP100 상승 / 하락 / 보합</span><strong>{currentBreadth.advancers} / {currentBreadth.decliners} / {currentBreadth.unchanged}</strong><b>{currentBreadth.count}/100 집계</b></div>
      <div><span>TOP100 거래대금 합계</span><strong>{fmtAmount(totalAmount)}</strong><b>{rankings.length}/100 개별주</b></div>
      <div><span>외국인 / 기관 현물</span><strong>{fmtWon(investorTotal?.foreignerNetBuyAmount)}</strong><b>{fmtWon(investorTotal?.institutionNetBuyAmount)}</b></div>
    </section>

    <section className="top100-comparison-grid">
      <div><span>최근 동시간 거래대금 평균</span><strong>{fmtAmount(averageAmount)}</strong><b>{pctDelta(totalAmount, averageAmount) == null ? '-' : `${signed(pctDelta(totalAmount, averageAmount), '%')} 대비`}</b></div>
      <div><span>TOP10 거래대금 집중도</span><strong>{currentConcentration == null ? '-' : `${currentConcentration.toFixed(1)}%`}</strong><b>동시간 평균 {averageConcentration == null ? '-' : `${averageConcentration.toFixed(1)}%`}</b></div>
      <div><span>상승 종목 비율</span><strong>{currentBreadth.share == null ? '-' : `${currentBreadth.share.toFixed(1)}%`}</strong><b>동시간 평균 {averageBreadth == null ? '-' : `${averageBreadth.toFixed(1)}%`}</b></div>
      <div><span>거래대금 방향</span><strong>상승 {moneyDirection.up == null ? '-' : `${moneyDirection.up.toFixed(1)}%`}</strong><b>하락 {moneyDirection.down == null ? '-' : `${moneyDirection.down.toFixed(1)}%`}</b></div>
      <div><span>비교 표본</span><strong>{referenceSamples.length}/5일</strong><b>현재 시각 ±10분</b></div>
    </section>

    <section className="top100-detail-grid">
      <article className="panel top100-map-panel">
        <header><div><p>MARKET MAP / TOP100</p><h2>거래대금 TOP100 시장 지도</h2></div><span>면적 강도 = 거래대금 · 색 = 등락률</span></header>
        <div className="stock-heat-grid">
          {rankings.map((item, index) => {
            const share = (item.tradingAmount ?? 0) / Math.max(1, totalAmount) * 100
            const strength = Math.max(.12, Math.min(.92, (item.tradingAmount ?? 0) / topAmount))
            return <div key={item.symbol ?? index} className={`stock-heat-tile ${(item.changeRate ?? 0) >= 0 ? 'positive' : 'negative'} ${index < 10 ? 'top-ten' : ''}`} style={{ ['--stock-heat' as string]: strength }}>
              <div><b>{index + 1}</b><span>{validName(item.name, item.symbol) ?? item.symbol}</span></div>
              <strong>{signed(item.changeRate)}</strong>
              <small>{fmtAmount(item.tradingAmount)} · {share.toFixed(1)}%</small>
            </div>
          })}
        </div>
      </article>

      <aside className="panel top100-theme-panel">
        <header><div><p>THEME MONEY FLOW</p><h2>현재 주도 테마</h2></div><span>TOP100 개별주 구성</span></header>
        <div className="top100-theme-list">
          {themes.map((theme, index) => <div key={theme.name}><b>{String(index + 1).padStart(2, '0')}</b><span>{theme.name}<small>{theme.memberCount ?? 0}개 개별주</small></span><strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{signed(theme.currentValue)}</strong><em>{fmtAmount(theme.tradingAmount)}</em></div>)}
        </div>
        <div className="top100-scope-note"><strong>집계 범위</strong><span>이 영역은 한국 전체 상장종목 수를 뜻하지 않습니다. 당일 거래대금 상위 100개 개별주의 흐름을 빠르게 읽기 위한 시장 표본입니다.</span></div>
      </aside>
    </section>
  </main>
}

import { useEffect, useMemo, useState } from 'react'
import { mergeLiveSectors } from './marketData'
import type { MarketSnapshot, Sector } from './marketData'

type RankingItem = {
  symbol: string | null
  name: string | null
  market: string | null
  lastPrice: number | null
  changeRate: number | null
  tradingAmount: number | null
  tradingVolume: number | null
}

type InvestorMarket = {
  foreignerNetBuyAmount: number | null
  institutionNetBuyAmount: number | null
  individualNetBuyAmount?: number | null
  coverage?: string
}

type ProgramSummary = {
  arbitrageNetBuyVolume: number | null
  nonArbitrageNetBuyVolume: number | null
  symbolCount: number
  coverage: string
  unit: 'shares'
}

type FuturesSnapshot = {
  available?: boolean
  source?: string | null
  priceChangeRate?: number | null
  tradingStrength?: number | null
  tradingVolume?: number | null
  openInterest?: number | null
  foreignNetContracts?: number | null
  institutionNetContracts?: number | null
}

type ExtendedSnapshot = MarketSnapshot & {
  topRankings?: RankingItem[]
  marketTradingAmountCoverage?: string
  marketInvestors?: { KOSPI?: InvestorMarket | null; KOSDAQ?: InvestorMarket | null; total?: InvestorMarket | null } | null
  programSummary?: ProgramSummary | null
  futures?: FuturesSnapshot | null
}

type HistorySample = {
  updatedAt: string
  marketSession?: string
  marketTradingAmount: number | null
  marketTradingAmountCoverage?: string | null
  indices: ExtendedSnapshot['indices']
  stocks: ExtendedSnapshot['stocks']
  topRankings?: RankingItem[]
  marketInvestors?: ExtendedSnapshot['marketInvestors']
  programSummary?: ProgramSummary | null
  futures?: FuturesSnapshot | null
}

type HistoryResponse = { days: number; tradingDays: number; samples: HistorySample[] }

type MetricCardProps = {
  label: string
  value: string
  average?: string | null
  delta?: string | null
  percentile?: string | null
  note?: string | null
}

function signed(value: number | null | undefined, suffix = '') {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}`
}

function fmtShares(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${value > 0 ? '+' : ''}${(value / 1_000_000).toFixed(1)}백만주`
  if (abs >= 10_000) return `${value > 0 ? '+' : ''}${(value / 10_000).toFixed(1)}만주`
  return `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString()}주`
}

function fmtWon(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(2)}조`
  if (abs >= 100_000_000) return `${sign}${Math.round(abs / 100_000_000).toLocaleString()}억`
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString()}만`
  return `${sign}${Math.round(abs).toLocaleString()}원`
}

function fmtAmountTrillion(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  if (value >= 1) return `${value.toFixed(value >= 10 ? 1 : 2)}조`
  return `${Math.round(value * 10_000).toLocaleString()}억`
}

function koreaMinuteNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 8)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return Math.max(0, Math.min(720, (hour - 8) * 60 + minute))
}

function timelineTime(value: number) {
  const hour = 8 + Math.floor(value / 60)
  const minute = value % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function dateKey(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

function minuteFromIso(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 8)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return Math.max(0, Math.min(720, (hour - 8) * 60 + minute))
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!valid.length) return null
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function pctDelta(current: number | null | undefined, base: number | null | undefined) {
  if (current == null || base == null || !Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null
  return ((current / base) - 1) * 100
}

function percentile(current: number | null | undefined, values: Array<number | null | undefined>) {
  if (current == null || !Number.isFinite(current)) return null
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!valid.length) return null
  return Math.round(valid.filter((value) => value <= current).length / valid.length * 100)
}

function nearestPerTradingDay(samples: HistorySample[], targetMinute: number, currentDay: string) {
  const grouped = new Map<string, HistorySample[]>()
  for (const sample of samples) {
    const day = dateKey(sample.updatedAt)
    if (day === currentDay) continue
    const list = grouped.get(day) ?? []
    list.push(sample)
    grouped.set(day, list)
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 5)
    .map(([day, list]) => {
      const sample = list.reduce((best, item) => Math.abs(minuteFromIso(item.updatedAt) - targetMinute) < Math.abs(minuteFromIso(best.updatedAt) - targetMinute) ? item : best)
      return { day, sample, minuteGap: Math.abs(minuteFromIso(sample.updatedAt) - targetMinute) }
    })
    .filter((item) => item.minuteGap <= 10)
}

function sampleAsSnapshot(sample: HistorySample): MarketSnapshot {
  return {
    ok: true,
    mode: 'live',
    updatedAt: sample.updatedAt,
    marketSession: sample.marketSession ?? '',
    indices: sample.indices ?? {},
    stocks: sample.stocks ?? {},
    marketTradingAmount: sample.marketTradingAmount ?? null,
  }
}

function concentration(snapshot: Pick<ExtendedSnapshot, 'topRankings' | 'marketTradingAmount'>) {
  const total = snapshot.marketTradingAmount
  if (total == null || total <= 0) return null
  const top = [...(snapshot.topRankings ?? [])]
    .map((item) => item.tradingAmount ?? 0)
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((sum, value) => sum + value, 0)
  return top / total * 100
}

function breadthFromStocks(stocks: ExtendedSnapshot['stocks']) {
  const list = Object.values(stocks ?? {}).filter((stock) => stock.changeRate != null)
  if (!list.length) return { advancers: 0, decliners: 0, unchanged: 0, share: null as number | null }
  const advancers = list.filter((stock) => (stock.changeRate ?? 0) > 0).length
  const decliners = list.filter((stock) => (stock.changeRate ?? 0) < 0).length
  const unchanged = list.length - advancers - decliners
  return { advancers, decliners, unchanged, share: advancers / list.length * 100 }
}

function amountDirectionShare(stocks: ExtendedSnapshot['stocks']) {
  const list = Object.values(stocks ?? {}).filter((stock) => stock.tradingAmount != null && stock.changeRate != null)
  const total = list.reduce((sum, stock) => sum + (stock.tradingAmount ?? 0), 0)
  if (!total) return { up: null, down: null }
  const up = list.filter((stock) => (stock.changeRate ?? 0) > 0).reduce((sum, stock) => sum + (stock.tradingAmount ?? 0), 0)
  const down = list.filter((stock) => (stock.changeRate ?? 0) < 0).reduce((sum, stock) => sum + (stock.tradingAmount ?? 0), 0)
  return { up: up / total * 100, down: down / total * 100 }
}

function MetricCard({ label, value, average: avg, delta, percentile: pct, note }: MetricCardProps) {
  return <div className="comparison-card">
    <span>{label}</span>
    <strong>{value}</strong>
    <div className="comparison-lines">
      {avg && <small>최근 동시간 평균 <b>{avg}</b></small>}
      {delta && <small>평균 대비 <b>{delta}</b></small>}
      {pct && <small>동시간 표본 백분위 <b>{pct}</b></small>}
      {note && <small>{note}</small>}
    </div>
  </div>
}

function IntradayChart({ current, history }: { current: ExtendedSnapshot | null; history: HistorySample[] }) {
  const currentDay = current?.updatedAt ? dateKey(current.updatedAt) : ''
  const buckets = Array.from({ length: 25 }, (_, index) => index * 30)
  const priorDays = [...new Set(history.map((sample) => dateKey(sample.updatedAt)).filter((day) => day !== currentDay))].sort().slice(-5)

  const closest = (samples: HistorySample[], minute: number) => {
    const candidates = samples.filter((sample) => Math.abs(minuteFromIso(sample.updatedAt) - minute) <= 15)
    if (!candidates.length) return null
    return candidates.reduce((best, item) => Math.abs(minuteFromIso(item.updatedAt) - minute) < Math.abs(minuteFromIso(best.updatedAt) - minute) ? item : best)
  }

  const todaySamples = history.filter((sample) => dateKey(sample.updatedAt) === currentDay)
  const today = buckets.map((minute) => ({ minute, value: closest(todaySamples, minute)?.marketTradingAmount ?? null }))
  if (current?.marketTradingAmount != null) today.push({ minute: minuteFromIso(current.updatedAt), value: current.marketTradingAmount })
  const baseline = buckets.map((minute) => ({
    minute,
    value: average(priorDays.map((day) => closest(history.filter((sample) => dateKey(sample.updatedAt) === day), minute)?.marketTradingAmount ?? null)),
  }))

  const values = [...today, ...baseline].map((point) => point.value).filter((value): value is number => value != null && Number.isFinite(value))
  if (!values.length) return <div className="empty-state">히스토리 데이터 수집 후 시간대별 비교선이 표시됩니다.</div>
  const max = Math.max(...values, 1)
  const width = 1000
  const height = 250
  const point = (minute: number, value: number) => `${(minute / 720) * width},${height - (value / max) * (height - 20)}`
  const toPolyline = (points: Array<{ minute: number; value: number | null }>) => points.filter((item): item is { minute: number; value: number } => item.value != null).sort((a, b) => a.minute - b.minute).map((item) => point(item.minute, item.value)).join(' ')

  return <div className="intraday-chart-wrap">
    <svg className="intraday-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="오늘과 최근 5거래일 동시간 평균 거래대금 비교">
      {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} className="chart-grid" />)}
      <polyline points={toPolyline(baseline)} className="chart-line baseline-line" fill="none" />
      <polyline points={toPolyline(today)} className="chart-line today-line" fill="none" />
    </svg>
    <div className="chart-legend"><span><i className="legend-today" />오늘</span><span><i className="legend-average" />최근 5거래일 동시간 평균</span></div>
  </div>
}

async function fetchSnapshot(signal?: AbortSignal): Promise<ExtendedSnapshot> {
  const response = await fetch('/api/market/snapshot', { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`market api ${response.status}`)
  return response.json() as Promise<ExtendedSnapshot>
}

async function fetchHistory(signal?: AbortSignal): Promise<HistoryResponse> {
  const response = await fetch('/api/market/history?days=7', { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`history api ${response.status}`)
  return response.json() as Promise<HistoryResponse>
}

export default function MarketDashboard() {
  const [snapshot, setSnapshot] = useState<ExtendedSnapshot | null>(null)
  const [history, setHistory] = useState<HistoryResponse>({ days: 7, tradingDays: 0, samples: [] })
  const [apiError, setApiError] = useState<string | null>(null)
  const [minute, setMinute] = useState(koreaMinuteNow)
  const [sectorName, setSectorName] = useState('반도체')
  const [themeName, setThemeName] = useState('HBM')

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    let historyTick = 0
    const load = async () => {
      try {
        const next = await fetchSnapshot(controller.signal)
        setSnapshot(next)
        setApiError(next.error ?? null)
        if (next.ok) setMinute(koreaMinuteNow())
        if (historyTick % 6 === 0) {
          const nextHistory = await fetchHistory(controller.signal).catch(() => null)
          if (nextHistory) setHistory(nextHistory)
        }
        historyTick += 1
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setApiError('백엔드 연결 대기 중 · Docker 실행 시 토스 실시간 데이터로 전환됩니다.')
      } finally {
        timer = window.setTimeout(load, 5000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const live = Boolean(snapshot?.ok)
  const sectors = useMemo(() => mergeLiveSectors(snapshot), [snapshot])
  const selectedSector = sectors.find((sector) => sector.name === sectorName) ?? sectors[0]
  const selectedTheme = selectedSector.themes.find((theme) => theme.name === themeName) ?? selectedSector.themes[0]
  const displayTime = timelineTime(minute)
  const currentDay = snapshot?.updatedAt ? dateKey(snapshot.updatedAt) : dateKey(new Date().toISOString())
  const currentMinute = snapshot?.updatedAt ? minuteFromIso(snapshot.updatedAt) : minute
  const referenceDays = useMemo(() => nearestPerTradingDay(history.samples, currentMinute, currentDay), [history.samples, currentMinute, currentDay])

  const kospi = snapshot?.indices.KOSPI
  const kosdaq = snapshot?.indices.KOSDAQ
  const totalAmountWon = snapshot?.marketTradingAmount ?? sectors.reduce((sum, sector) => sum + sector.turnover * 1_000_000_000_000, 0)
  const totalAmount = totalAmountWon / 1_000_000_000_000
  const breadth = snapshot?.stocks ? breadthFromStocks(snapshot.stocks) : { advancers: 0, decliners: 0, unchanged: 0, share: null }
  const directionShare = snapshot?.stocks ? amountDirectionShare(snapshot.stocks) : { up: null, down: null }
  const currentConcentration = snapshot ? concentration(snapshot) : null
  const investorTotal = snapshot?.marketInvestors?.total ?? null

  const referenceAmounts = referenceDays.map(({ sample }) => sample.marketTradingAmount)
  const amountAverage = average(referenceAmounts)
  const concentrationReferences = referenceDays.map(({ sample }) => concentration(sample as ExtendedSnapshot))
  const breadthReferences = referenceDays.map(({ sample }) => breadthFromStocks(sample.stocks).share)
  const foreignReferences = referenceDays.map(({ sample }) => sample.marketInvestors?.total?.foreignerNetBuyAmount ?? null)
  const institutionReferences = referenceDays.map(({ sample }) => sample.marketInvestors?.total?.institutionNetBuyAmount ?? null)

  const selectSector = (name: string) => {
    const next = sectors.find((sector) => sector.name === name) ?? sectors[0]
    setSectorName(next.name)
    setThemeName(next.themes[0].name)
  }

  const sectorReference = (name: string) => average(referenceDays.map(({ sample }) => mergeLiveSectors(sampleAsSnapshot(sample)).find((sector) => sector.name === name)?.turnover ?? null))
  const rankedSectors = [...sectors].sort((a, b) => b.turnover - a.turnover)
  const medianTurnover = [...sectors].map((sector) => sector.turnover).sort((a, b) => a - b)[Math.floor(sectors.length / 2)] || 0

  const dayRows = referenceDays.map(({ day, sample }) => ({
    day,
    time: timelineTime(minuteFromIso(sample.updatedAt)),
    amount: sample.marketTradingAmount,
    concentration: concentration(sample as ExtendedSnapshot),
    breadth: breadthFromStocks(sample.stocks).share,
    foreign: sample.marketInvestors?.total?.foreignerNetBuyAmount ?? null,
    institution: sample.marketInvestors?.total?.institutionNetBuyAmount ?? null,
    nonArbitrage: sample.programSummary?.nonArbitrageNetBuyVolume ?? null,
  }))

  const rotationRows = useMemo(() => {
    const rows: Array<{ time: string; sector: string; turnover: number }> = []
    const todaySamples = history.samples.filter((sample) => dateKey(sample.updatedAt) === currentDay)
    for (const target of [60, 120, 180, 240, 300, 360, 420, 480, 600, 720]) {
      const nearby = todaySamples.filter((sample) => Math.abs(minuteFromIso(sample.updatedAt) - target) <= 12)
      if (!nearby.length) continue
      const sample = nearby.reduce((best, item) => Math.abs(minuteFromIso(item.updatedAt) - target) < Math.abs(minuteFromIso(best.updatedAt) - target) ? item : best)
      const leader = [...mergeLiveSectors(sampleAsSnapshot(sample))].sort((a, b) => b.turnover - a.turnover)[0]
      if (leader) rows.push({ time: timelineTime(target), sector: leader.name, turnover: leader.turnover })
    }
    return rows
  }, [history.samples, currentDay])

  const accelerationRows = useMemo(() => {
    if (!snapshot?.stocks) return []
    const currentStocks = Object.values(snapshot.stocks)
    return currentStocks.map((stock) => {
      const historical = referenceDays.map(({ sample }) => sample.stocks?.[stock.symbol]?.tradingAmount ?? null)
      const avg = average(historical)
      const ratio = avg && stock.tradingAmount != null ? stock.tradingAmount / avg : null
      const today = history.samples.filter((sample) => dateKey(sample.updatedAt) === currentDay && sample.stocks?.[stock.symbol]?.tradingAmount != null)
      const tenMinutesAgoTarget = currentMinute - 10
      const before = today.filter((sample) => minuteFromIso(sample.updatedAt) <= tenMinutesAgoTarget).sort((a, b) => minuteFromIso(b.updatedAt) - minuteFromIso(a.updatedAt))[0]
      const increase10m = stock.tradingAmount != null && before?.stocks?.[stock.symbol]?.tradingAmount != null ? stock.tradingAmount - (before.stocks[stock.symbol].tradingAmount ?? 0) : null
      return { stock, avg, ratio, increase10m }
    }).sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1)).slice(0, 10)
  }, [snapshot, referenceDays, history.samples, currentDay, currentMinute])

  const programAverageNonArb = average(referenceDays.map(({ sample }) => sample.programSummary?.nonArbitrageNetBuyVolume ?? null))
  const programAverageArb = average(referenceDays.map(({ sample }) => sample.programSummary?.arbitrageNetBuyVolume ?? null))
  const futures = snapshot?.futures

  return (
    <main className="terminal-shell market-lab" data-testid="moneyflow-dashboard">
      <section className={`data-status ${live ? 'live' : 'demo'}`}>
        <span>{live ? '● TOSS LIVE' : '● DEMO FALLBACK'}</span>
        <strong>{snapshot?.marketSession ?? '08:00~20:00 통합시장'}</strong>
        <em>{live && snapshot ? `업데이트 ${new Date(snapshot.updatedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })} · 비교데이터 ${history.tradingDays}거래일` : 'Docker 백엔드 연결 전에는 예시 데이터가 표시됩니다.'}</em>
      </section>
      {apiError && <div className="api-error">{apiError}</div>}

      <section className="market-strip">
        <div><span>KOSPI</span><strong>{kospi?.lastPrice?.toLocaleString() ?? '-'}</strong><em className={(kospi?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{signed(kospi?.changeRate, '%')}</em></div>
        <div><span>KOSDAQ</span><strong>{kosdaq?.lastPrice?.toLocaleString() ?? '-'}</strong><em className={(kosdaq?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{signed(kosdaq?.changeRate, '%')}</em></div>
        <div><span>상승 / 하락 / 보합</span><strong>{breadth.advancers} / {breadth.decliners} / {breadth.unchanged}</strong><em>현재 추적 종목 기준</em></div>
        <div><span>통합 거래대금 TOP100</span><strong>{fmtAmountTrillion(totalAmount)}</strong><em>토스 거래대금 랭킹 합계</em></div>
        <div><span>외국인 / 기관 현물 순매수</span><strong className={(investorTotal?.foreignerNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtWon(investorTotal?.foreignerNetBuyAmount)}</strong><em className={(investorTotal?.institutionNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtWon(investorTotal?.institutionNetBuyAmount)} · {investorTotal?.coverage ?? '시장지표 집계'}</em></div>
      </section>

      <section className="comparison-grid" aria-label="동시간 과거 비교">
        <MetricCard label="거래대금 TOP100" value={fmtAmountTrillion(totalAmount)} average={amountAverage == null ? null : fmtAmountTrillion(amountAverage / 1_000_000_000_000)} delta={pctDelta(totalAmountWon, amountAverage) == null ? null : signed(pctDelta(totalAmountWon, amountAverage), '%')} percentile={percentile(totalAmountWon, referenceAmounts) == null ? null : `${percentile(totalAmountWon, referenceAmounts)}%`} note={`${referenceDays.length}/5 거래일 동시간 표본`} />
        <MetricCard label="TOP10 거래대금 집중도" value={currentConcentration == null ? '-' : `${currentConcentration.toFixed(1)}%`} average={average(concentrationReferences) == null ? null : `${average(concentrationReferences)?.toFixed(1)}%`} delta={pctDelta(currentConcentration, average(concentrationReferences)) == null ? null : signed(pctDelta(currentConcentration, average(concentrationReferences)), '%')} />
        <MetricCard label="상승 종목 비율" value={breadth.share == null ? '-' : `${breadth.share.toFixed(1)}%`} average={average(breadthReferences) == null ? null : `${average(breadthReferences)?.toFixed(1)}%`} delta={breadth.share != null && average(breadthReferences) != null ? `${(breadth.share - (average(breadthReferences) ?? 0)).toFixed(1)}%p` : null} note={`거래대금 기준 상승 ${directionShare.up == null ? '-' : `${directionShare.up.toFixed(1)}%`} / 하락 ${directionShare.down == null ? '-' : `${directionShare.down.toFixed(1)}%`}`} />
        <MetricCard label="외국인 현물 순매수" value={fmtWon(investorTotal?.foreignerNetBuyAmount)} average={fmtWon(average(foreignReferences))} delta={pctDelta(investorTotal?.foreignerNetBuyAmount, average(foreignReferences)) == null ? null : signed(pctDelta(investorTotal?.foreignerNetBuyAmount, average(foreignReferences)), '%')} />
        <MetricCard label="기관 현물 순매수" value={fmtWon(investorTotal?.institutionNetBuyAmount)} average={fmtWon(average(institutionReferences))} delta={pctDelta(investorTotal?.institutionNetBuyAmount, average(institutionReferences)) == null ? null : signed(pctDelta(investorTotal?.institutionNetBuyAmount, average(institutionReferences)), '%')} />
      </section>

      <section className="dashboard-grid objective-grid">
        <section className="panel heatmap-panel market-map-panel">
          <div className="panel-head"><div><p>MARKET MAP</p><h2>한국 시장 전체 Heatmap</h2></div><span className={live ? 'live-badge' : 'demo-badge'}>{live ? '거래대금 면적 · 등락률 색' : 'DEMO SNAPSHOT'}</span></div>
          <div className="market-map-grid">
            {rankedSectors.map((sector, index) => {
              const share = totalAmount > 0 ? sector.turnover / totalAmount * 100 : 0
              const ref = sectorReference(sector.name)
              const ratio = ref && ref > 0 ? sector.turnover / ref : null
              const vsMedian = medianTurnover > 0 ? sector.turnover / medianTurnover : null
              const intensity = Math.min(.88, .13 + Math.abs(sector.change) / 7)
              const span = share >= 20 || index === 0 ? 2 : 1
              return <button
                key={sector.name}
                className={`market-map-tile heat-tile ${sector.change >= 0 ? 'positive' : 'negative'} ${sector.name === selectedSector.name ? 'active' : ''} ${vsMedian != null && vsMedian >= 2 ? 'turnover-outlier' : ''}`}
                style={{ ['--heat' as string]: intensity, gridColumn: `span ${span}` }}
                onClick={() => selectSector(sector.name)}
              >
                <div className="map-title"><span>{sector.name}</span>{index === 0 && <b>거래대금 1위</b>}</div>
                <strong>{signed(sector.change, '%')}</strong>
                <small>{fmtAmountTrillion(sector.turnover)} · TOP100 대비 {share.toFixed(1)}%</small>
                <small>5일 동시간 {ratio == null ? '-' : `${ratio.toFixed(2)}×`} · 중앙 섹터 대비 {vsMedian == null ? '-' : `${vsMedian.toFixed(2)}×`}</small>
              </button>
            })}
          </div>
          <p className="data-footnote">시장지도 섹터 분류는 현재 등록된 대표 종목 기준입니다. 면적은 섹터 거래대금, 색은 거래대금 가중 등락률이며 비교값은 저장된 동시간 표본으로 계산합니다.</p>
        </section>

        <aside className="panel ranking-panel">
          <div className="panel-head"><div><p>MONEY FLOW</p><h2>거래대금 순위</h2></div><span>{displayTime}</span></div>
          <div className="ranking-list objective-ranking">
            {rankedSectors.map((sector, index) => {
              const share = totalAmount > 0 ? sector.turnover / totalAmount * 100 : 0
              return <button key={sector.name} onClick={() => selectSector(sector.name)} className={sector.name === selectedSector.name ? 'active' : ''}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span>{sector.name}<small>{fmtAmountTrillion(sector.turnover)} · {signed(sector.change, '%')}</small></span>
                <strong>{share.toFixed(1)}%</strong>
              </button>
            })}
          </div>
        </aside>

        <section className="panel intraday-panel timeline-panel">
          <div className="panel-head"><div><p>INTRADAY TURNOVER</p><h2>시간대별 거래대금 · 최근 5거래일 동시간 비교</h2></div><strong>{timelineTime(currentMinute)}</strong></div>
          <IntradayChart current={snapshot} history={history.samples} />
          <div className="time-labels"><span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span><span>16:00</span><span>18:00</span><span>20:00</span></div>
        </section>

        <section className="panel drill-panel">
          <div className="panel-head"><div><p>DRILL DOWN</p><h2>{selectedSector.name} → 세부테마 → 종목</h2></div><span>TOP100 대비 {(selectedSector.turnover / Math.max(totalAmount, .0001) * 100).toFixed(1)}%</span></div>
          <div className="sector-metrics">
            <div><span>거래대금 가중 등락</span><strong className={selectedSector.change >= 0 ? 'up' : 'down'}>{signed(selectedSector.change, '%')}</strong></div>
            <div><span>통합 거래대금</span><strong>{fmtAmountTrillion(selectedSector.turnover)}</strong></div>
            <div><span>상승 비율</span><strong>{Math.round(selectedSector.advancers / Math.max(1, selectedSector.advancers + selectedSector.decliners) * 100)}%</strong></div>
            <div><span>외국인 순매수량</span><strong className={selectedSector.foreign >= 0 ? 'up' : 'down'}>{fmtShares(selectedSector.foreign)}</strong></div>
            <div><span>기관 순매수량</span><strong className={selectedSector.institution >= 0 ? 'up' : 'down'}>{fmtShares(selectedSector.institution)}</strong></div>
          </div>
          <div className="theme-tabs">{selectedSector.themes.map((theme) => {
            const themeTurnover = theme.stocks.reduce((sum, stock) => sum + stock.turnover, 0)
            return <button key={theme.name} className={theme.name === selectedTheme.name ? 'active' : ''} onClick={() => setThemeName(theme.name)}>{theme.name} · {(themeTurnover / Math.max(totalAmount, .0001) * 100).toFixed(1)}%</button>
          })}</div>
          <div className="stock-table">
            <div className="table-row table-head"><span>종목</span><span>현재가</span><span>등락률</span><span>통합 거래대금</span><span>외국인</span><span>기관</span></div>
            {selectedTheme.stocks.map((stock) => <div className="table-row" key={stock.ticker}><span><b>{stock.name}</b><small>{stock.ticker} · {stock.market}</small></span><span>{stock.price != null ? `${stock.price.toLocaleString()}원` : '-'}</span><span className={stock.change >= 0 ? 'up' : 'down'}>{signed(stock.change, '%')}</span><span>{stock.turnoverEstimated ? '~' : ''}{fmtAmountTrillion(stock.turnover)}</span><span className={stock.foreign >= 0 ? 'up' : 'down'}>{fmtShares(stock.foreign)}</span><span className={stock.institution >= 0 ? 'up' : 'down'}>{fmtShares(stock.institution)}</span></div>)}
          </div>
        </section>

        <section className="panel timeline-panel replay-panel">
          <div className="panel-head"><div><p>TIMELINE</p><h2>08:00 → 20:00 · KRX + NXT 통합 흐름</h2></div><strong data-testid="timeline-current">{displayTime}</strong></div>
          <input aria-label="시장 시간 재생" type="range" min="0" max="720" step="10" value={minute} onChange={(event) => setMinute(Number(event.target.value))} />
          <div className="time-labels"><span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span><span>16:00</span><span>18:00</span><span>20:00</span></div>
          <p className="formula-note">이 화면은 매수·매도 판단 문구를 생성하지 않습니다. 현재값, 과거 동시간 평균, 변화율, 백분위와 데이터 범위만 표시합니다.</p>
        </section>
      </section>

      <section className="fold-stack">
        <details className="panel fold-panel" open>
          <summary><span><b>수급 · 프로그램 · 선물</b><small>외국인/기관 현물, 차익/비차익 프로그램, 선물 데이터 슬롯</small></span><strong>펼치기 / 접기</strong></summary>
          <div className="flow-matrix">
            <MetricCard label="외국인 현물 순매수" value={fmtWon(investorTotal?.foreignerNetBuyAmount)} average={fmtWon(average(foreignReferences))} />
            <MetricCard label="기관 현물 순매수" value={fmtWon(investorTotal?.institutionNetBuyAmount)} average={fmtWon(average(institutionReferences))} />
            <MetricCard label="비차익 프로그램 순매수량" value={fmtShares(snapshot?.programSummary?.nonArbitrageNetBuyVolume)} average={fmtShares(programAverageNonArb)} note={snapshot?.programSummary ? `${snapshot.programSummary.symbolCount}종목 집계` : '데이터 수집 전'} />
            <MetricCard label="차익 프로그램 순매수량" value={fmtShares(snapshot?.programSummary?.arbitrageNetBuyVolume)} average={fmtShares(programAverageArb)} note={snapshot?.programSummary?.coverage ?? '데이터 수집 전'} />
            <MetricCard label="선물 등락률" value={futures?.available ? signed(futures.priceChangeRate, '%') : '-'} note={futures?.available ? `source: ${futures.source ?? '-'}` : '연결된 선물 데이터 소스 없음'} />
            <MetricCard label="선물 거래강도" value={futures?.available && futures.tradingStrength != null ? futures.tradingStrength.toLocaleString() : '-'} note="원시 데이터가 연결되면 값만 표시" />
            <MetricCard label="선물 거래량" value={futures?.available && futures.tradingVolume != null ? futures.tradingVolume.toLocaleString() : '-'} />
            <MetricCard label="미결제약정" value={futures?.available && futures.openInterest != null ? futures.openInterest.toLocaleString() : '-'} />
            <MetricCard label="외국인 선물 순계약" value={futures?.available && futures.foreignNetContracts != null ? signed(futures.foreignNetContracts) : '-'} />
            <MetricCard label="기관 선물 순계약" value={futures?.available && futures.institutionNetContracts != null ? signed(futures.institutionNetContracts) : '-'} />
          </div>
        </details>

        <details className="panel fold-panel">
          <summary><span><b>1주 동시간 비교</b><small>현재 시각과 가장 가까운 과거 거래일 표본</small></span><strong>{referenceDays.length}/5 거래일</strong></summary>
          <div className="week-table-wrap">
            <div className="week-table week-head"><span>날짜</span><span>시각</span><span>TOP100 거래대금</span><span>TOP10 집중도</span><span>상승비율</span><span>외국인</span><span>기관</span><span>비차익</span></div>
            <div className="week-table current-row"><span>오늘</span><span>{timelineTime(currentMinute)}</span><span>{fmtAmountTrillion(totalAmount)}</span><span>{currentConcentration == null ? '-' : `${currentConcentration.toFixed(1)}%`}</span><span>{breadth.share == null ? '-' : `${breadth.share.toFixed(1)}%`}</span><span>{fmtWon(investorTotal?.foreignerNetBuyAmount)}</span><span>{fmtWon(investorTotal?.institutionNetBuyAmount)}</span><span>{fmtShares(snapshot?.programSummary?.nonArbitrageNetBuyVolume)}</span></div>
            {dayRows.map((row) => <div className="week-table" key={row.day}><span>{row.day}</span><span>{row.time}</span><span>{row.amount == null ? '-' : fmtAmountTrillion(row.amount / 1_000_000_000_000)}</span><span>{row.concentration == null ? '-' : `${row.concentration.toFixed(1)}%`}</span><span>{row.breadth == null ? '-' : `${row.breadth.toFixed(1)}%`}</span><span>{fmtWon(row.foreign)}</span><span>{fmtWon(row.institution)}</span><span>{fmtShares(row.nonArbitrage)}</span></div>)}
            {!dayRows.length && <div className="empty-state">비교 가능한 이전 거래일 데이터가 아직 없습니다.</div>}
          </div>
        </details>

        <details className="panel fold-panel">
          <summary><span><b>테마 순환 기록</b><small>각 시간대에 추적 섹터 중 거래대금 1위였던 섹터</small></span><strong>{rotationRows.length}개 시점</strong></summary>
          <div className="rotation-strip">
            {rotationRows.map((row) => <div key={`${row.time}-${row.sector}`}><span>{row.time}</span><strong>{row.sector}</strong><small>{fmtAmountTrillion(row.turnover)}</small></div>)}
            {!rotationRows.length && <div className="empty-state">오늘 저장된 시간대별 데이터가 쌓이면 표시됩니다.</div>}
          </div>
        </details>

        <details className="panel fold-panel">
          <summary><span><b>종목 거래대금 변화</b><small>현재 거래대금 ÷ 최근 동시간 평균, 최근 10분 증가액</small></span><strong>TOP 10</strong></summary>
          <div className="accel-table-wrap">
            <div className="accel-table accel-head"><span>종목</span><span>현재 거래대금</span><span>동시간 평균</span><span>평균 대비 배수</span><span>최근 10분 증가</span></div>
            {accelerationRows.map(({ stock, avg, ratio, increase10m }) => <div className="accel-table" key={stock.symbol}><span><b>{stock.name ?? stock.symbol}</b><small>{stock.symbol}</small></span><span>{stock.tradingAmount == null ? '-' : fmtAmountTrillion(stock.tradingAmount / 1_000_000_000_000)}</span><span>{avg == null ? '-' : fmtAmountTrillion(avg / 1_000_000_000_000)}</span><span>{ratio == null ? '-' : `${ratio.toFixed(2)}×`}</span><span>{increase10m == null ? '-' : fmtWon(increase10m)}</span></div>)}
            {!accelerationRows.length && <div className="empty-state">종목별 동시간 비교 표본을 수집 중입니다.</div>}
          </div>
        </details>

        <details className="panel fold-panel">
          <summary><span><b>뉴스 · 동적 테마 분류</b><small>고정 테마와 당일 뉴스 기반 테마를 분리하는 영역</small></span><strong>데이터 소스 준비</strong></summary>
          <div className="source-status-grid">
            <div><span>고정 기업/테마 매핑</span><strong>현재 대표종목 매핑 사용</strong><small>한 종목에 복수 테마 태그를 허용하는 구조로 확장 예정</small></div>
            <div><span>당일 뉴스/공시</span><strong>미연결</strong><small>뉴스·공시 원문 데이터 소스를 연결한 뒤 객관적 출처와 분류 신뢰도만 표시</small></div>
            <div><span>신규 테마 후보</span><strong>미연결</strong><small>뉴스 직접 언급, 기업 사업 연관성, 동시 거래대금 증가를 각각 별도 값으로 보관</small></div>
          </div>
        </details>
      </section>
    </main>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { mergeLiveSectors } from './marketData'
import type { MarketSnapshot } from './marketData'

type RankingItem = {
  symbol: string | null
  name: string | null
  tradingAmount: number | null
}

type InvestorMarket = {
  foreignerNetBuyAmount: number | null
  institutionNetBuyAmount: number | null
  coverage?: string
}

type ExtendedSnapshot = MarketSnapshot & {
  topRankings?: RankingItem[]
  marketInvestors?: { total?: InvestorMarket | null } | null
}

type HistorySample = {
  updatedAt: string
  marketTradingAmount: number | null
  indices: ExtendedSnapshot['indices']
  stocks: ExtendedSnapshot['stocks']
  topRankings?: RankingItem[]
  marketInvestors?: ExtendedSnapshot['marketInvestors']
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

function fmtWon(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(2)}조`
  if (abs >= 100_000_000) return `${sign}${Math.round(abs / 100_000_000).toLocaleString()}억`
  return `${sign}${Math.round(abs).toLocaleString()}원`
}

function fmtAmountTrillion(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  if (value >= 1) return `${value.toFixed(value >= 10 ? 1 : 2)}조`
  return `${Math.round(value * 10_000).toLocaleString()}억`
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
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
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
  return [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 5).map(([day, list]) => {
    const sample = list.reduce((best, item) => Math.abs(minuteFromIso(item.updatedAt) - targetMinute) < Math.abs(minuteFromIso(best.updatedAt) - targetMinute) ? item : best)
    return { day, sample, minuteGap: Math.abs(minuteFromIso(sample.updatedAt) - targetMinute) }
  }).filter((item) => item.minuteGap <= 10)
}

function sampleAsSnapshot(sample: HistorySample): MarketSnapshot {
  return {
    ok: true,
    mode: 'live',
    updatedAt: sample.updatedAt,
    marketSession: '',
    indices: sample.indices ?? {},
    stocks: sample.stocks ?? {},
    marketTradingAmount: sample.marketTradingAmount ?? null,
  }
}

function concentration(snapshot: Pick<ExtendedSnapshot, 'topRankings' | 'marketTradingAmount'>) {
  const total = snapshot.marketTradingAmount
  if (total == null || total <= 0) return null
  const top = [...(snapshot.topRankings ?? [])].map((item) => item.tradingAmount ?? 0).sort((a, b) => b - a).slice(0, 10).reduce((sum, value) => sum + value, 0)
  return top / total * 100
}

function breadthFromStocks(stocks: ExtendedSnapshot['stocks']) {
  const list = Object.values(stocks ?? {}).filter((stock) => stock.changeRate != null)
  if (!list.length) return { advancers: 0, decliners: 0, unchanged: 0, share: null as number | null }
  const advancers = list.filter((stock) => (stock.changeRate ?? 0) > 0).length
  const decliners = list.filter((stock) => (stock.changeRate ?? 0) < 0).length
  return { advancers, decliners, unchanged: list.length - advancers - decliners, share: advancers / list.length * 100 }
}

function amountDirectionShare(stocks: ExtendedSnapshot['stocks']) {
  const list = Object.values(stocks ?? {}).filter((stock) => stock.tradingAmount != null && stock.changeRate != null)
  const total = list.reduce((sum, stock) => sum + (stock.tradingAmount ?? 0), 0)
  if (!total) return { up: null as number | null, down: null as number | null }
  const up = list.filter((stock) => (stock.changeRate ?? 0) > 0).reduce((sum, stock) => sum + (stock.tradingAmount ?? 0), 0)
  const down = list.filter((stock) => (stock.changeRate ?? 0) < 0).reduce((sum, stock) => sum + (stock.tradingAmount ?? 0), 0)
  return { up: up / total * 100, down: down / total * 100 }
}

function MetricCard({ label, value, average: avg, delta, percentile: pct, note }: MetricCardProps) {
  return <div className="comparison-card">
    <span>{label}</span><strong className="value-flash-soft">{value}</strong>
    <div className="comparison-lines">
      {avg && <small>최근 동시간 평균 <b>{avg}</b></small>}
      {delta && <small>평균 대비 <b>{delta}</b></small>}
      {pct && <small>동시간 표본 백분위 <b>{pct}</b></small>}
      {note && <small>{note}</small>}
    </div>
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
  const [sectorName, setSectorName] = useState('반도체')

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    let historyTick = 0
    const load = async () => {
      try {
        const next = await fetchSnapshot(controller.signal)
        setSnapshot(next)
        setApiError(next.error ?? null)
        if (historyTick % 6 === 0) {
          const nextHistory = await fetchHistory(controller.signal).catch(() => null)
          if (nextHistory) setHistory(nextHistory)
        }
        historyTick += 1
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setApiError('백엔드 연결 대기 중')
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(load, 10000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const live = Boolean(snapshot?.ok)
  const sectors = useMemo(() => mergeLiveSectors(snapshot), [snapshot])
  const selectedSector = sectors.find((sector) => sector.name === sectorName) ?? sectors[0]
  const currentDay = snapshot?.updatedAt ? dateKey(snapshot.updatedAt) : dateKey(new Date().toISOString())
  const currentMinute = snapshot?.updatedAt ? minuteFromIso(snapshot.updatedAt) : 0
  const referenceDays = useMemo(() => nearestPerTradingDay(history.samples, currentMinute, currentDay), [history.samples, currentMinute, currentDay])
  const kospi = snapshot?.indices?.KOSPI
  const kosdaq = snapshot?.indices?.KOSDAQ
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
  const rankedSectors = [...sectors].sort((a, b) => b.turnover - a.turnover)
  const medianTurnover = [...sectors].map((sector) => sector.turnover).sort((a, b) => a - b)[Math.floor(sectors.length / 2)] || 0
  const sectorReference = (name: string) => average(referenceDays.map(({ sample }) => mergeLiveSectors(sampleAsSnapshot(sample)).find((sector) => sector.name === name)?.turnover ?? null))

  return <main className="terminal-shell market-lab" data-testid="moneyflow-dashboard">
    <section className={`data-status ${live ? 'live' : 'demo'}`}>
      <span>{live ? '● TOSS LIVE' : '● 데이터 연결 대기'}</span>
      <strong>{snapshot?.marketSession ?? '국내 통합시장'}</strong>
      <em>{snapshot?.updatedAt ? `업데이트 ${new Date(snapshot.updatedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })} · 비교데이터 ${history.tradingDays}거래일` : '실시간 데이터 준비 중'}</em>
    </section>
    {apiError && <div className="api-error">{apiError}</div>}

    <section className="market-strip">
      <div><span>KOSPI</span><strong>{kospi?.lastPrice?.toLocaleString() ?? '-'}</strong><em className={(kospi?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{signed(kospi?.changeRate, '%')}</em></div>
      <div><span>KOSDAQ</span><strong>{kosdaq?.lastPrice?.toLocaleString() ?? '-'}</strong><em className={(kosdaq?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{signed(kosdaq?.changeRate, '%')}</em></div>
      <div><span>상승 / 하락 / 보합</span><strong>{breadth.advancers} / {breadth.decliners} / {breadth.unchanged}</strong><em>현재 추적 종목 기준</em></div>
      <div><span>통합 거래대금 TOP100</span><strong>{fmtAmountTrillion(totalAmount)}</strong><em>거래대금 랭킹 합계</em></div>
      <div><span>외국인 / 기관 현물 순매수</span><strong className={(investorTotal?.foreignerNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtWon(investorTotal?.foreignerNetBuyAmount)}</strong><em className={(investorTotal?.institutionNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtWon(investorTotal?.institutionNetBuyAmount)}</em></div>
    </section>

    <section className="comparison-grid" aria-label="동시간 과거 비교">
      <MetricCard label="거래대금 TOP100" value={fmtAmountTrillion(totalAmount)} average={amountAverage == null ? null : fmtAmountTrillion(amountAverage / 1_000_000_000_000)} delta={pctDelta(totalAmountWon, amountAverage) == null ? null : signed(pctDelta(totalAmountWon, amountAverage), '%')} percentile={percentile(totalAmountWon, referenceAmounts) == null ? null : `${percentile(totalAmountWon, referenceAmounts)}%`} note={`${referenceDays.length}/5 거래일 동시간 표본`} />
      <MetricCard label="TOP10 거래대금 집중도" value={currentConcentration == null ? '-' : `${currentConcentration.toFixed(1)}%`} average={average(concentrationReferences) == null ? null : `${average(concentrationReferences)?.toFixed(1)}%`} />
      <MetricCard label="상승 종목 비율" value={breadth.share == null ? '-' : `${breadth.share.toFixed(1)}%`} average={average(breadthReferences) == null ? null : `${average(breadthReferences)?.toFixed(1)}%`} note={`거래대금 기준 상승 ${directionShare.up == null ? '-' : `${directionShare.up.toFixed(1)}%`} / 하락 ${directionShare.down == null ? '-' : `${directionShare.down.toFixed(1)}%`}`} />
      <MetricCard label="외국인 현물 순매수" value={fmtWon(investorTotal?.foreignerNetBuyAmount)} average={fmtWon(average(foreignReferences))} />
      <MetricCard label="기관 현물 순매수" value={fmtWon(investorTotal?.institutionNetBuyAmount)} average={fmtWon(average(institutionReferences))} />
    </section>

    <section className="dashboard-grid objective-grid simplified-market-grid">
      <section className="panel heatmap-panel market-map-panel">
        <div className="panel-head"><div><p>MARKET MAP</p><h2>한국 시장 전체 Heatmap</h2></div><span className={live ? 'live-badge' : 'demo-badge'}>{live ? '거래대금 면적 · 등락률 색' : '준비 중'}</span></div>
        <div className="market-map-grid">
          {rankedSectors.map((sector, index) => {
            const share = totalAmount > 0 ? sector.turnover / totalAmount * 100 : 0
            const ref = sectorReference(sector.name)
            const ratio = ref && ref > 0 ? sector.turnover / ref : null
            const vsMedian = medianTurnover > 0 ? sector.turnover / medianTurnover : null
            const intensity = Math.min(.88, .13 + Math.abs(sector.change) / 7)
            return <button key={sector.name} className={`market-map-tile heat-tile ${sector.change >= 0 ? 'positive' : 'negative'} ${sector.name === selectedSector?.name ? 'active' : ''} ${vsMedian != null && vsMedian >= 2 ? 'turnover-outlier' : ''}`} style={{ ['--heat' as string]: intensity, gridColumn: `span ${share >= 20 || index === 0 ? 2 : 1}` }} onClick={() => setSectorName(sector.name)}>
              <div className="map-title"><span>{sector.name}</span>{index === 0 && <b>거래대금 1위</b>}</div>
              <strong>{signed(sector.change, '%')}</strong>
              <small>{fmtAmountTrillion(sector.turnover)} · TOP100 대비 {share.toFixed(1)}%</small>
              <small>5일 동시간 {ratio == null ? '-' : `${ratio.toFixed(2)}×`}</small>
            </button>
          })}
        </div>
      </section>

      <aside className="panel ranking-panel">
        <div className="panel-head"><div><p>MONEY FLOW</p><h2>거래대금 순위</h2></div></div>
        <div className="ranking-list objective-ranking">
          {rankedSectors.map((sector, index) => {
            const share = totalAmount > 0 ? sector.turnover / totalAmount * 100 : 0
            return <button key={sector.name} onClick={() => setSectorName(sector.name)} className={sector.name === selectedSector?.name ? 'active' : ''}>
              <b>{String(index + 1).padStart(2, '0')}</b><span>{sector.name}<small>{fmtAmountTrillion(sector.turnover)} · {signed(sector.change, '%')}</small></span><strong>{share.toFixed(1)}%</strong>
            </button>
          })}
        </div>
      </aside>
    </section>
  </main>
}

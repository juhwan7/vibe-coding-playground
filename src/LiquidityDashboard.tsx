import { useEffect, useMemo, useState } from 'react'
import './liquidity.css'

type IndexPoint = { lastPrice?: number | null; changeRate?: number | null }
type InvestorTotal = {
  foreignerNetBuyAmount?: number | null
  institutionNetBuyAmount?: number | null
  individualNetBuyAmount?: number | null
}
type ProgramSummary = {
  arbitrageNetBuyVolume?: number | null
  nonArbitrageNetBuyVolume?: number | null
  symbolCount?: number | null
}
type Snapshot = {
  ok?: boolean
  updatedAt?: string
  marketSession?: string
  marketTradingAmount?: number | null
  marketTradingAmountCoverage?: string | null
  indices?: { KOSPI?: IndexPoint; KOSDAQ?: IndexPoint }
  marketInvestors?: { total?: InvestorTotal | null } | null
  programSummary?: ProgramSummary | null
}
type HistorySample = Snapshot & { updatedAt: string }
type HistoryResponse = { tradingDays?: number; samples?: HistorySample[] }
type Funding = {
  ok?: boolean
  configured?: boolean
  source?: string
  sourceDataset?: string
  frequency?: string
  investorDeposits?: number | null
  cmaBalance?: number | null
  creditBalance?: number | null
  unsettledReceivables?: number | null
  updatedAt?: string | null
  note?: string | null
}

function fmtAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(abs >= 10_000_000_000_000 ? 1 : 2)}조`
  if (abs >= 100_000_000) return `${sign}${Math.round(abs / 100_000_000).toLocaleString()}억`
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString()}만`
  return `${sign}${Math.round(abs).toLocaleString()}`
}

function fmtSignedAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${fmtAmount(value)}`
}

function fmtRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function displayTime(iso?: string | null) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

function kstDay(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

function minuteOfDay(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
}

function nearestSample(samples: HistorySample[], day: string, minute: number) {
  const matches = samples.filter((sample) => kstDay(sample.updatedAt) === day)
  if (!matches.length) return null
  return matches.reduce<{ sample: HistorySample; gap: number } | null>((best, sample) => {
    const gap = Math.abs(minuteOfDay(sample.updatedAt) - minute)
    return !best || gap < best.gap ? { sample, gap } : best
  }, null)?.sample ?? null
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="liquidity-spark-empty">1분 데이터 축적 중</div>
  const width = 480
  const height = 100
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  const path = values.map((value, index) => {
    const x = index / Math.max(1, values.length - 1) * width
    const y = height - 8 - (value - min) / range * (height - 16)
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return <svg className="liquidity-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="오늘 TOP100 누적 거래대금 추이"><path d={path} /></svg>
}

export default function LiquidityDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [history, setHistory] = useState<HistorySample[]>([])
  const [historyDays, setHistoryDays] = useState(0)
  const [funding, setFunding] = useState<Funding | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    let marketReady = false
    const load = async () => {
      try {
        const [snapshotResponse, historyResponse, fundingResponse] = await Promise.all([
          fetch('/api/market/snapshot', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
          fetch('/api/market/history?days=8&resolution=1', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
          fetch('/api/market/funding', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
        ])
        if (snapshotResponse?.ok) {
          const payload = await snapshotResponse.json() as Snapshot
          setSnapshot(payload)
          marketReady = Boolean(payload.ok)
        }
        if (historyResponse?.ok) {
          const payload = await historyResponse.json() as HistoryResponse
          setHistory(payload.samples ?? [])
          setHistoryDays(payload.tradingDays ?? 0)
        }
        if (fundingResponse?.ok) setFunding(await fundingResponse.json() as Funding)
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      } finally {
        timer = window.setTimeout(load, marketReady ? 60000 : 5000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const analytics = useMemo(() => {
    if (!snapshot?.updatedAt) return { minuteIncrease: null, sameTimeAvg: null, ratio: null, todaySeries: [] as number[] }
    const currentDay = kstDay(snapshot.updatedAt)
    const currentMinute = minuteOfDay(snapshot.updatedAt)
    const today = history.filter((sample) => kstDay(sample.updatedAt) === currentDay).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    const previous = [...today].reverse().find((sample) => minuteOfDay(sample.updatedAt) < currentMinute)
    const currentAmount = snapshot.marketTradingAmount ?? null
    const minuteIncrease = currentAmount != null && previous?.marketTradingAmount != null ? currentAmount - previous.marketTradingAmount : null

    const days = [...new Set(history.map((sample) => kstDay(sample.updatedAt)))].filter((day) => day !== currentDay).sort().slice(-5)
    const sameTimeValues = days
      .map((day) => nearestSample(history, day, currentMinute)?.marketTradingAmount ?? null)
      .filter((value): value is number => value != null && Number.isFinite(value))
    const sameTimeAvg = sameTimeValues.length ? sameTimeValues.reduce((sum, value) => sum + value, 0) / sameTimeValues.length : null
    const ratio = currentAmount != null && sameTimeAvg && sameTimeAvg > 0 ? currentAmount / sameTimeAvg * 100 : null
    const todaySeries = today.map((sample) => sample.marketTradingAmount ?? null).filter((value): value is number => value != null && Number.isFinite(value))
    if (currentAmount != null && (todaySeries.length === 0 || todaySeries.at(-1) !== currentAmount)) todaySeries.push(currentAmount)
    return { minuteIncrease, sameTimeAvg, ratio, todaySeries, baselineDays: sameTimeValues.length }
  }, [snapshot, history])

  const investors = snapshot?.marketInvestors?.total
  const program = snapshot?.programSummary
  const leverageRatio = funding?.investorDeposits && funding.creditBalance != null ? funding.creditBalance / funding.investorDeposits * 100 : null
  const receivableRatio = funding?.investorDeposits && funding.unsettledReceivables != null ? funding.unsettledReceivables / funding.investorDeposits * 100 : null

  const fundingCards = [
    ['투자자예탁금', funding?.investorDeposits, '주식 매수 대기자금 성격 · 일간'],
    ['CMA 잔고', funding?.cmaBalance, 'CMA 전체 잔고 · 일간'],
    ['신용융자 잔고', funding?.creditBalance, '신용거래 융자 잔고 · T+1'],
    ['미수금', funding?.unsettledReceivables, '주식 위탁매매 미수금 · 일간'],
  ] as const

  return <main className="liquidity-page" data-testid="liquidity-dashboard">
    <header className="liquidity-hero">
      <div><p>DOMESTIC MARKET LIQUIDITY</p><h1>국내 증시 자금 상태</h1><small>실시간 시장 거래와 일별 주변자금을 분리해 표시합니다. 수치는 그대로 보여주며 별도의 시장 해석이나 매매 판단 문구는 넣지 않습니다.</small></div>
      <div className="liquidity-update"><b>● 1분 업데이트</b><span>{displayTime(snapshot?.updatedAt)}</span><small>{snapshot?.marketSession ?? '시장 데이터 연결 대기'}</small></div>
    </header>

    <section className="liquidity-section">
      <div className="liquidity-section-head"><div><p>INTRADAY / 1 MIN</p><h2>오늘 시장에 실제로 움직인 돈</h2></div><span>TOP100 1일 누적 기준</span></div>
      <div className="liquidity-primary-grid">
        <article className="liquidity-card primary"><span>TOP100 누적 거래대금</span><strong>{fmtAmount(snapshot?.marketTradingAmount)}</strong><small>{snapshot?.marketTradingAmountCoverage ?? '데이터 대기'}</small></article>
        <article className="liquidity-card"><span>최근 1분 증가액</span><strong>{fmtSignedAmount(analytics.minuteIncrease)}</strong><small>직전 저장 1분 표본 대비</small></article>
        <article className="liquidity-card"><span>과거 동시간 평균</span><strong>{fmtAmount(analytics.sameTimeAvg)}</strong><small>{analytics.baselineDays ?? 0}개 거래일 표본</small></article>
        <article className="liquidity-card"><span>동시간 평균 대비</span><strong>{analytics.ratio == null ? '-' : `${analytics.ratio.toFixed(1)}%`}</strong><small>오늘 누적 ÷ 과거 동시간 평균</small></article>
      </div>

      <div className="liquidity-live-grid">
        <article className="liquidity-flow-panel">
          <div className="liquidity-panel-head"><div><span>TOP100 누적 거래대금</span><b>08:00~20:00 · 1분 저장</b></div><small>저장된 거래일 {historyDays}일</small></div>
          <Sparkline values={analytics.todaySeries} />
          <div className="liquidity-chart-foot"><span>현재 {fmtAmount(snapshot?.marketTradingAmount)}</span><span>동시간 평균 {fmtAmount(analytics.sameTimeAvg)}</span></div>
        </article>
        <article className="liquidity-flow-panel">
          <div className="liquidity-panel-head"><div><span>투자주체 현물 순매수</span><b>코스피 + 코스닥</b></div><small>금액</small></div>
          <div className="investor-bars">
            <div><span>외국인</span><strong className={(investors?.foreignerNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtSignedAmount(investors?.foreignerNetBuyAmount)}</strong></div>
            <div><span>기관</span><strong className={(investors?.institutionNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtSignedAmount(investors?.institutionNetBuyAmount)}</strong></div>
            <div><span>개인</span><strong className={(investors?.individualNetBuyAmount ?? 0) >= 0 ? 'up' : 'down'}>{fmtSignedAmount(investors?.individualNetBuyAmount)}</strong></div>
          </div>
        </article>
      </div>

      <div className="liquidity-secondary-grid">
        <article className="liquidity-card compact"><span>KOSPI</span><strong>{snapshot?.indices?.KOSPI?.lastPrice?.toLocaleString() ?? '-'}</strong><small className={(snapshot?.indices?.KOSPI?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(snapshot?.indices?.KOSPI?.changeRate)}</small></article>
        <article className="liquidity-card compact"><span>KOSDAQ</span><strong>{snapshot?.indices?.KOSDAQ?.lastPrice?.toLocaleString() ?? '-'}</strong><small className={(snapshot?.indices?.KOSDAQ?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(snapshot?.indices?.KOSDAQ?.changeRate)}</small></article>
        <article className="liquidity-card compact"><span>비차익 프로그램</span><strong>{fmtSignedAmount(program?.nonArbitrageNetBuyVolume)}</strong><small>주식수 · 추적 {program?.symbolCount ?? 0}종목</small></article>
        <article className="liquidity-card compact"><span>차익 프로그램</span><strong>{fmtSignedAmount(program?.arbitrageNetBuyVolume)}</strong><small>주식수 · 추적 {program?.symbolCount ?? 0}종목</small></article>
      </div>
    </section>

    <section className="liquidity-section funding-section">
      <div className="liquidity-section-head"><div><p>SIDELINE CASH / LEVERAGE</p><h2>증시 주변자금 · 대기자금 · 레버리지</h2></div><span className={funding?.ok ? 'source-ready' : 'source-wait'}>{funding?.ok ? '공식 데이터 연결' : '공식 데이터 연결 대기'}</span></div>
      <div className="funding-grid">
        {fundingCards.map(([label, value, detail]) => <article className="funding-card" key={label}><span>{label}</span><strong>{fmtAmount(value)}</strong><small>{detail}</small></article>)}
        <article className="funding-card ratio"><span>신용융자 / 예탁금</span><strong>{leverageRatio == null ? '-' : `${leverageRatio.toFixed(2)}%`}</strong><small>신용융자 잔고 ÷ 투자자예탁금</small></article>
        <article className="funding-card ratio"><span>미수금 / 예탁금</span><strong>{receivableRatio == null ? '-' : `${receivableRatio.toFixed(2)}%`}</strong><small>미수금 ÷ 투자자예탁금</small></article>
      </div>
      <div className="funding-source-note"><b>{funding?.source ?? '금융위원회_금융투자협회종합통계정보'}</b><span>{funding?.sourceDataset ?? 'data.go.kr 15094809'} · {funding?.frequency ?? '일간/T+1'}</span><small>{funding?.note ?? '서비스키 연결 전에는 값을 임의로 채우지 않습니다.'}</small></div>
    </section>
  </main>
}

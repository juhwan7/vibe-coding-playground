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

type Snapshot = {
  ok?: boolean
  updatedAt?: string
  topRankings?: RankingItem[]
  marketTradingAmount?: number | null
}

type HistorySample = {
  updatedAt: string
  topRankings?: RankingItem[]
  marketTradingAmount?: number | null
}

type HistoryResponse = {
  samples?: HistorySample[]
}

type FlowRow = {
  item: RankingItem
  rank: number
  share: number | null
  increase10m: number | null
  increase30m: number | null
  previousRank30m: number | null
  rankMove30m: number | null
  spark: number[]
}

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

function fmtSignedAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  const prefix = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${prefix}${fmtAmount(Math.abs(value))}`
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

function displayTime(iso?: string) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso))
}

function itemForSymbol(sample: HistorySample, symbol: string) {
  return sample.topRankings?.find((item) => item.symbol === symbol) ?? null
}

function rankForSymbol(sample: HistorySample, symbol: string) {
  const index = sample.topRankings?.findIndex((item) => item.symbol === symbol) ?? -1
  return index >= 0 ? index + 1 : null
}

function nearestAtOrBefore(samples: HistorySample[], targetMinute: number) {
  const candidates = samples.filter((sample) => minuteFromIso(sample.updatedAt) <= targetMinute)
  if (!candidates.length) return null
  return candidates.reduce((best, item) => minuteFromIso(item.updatedAt) > minuteFromIso(best.updatedAt) ? item : best)
}

function sparkPath(values: number[], width = 176, height = 44) {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  return values.map((value, index) => {
    const x = index / Math.max(1, values.length - 1) * width
    const y = height - 4 - ((value - min) / range) * (height - 8)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

export default function MarketWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [history, setHistory] = useState<HistorySample[]>([])
  const [visibleCount, setVisibleCount] = useState<10 | 20 | 30>(20)
  const [sortMode, setSortMode] = useState<'amount' | 'recent'>('amount')

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    let historyTick = 0

    const load = async () => {
      try {
        const response = await fetch('/api/market/snapshot', { signal: controller.signal, headers: { Accept: 'application/json' } })
        if (response.ok) setSnapshot(await response.json() as Snapshot)
        if (historyTick % 6 === 0) {
          const historyResponse = await fetch('/api/market/history?days=2&resolution=5', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null)
          if (historyResponse?.ok) {
            const payload = await historyResponse.json() as HistoryResponse
            setHistory(payload.samples ?? [])
          }
        }
        historyTick += 1
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      } finally {
        timer = window.setTimeout(load, 5000)
      }
    }

    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const rankings = useMemo(() => (snapshot?.topRankings ?? []).filter((item): item is RankingItem & { symbol: string } => Boolean(item.symbol)), [snapshot])
  const currentDay = snapshot?.updatedAt ? dateKey(snapshot.updatedAt) : ''
  const currentMinute = snapshot?.updatedAt ? minuteFromIso(snapshot.updatedAt) : 0
  const todayHistory = useMemo(() => history.filter((sample) => currentDay && dateKey(sample.updatedAt) === currentDay).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)), [history, currentDay])
  const totalAmount = snapshot?.marketTradingAmount ?? rankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)

  const flowRows = useMemo<FlowRow[]>(() => rankings.map((item, index) => {
    const symbol = item.symbol as string
    const before10 = nearestAtOrBefore(todayHistory, currentMinute - 10)
    const before30 = nearestAtOrBefore(todayHistory, currentMinute - 30)
    const amount10 = before10 ? itemForSymbol(before10, symbol)?.tradingAmount ?? null : null
    const amount30 = before30 ? itemForSymbol(before30, symbol)?.tradingAmount ?? null : null
    const currentAmount = item.tradingAmount ?? null
    const previousRank30m = before30 ? rankForSymbol(before30, symbol) : null
    const rank = index + 1
    const recentSamples = todayHistory.filter((sample) => minuteFromIso(sample.updatedAt) >= Math.max(0, currentMinute - 90))
    const spark = recentSamples.map((sample) => itemForSymbol(sample, symbol)?.tradingAmount ?? null).filter((value): value is number => value != null && Number.isFinite(value))
    if (currentAmount != null && (spark.length === 0 || spark[spark.length - 1] !== currentAmount)) spark.push(currentAmount)

    return {
      item,
      rank,
      share: currentAmount != null && totalAmount > 0 ? currentAmount / totalAmount * 100 : null,
      increase10m: currentAmount != null && amount10 != null ? currentAmount - amount10 : null,
      increase30m: currentAmount != null && amount30 != null ? currentAmount - amount30 : null,
      previousRank30m,
      rankMove30m: previousRank30m != null ? previousRank30m - rank : null,
      spark,
    }
  }), [rankings, todayHistory, currentMinute, totalAmount])

  const visibleRows = useMemo(() => {
    const rows = [...flowRows]
    if (sortMode === 'recent') rows.sort((a, b) => (b.increase10m ?? -Infinity) - (a.increase10m ?? -Infinity))
    else rows.sort((a, b) => a.rank - b.rank)
    return rows.slice(0, visibleCount)
  }, [flowRows, visibleCount, sortMode])

  const maxCurrent = Math.max(1, ...visibleRows.map((row) => row.item.tradingAmount ?? 0))
  const maxIncrease10m = Math.max(1, ...visibleRows.map((row) => Math.abs(row.increase10m ?? 0)))
  const topAmount = Math.max(1, rankings[0]?.tradingAmount ?? 1)

  return <div className="market-workspace">
    <section className="workspace-main">
      <section className="top-flow-board panel" data-testid="top-flow-board">
        <div className="flow-board-head">
          <div>
            <p>TOP TURNOVER FLOW</p>
            <h1>거래대금 상위 종목 자금 이동 비교</h1>
            <small>누적 거래대금과 최근 10분 증가액을 같은 종목 행에서 세로로 비교합니다. 별도 해석 문구 없이 원시 비교값만 표시합니다.</small>
          </div>
          <div className="flow-controls">
            <div className="segmented-control" aria-label="정렬 기준">
              <button className={sortMode === 'amount' ? 'active' : ''} onClick={() => setSortMode('amount')}>누적 순위</button>
              <button className={sortMode === 'recent' ? 'active' : ''} onClick={() => setSortMode('recent')}>최근 10분 증가</button>
            </div>
            <div className="segmented-control" aria-label="표시 종목 수">
              {([10, 20, 30] as const).map((count) => <button key={count} className={visibleCount === count ? 'active' : ''} onClick={() => setVisibleCount(count)}>TOP {count}</button>)}
            </div>
          </div>
        </div>

        <div className="flow-column-head">
          <span>종목</span><span>현재 거래대금</span><span>TOP100 비중</span><span>최근 10분 증가</span><span>30분 순위변화</span><span>최근 90분</span>
        </div>
        <div className="flow-rows">
          {visibleRows.map((row) => {
            const amountWidth = (row.item.tradingAmount ?? 0) / maxCurrent * 100
            const recentWidth = Math.abs(row.increase10m ?? 0) / maxIncrease10m * 100
            const move = row.rankMove30m
            return <article className="flow-stock-row" key={row.item.symbol}>
              <div className="flow-stock-name"><b>{String(row.rank).padStart(2, '0')}</b><span><strong>{row.item.name ?? row.item.symbol}</strong><small>{row.item.symbol} · {row.item.market ?? '-'}</small></span><em className={(row.item.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(row.item.changeRate)}</em></div>
              <div className="flow-bar-cell"><strong>{fmtAmount(row.item.tradingAmount)}</strong><div className="flow-bar-track"><i className="flow-bar cumulative" style={{ width: `${amountWidth}%` }} /></div></div>
              <div className="flow-share"><strong>{row.share == null ? '-' : `${row.share.toFixed(2)}%`}</strong><small>TOP100 합계 기준</small></div>
              <div className="flow-bar-cell recent"><strong>{fmtSignedAmount(row.increase10m)}</strong><div className="flow-bar-track"><i className={`flow-bar recent-bar ${(row.increase10m ?? 0) < 0 ? 'negative' : ''}`} style={{ width: `${recentWidth}%` }} /></div><small>30분 {fmtSignedAmount(row.increase30m)}</small></div>
              <div className="rank-move"><strong>{move == null ? '-' : move === 0 ? '0' : `${move > 0 ? '▲ ' : '▼ '}${Math.abs(move)}`}</strong><small>{row.previousRank30m == null ? '30분 표본 없음' : `30분 전 ${row.previousRank30m}위`}</small></div>
              <div className="spark-cell"><svg viewBox="0 0 176 44" preserveAspectRatio="none" role="img" aria-label={`${row.item.name ?? row.item.symbol} 최근 90분 누적 거래대금`}><path d={sparkPath(row.spark)} /></svg><small>종목별 축 · {row.spark.length}개 표본</small></div>
            </article>
          })}
          {!visibleRows.length && <div className="workspace-empty">실시간 거래대금 TOP100 데이터 연결 대기 중입니다.</div>}
        </div>
      </section>

      <MarketDashboard />
    </section>

    <aside className="top100-rail panel" data-testid="top100-ranking">
      <div className="top100-head">
        <div><p>MARKET TURNOVER</p><h2>거래대금 TOP100</h2></div>
        <span>{displayTime(snapshot?.updatedAt)}</span>
      </div>
      <div className="top100-summary"><span>합계</span><strong>{fmtAmount(totalAmount)}</strong><small>{rankings.length}/100 종목 수신</small></div>
      <div className="top100-list">
        {rankings.slice(0, 100).map((item, index) => {
          const amount = item.tradingAmount ?? 0
          const width = amount / topAmount * 100
          const share = totalAmount > 0 ? amount / totalAmount * 100 : 0
          return <div className="top100-row" key={`${item.symbol}-${index}`}>
            <b>{String(index + 1).padStart(2, '0')}</b>
            <div className="top100-stock"><strong>{item.name ?? item.symbol}</strong><small>{item.symbol} · {fmtAmount(item.tradingAmount)}</small><div className="top100-mini-track"><i style={{ width: `${width}%` }} /></div></div>
            <div className="top100-values"><strong className={(item.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(item.changeRate)}</strong><small>{share.toFixed(2)}%</small></div>
          </div>
        })}
        {!rankings.length && <div className="workspace-empty">TOP100 라이브 데이터 연결 대기 중</div>}
      </div>
    </aside>
  </div>
}

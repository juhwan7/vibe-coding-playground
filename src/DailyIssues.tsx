import { useEffect, useMemo, useState } from 'react'
import './dailyIssues.css'

type LinePoint = { timestamp: string; value: number }
type IssueLink = { title?: string | null; link?: string | null; source?: string | null }
type DailyIssueRow = {
  symbol: string
  name: string
  market?: string | null
  theme?: string | null
  price?: number | null
  changeRate?: number | null
  tradingAmount?: number | null
  issueSummary?: string | null
  articleCount?: number | null
  sources?: string[] | null
  links?: IssueLink[] | null
  intraday?: LinePoint[] | null
}
type DailyIssuePayload = {
  ok?: boolean
  status?: 'waiting' | 'pending' | 'generating' | 'finalized'
  date?: string | null
  capturedAt?: string | null
  targetTime?: string | null
  source?: string | null
  rows?: DailyIssueRow[]
  error?: string | null
}

function fmtRate(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function fmtAmount(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '-'
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(value >= 10_000_000_000_000 ? 1 : 2)}조`
  if (value >= 100_000_000) return `${Math.round(value / 100_000_000).toLocaleString()}억`
  return Math.round(value).toLocaleString()
}

function displayTime(value?: string | null) {
  if (!value) return '-'
  try {
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
  } catch { return '-' }
}

function IntradayLine({ points, changeRate }: { points?: LinePoint[] | null; changeRate?: number | null }) {
  const data = (points ?? []).filter((point) => Number.isFinite(point.value))
  if (data.length < 2) return <div className="daily-issues-chart-empty">장중 차트 준비 중</div>
  const width = 260
  const height = 62
  const values = data.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const rawRange = Math.max(0, max - min)
  const visibleRange = Math.max(rawRange, Math.max(1, Math.abs((max + min) / 2) * .002))
  const center = (max + min) / 2
  const lo = center - visibleRange / 2 - visibleRange * .08
  const hi = center + visibleRange / 2 + visibleRange * .08
  const range = Math.max(1, hi - lo)
  const x = (index: number) => index / Math.max(1, data.length - 1) * width
  const y = (value: number) => height - 4 - ((value - lo) / range) * (height - 8)
  const path = data.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(2)} ${y(point.value).toFixed(2)}`).join(' ')
  return <svg className={`daily-issues-chart ${(changeRate ?? 0) >= 0 ? 'up' : 'down'}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="당일 주가 흐름 선차트">
    <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="daily-issues-chart-grid" />
    <path d={path} className="daily-issues-chart-line" fill="none" />
  </svg>
}

export default function DailyIssues() {
  const [payload, setPayload] = useState<DailyIssuePayload>({ ok: false, status: 'waiting', rows: [] })

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        const response = await fetch('/api/market/daily-issues', { signal: controller.signal, headers: { Accept: 'application/json' } })
        const next = await response.json().catch(() => null) as DailyIssuePayload | null
        if (next) setPayload(next)
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(load, payload.ok ? 300000 : 30000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [payload.ok])

  const rows = useMemo(() => [...(payload.rows ?? [])].sort((a, b) => (b.changeRate ?? -Infinity) - (a.changeRate ?? -Infinity) || (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0)), [payload.rows])

  return <main className="daily-issues-page" data-testid="daily-issues">
    <section className="daily-issues-head panel">
      <div>
        <p>DAILY MARKET ISSUE DIGEST / 15:20 KST</p>
        <h1>금일 이슈 정리</h1>
        <small>매일 15:20 기준 거래대금 상위 개별주 100개를 고정해 종목별 당일 이슈를 종합합니다. 등락률 높은 순서로 정렬하며, 확인 가능한 직접 뉴스가 없으면 원인을 임의로 만들지 않고 그대로 표시합니다.</small>
      </div>
      <aside>
        <b className={payload.ok ? 'ready' : 'waiting'}>{payload.ok ? '● 정리 완료' : payload.status === 'generating' ? '● 생성 중' : '● 15:20 대기'}</b>
        <span>{payload.ok ? `${payload.date} · ${displayTime(payload.capturedAt)}` : `오늘 ${payload.targetTime ?? '15:20'} 자동 생성`}</span>
      </aside>
    </section>

    {!payload.ok && <section className="daily-issues-wait panel">
      <strong>{payload.status === 'generating' ? '금일 거래대금 TOP100과 당일 뉴스를 종합하고 있습니다.' : '15:20이 되면 오늘의 거래대금 TOP100을 확정합니다.'}</strong>
      <span>확정 후 종목명 · 테마 · 가격 · 등락률 · 거래대금 · 당일 이슈 · 장중 선차트가 이 메뉴에 저장됩니다.</span>
      {payload.error && <small>{payload.error}</small>}
    </section>}

    {payload.ok && <section className="daily-issues-table panel">
      <div className="daily-issues-table-head">
        <span>순위</span><span>종목명</span><span>테마</span><span>가격</span><span>등락률</span><span>거래대금</span><span>금일 이슈</span><span>장중 흐름</span>
      </div>
      <div className="daily-issues-table-body">
        {rows.map((row, index) => <article className="daily-issues-row" key={row.symbol}>
          <b className="daily-issues-rank">{index + 1}</b>
          <div className="daily-issues-stock"><strong>{row.name}</strong><small>{row.symbol}{row.market ? ` · ${row.market}` : ''}</small></div>
          <span className="daily-issues-theme">{row.theme || '기타'}</span>
          <strong className="daily-issues-price">{row.price?.toLocaleString() ?? '-'}</strong>
          <strong className={`daily-issues-rate ${(row.changeRate ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtRate(row.changeRate)}</strong>
          <strong className="daily-issues-amount">{fmtAmount(row.tradingAmount)}</strong>
          <div className="daily-issues-summary">
            <strong>{row.issueSummary || '직접적인 당일 뉴스 재료 확인 안 됨'}</strong>
            <small>{(row.articleCount ?? 0) > 0 ? `${row.articleCount}건 종합${row.sources?.length ? ` · ${row.sources.join(' · ')}` : ''}` : '확인된 직접 뉴스 없음'}</small>
            {!!row.links?.length && <div>{row.links.slice(0, 2).map((link, linkIndex) => link.link ? <a key={`${row.symbol}-${linkIndex}`} href={link.link} target="_blank" rel="noreferrer">원문 {linkIndex + 1}</a> : null)}</div>}
          </div>
          <div className="daily-issues-chart-cell"><IntradayLine points={row.intraday} changeRate={row.changeRate} /><small>09:00 → 15:20</small></div>
        </article>)}
      </div>
    </section>}
  </main>
}

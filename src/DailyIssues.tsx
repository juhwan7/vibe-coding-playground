import { useEffect, useMemo, useState } from 'react'
import './dailyIssues.css'

type LinePoint = { timestamp: string; value: number }
type IssueLink = { title?: string | null; link?: string | null; source?: string | null }
type DailyIssueRow = {
  symbol: string
  name: string
  market?: string | null
  theme?: string | null
  companySummary?: string | null
  price?: number | null
  changeRate?: number | null
  tradingAmount?: number | null
  issueSummary?: string | null
  reasonType?: 'direct-news' | 'theme-news' | 'unconfirmed' | null
  reasonTheme?: string | null
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

const SESSION_START_MINUTE = 9 * 60
const SESSION_END_MINUTE = 15 * 60 + 20

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

function kstParts(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return {
    day: `${get('month')}-${get('day')}`,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

function TwoDayMinuteLine({ points, changeRate }: { points?: LinePoint[] | null; changeRate?: number | null }) {
  const data = (points ?? [])
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(Date.parse(point.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  if (data.length < 2) return <div className="daily-issues-chart-empty">전일·오늘 1분봉 준비 중</div>

  const width = 520
  const height = 132
  const padX = 8
  const gap = 18
  const parsed = data.map((point) => ({ ...point, ...kstParts(point.timestamp) }))
  const days = [...new Set(parsed.map((point) => point.day))].slice(-2)
  const daySet = new Set(days)
  const visible = parsed.filter((point) => daySet.has(point.day) && point.minute >= SESSION_START_MINUTE && point.minute <= SESSION_END_MINUTE)
  if (visible.length < 2) return <div className="daily-issues-chart-empty">전일·오늘 1분봉 준비 중</div>

  const values = visible.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const rawRange = Math.max(0, max - min)
  const visibleRange = Math.max(rawRange, Math.max(1, Math.abs((max + min) / 2) * .002))
  const center = (max + min) / 2
  const lo = center - visibleRange / 2 - visibleRange * .08
  const hi = center + visibleRange / 2 + visibleRange * .08
  const range = Math.max(1, hi - lo)
  const sessionRange = SESSION_END_MINUTE - SESSION_START_MINUTE
  const panelWidth = days.length > 1 ? (width - padX * 2 - gap) / 2 : width - padX * 2
  const x = (day: string, minute: number) => {
    const dayIndex = Math.max(0, days.indexOf(day))
    const start = padX + dayIndex * (panelWidth + (days.length > 1 ? gap : 0))
    return start + Math.max(0, Math.min(1, (minute - SESSION_START_MINUTE) / sessionRange)) * panelWidth
  }
  const y = (value: number) => height - 10 - ((value - lo) / range) * (height - 20)
  const paths = days.map((day) => {
    const dayPoints = visible.filter((point) => point.day === day)
    return dayPoints.map((point, index) => `${index ? 'L' : 'M'} ${x(day, point.minute).toFixed(2)} ${y(point.value).toFixed(2)}`).join(' ')
  }).filter(Boolean)

  return <div className="daily-issues-chart-stack">
    <svg className={`daily-issues-chart ${(changeRate ?? 0) >= 0 ? 'up' : 'down'}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="전일과 오늘 실제 1분 주가 흐름 선차트">
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="daily-issues-chart-grid" />
      {days.length > 1 && <line x1={width / 2} x2={width / 2} y1="4" y2={height - 4} className="daily-issues-chart-day-divider" />}
      {paths.map((path, index) => <path key={`${days[index] ?? index}`} d={path} className="daily-issues-chart-line" fill="none" />)}
    </svg>
    <div className="daily-issues-chart-labels">
      {days.length > 1 ? <>
        <span>전일 {days[0]} · 09:00 → 15:20</span>
        <span>오늘 {days[1]} · 09:00 → 15:20</span>
      </> : <span>오늘 {days[0]} · 09:00 → 15:20</span>}
    </div>
  </div>
}

function reasonLabel(row: DailyIssueRow) {
  if (row.reasonType === 'direct-news') return '직접 뉴스'
  if (row.reasonType === 'theme-news') return '테마 연동 추정'
  return '이유 미확인'
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
        <small>국내 테마 흐름과 같은 최대 폭으로 읽기 쉽게 정리합니다. 종목별 핵심사업·테마를 붙이고, 상승 이유는 직접 종목 뉴스가 우선이며 없을 때만 같은 테마의 상승 종목 기사로 보조 추정합니다. 차트는 전일·오늘 실제 1분봉을 그대로 사용합니다.</small>
      </div>
      <aside>
        <b className={payload.ok ? 'ready' : 'waiting'}>{payload.ok ? '● 정리 완료' : payload.status === 'generating' ? '● 생성 중' : '● 15:20 대기'}</b>
        <span>{payload.ok ? `${payload.date} · ${displayTime(payload.capturedAt)}` : `오늘 ${payload.targetTime ?? '15:20'} 자동 생성`}</span>
      </aside>
    </section>

    {!payload.ok && <section className="daily-issues-wait panel">
      <strong>{payload.status === 'generating' ? '금일 거래대금 TOP100 · 기업개요 · 뉴스 · 2거래일 1분봉을 종합하고 있습니다.' : '15:20이 되면 오늘의 거래대금 TOP100을 확정합니다.'}</strong>
      <span>확정 후 종목 핵심사업 · 테마 · 등락률 · 거래대금 · 상승 이유 · 전일+오늘 실제 1분 흐름이 저장됩니다.</span>
      {payload.error && <small>{payload.error}</small>}
    </section>}

    {payload.ok && <section className="daily-issues-table panel">
      <div className="daily-issues-table-head">
        <span>순위</span><span>종목 · 어떤 기업 · 테마</span><span>등락 · 거래대금</span><span>금일 상승 이유</span><span>전일 + 오늘 실제 1분 흐름</span>
      </div>
      <div className="daily-issues-table-body">
        {rows.map((row, index) => <article className="daily-issues-row" key={row.symbol}>
          <b className="daily-issues-rank">{index + 1}</b>
          <div className="daily-issues-stock">
            <div className="daily-issues-stock-title"><strong>{row.name}</strong><span>{row.theme || '기타·개별주'}</span></div>
            <p>{row.companySummary || '기업개요 확인 중'}</p>
            <small>{row.symbol}{row.market ? ` · ${row.market}` : ''}</small>
          </div>
          <div className="daily-issues-quote">
            <strong className={`daily-issues-rate ${(row.changeRate ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtRate(row.changeRate)}</strong>
            <span>{row.price?.toLocaleString() ?? '-'}원</span>
            <b>거래대금 {fmtAmount(row.tradingAmount)}</b>
          </div>
          <div className="daily-issues-summary">
            <div className="daily-issues-reason-line">
              <span className={`daily-issues-reason-badge ${row.reasonType ?? 'unconfirmed'}`}>{reasonLabel(row)}</span>
              {row.reasonTheme && <b>{row.reasonTheme}</b>}
            </div>
            <strong>{row.issueSummary || '상승 이유 확인 안 됨'}</strong>
            <small>{row.reasonType === 'theme-news'
              ? `직접 종목 뉴스는 확인되지 않음 · 같은 테마 상승 종목 기사 ${(row.articleCount ?? 0)}건 근거`
              : (row.articleCount ?? 0) > 0
                ? `${row.articleCount}건 종합${row.sources?.length ? ` · ${row.sources.join(' · ')}` : ''}`
                : '확인 가능한 직접 뉴스 또는 테마 상승 기사 없음'}</small>
            {!!row.links?.length && <div>{row.links.slice(0, 2).map((link, linkIndex) => link.link ? <a key={`${row.symbol}-${linkIndex}`} href={link.link} target="_blank" rel="noreferrer">근거 기사 {linkIndex + 1}</a> : null)}</div>}
          </div>
          <div className="daily-issues-chart-cell"><TwoDayMinuteLine points={row.intraday} changeRate={row.changeRate} /></div>
        </article>)}
      </div>
    </section>}
  </main>
}

import { useEffect, useMemo, useState } from 'react'
import './dailyIssues.css'

type LinePoint = { timestamp: string; value: number }
type IntradayDay = { date: string; points: LinePoint[] }
type IntradayValue = IntradayDay[] | LinePoint[]
type IssueLink = { title?: string | null; link?: string | null; source?: string | null }
type DailyIssueRow = {
  symbol: string
  name: string
  market?: string | null
  theme?: string | null
  companySummary?: string | null
  companySummarySource?: string | null
  price?: number | null
  changeRate?: number | null
  tradingAmount?: number | null
  issueSummary?: string | null
  reasonType?: 'direct-news' | 'theme-news' | 'unconfirmed' | null
  reasonTheme?: string | null
  articleCount?: number | null
  sources?: string[] | null
  links?: IssueLink[] | null
  intraday?: IntradayValue | null
}
type DailyIssuePayload = {
  ok?: boolean
  status?: 'waiting' | 'pending' | 'generating' | 'finalized'
  schemaVersion?: number | null
  date?: string | null
  capturedAt?: string | null
  targetTime?: string | null
  source?: string | null
  rows?: DailyIssueRow[]
  error?: string | null
}

const SESSION_START_MINUTE = 9 * 60
const SESSION_END_MINUTE = 15 * 60 + 30
const MAX_CONNECTED_GAP_MS = 15 * 60 * 1000

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

function dateKey(value: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
  } catch { return '' }
}

function minuteOfDay(value: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value))
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
    return hour * 60 + minute
  } catch { return SESSION_START_MINUTE }
}

function shortDate(value: string) {
  const parts = value.split('-')
  return parts.length === 3 ? `${parts[1]}.${parts[2]}` : value
}

function normalizeIntraday(value?: IntradayValue | null): IntradayDay[] {
  if (!Array.isArray(value) || !value.length) return []
  const first = value[0] as IntradayDay | LinePoint
  if ('points' in first) {
    return (value as IntradayDay[])
      .map((day) => ({ date: day.date, points: [...(day.points ?? [])].filter((point) => Number.isFinite(point.value)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)) }))
      .filter((day) => day.date && day.points.length)
      .slice(-2)
  }
  const points = (value as LinePoint[]).filter((point) => Number.isFinite(point.value)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const day = points.length ? dateKey(points.at(-1)!.timestamp) : ''
  return day ? [{ date: day, points }] : []
}

function splitSegments(points: LinePoint[]) {
  const segments: LinePoint[][] = []
  let current: LinePoint[] = []
  for (const point of points) {
    const previous = current.at(-1)
    if (previous && Date.parse(point.timestamp) - Date.parse(previous.timestamp) > MAX_CONNECTED_GAP_MS) {
      if (current.length >= 2) segments.push(current)
      current = []
    }
    current.push(point)
  }
  if (current.length >= 2) segments.push(current)
  return segments
}

function fmtChartPrice(value: number) {
  if (!Number.isFinite(value)) return '-'
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString()
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function reasonLabel(row: DailyIssueRow) {
  if (row.reasonType === 'direct-news') return '종목 직접 기사'
  if (row.reasonType === 'theme-news') return '테마 연동 추정'
  return '이유 미확인'
}

function companyText(row: DailyIssueRow) {
  if (row.companySummary) return row.companySummary
  if (row.theme && row.theme !== '기타' && row.theme !== '기타·개별주') return `기업개요 미확보 · ${row.theme} 분류 종목`
  return '기업개요 확인 중'
}

function TwoDayIntradayChart({ intraday, changeRate }: { intraday?: IntradayValue | null; changeRate?: number | null }) {
  const days = normalizeIntraday(intraday)
  const allPoints = days.flatMap((day) => day.points)
  if (allPoints.length < 2) return <div className="daily-issues-chart-empty large">2거래일 실제 1분봉 준비 중</div>

  const width = 760
  const height = 330
  const pad = { left: 58, right: 18, top: 22, bottom: 42 }
  const gap = days.length > 1 ? 28 : 0
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const dayWidth = (plotWidth - gap * Math.max(0, days.length - 1)) / Math.max(1, days.length)
  const values = allPoints.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const rawRange = Math.max(0, max - min)
  const visibleRange = Math.max(rawRange, Math.max(1, Math.abs((max + min) / 2) * .004))
  const center = (max + min) / 2
  const lo = center - visibleRange / 2 - visibleRange * .08
  const hi = center + visibleRange / 2 + visibleRange * .08
  const range = Math.max(1e-9, hi - lo)
  const y = (value: number) => pad.top + (hi - value) / range * plotHeight
  const x = (timestamp: string, dayIndex: number) => {
    const minute = Math.min(SESSION_END_MINUTE, Math.max(SESSION_START_MINUTE, minuteOfDay(timestamp)))
    const ratio = (minute - SESSION_START_MINUTE) / Math.max(1, SESSION_END_MINUTE - SESSION_START_MINUTE)
    return pad.left + dayIndex * (dayWidth + gap) + ratio * dayWidth
  }
  const gridValues = [hi, hi - range * .25, hi - range * .5, hi - range * .75, lo]
  const lineClass = (changeRate ?? 0) >= 0 ? 'up' : 'down'
  const previousClose = days.length > 1 ? days[0].points.at(-1)?.value ?? null : null
  const latest = days.at(-1)?.points.at(-1)?.value ?? null
  const twoDayRate = previousClose && latest ? (latest / previousClose - 1) * 100 : null

  return <div className="daily-issues-chart-wrap">
    <div className="daily-issues-chart-summary">
      <span>실제 1분봉 · 보간/5분 압축 없음</span>
      <strong>{latest != null ? fmtChartPrice(latest) : '-'}</strong>
      <b className={(twoDayRate ?? 0) >= 0 ? 'up' : 'down'}>{twoDayRate == null ? '-' : `${twoDayRate > 0 ? '+' : ''}${twoDayRate.toFixed(2)}%`}</b>
    </div>
    <svg className={`daily-issues-big-chart ${lineClass}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="전일과 오늘 실제 1분 주가 흐름">
      {gridValues.map((value) => {
        const gridY = y(value)
        return <g key={value.toFixed(6)}>
          <line x1={pad.left} x2={width - pad.right} y1={gridY} y2={gridY} className="daily-issues-big-grid" />
          <text x={pad.left - 8} y={gridY + 3} textAnchor="end" className="daily-issues-big-y-label">{fmtChartPrice(value)}</text>
        </g>
      })}
      {days.map((day, dayIndex) => {
        const dayStart = pad.left + dayIndex * (dayWidth + gap)
        const dayEnd = dayStart + dayWidth
        return <g key={day.date}>
          {dayIndex > 0 && <line x1={dayStart - gap / 2} x2={dayStart - gap / 2} y1={pad.top} y2={height - pad.bottom} className="daily-issues-session-divider" />}
          {[9, 11, 13, 15].map((hour) => {
            const ratio = (hour * 60 - SESSION_START_MINUTE) / (SESSION_END_MINUTE - SESSION_START_MINUTE)
            const tickX = dayStart + ratio * dayWidth
            return <g key={`${day.date}-${hour}`}>
              <line x1={tickX} x2={tickX} y1={height - pad.bottom} y2={height - pad.bottom + 5} className="daily-issues-big-tick" />
              <text x={tickX} y={height - 13} textAnchor="middle" className="daily-issues-big-x-label">{`${String(hour).padStart(2, '0')}:00`}</text>
            </g>
          })}
          <text x={(dayStart + dayEnd) / 2} y={height - 1} textAnchor="middle" className="daily-issues-big-day-label">{shortDate(day.date)}</text>
          {splitSegments(day.points).map((segment, segmentIndex) => {
            const path = segment.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'} ${x(point.timestamp, dayIndex).toFixed(2)} ${y(point.value).toFixed(2)}`).join(' ')
            return <path key={`${day.date}-${segmentIndex}`} d={path} className="daily-issues-big-line" fill="none" />
          })}
        </g>
      })}
    </svg>
    <div className="daily-issues-chart-legend">
      {days.map((day, index) => <span key={day.date}><b>{index === days.length - 1 ? '오늘' : '전일'}</b>{shortDate(day.date)} · 실제 1분 포인트 {day.points.length}개</span>)}
    </div>
  </div>
}

export default function DailyIssues() {
  const [payload, setPayload] = useState<DailyIssuePayload>({ ok: false, status: 'waiting', rows: [] })
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)

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
  const selectedRow = rows.find((row) => row.symbol === selectedSymbol) ?? rows[0] ?? null

  return <main className="daily-issues-page" data-testid="daily-issues">
    <section className="daily-issues-head panel">
      <div>
        <p>DAILY MARKET ISSUE DIGEST / 15:20 KST</p>
        <h1>금일 이슈 정리</h1>
        <small>거래대금 상위 개별주를 등락률 순으로 정리합니다. 종목별 실제 기업개요와 테마를 함께 표시하고, 직접 종목 기사가 없으면 같은 테마에서 상승한 종목의 기사만 근거로 테마 동반 강세 가능성을 추정해 구분 표시합니다. 오른쪽은 전일과 오늘 2거래일의 실제 1분봉입니다.</small>
      </div>
      <aside>
        <b className={payload.ok ? 'ready' : 'waiting'}>{payload.ok ? '● 정리 완료' : payload.status === 'generating' ? '● 생성 중' : '● 15:20 대기'}</b>
        <span>{payload.ok ? `${payload.date} · ${displayTime(payload.capturedAt)}` : `오늘 ${payload.targetTime ?? '15:20'} 자동 생성`}</span>
      </aside>
    </section>

    {!payload.ok && <section className="daily-issues-wait panel">
      <strong>{payload.status === 'generating' ? '금일 TOP100 · 기업 분류 · 뉴스 · 전일+오늘 실제 1분봉을 종합하고 있습니다.' : '15:20이 되면 오늘의 거래대금 TOP100을 확정합니다.'}</strong>
      <span>확정 후 왼쪽에는 종목 성격·테마·상승 이유, 오른쪽에는 선택 종목의 2거래일 실제 1분 흐름이 저장됩니다.</span>
      {payload.error && <small>{payload.error}</small>}
    </section>}

    {payload.ok && <section className="daily-issues-layout" data-testid="daily-issues-split-layout">
      <section className="daily-issues-list panel">
        <div className="daily-issues-list-title">
          <div><b>TOP100 ISSUE LIST</b><span>등락률 높은 순 · 종목을 눌러 우측 차트 변경</span></div>
          <strong>{rows.length}종목</strong>
        </div>
        <div className="daily-issues-list-head">
          <span>순위</span><span>종목 · 기업 · 테마</span><span>등락률</span><span>거래대금</span><span>금일 상승 이유</span>
        </div>
        <div className="daily-issues-list-body">
          {rows.map((row, index) => <button type="button" className={`daily-issues-list-row ${selectedRow?.symbol === row.symbol ? 'active' : ''}`} key={row.symbol} onClick={() => setSelectedSymbol(row.symbol)} aria-pressed={selectedRow?.symbol === row.symbol}>
            <b className="daily-issues-rank">{index + 1}</b>
            <div className="daily-issues-stock">
              <div className="daily-issues-stock-title"><strong>{row.name}</strong><span>{row.theme || '기타·개별주'}</span></div>
              <p>{companyText(row)}</p>
              <small>{row.symbol}{row.market ? ` · ${row.market}` : ''}</small>
            </div>
            <strong className={`daily-issues-rate ${(row.changeRate ?? 0) >= 0 ? 'up' : 'down'}`}>{fmtRate(row.changeRate)}</strong>
            <strong className="daily-issues-amount">{fmtAmount(row.tradingAmount)}</strong>
            <div className="daily-issues-summary compact">
              <div className="daily-issues-reason-line"><span className={`daily-issues-reason-badge ${row.reasonType ?? 'unconfirmed'}`}>{reasonLabel(row)}</span>{row.reasonTheme && <b>{row.reasonTheme}</b>}</div>
              <strong>{row.issueSummary || '상승 이유 확인 안 됨'}</strong>
              <small>{row.reasonType === 'theme-news' ? `직접 종목 기사 없음 · 동종 테마 기사 ${(row.articleCount ?? 0)}건 근거` : (row.articleCount ?? 0) > 0 ? `${row.articleCount}건 종합` : '확인 가능한 상승 근거 없음'}</small>
            </div>
          </button>)}
        </div>
      </section>

      <aside className="daily-issues-detail panel" data-testid="daily-issues-chart-panel">
        {selectedRow ? <>
          <div className="daily-issues-detail-head">
            <div>
              <p>2-DAY REAL 1M FLOW</p>
              <div className="daily-issues-detail-title"><h2>{selectedRow.name}</h2><span>{selectedRow.theme || '기타·개별주'}</span></div>
              <strong className="daily-issues-company-summary">{companyText(selectedRow)}</strong>
              <small>{selectedRow.symbol}{selectedRow.market ? ` · ${selectedRow.market}` : ''}</small>
            </div>
            <div className="daily-issues-detail-price"><strong>{selectedRow.price?.toLocaleString() ?? '-'}</strong><b className={(selectedRow.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(selectedRow.changeRate)}</b><span>거래대금 {fmtAmount(selectedRow.tradingAmount)}</span></div>
          </div>
          <TwoDayIntradayChart intraday={selectedRow.intraday} changeRate={selectedRow.changeRate} />
          <div className="daily-issues-detail-issue">
            <div className="daily-issues-reason-line"><span className={`daily-issues-reason-badge ${selectedRow.reasonType ?? 'unconfirmed'}`}>{reasonLabel(selectedRow)}</span>{selectedRow.reasonTheme && <b>{selectedRow.reasonTheme}</b>}</div>
            <span>금일 상승 이유</span>
            <strong>{selectedRow.issueSummary || '상승 이유 확인 안 됨'}</strong>
            <small>{selectedRow.reasonType === 'theme-news'
              ? `확인된 직접 종목 기사가 없어 같은 테마 상승 종목 기사로 보조 추정한 내용입니다. 인과관계가 확정된 것은 아닙니다.${selectedRow.sources?.length ? ` · ${selectedRow.sources.join(' · ')}` : ''}`
              : (selectedRow.articleCount ?? 0) > 0
                ? `종목명이 직접 포함된 기사 ${selectedRow.articleCount}건 종합${selectedRow.sources?.length ? ` · ${selectedRow.sources.join(' · ')}` : ''}`
                : '확인 가능한 직접 기사 또는 같은 테마 상승 기사 근거가 없습니다.'}</small>
            {!!selectedRow.links?.length && <div>{selectedRow.links.slice(0, 3).map((link, linkIndex) => link.link ? <a key={`${selectedRow.symbol}-${linkIndex}`} href={link.link} target="_blank" rel="noreferrer">근거 기사 {linkIndex + 1}</a> : null)}</div>}
          </div>
          <small className="daily-issues-detail-source">{payload.source || '실제 시장 데이터만 표시'} · 실제 데이터가 없는 구간은 보간하지 않으며 15분 초과 공백은 선으로 연결하지 않음</small>
        </> : <div className="daily-issues-chart-empty large">종목을 선택하면 차트가 표시됩니다.</div>}
      </aside>
    </section>}
  </main>
}

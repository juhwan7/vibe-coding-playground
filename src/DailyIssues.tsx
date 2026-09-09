import { useEffect, useMemo, useState } from 'react'
import './dailyIssues.css'

type OhlcPoint = {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume?: number | null
}
type IntradayDay = { date: string; points: OhlcPoint[] }
type IntradayValue = IntradayDay[]
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
  daily?: OhlcPoint[] | null
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
  stale?: boolean | null
  error?: string | null
}

const SESSION_START_MINUTE = 9 * 60
const SESSION_END_MINUTE = 15 * 60 + 30

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

function isOhlcPoint(point: unknown): point is OhlcPoint {
  if (!point || typeof point !== 'object') return false
  const item = point as Partial<OhlcPoint>
  return typeof item.timestamp === 'string'
    && Number.isFinite(item.open)
    && Number.isFinite(item.high)
    && Number.isFinite(item.low)
    && Number.isFinite(item.close)
}

function normalizeIntraday(value?: IntradayValue | null): IntradayDay[] {
  if (!Array.isArray(value) || !value.length) return []
  return value
    .map((day) => ({
      date: day?.date ?? '',
      points: Array.isArray(day?.points)
        ? day.points.filter(isOhlcPoint).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        : [],
    }))
    .filter((day) => day.date && day.points.length)
    .slice(-2)
}

function normalizeDaily(value?: OhlcPoint[] | null) {
  if (!Array.isArray(value)) return []
  return value.filter(isOhlcPoint).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-30)
}

function fmtChartPrice(value: number) {
  if (!Number.isFinite(value)) return '-'
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString()
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function barDirection(point: OhlcPoint) {
  if (point.close > point.open) return 'up'
  if (point.close < point.open) return 'down'
  return 'flat'
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

function DailyOhlcChart({ daily, finalized }: { daily?: OhlcPoint[] | null; finalized: boolean }) {
  const bars = normalizeDaily(daily)
  if (bars.length < 2) return <div className="daily-issues-chart-empty daily">최근 일봉 OHLC 준비 중</div>

  const width = 760
  const height = 180
  const pad = { left: 58, right: 18, top: 16, bottom: 30 }
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const lows = bars.map((point) => point.low)
  const highs = bars.map((point) => point.high)
  const min = Math.min(...lows)
  const max = Math.max(...highs)
  const rawRange = Math.max(0, max - min)
  const visibleRange = Math.max(rawRange, Math.max(1, Math.abs((max + min) / 2) * .01))
  const lo = min - visibleRange * .08
  const hi = max + visibleRange * .08
  const range = Math.max(1e-9, hi - lo)
  const y = (value: number) => pad.top + (hi - value) / range * plotHeight
  const step = plotWidth / Math.max(1, bars.length)
  const x = (index: number) => pad.left + step * (index + .5)
  const tick = Math.max(2.2, Math.min(6, step * .28))
  const gridValues = [hi, hi - range * .5, lo]
  const labelIndexes = [...new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1])]

  return <div className="daily-issues-chart-wrap daily-context" data-testid="daily-issues-daily-chart">
    <div className="daily-issues-chart-summary compact-chart-summary">
      <span>최근 {bars.length}거래일 · 실제 일봉 OHLC · {finalized ? '당일 봉은 15:30 종가 기준' : '15:30 종가 OHLC 갱신 중'}</span>
      <strong>{fmtChartPrice(bars.at(-1)!.close)}</strong>
    </div>
    <svg className="daily-issues-daily-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="최근 거래일 실제 일봉 OHLC 막대차트">
      {gridValues.map((value) => {
        const gridY = y(value)
        return <g key={value.toFixed(6)}>
          <line x1={pad.left} x2={width - pad.right} y1={gridY} y2={gridY} className="daily-issues-big-grid" />
          <text x={pad.left - 8} y={gridY + 3} textAnchor="end" className="daily-issues-big-y-label">{fmtChartPrice(value)}</text>
        </g>
      })}
      {bars.map((point, index) => {
        const barX = x(index)
        const direction = barDirection(point)
        return <g key={point.timestamp} className={`daily-issues-ohlc-bar daily-issues-daily-bar ${direction}`}>
          <title>{`${shortDate(dateKey(point.timestamp))} 시 ${fmtChartPrice(point.open)} 고 ${fmtChartPrice(point.high)} 저 ${fmtChartPrice(point.low)} 종 ${fmtChartPrice(point.close)}`}</title>
          <line x1={barX} x2={barX} y1={y(point.high)} y2={y(point.low)} className="daily-issues-ohlc-wick" />
          <line x1={barX - tick} x2={barX} y1={y(point.open)} y2={y(point.open)} className="daily-issues-ohlc-tick" />
          <line x1={barX} x2={barX + tick} y1={y(point.close)} y2={y(point.close)} className="daily-issues-ohlc-tick" />
        </g>
      })}
      {labelIndexes.map((index) => <text key={index} x={x(index)} y={height - 7} textAnchor="middle" className="daily-issues-big-x-label">{shortDate(dateKey(bars[index].timestamp))}</text>)}
    </svg>
    <div className="daily-issues-ohlc-legend"><span><i className="up" />상승</span><span><i className="down" />하락</span><small>세로선=고가↔저가 · 왼쪽=시가 · 오른쪽=종가</small></div>
  </div>
}

function TwoDayIntradayBarChart({ intraday }: { intraday?: IntradayValue | null }) {
  const days = normalizeIntraday(intraday)
  const allPoints = days.flatMap((day) => day.points)
  if (allPoints.length < 2) return <div className="daily-issues-chart-empty large">2거래일 실제 1분 OHLC 준비 중</div>

  const width = 760
  const height = 330
  const pad = { left: 58, right: 18, top: 22, bottom: 42 }
  const gap = days.length > 1 ? 28 : 0
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const dayWidth = (plotWidth - gap * Math.max(0, days.length - 1)) / Math.max(1, days.length)
  const min = Math.min(...allPoints.map((point) => point.low))
  const max = Math.max(...allPoints.map((point) => point.high))
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
  const tick = Math.max(.7, Math.min(1.5, dayWidth / 190))
  const gridValues = [hi, hi - range * .25, hi - range * .5, hi - range * .75, lo]
  const previousClose = days.length > 1 ? days[0].points.at(-1)?.close ?? null : null
  const latest = days.at(-1)?.points.at(-1)?.close ?? null
  const twoDayRate = previousClose && latest ? (latest / previousClose - 1) * 100 : null

  return <div className="daily-issues-chart-wrap" data-testid="daily-issues-intraday-chart">
    <div className="daily-issues-chart-summary">
      <span>전일+오늘 · 실제 1분 OHLC 막대 · 15:30 정규장 종가까지 · 압축/보간 없음</span>
      <strong>{latest != null ? fmtChartPrice(latest) : '-'}</strong>
      <b className={(twoDayRate ?? 0) >= 0 ? 'up' : 'down'}>{twoDayRate == null ? '-' : `${twoDayRate > 0 ? '+' : ''}${twoDayRate.toFixed(2)}%`}</b>
    </div>
    <svg className="daily-issues-big-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="전일과 오늘 실제 1분 OHLC 막대차트">
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
          {day.points.map((point) => {
            const barX = x(point.timestamp, dayIndex)
            const direction = barDirection(point)
            return <g key={point.timestamp} className={`daily-issues-ohlc-bar daily-issues-minute-bar ${direction}`}>
              <title>{`${day.date} ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(point.timestamp))} 시 ${fmtChartPrice(point.open)} 고 ${fmtChartPrice(point.high)} 저 ${fmtChartPrice(point.low)} 종 ${fmtChartPrice(point.close)}`}</title>
              <line x1={barX} x2={barX} y1={y(point.high)} y2={y(point.low)} className="daily-issues-ohlc-wick" />
              <line x1={barX - tick} x2={barX} y1={y(point.open)} y2={y(point.open)} className="daily-issues-ohlc-tick" />
              <line x1={barX} x2={barX + tick} y1={y(point.close)} y2={y(point.close)} className="daily-issues-ohlc-tick" />
            </g>
          })}
        </g>
      })}
    </svg>
    <div className="daily-issues-chart-legend">
      {days.map((day, index) => <span key={day.date}><b>{index === days.length - 1 ? '오늘' : '전일'}</b>{shortDate(day.date)} · 실제 1분 막대 {day.points.length}개</span>)}
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
        const finalized = payload.ok && payload.status === 'finalized' && !payload.stale
        if (!controller.signal.aborted) timer = window.setTimeout(load, finalized ? 300000 : 15000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [payload.ok, payload.status, payload.stale])

  const rows = useMemo(() => [...(payload.rows ?? [])].sort((a, b) => (b.changeRate ?? -Infinity) - (a.changeRate ?? -Infinity) || (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0)), [payload.rows])
  const selectedRow = rows.find((row) => row.symbol === selectedSymbol) ?? rows[0] ?? null
  const hasRows = rows.length > 0
  const finalized = Boolean(payload.ok && payload.status === 'finalized' && !payload.stale)
  const statusText = finalized
    ? '● 종가 정리 완료'
    : payload.status === 'generating'
      ? '● 종가 기준 업데이트 중'
      : payload.status === 'pending'
        ? '● 재생성 대기'
        : '● 15:30 종가 대기'

  return <main className="daily-issues-page" data-testid="daily-issues">
    <section className="daily-issues-head panel">
      <div>
        <p>DAILY MARKET ISSUE DIGEST / 15:30 CLOSE</p>
        <h1>금일 이슈 정리</h1>
        <small>거래대금 상위 개별주를 15:30 정규장 종가 기준 등락률 순으로 정리합니다. 왼쪽에서는 선택 종목의 최근 30거래일 실제 일봉과 전일+오늘 실제 1분 OHLC 막대를 함께 보고, 오른쪽에서는 종목별 기업개요·테마·금일 상승 이유를 비교합니다. 직접 종목 기사가 없으면 같은 테마 상승 종목 기사 기반 추정임을 별도로 표시합니다.</small>
      </div>
      <aside>
        <b className={finalized ? 'ready' : 'waiting'}>{statusText}</b>
        <span>{hasRows ? `${payload.date} · ${displayTime(payload.capturedAt)}${finalized ? '' : ' · 기존/부분 데이터 표시 중'}` : `오늘 ${payload.targetTime ?? '15:30'} 종가 확정 후 자동 생성`}</span>
      </aside>
    </section>

    {!hasRows && <section className="daily-issues-wait panel">
      <strong>{payload.status === 'generating' ? '금일 TOP100 목록부터 먼저 준비한 뒤 일봉·전일+오늘 실제 1분 OHLC를 순차 갱신하고 있습니다.' : '15:30 종가가 확정되면 오늘의 거래대금 TOP100을 종가 기준으로 정리합니다.'}</strong>
      <span>목록이 준비되는 즉시 먼저 표시하고, 차트는 뒤에서 계속 채워집니다. 기존 데이터가 있으면 새 데이터 생성 중에도 빈 화면으로 숨기지 않습니다.</span>
      {payload.error && <small>{payload.error}</small>}
    </section>}

    {hasRows && <section className="daily-issues-layout" data-testid="daily-issues-split-layout">
      <aside className="daily-issues-detail panel" data-testid="daily-issues-chart-panel">
        {selectedRow ? <>
          <div className="daily-issues-detail-head">
            <div>
              <p>30-DAY DAILY + 2-DAY REAL 1M OHLC</p>
              <div className="daily-issues-detail-title"><h2>{selectedRow.name}</h2><span>{selectedRow.theme || '기타·개별주'}</span></div>
              <strong className="daily-issues-company-summary">{companyText(selectedRow)}</strong>
              <small>{selectedRow.symbol}{selectedRow.market ? ` · ${selectedRow.market}` : ''}</small>
            </div>
            <div className="daily-issues-detail-price"><strong>{selectedRow.price?.toLocaleString() ?? '-'}</strong><b className={(selectedRow.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{fmtRate(selectedRow.changeRate)}</b><span>거래대금 {fmtAmount(selectedRow.tradingAmount)}</span></div>
          </div>
          <DailyOhlcChart daily={selectedRow.daily} finalized={finalized} />
          <TwoDayIntradayBarChart intraday={selectedRow.intraday} />
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
          <small className="daily-issues-detail-source">{payload.source || '실제 시장 데이터만 표시'} · 실제 OHLC가 없는 분/거래일은 임의 보간하거나 막대를 생성하지 않음</small>
        </> : <div className="daily-issues-chart-empty large">종목을 선택하면 차트가 표시됩니다.</div>}
      </aside>

      <section className="daily-issues-list panel">
        <div className="daily-issues-list-title">
          <div><b>TOP100 ISSUE LIST</b><span>15:30 종가 기준 등락률 높은 순 · 종목을 눌러 좌측 차트 변경</span></div>
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
    </section>}
  </main>
}
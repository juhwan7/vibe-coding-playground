import { useEffect, useMemo, useState } from 'react'
import './marketReplay.css'

type RankingItem = { symbol?: string | null; name?: string | null; changeRate?: number | null; tradingAmount?: number | null; lastPrice?: number | null }
type InvestorTotal = { foreignerNetBuyAmount?: number | null; institutionNetBuyAmount?: number | null }
type HistorySample = {
  updatedAt: string
  marketTradingAmount?: number | null
  indices?: Record<string, { lastPrice?: number | null; changeRate?: number | null }>
  topRankings?: RankingItem[]
  marketInvestors?: { total?: InvestorTotal | null } | null
  programSummary?: { arbitrageNetBuyVolume?: number | null; nonArbitrageNetBuyVolume?: number | null } | null
}
type HistoryPayload = { samples?: HistorySample[]; tradingDays?: number; resolutionMinutes?: number }
type ReplaySample = { timestamp: string; themes?: Array<{ name?: string | null; tradingAmount?: number | null; memberCount?: number | null }> }
type ReplayPayload = { samples?: ReplaySample[]; closeArchive?: unknown[] }
type NewsItem = { title?: string | null; summary?: string | null; publishedAt?: string | null; category?: string | null; source?: string | null; link?: string | null }
type NewsPayload = { items?: NewsItem[] }

function dayKey(value: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}
function minuteOfDay(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value))
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
}
function clock(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}
function rate(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}
function amount(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '-'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(2)}조`
  if (abs >= 100_000_000) return `${sign}${Math.round(abs / 100_000_000).toLocaleString()}억`
  return `${sign}${Math.round(abs).toLocaleString()}`
}
function validName(item: RankingItem) {
  const name = String(item.name ?? '').trim()
  const symbol = String(item.symbol ?? '').trim()
  return name && name !== symbol && !/^\d{6}$/.test(name) ? name : symbol || '종목'
}
function nearest(samples: HistorySample[], targetMinute: number) {
  if (!samples.length) return null
  return samples.reduce((best, item) => Math.abs(minuteOfDay(item.updatedAt) - targetMinute) < Math.abs(minuteOfDay(best.updatedAt) - targetMinute) ? item : best)
}
function normalizedPath(samples: HistorySample[], getter: (sample: HistorySample) => number | null | undefined, width = 920, height = 210) {
  const points = samples.map((sample) => ({ time: minuteOfDay(sample.updatedAt), value: getter(sample) })).filter((point): point is { time: number; value: number } => point.value != null && Number.isFinite(point.value))
  if (points.length < 2) return ''
  const values = points.map((point) => point.value)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const range = Math.max(1e-9, hi - lo)
  const start = Math.min(...points.map((point) => point.time))
  const end = Math.max(...points.map((point) => point.time))
  const timeRange = Math.max(1, end - start)
  return points.map((point) => `${((point.time - start) / timeRange) * width},${height - ((point.value - lo) / range) * (height - 20) - 10}`).join(' ')
}

export default function MarketReplay() {
  const [days, setDays] = useState(2)
  const [resolution, setResolution] = useState(5)
  const [history, setHistory] = useState<HistoryPayload>({ samples: [] })
  const [replay, setReplay] = useState<ReplayPayload>({ samples: [] })
  const [news, setNews] = useState<NewsPayload>({ items: [] })
  const [selectedDay, setSelectedDay] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoading(true)
      try {
        const [historyResponse, replayResponse, newsResponse] = await Promise.all([
          fetch(`/api/market/history?days=${days}&resolution=${resolution}`, { signal: controller.signal, headers: { Accept: 'application/json' } }),
          fetch(`/api/market/replay?days=${days}&resolution=${resolution}`, { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
          fetch('/api/market/feature-news', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
        ])
        if (historyResponse.ok) setHistory(await historyResponse.json() as HistoryPayload)
        if (replayResponse?.ok) setReplay(await replayResponse.json() as ReplayPayload)
        if (newsResponse?.ok) setNews(await newsResponse.json() as NewsPayload)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [days, resolution])

  const dayOptions = useMemo(() => [...new Set((history.samples ?? []).map((sample) => dayKey(sample.updatedAt)))].sort().reverse(), [history.samples])
  useEffect(() => {
    if (!dayOptions.length) return
    if (!selectedDay || !dayOptions.includes(selectedDay)) setSelectedDay(dayOptions[0])
  }, [dayOptions, selectedDay])

  const samples = useMemo(() => (history.samples ?? []).filter((sample) => dayKey(sample.updatedAt) === selectedDay).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)), [history.samples, selectedDay])
  const replaySamples = useMemo(() => (replay.samples ?? []).filter((sample) => dayKey(sample.timestamp) === selectedDay).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)), [replay.samples, selectedDay])
  const first = samples[0]
  const latest = samples.at(-1)
  const latestRankings = latest?.topRankings ?? []
  const latestBreadth = latestRankings.filter((item) => item.changeRate != null)
  const advancers = latestBreadth.filter((item) => (item.changeRate ?? 0) > 0).length
  const decliners = latestBreadth.filter((item) => (item.changeRate ?? 0) < 0).length
  const peakTurnover = samples.reduce<HistorySample | null>((best, sample) => !best || (sample.marketTradingAmount ?? 0) > (best.marketTradingAmount ?? 0) ? sample : best, null)

  const milestones = useMemo(() => [540, 600, 660, 780, 840, 920].map((minute) => nearest(samples, minute)).filter((sample): sample is HistorySample => Boolean(sample)), [samples])
  const turns = useMemo(() => {
    const rows = [] as Array<{ label: string; timestamp: string; value: string; note: string }>
    let biggestIndex: { delta: number; at: string } | null = null
    let biggestTurnover: { delta: number; at: string } | null = null
    for (let index = 1; index < samples.length; index += 1) {
      const prev = samples[index - 1]
      const current = samples[index]
      const indexDelta = (current.indices?.KOSPI?.changeRate ?? 0) - (prev.indices?.KOSPI?.changeRate ?? 0)
      const amountDelta = (current.marketTradingAmount ?? 0) - (prev.marketTradingAmount ?? 0)
      if (!biggestIndex || Math.abs(indexDelta) > Math.abs(biggestIndex.delta)) biggestIndex = { delta: indexDelta, at: current.updatedAt }
      if (!biggestTurnover || amountDelta > biggestTurnover.delta) biggestTurnover = { delta: amountDelta, at: current.updatedAt }
    }
    if (biggestIndex) rows.push({ label: 'KOSPI 최대 변곡', timestamp: biggestIndex.at, value: `${biggestIndex.delta > 0 ? '+' : ''}${biggestIndex.delta.toFixed(2)}%p`, note: '직전 저장 구간 대비 지수 등락률 변화' })
    if (biggestTurnover) rows.push({ label: '거래대금 최대 가속', timestamp: biggestTurnover.at, value: amount(biggestTurnover.delta), note: '직전 저장 구간 대비 TOP100 누적 거래대금 증가' })
    if (peakTurnover) rows.push({ label: '당일 최대 누적 거래대금', timestamp: peakTurnover.updatedAt, value: amount(peakTurnover.marketTradingAmount), note: '저장된 장중 표본 기준' })
    return rows
  }, [samples, peakTurnover])

  const themeRotation = useMemo(() => {
    const map = new Map<string, { appearances: number; peak: number; latest: number; lastAt: string }>()
    for (const sample of replaySamples) {
      for (const theme of sample.themes ?? []) {
        const name = String(theme.name ?? '').trim()
        if (!name) continue
        const current = map.get(name) ?? { appearances: 0, peak: 0, latest: 0, lastAt: sample.timestamp }
        const value = Number(theme.tradingAmount) || 0
        current.appearances += 1
        current.peak = Math.max(current.peak, value)
        current.latest = value
        current.lastAt = sample.timestamp
        map.set(name, current)
      }
    }
    return [...map.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.appearances - a.appearances || b.peak - a.peak).slice(0, 10)
  }, [replaySamples])

  const dayNews = useMemo(() => (news.items ?? []).filter((item) => item.publishedAt && dayKey(item.publishedAt) === selectedDay).sort((a, b) => Date.parse(a.publishedAt ?? '') - Date.parse(b.publishedAt ?? '')).slice(-20), [news.items, selectedDay])
  const kospiPath = normalizedPath(samples, (sample) => sample.indices?.KOSPI?.changeRate)
  const turnoverPath = normalizedPath(samples, (sample) => sample.marketTradingAmount)

  return <main className="market-replay" data-testid="market-replay">
    <section className="replay-hero panel">
      <div><p>MARKET REPLAY / INTRADAY REVIEW</p><h1>시장 복기</h1><small>저장된 실제 장중 스냅샷을 시간순으로 되돌려 보며 지수, 거래대금, 주도 종목, 테마 순환, 수급, 뉴스가 언제 변했는지 확인합니다. 확인되지 않은 원인은 자동으로 만들지 않습니다.</small></div>
      <div className="replay-controls">
        <label>조회 기간<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={1}>1일</option><option value={2}>2일</option><option value={5}>5일</option><option value={10}>10일</option></select></label>
        <label>간격<select value={resolution} onChange={(event) => setResolution(Number(event.target.value))}><option value={1}>1분</option><option value={5}>5분</option><option value={10}>10분</option></select></label>
        <label>거래일<select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}>{dayOptions.map((day) => <option key={day} value={day}>{day}</option>)}</select></label>
      </div>
    </section>

    {loading && <section className="replay-loading panel">저장된 시장 데이터를 불러오는 중입니다.</section>}

    <section className="replay-kpis">
      <div className="panel"><span>최종 KOSPI</span><strong>{latest?.indices?.KOSPI?.lastPrice?.toLocaleString() ?? '-'}</strong><b className={(latest?.indices?.KOSPI?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{rate(latest?.indices?.KOSPI?.changeRate)}</b></div>
      <div className="panel"><span>최종 KOSDAQ</span><strong>{latest?.indices?.KOSDAQ?.lastPrice?.toLocaleString() ?? '-'}</strong><b className={(latest?.indices?.KOSDAQ?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{rate(latest?.indices?.KOSDAQ?.changeRate)}</b></div>
      <div className="panel"><span>TOP100 상승 / 하락</span><strong>{advancers} / {decliners}</strong><b>{latestBreadth.length}종목 표본</b></div>
      <div className="panel"><span>최종 거래대금</span><strong>{amount(latest?.marketTradingAmount)}</strong><b>TOP100 누적</b></div>
      <div className="panel"><span>저장 구간</span><strong>{first ? clock(first.updatedAt) : '-'} → {latest ? clock(latest.updatedAt) : '-'}</strong><b>{samples.length}개 표본</b></div>
    </section>

    <section className="replay-grid replay-grid-top">
      <article className="panel replay-chart-panel">
        <header><div><p>INTRADAY CURVE</p><h2>지수·거래대금 흐름</h2></div><span>각 선은 자체 범위를 정규화해 변곡 시점을 비교</span></header>
        <svg viewBox="0 0 920 230" preserveAspectRatio="none" aria-label="장중 지수와 거래대금 흐름">
          {[.25,.5,.75].map((ratio) => <line key={ratio} x1="0" x2="920" y1={ratio * 210} y2={ratio * 210} className="replay-grid-line" />)}
          {kospiPath && <polyline points={kospiPath} className="replay-line replay-index-line" fill="none" />}
          {turnoverPath && <polyline points={turnoverPath} className="replay-line replay-turnover-line" fill="none" />}
        </svg>
        <footer><span><i className="index-dot" />KOSPI 등락률</span><span><i className="turnover-dot" />TOP100 누적 거래대금</span></footer>
      </article>

      <article className="panel replay-turns">
        <header><div><p>TURNING POINTS</p><h2>장중 변곡점</h2></div></header>
        {turns.map((turn) => <div key={turn.label}><time>{clock(turn.timestamp)}</time><span><b>{turn.label}</b><small>{turn.note}</small></span><strong>{turn.value}</strong></div>)}
        {!turns.length && <div className="replay-empty">비교할 장중 표본이 아직 충분하지 않습니다.</div>}
      </article>
    </section>

    <section className="panel replay-milestones">
      <header><div><p>TIME CHECKPOINTS</p><h2>시간대별 시장 주도권</h2></div><span>09:00 · 10:00 · 11:00 · 13:00 · 14:00 · 15:20 근접 표본</span></header>
      <div className="milestone-grid">
        {milestones.map((sample) => {
          const top = (sample.topRankings ?? []).slice(0, 3)
          const up = (sample.topRankings ?? []).filter((item) => (item.changeRate ?? 0) > 0).length
          const down = (sample.topRankings ?? []).filter((item) => (item.changeRate ?? 0) < 0).length
          return <article key={sample.updatedAt}><time>{clock(sample.updatedAt)}</time><strong>KOSPI {rate(sample.indices?.KOSPI?.changeRate)}</strong><span>거래대금 {amount(sample.marketTradingAmount)}</span><span>TOP100 상승 {up} · 하락 {down}</span><div>{top.map((item, index) => <b key={item.symbol ?? index}>{index + 1}. {validName(item)} <em>{rate(item.changeRate)}</em></b>)}</div></article>
        })}
      </div>
    </section>

    <section className="replay-grid">
      <article className="panel replay-leaders">
        <header><div><p>TURNOVER LEADERS</p><h2>거래대금 주도 종목</h2></div><span>선택 거래일 마지막 저장 표본</span></header>
        <div className="replay-table-head"><span>#</span><span>종목</span><span>등락률</span><span>거래대금</span></div>
        {latestRankings.slice(0, 20).map((item, index) => <div className="replay-table-row" key={item.symbol ?? index}><b>{index + 1}</b><span>{validName(item)}<small>{item.symbol}</small></span><strong className={(item.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{rate(item.changeRate)}</strong><em>{amount(item.tradingAmount)}</em></div>)}
      </article>

      <article className="panel replay-themes">
        <header><div><p>THEME ROTATION</p><h2>테마 순환 기록</h2></div><span>저장 표본에서 상위권 등장 횟수</span></header>
        {themeRotation.map((theme, index) => <div key={theme.name}><b>{index + 1}</b><span>{theme.name}<small>최근 {clock(theme.lastAt)} · {theme.appearances}회 등장</small></span><strong>{amount(theme.peak)}</strong></div>)}
        {!themeRotation.length && <div className="replay-empty">과거 테마 표본을 계산 중입니다.</div>}
      </article>
    </section>

    <section className="replay-grid">
      <article className="panel replay-supply">
        <header><div><p>SUPPLY / PROGRAM</p><h2>수급·프로그램 복기</h2></div><span>가장 최근 저장값</span></header>
        <div className="supply-cards"><div><span>외국인 현물 순매수</span><strong>{amount(latest?.marketInvestors?.total?.foreignerNetBuyAmount)}</strong></div><div><span>기관 현물 순매수</span><strong>{amount(latest?.marketInvestors?.total?.institutionNetBuyAmount)}</strong></div><div><span>비차익 프로그램</span><strong>{latest?.programSummary?.nonArbitrageNetBuyVolume?.toLocaleString() ?? '-'}주</strong></div><div><span>차익 프로그램</span><strong>{latest?.programSummary?.arbitrageNetBuyVolume?.toLocaleString() ?? '-'}주</strong></div></div>
      </article>

      <article className="panel replay-news">
        <header><div><p>NEWS TIMING</p><h2>뉴스 타이밍</h2></div><span>{dayNews.length}건</span></header>
        <div className="replay-news-list">{dayNews.map((item, index) => <a key={`${item.publishedAt}-${index}`} href={item.link ?? undefined} target="_blank" rel="noreferrer"><time>{clock(item.publishedAt)}</time><span>{item.summary || item.title}<small>{item.source ?? '뉴스'} · {item.category ?? '시장 이슈'}</small></span></a>)}</div>
        {!dayNews.length && <div className="replay-empty">선택 거래일의 선별 뉴스가 저장되어 있지 않습니다.</div>}
      </article>
    </section>
  </main>
}

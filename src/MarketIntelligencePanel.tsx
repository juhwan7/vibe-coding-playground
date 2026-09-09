import { useEffect, useMemo, useState } from 'react'
import './marketIntelligence.css'

type FreshnessState = {
  status?: 'live' | 'delayed' | 'stale' | 'fallback' | 'missing'
  label?: string
  ageSeconds?: number | null
  timestamp?: string | null
}

type ThemeMember = {
  symbol?: string | null
  name?: string | null
  tradingAmount?: number | null
  changeRate?: number | null
}

type ThemeIntel = {
  name: string
  tradingAmount?: number | null
  overlapAdjustedTradingAmount?: number | null
  currentValue?: number | null
  change1h?: number | null
  breadthPercent?: number | null
  medianReturn?: number | null
  leaderConcentrationPercent?: number | null
  flowVelocity10mPercent?: number | null
  strengthScore?: number | null
  lifecycle?: string | null
  hysteresisHold?: boolean
  members?: ThemeMember[]
}

type FlowPoint = {
  timestamp?: string | null
  foreign?: number | null
  institution?: number | null
  nonArbitrage?: number | null
  arbitrage?: number | null
  marketTradingAmount?: number | null
}

type NewsItem = {
  title?: string | null
  summary?: string | null
  source?: string | null
  publishedAt?: string | null
  link?: string | null
  evidence?: { grade?: string; label?: string; confidence?: string }
}

type IntelligencePayload = {
  ok?: boolean
  generatedAt?: string | null
  quality?: {
    level?: 'good' | 'warning' | 'critical'
    issues?: Array<{ severity?: string; code?: string; message?: string }>
  }
  freshness?: {
    market?: FreshnessState
    theme?: FreshnessState
    news?: FreshnessState
    futures?: FreshnessState
  }
  market?: {
    label?: string
    score?: number | null
    concentration?: number | null
    reasons?: string[]
    breadth?: {
      sampleCount?: number
      advancers?: number
      decliners?: number
      advancerShare?: number | null
      upAmountShare?: number | null
    }
  }
  themes?: ThemeIntel[]
  flowSeries?: FlowPoint[]
  news?: { items?: NewsItem[] }
  futures?: {
    available?: boolean
    configured?: boolean
    source?: string | null
    updatedAt?: string | null
    priceChangeRate?: number | null
    tradingStrength?: number | null
    tradingVolume?: number | null
    openInterest?: number | null
    foreignNetContracts?: number | null
    institutionNetContracts?: number | null
    note?: string | null
  }
}

type ReplaySample = {
  timestamp?: string | null
  marketTradingAmount?: number | null
  indices?: Record<string, { lastPrice?: number | null; changeRate?: number | null }>
  marketInvestors?: { total?: { foreignerNetBuyAmount?: number | null; institutionNetBuyAmount?: number | null } | null } | null
  programSummary?: { nonArbitrageNetBuyVolume?: number | null; arbitrageNetBuyVolume?: number | null } | null
  topRankings?: ThemeMember[]
  themes?: Array<{ name?: string; tradingAmount?: number | null; memberCount?: number | null }>
}

type ReplayPayload = {
  ok?: boolean
  samples?: ReplaySample[]
  closeArchive?: Array<{ date?: string; slot?: string; capturedAt?: string; marketTradingAmount?: number | null }>
}

type TimelineEvent = {
  type?: 'price' | 'news'
  timestamp?: string | null
  price?: number | null
  title?: string | null
  source?: string | null
  link?: string | null
  evidence?: { grade?: string; label?: string }
}

type TimelinePayload = {
  ok?: boolean
  stock?: ThemeMember | null
  events?: TimelineEvent[]
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

function fmtRate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function fmtNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString()}`
}

function displayTime(iso?: string | null) {
  if (!iso) return '-'
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(parsed))
}

function ageLabel(age?: number | null) {
  if (age == null) return '-'
  if (age < 60) return `${age}초 전`
  if (age < 3600) return `${Math.floor(age / 60)}분 전`
  return `${Math.floor(age / 3600)}시간 전`
}

function FreshnessBadge({ name, state }: { name: string; state?: FreshnessState }) {
  const status = state?.status ?? 'missing'
  return <span className={`intel-freshness ${status}`} title={state?.timestamp ? `${displayTime(state.timestamp)} 갱신` : '갱신 시각 없음'}>
    <b>{state?.label ?? 'MISSING'}</b><span>{name}</span><small>{ageLabel(state?.ageSeconds)}</small>
  </span>
}

function Sparkline({ values, label }: { values: Array<number | null | undefined>; label: string }) {
  const clean = values.map((value, index) => ({ index, value: value != null && Number.isFinite(value) ? value : null })).filter((item): item is { index: number; value: number } => item.value != null)
  if (clean.length < 2) return <div className="intel-spark-empty">{label} 데이터 축적 중</div>
  const width = 220
  const height = 54
  const min = Math.min(...clean.map((item) => item.value))
  const max = Math.max(...clean.map((item) => item.value))
  const range = Math.max(1, max - min)
  const maxIndex = Math.max(1, values.length - 1)
  const points = clean.map((item) => `${item.index / maxIndex * width},${height - ((item.value - min) / range) * (height - 8) - 4}`).join(' ')
  const zeroY = min <= 0 && max >= 0 ? height - ((0 - min) / range) * (height - 8) - 4 : null
  return <svg className="intel-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
    {zeroY != null && <line x1="0" x2={width} y1={zeroY} y2={zeroY} className="intel-spark-zero" />}
    <polyline points={points} fill="none" />
  </svg>
}

function nearestPrice(events: TimelineEvent[], timestamp?: string | null) {
  const target = Date.parse(timestamp ?? '')
  if (!Number.isFinite(target)) return null
  let nearest: TimelineEvent | null = null
  let gap = Infinity
  for (const event of events) {
    if (event.type !== 'price' || event.price == null) continue
    const parsed = Date.parse(event.timestamp ?? '')
    if (!Number.isFinite(parsed)) continue
    const nextGap = Math.abs(parsed - target)
    if (nextGap < gap) {
      gap = nextGap
      nearest = event
    }
  }
  return gap <= 20 * 60 * 1000 ? nearest?.price ?? null : null
}

export default function MarketIntelligencePanel() {
  const [intel, setIntel] = useState<IntelligencePayload | null>(null)
  const [replay, setReplay] = useState<ReplayPayload>({ samples: [], closeArchive: [] })
  const [replayIndex, setReplayIndex] = useState(0)
  const [timeline, setTimeline] = useState<TimelinePayload>({ events: [] })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    let replayTick = 0
    const load = async () => {
      try {
        const response = await fetch('/api/market/intelligence', { signal: controller.signal, headers: { Accept: 'application/json' } })
        const payload = await response.json().catch(() => null) as IntelligencePayload | null
        if (payload) {
          setIntel(payload)
          setError(response.ok ? null : '시장 인텔리전스 데이터가 최신 상태가 아닙니다.')
        }
        if (replayTick % 6 === 0) {
          const replayResponse = await fetch('/api/market/replay?days=2&resolution=5', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null)
          if (replayResponse?.ok) {
            const next = await replayResponse.json() as ReplayPayload
            setReplay(next)
            setReplayIndex(Math.max(0, (next.samples?.length ?? 1) - 1))
          }
        }
        replayTick += 1
      } catch (loadError) {
        if ((loadError as Error).name !== 'AbortError') setError('시장 인텔리전스 연결 대기 중')
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(load, 10000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const leader = useMemo(() => {
    const theme = intel?.themes?.[0]
    return [...(theme?.members ?? [])].filter((member) => member.symbol).sort((a, b) => (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0))[0] ?? null
  }, [intel?.themes])

  useEffect(() => {
    if (!leader?.symbol) {
      setTimeline({ events: [] })
      return
    }
    const controller = new AbortController()
    const params = new URLSearchParams({ symbol: leader.symbol })
    if (leader.name) params.set('name', leader.name)
    void fetch(`/api/market/event-timeline?${params.toString()}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then((response) => response.json())
      .then((payload) => setTimeline(payload as TimelinePayload))
      .catch(() => {})
    return () => controller.abort()
  }, [leader?.symbol, leader?.name])

  const flow = (intel?.flowSeries ?? []).slice(-90)
  const replaySamples = replay.samples ?? []
  const selectedReplay = replaySamples[Math.min(replayIndex, Math.max(0, replaySamples.length - 1))]
  const newsEvents = (timeline.events ?? []).filter((event) => event.type === 'news').slice(-5).reverse()
  const market = intel?.market
  const quality = intel?.quality

  return <section className="market-intelligence panel" data-testid="market-intelligence">
    <header className="intel-head">
      <div>
        <p>MARKET INTELLIGENCE / VERIFIED SIGNALS</p>
        <h1>시장 상태 엔진 <span>원시값 기반 · 추정은 별도 표시</span></h1>
        <small>테마 강도·확산·집중·유입 속도, 데이터 신선도, 수급 흐름, 뉴스 근거 등급과 장중 복기를 한 화면에서 확인합니다.</small>
      </div>
      <div className="intel-freshness-row">
        <FreshnessBadge name="시장" state={intel?.freshness?.market} />
        <FreshnessBadge name="테마" state={intel?.freshness?.theme} />
        <FreshnessBadge name="뉴스" state={intel?.freshness?.news} />
        <FreshnessBadge name="선물" state={intel?.freshness?.futures} />
      </div>
    </header>

    {(error || quality?.level !== 'good') && <div className={`intel-quality ${quality?.level ?? 'warning'}`}>
      <strong>{quality?.level === 'critical' ? '데이터 검증 필요' : quality?.level === 'warning' ? '일부 데이터 지연/이상 감지' : '데이터 상태 확인'}</strong>
      <span>{error ?? quality?.issues?.map((issue) => issue.message).filter(Boolean).join(' · ') ?? '현재 확인된 오류 없음'}</span>
    </div>}

    <div className="intel-regime-grid">
      <article className="intel-regime-card">
        <span>현재 시장 상태</span>
        <strong>{market?.label ?? '판정 대기'}</strong>
        <b>상태점수 {market?.score ?? '-'}</b>
        <p>{market?.reasons?.slice(0, 4).join(' · ') ?? '표본 수집 중'}</p>
      </article>
      <article><span>상승 종목 비율</span><strong>{fmtRate(market?.breadth?.advancerShare)}</strong><small>{market?.breadth?.advancers ?? '-'} 상승 / {market?.breadth?.decliners ?? '-'} 하락</small></article>
      <article><span>상승 거래대금 비중</span><strong>{fmtRate(market?.breadth?.upAmountShare)}</strong><small>등락 방향별 거래대금 분포</small></article>
      <article><span>TOP10 집중도</span><strong>{fmtRate(market?.concentration)}</strong><small>높을수록 소수 종목 쏠림</small></article>
    </div>

    <div className="intel-theme-grid">
      {(intel?.themes ?? []).slice(0, 4).map((theme, index) => <article className="intel-theme-card" key={theme.name}>
        <div className="intel-theme-title"><b>{index + 1}</b><h2>{theme.name}</h2><span className={`lifecycle lifecycle-${theme.lifecycle ?? '유지'}`}>{theme.lifecycle ?? '유지'}</span></div>
        <div className="intel-theme-main"><strong>{fmtRate(theme.currentValue)}</strong><small>강도점수 {theme.strengthScore?.toFixed(1) ?? '-'}</small></div>
        <dl>
          <div><dt>누적 거래대금</dt><dd>{fmtAmount(theme.tradingAmount)}</dd></div>
          <div><dt>중복조정 1/N</dt><dd>{fmtAmount(theme.overlapAdjustedTradingAmount)}</dd></div>
          <div><dt>상승 확산도</dt><dd>{fmtRate(theme.breadthPercent)}</dd></div>
          <div><dt>구성종목 중앙값</dt><dd>{fmtRate(theme.medianReturn)}</dd></div>
          <div><dt>대장 집중도</dt><dd>{fmtRate(theme.leaderConcentrationPercent)}</dd></div>
          <div><dt>10분 환산 유입속도</dt><dd>{fmtRate(theme.flowVelocity10mPercent)}</dd></div>
        </dl>
        {theme.hysteresisHold && <p className="intel-hold">교체 문턱 미충족 · 기존 주도테마 유지</p>}
      </article>)}
    </div>

    <div className="intel-flow-grid">
      <article><div><span>외국인 현물</span><strong>{fmtAmount(flow.at(-1)?.foreign)}</strong></div><Sparkline label="외국인 현물 순매수 흐름" values={flow.map((point) => point.foreign)} /></article>
      <article><div><span>기관 현물</span><strong>{fmtAmount(flow.at(-1)?.institution)}</strong></div><Sparkline label="기관 현물 순매수 흐름" values={flow.map((point) => point.institution)} /></article>
      <article><div><span>비차익 프로그램</span><strong>{fmtNumber(flow.at(-1)?.nonArbitrage)}</strong></div><Sparkline label="비차익 프로그램 순매수 흐름" values={flow.map((point) => point.nonArbitrage)} /></article>
      <article><div><span>차익 프로그램</span><strong>{fmtNumber(flow.at(-1)?.arbitrage)}</strong></div><Sparkline label="차익 프로그램 순매수 흐름" values={flow.map((point) => point.arbitrage)} /></article>
    </div>

    <div className="intel-evidence-grid">
      <article className="intel-news-evidence">
        <header><div><span>NEWS EVIDENCE</span><h2>뉴스 근거 등급</h2></div><small>A=1차자료 · B=복수 출처 · C=단일기사</small></header>
        <div className="intel-news-list">
          {(intel?.news?.items ?? []).slice(0, 5).map((item, index) => <a href={item.link ?? undefined} target="_blank" rel="noreferrer" key={`${item.title}-${index}`}>
            <b className={`evidence-${item.evidence?.grade ?? 'C'}`}>{item.evidence?.grade ?? 'C'}</b>
            <span><strong>{item.summary ?? item.title}</strong><small>{item.source ?? '뉴스'} · {item.evidence?.label ?? '확인되지 않음'} · {displayTime(item.publishedAt)}</small></span>
          </a>)}
          {!(intel?.news?.items?.length) && <div className="intel-empty">고신호 뉴스 수집 중</div>}
        </div>
      </article>

      <article className="intel-futures-card">
        <header><span>FUTURES</span><h2>KOSPI200 선물 연결 상태</h2></header>
        {intel?.futures?.available ? <>
          <strong>{fmtRate(intel.futures.priceChangeRate)}</strong>
          <dl>
            <div><dt>거래강도</dt><dd>{fmtNumber(intel.futures.tradingStrength)}</dd></div>
            <div><dt>거래량</dt><dd>{fmtNumber(intel.futures.tradingVolume)}</dd></div>
            <div><dt>미결제약정</dt><dd>{fmtNumber(intel.futures.openInterest)}</dd></div>
            <div><dt>외국인 순계약</dt><dd>{fmtNumber(intel.futures.foreignNetContracts)}</dd></div>
            <div><dt>기관 순계약</dt><dd>{fmtNumber(intel.futures.institutionNetContracts)}</dd></div>
          </dl>
          <small>{intel.futures.source ?? '검증 공급원'} · {displayTime(intel.futures.updatedAt)}</small>
        </> : <div className="intel-empty verified-only"><strong>실데이터 미연결</strong><span>{intel?.futures?.note ?? '검증된 공급원이 연결되기 전에는 값을 표시하지 않습니다.'}</span></div>}
      </article>
    </div>

    <div className="intel-timeline-grid">
      <article className="intel-event-timeline">
        <header><div><span>CATALYST TIMELINE</span><h2>{leader?.name ?? '주도주'} 뉴스 ↔ 가격 시각 비교</h2></div><small>뉴스 직후 움직임은 인과관계로 단정하지 않습니다.</small></header>
        {newsEvents.map((event, index) => {
          const price = nearestPrice(timeline.events ?? [], event.timestamp)
          return <div className="intel-event" key={`${event.timestamp}-${index}`}>
            <time>{displayTime(event.timestamp)}</time><b className={`evidence-${event.evidence?.grade ?? 'C'}`}>{event.evidence?.grade ?? 'C'}</b>
            <span><strong>{event.title}</strong><small>{event.source ?? '뉴스'} · 당시 인접 가격 {price?.toLocaleString() ?? '-'}</small></span>
          </div>
        })}
        {!newsEvents.length && <div className="intel-empty">현재 주도주와 직접 연결된 고신호 뉴스가 확인되지 않았습니다.</div>}
      </article>

      <article className="intel-replay">
        <header><div><span>INTRADAY REPLAY</span><h2>시장 복기</h2></div><small>최근 2거래일 · 5분 해상도</small></header>
        {replaySamples.length ? <>
          <input type="range" min="0" max={Math.max(0, replaySamples.length - 1)} value={Math.min(replayIndex, replaySamples.length - 1)} onChange={(event) => setReplayIndex(Number(event.target.value))} />
          <div className="replay-time"><strong>{displayTime(selectedReplay?.timestamp)}</strong><span>거래대금 {fmtAmount(selectedReplay?.marketTradingAmount)}</span></div>
          <div className="replay-metrics">
            <span>KOSPI <b>{selectedReplay?.indices?.KOSPI?.lastPrice?.toLocaleString() ?? '-'}</b></span>
            <span>외국인 <b>{fmtAmount(selectedReplay?.marketInvestors?.total?.foreignerNetBuyAmount)}</b></span>
            <span>비차익 <b>{fmtNumber(selectedReplay?.programSummary?.nonArbitrageNetBuyVolume)}</b></span>
          </div>
          <div className="replay-themes">{(selectedReplay?.themes ?? []).slice(0, 4).map((theme) => <span key={theme.name}>{theme.name} <b>{fmtAmount(theme.tradingAmount)}</b></span>)}</div>
          <div className="close-slots">종가판: {(replay.closeArchive ?? []).slice(-4).map((record) => <span key={`${record.date}-${record.slot}`}>{record.date} {record.slot}</span>)}</div>
        </> : <div className="intel-empty">히스토리 수집 후 복기 슬라이더가 활성화됩니다.</div>}
      </article>
    </div>
  </section>
}

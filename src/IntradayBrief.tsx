import { useEffect, useMemo, useState } from 'react'
import './intradayBrief.css'

type RankingItem = {
  symbol?: string | null
  name?: string | null
  changeRate?: number | null
  tradingAmount?: number | null
}
type Snapshot = {
  ok?: boolean
  updatedAt?: string | null
  indices?: Record<string, { lastPrice?: number | null; changeRate?: number | null }>
  topRankings?: RankingItem[]
}
type ThemeFlow = {
  ok?: boolean
  topRankings?: RankingItem[]
  themes?: Array<{ name?: string | null; currentValue?: number | null; tradingAmount?: number | null; memberCount?: number | null }>
}
type NewsItem = { title?: string | null; summary?: string | null; publishedAt?: string | null; category?: string | null }
type NewsPayload = { ok?: boolean; items?: NewsItem[]; error?: string | null; updatedAt?: string | null; policy?: { successfulSources?: number; failedSources?: string[] } }

function validName(name?: string | null, symbol?: string | null) {
  const value = String(name ?? '').trim()
  if (!value || value === String(symbol ?? '').trim() || /^\d{6}$/.test(value)) return null
  return value
}

function rate(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function amount(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '-'
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}조`
  if (value >= 100_000_000) return `${Math.round(value / 100_000_000).toLocaleString()}억`
  return Math.round(value).toLocaleString()
}

function clock(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

export default function IntradayBrief() {
  const [snapshot, setSnapshot] = useState<Snapshot>({})
  const [themes, setThemes] = useState<ThemeFlow>({})
  const [news, setNews] = useState<NewsPayload>({})

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        const [snapshotResponse, themeResponse, newsResponse] = await Promise.all([
          fetch('/api/market/snapshot', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
          fetch('/api/market/theme-flow', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
          fetch('/api/market/feature-news', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
        ])
        if (snapshotResponse?.ok) setSnapshot(await snapshotResponse.json() as Snapshot)
        if (themeResponse) setThemes(await themeResponse.json().catch(() => ({})) as ThemeFlow)
        if (newsResponse) setNews(await newsResponse.json().catch(() => ({})) as NewsPayload)
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(load, 30000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const rankings = useMemo(() => {
    const metadata = new Map((themes.topRankings ?? []).filter((item) => item.symbol).map((item) => [item.symbol!, item]))
    return (snapshot.topRankings ?? themes.topRankings ?? []).map((item) => {
      const meta = item.symbol ? metadata.get(item.symbol) : null
      return { ...meta, ...item, name: validName(item.name, item.symbol) ?? validName(meta?.name, item.symbol) ?? null }
    }).filter((item) => item.symbol).slice(0, 100)
  }, [snapshot.topRankings, themes.topRankings])

  const breadth = useMemo(() => {
    const valid = rankings.filter((item) => item.changeRate != null && Number.isFinite(item.changeRate))
    const up = valid.filter((item) => (item.changeRate ?? 0) > 0).length
    const down = valid.filter((item) => (item.changeRate ?? 0) < 0).length
    return { up, down, flat: valid.length - up - down, count: valid.length }
  }, [rankings])

  const strongest = useMemo(() => [...rankings].filter((item) => item.changeRate != null).sort((a, b) => (b.changeRate ?? 0) - (a.changeRate ?? 0)).slice(0, 5), [rankings])
  const weakest = useMemo(() => [...rankings].filter((item) => item.changeRate != null).sort((a, b) => (a.changeRate ?? 0) - (b.changeRate ?? 0)).slice(0, 5), [rankings])
  const leaders = useMemo(() => [...(themes.themes ?? [])].sort((a, b) => (b.tradingAmount ?? 0) - (a.tradingAmount ?? 0)).slice(0, 5), [themes.themes])
  const kospi = snapshot.indices?.KOSPI
  const kosdaq = snapshot.indices?.KOSDAQ
  const total = rankings.reduce((sum, item) => sum + (item.tradingAmount ?? 0), 0)
  const newsItems = news.items ?? []
  const latestNews = [...newsItems].sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? '')).slice(0, 3)
  const direction = breadth.count ? (breadth.up > breadth.down ? '상승 종목 우위' : breadth.down > breadth.up ? '하락 종목 우위' : '상승·하락 균형') : '집계 준비 중'

  return <section className="intraday-brief panel" data-testid="intraday-brief">
    <header className="intraday-brief-head">
      <div><p>INTRADAY BRIEF / LIVE FACTS</p><h1>장중 시황 브리핑</h1><small>뉴스가 잠시 비어도 실제 TOP100·지수·테마 데이터로 현재 시장 상태와 특징주를 계속 요약합니다. 원인이 확인되지 않은 움직임에는 임의의 재료를 붙이지 않습니다.</small></div>
      <span>업데이트 {clock(snapshot.updatedAt)}</span>
    </header>

    <div className="intraday-kpis">
      <div><span>KOSPI</span><strong>{kospi?.lastPrice?.toLocaleString() ?? '-'}</strong><b className={(kospi?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{rate(kospi?.changeRate)}</b></div>
      <div><span>KOSDAQ</span><strong>{kosdaq?.lastPrice?.toLocaleString() ?? '-'}</strong><b className={(kosdaq?.changeRate ?? 0) >= 0 ? 'up' : 'down'}>{rate(kosdaq?.changeRate)}</b></div>
      <div><span>TOP100 상승 / 하락 / 보합</span><strong>{breadth.up} / {breadth.down} / {breadth.flat}</strong><b>{direction}</b></div>
      <div><span>TOP100 거래대금 합계</span><strong>{amount(total)}</strong><b>{rankings.length}/100 종목</b></div>
      <div><span>06:00 이후 선별 뉴스</span><strong>{newsItems.length}건</strong><b>{news.ok ? `최근 ${clock(news.updatedAt)}` : '수집 상태 확인 필요'}</b></div>
    </div>

    <div className="intraday-brief-grid">
      <article>
        <h2>상승 특징주 <small>TOP100 거래대금 내</small></h2>
        {strongest.map((item, index) => <div className="brief-stock-row" key={item.symbol ?? index}><b>{index + 1}</b><span>{item.name ?? item.symbol}<small>{item.symbol} · {amount(item.tradingAmount)}</small></span><strong className="up">{rate(item.changeRate)}</strong></div>)}
      </article>
      <article>
        <h2>하락 특징주 <small>TOP100 거래대금 내</small></h2>
        {weakest.map((item, index) => <div className="brief-stock-row" key={item.symbol ?? index}><b>{index + 1}</b><span>{item.name ?? item.symbol}<small>{item.symbol} · {amount(item.tradingAmount)}</small></span><strong className="down">{rate(item.changeRate)}</strong></div>)}
      </article>
      <article>
        <h2>주도 테마 <small>거래대금 기준</small></h2>
        {leaders.map((theme, index) => <div className="brief-theme-row" key={theme.name ?? index}><b>{index + 1}</b><span>{theme.name ?? '테마'}<small>{theme.memberCount ?? 0}개 종목</small></span><strong className={(theme.currentValue ?? 0) >= 0 ? 'up' : 'down'}>{rate(theme.currentValue)}</strong><em>{amount(theme.tradingAmount)}</em></div>)}
      </article>
      <article className="brief-news-status">
        <h2>뉴스·리포트 상태 <small>06:00 이후</small></h2>
        {latestNews.map((item, index) => <div key={`${item.publishedAt}-${index}`}><time>{clock(item.publishedAt)}</time><span>{item.summary || item.title}</span><b>{item.category ?? '시장 이슈'}</b></div>)}
        {!latestNews.length && <div className="brief-news-empty"><strong>선별 뉴스가 현재 0건입니다.</strong><span>{news.error || '서버가 복수 뉴스 피드를 확인하고 있습니다. TOP100·테마·등락 기반 브리핑은 계속 표시됩니다.'}</span></div>}
      </article>
    </div>
  </section>
}

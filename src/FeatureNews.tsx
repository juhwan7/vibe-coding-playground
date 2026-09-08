import { useEffect, useMemo, useState } from 'react'
import './featureNews.css'

type RankingItem = { symbol?: string | null; name?: string | null; tradingAmount?: number | null }
type Snapshot = { topRankings?: RankingItem[] }
type NewsItem = { title: string; link: string; source?: string | null; sourceUrl?: string | null; publishedAt?: string | null }
type NewsPayload = { ok?: boolean; updatedAt?: string | null; source?: string | null; items?: NewsItem[]; error?: string | null }

const THEME_WORDS: Array<[string, string[]]> = [
  ['반도체', ['반도체','하이닉스','삼성전자','HBM','파운드리']],
  ['원전·전력', ['원전','원자력','에너빌리티','전력','전선','변압기']],
  ['방산', ['방산','에어로스페이스','현대로템','LIG넥스원','항공우주']],
  ['조선', ['조선','한화오션','삼성중공업','HD현대중공업']],
  ['2차전지', ['2차전지','배터리','에코프로','LG에너지솔루션','삼성SDI']],
  ['바이오', ['바이오','제약','알테오젠','셀트리온','HLB']],
  ['로봇', ['로봇','로보틱스','로보티즈']],
]

function displayTime(value?: string | null) {
  if (!value) return '-'
  try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) } catch { return '-' }
}

function timestamp(value?: string | null) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function matchTheme(title: string) {
  const found = THEME_WORDS.find(([, words]) => words.some((word) => title.toUpperCase().includes(word.toUpperCase())))
  return found?.[0] ?? null
}

export default function FeatureNews() {
  const [news, setNews] = useState<NewsPayload>({ ok: false, items: [] })
  const [snapshot, setSnapshot] = useState<Snapshot>({})

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        const [newsResponse, snapshotResponse] = await Promise.all([
          fetch('/api/market/feature-news', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
          fetch('/api/market/snapshot', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null),
        ])
        if (newsResponse) {
          const payload = await newsResponse.json().catch(() => null) as NewsPayload | null
          if (payload) setNews(payload)
        }
        if (snapshotResponse?.ok) setSnapshot(await snapshotResponse.json() as Snapshot)
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      } finally {
        timer = window.setTimeout(load, 60000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [])

  const topStocks = useMemo(() => (snapshot.topRankings ?? []).slice(0, 50).filter((item) => item.name), [snapshot.topRankings])
  const items = useMemo(() => (news.items ?? []).map((item) => {
    const matches = topStocks.filter((stock) => stock.name && item.title.includes(stock.name)).slice(0, 3)
    return { ...item, matches, theme: matchTheme(item.title) }
  }).sort((a, b) => {
    const aMatched = a.matches.length ? 1 : 0
    const bMatched = b.matches.length ? 1 : 0
    if (aMatched !== bMatched) return bMatched - aMatched
    return timestamp(b.publishedAt) - timestamp(a.publishedAt)
  }).slice(0, 12), [news.items, topStocks])

  return <section className="feature-news-shell" data-testid="feature-news">
    <header className="feature-news-head">
      <div><p>FEATURE STOCK NEWS / MONEY FLOW CONTEXT</p><h2>특징주 이슈</h2><small>거래대금 TOP50 종목명이 기사 제목에 있으면 먼저 올려서, 돈이 몰린 종목과 당일 이슈를 같은 화면에서 확인합니다.</small></div>
      <div><b>{news.ok ? '● 1분 최신화' : '● 뉴스 연결 중'}</b><span>{displayTime(news.updatedAt)}</span></div>
    </header>
    <div className="feature-news-list">
      {items.map((item, index) => <a className="feature-news-item" href={item.link} target="_blank" rel="noreferrer" key={`${item.link}-${index}`}>
        <div className="feature-news-meta"><span>{item.source || '뉴스'}</span><time>{displayTime(item.publishedAt)}</time>{item.matches.length > 0 && <b>TOP50 연관</b>}</div>
        <h3>{item.title}</h3>
        <div className="feature-news-tags">{item.matches.map((stock) => <span key={stock.symbol ?? stock.name ?? ''}>{stock.name}</span>)}{item.theme && <em>{item.theme}</em>}</div>
      </a>)}
      {!items.length && <div className="feature-news-empty"><strong>특징주 뉴스를 불러오는 중입니다.</strong><span>기사 제목·언론사·발행시각·기사 링크만 표시하고 임의의 이슈는 만들지 않습니다.</span>{news.error && <small>{news.error}</small>}</div>}
    </div>
    <footer>기사 클릭 시 해당 뉴스의 기사 페이지가 새 창에서 열립니다. 뉴스와 주가의 인과관계는 자동으로 판단하지 않습니다.</footer>
  </section>
}

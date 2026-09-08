import { useEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import './featureNews.css'

type RankingItem = { symbol?: string | null; name?: string | null; tradingAmount?: number | null }
type Snapshot = { topRankings?: RankingItem[] }
type NewsItem = {
  title: string
  summary?: string | null
  link: string
  source?: string | null
  sourceUrl?: string | null
  publishedAt?: string | null
  lastPublishedAt?: string | null
  duplicateCount?: number | null
  sourceCount?: number | null
}
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

const PROMO_WORDS = ['[광고]', '[홍보]', '리딩방', '무료 추천', '무료추천', '카톡방', '텔레그램방', '회원모집', '회원 모집', '추천주 무료']

function displayTime(value?: string | null) {
  if (!value) return '-'
  try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) } catch { return '-' }
}

function displayClock(value?: string | null) {
  if (!value) return '-'
  try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) } catch { return '-' }
}

function timestamp(value?: string | null) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function conciseTitle(item: NewsItem) {
  return (item.summary || item.title)
    .replace(/^\s*(?:\[[^\]]{1,30}\]\s*)+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchTheme(title: string) {
  const found = THEME_WORDS.find(([, words]) => words.some((word) => title.toUpperCase().includes(word.toUpperCase())))
  return found?.[0] ?? null
}

function looksPromotional(item: NewsItem) {
  const text = `${item.title} ${item.source ?? ''}`.toLowerCase()
  return PROMO_WORDS.some((word) => text.includes(word.toLowerCase()))
}

export default function FeatureNews() {
  const [news, setNews] = useState<NewsPayload>({ ok: false, items: [] })
  const [snapshot, setSnapshot] = useState<Snapshot>({})
  const timelineRef = useRef<HTMLDivElement>(null)
  const positionedRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    let newsTimer: number | undefined
    let snapshotTimer: number | undefined
    let startupTimer: number | undefined

    const loadNews = async () => {
      try {
        const response = await fetch('/api/market/feature-news', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null)
        if (response) {
          const payload = await response.json().catch(() => null) as NewsPayload | null
          if (payload) setNews(payload)
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      } finally {
        if (!controller.signal.aborted) newsTimer = window.setTimeout(loadNews, 180000)
      }
    }

    const loadSnapshot = async () => {
      try {
        const response = await fetch('/api/market/snapshot', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null)
        if (response?.ok) setSnapshot(await response.json() as Snapshot)
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      } finally {
        if (!controller.signal.aborted) snapshotTimer = window.setTimeout(loadSnapshot, 60000)
      }
    }

    void loadNews()
    startupTimer = window.setTimeout(() => { void loadSnapshot() }, 250)
    return () => {
      controller.abort()
      if (newsTimer) window.clearTimeout(newsTimer)
      if (snapshotTimer) window.clearTimeout(snapshotTimer)
      if (startupTimer) window.clearTimeout(startupTimer)
    }
  }, [])

  const topStocks = useMemo(() => (snapshot.topRankings ?? []).slice(0, 50).filter((item) => item.name), [snapshot.topRankings])
  const items = useMemo(() => {
    const exactSeen = new Set<string>()
    return (news.items ?? [])
      .filter((item) => !looksPromotional(item))
      .map((item) => {
        const summary = conciseTitle(item)
        const matches = topStocks.filter((stock) => stock.name && summary.includes(stock.name)).slice(0, 3)
        return { ...item, summary, matches, theme: matchTheme(summary) }
      })
      .filter((item) => {
        const key = item.summary.toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
        if (!key || exactSeen.has(key)) return false
        exactSeen.add(key)
        return true
      })
      .sort((a, b) => timestamp(a.publishedAt) - timestamp(b.publishedAt))
      .slice(-20)
  }, [news.items, topStocks])

  useEffect(() => {
    const node = timelineRef.current
    if (!node || !items.length) return
    const frame = window.requestAnimationFrame(() => {
      node.scrollTo({ left: node.scrollWidth, behavior: positionedRef.current ? 'smooth' : 'auto' })
      positionedRef.current = true
    })
    return () => window.cancelAnimationFrame(frame)
  }, [items.length, news.updatedAt])

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    event.currentTarget.scrollLeft += event.deltaY
  }

  return <section className="feature-news-shell" data-testid="feature-news">
    <header className="feature-news-head">
      <div><p>FEATURE STOCK ISSUE TIMELINE</p><h2>특징주 이슈</h2><small>기사 나열 대신 같은 이슈는 묶고 홍보성 제목은 제외합니다. 오래된 이슈는 왼쪽, 최신 이슈는 오른쪽에 쌓입니다.</small></div>
      <div><b>{news.ok ? '● 뉴스 3분 최신화' : '● 뉴스 연결 중'}</b><span>{displayTime(news.updatedAt)}</span></div>
    </header>
    <div className="feature-news-timeline" ref={timelineRef} onWheel={handleWheel} data-testid="feature-news-timeline">
      {items.map((item, index) => <a className="feature-news-item" href={item.link} target="_blank" rel="noreferrer" key={`${item.link}-${index}`}>
        <div className="feature-news-time"><time>{displayClock(item.publishedAt)}</time><span>{index + 1}</span></div>
        <h3>{item.summary}</h3>
        <div className="feature-news-tags">
          {item.matches.map((stock) => <span key={stock.symbol ?? stock.name ?? ''}>{stock.name}</span>)}
          {item.theme && <em>{item.theme}</em>}
          {(item.duplicateCount ?? 1) > 1 && <b>{item.duplicateCount}건 묶음</b>}
        </div>
        <div className="feature-news-source"><span>{(item.sourceCount ?? 1) > 1 ? `${item.sourceCount}개 매체` : item.source || '뉴스'}</span>{item.matches.length > 0 && <b>TOP50 연관</b>}</div>
      </a>)}
      {!items.length && <div className="feature-news-empty"><strong>특징주 이슈를 불러오는 중입니다.</strong><span>중복 기사와 명시적인 광고·홍보성 제목은 제외하고 시간순 이슈만 표시합니다.</span>{news.error && <small>{news.error}</small>}</div>}
    </div>
    <footer>마우스 휠로 좌우 이동할 수 있습니다. 카드 클릭 시 대표 기사 원문이 열리며, 뉴스와 주가의 인과관계는 자동 판단하지 않습니다.</footer>
  </section>
}

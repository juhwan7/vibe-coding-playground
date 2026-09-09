import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'
import './featureNews.css'
import './featureNewsEnhancements.css'

type RankingItem = { symbol?: string | null; name?: string | null; tradingAmount?: number | null; changeRate?: number | null }
type Snapshot = { topRankings?: RankingItem[] }
type MatchedStock = { symbol?: string | null; name?: string | null; tradingAmount?: number | null; changeRate?: number | null; rank?: number | null }
type NewsItem = {
  title: string
  summary?: string | null
  link: string
  source?: string | null
  publishedAt?: string | null
  duplicateCount?: number | null
  sourceCount?: number | null
  category?: string | null
  importance?: number | null
  matches?: MatchedStock[] | null
}
type NewsPayload = { ok?: boolean; updatedAt?: string | null; items?: NewsItem[]; error?: string | null }

const THEME_WORDS: Array<[string, string[]]> = [
  ['반도체', ['반도체','하이닉스','삼성전자','HBM','파운드리']],
  ['원전·전력', ['원전','원자력','에너빌리티','전력','전선','변압기']],
  ['방산', ['방산','에어로스페이스','현대로템','LIG넥스원','항공우주']],
  ['조선', ['조선','한화오션','삼성중공업','HD현대중공업']],
  ['2차전지', ['2차전지','배터리','에코프로','LG에너지솔루션','삼성SDI']],
  ['바이오', ['바이오','제약','알테오젠','셀트리온','HLB']],
  ['광통신', ['광통신','광섬유','광케이블','광모듈','광트랜시버','대한광통신','우리로','옵티코어','오이솔루션']],
  ['로봇', ['로봇','로보틱스','휴머노이드']],
]
const PROMO_WORDS = ['[광고]', '[홍보]', '리딩방', '무료 추천', '무료추천', '카톡방', '텔레그램방', '회원모집', '회원 모집', '추천주 무료']

function displayTime(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function displayClock(value?: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function timestamp(value?: string | null) {
  const parsed = Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function kstSixStart(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now))
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return Date.parse(`${get('year')}-${get('month')}-${get('day')}T06:00:00+09:00`)
}

function conciseTitle(item: NewsItem) {
  return (item.summary || item.title).replace(/^\s*(?:\[[^\]]{1,30}\]\s*)+/g, '').replace(/\s+/g, ' ').trim()
}

function matchTheme(title: string) {
  return THEME_WORDS.find(([, words]) => words.some((word) => title.toUpperCase().includes(word.toUpperCase())))?.[0] ?? null
}

function looksPromotional(item: NewsItem) {
  const text = `${item.title} ${item.source ?? ''}`.toLowerCase()
  return PROMO_WORDS.some((word) => text.includes(word.toLowerCase()))
}

function validName(name?: string | null, symbol?: string | null) {
  const value = String(name ?? '').trim()
  if (!value || value === String(symbol ?? '').trim() || /^\d{6}$/.test(value)) return null
  return value
}

function fmtRate(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

export default function FeatureNews() {
  const [news, setNews] = useState<NewsPayload>({ ok: false, items: [] })
  const [snapshot, setSnapshot] = useState<Snapshot>({})
  const [dragging, setDragging] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const positionedRef = useRef(false)
  const dragRef = useRef({ pointerId: -1, startX: 0, startScrollLeft: 0, moved: false })
  const suppressClickUntil = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    let newsTimer: number | undefined
    let snapshotTimer: number | undefined

    const loadNews = async () => {
      try {
        const response = await fetch('/api/market/feature-news', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null)
        const payload = response ? await response.json().catch(() => null) as NewsPayload | null : null
        if (payload) setNews(payload)
      } finally {
        if (!controller.signal.aborted) newsTimer = window.setTimeout(loadNews, 180000)
      }
    }

    const loadSnapshot = async () => {
      try {
        const response = await fetch('/api/market/snapshot', { signal: controller.signal, headers: { Accept: 'application/json' } }).catch(() => null)
        if (response?.ok) setSnapshot(await response.json() as Snapshot)
      } finally {
        if (!controller.signal.aborted) snapshotTimer = window.setTimeout(loadSnapshot, 10000)
      }
    }

    void loadNews()
    void loadSnapshot()
    return () => {
      controller.abort()
      if (newsTimer) window.clearTimeout(newsTimer)
      if (snapshotTimer) window.clearTimeout(snapshotTimer)
    }
  }, [])

  const topStocks = useMemo(() => (snapshot.topRankings ?? []).slice(0, 50).filter((item) => validName(item.name, item.symbol)), [snapshot.topRankings])
  const items = useMemo(() => {
    const exactSeen = new Set<string>()
    const from = kstSixStart()
    const until = Date.now() + 5 * 60 * 1000
    return (news.items ?? []).filter((item) => {
      const published = timestamp(item.publishedAt)
      return published >= from && published <= until && !looksPromotional(item)
    }).map((item) => {
      const summary = conciseTitle(item)
      const fallbackMatches = topStocks.filter((stock) => {
        const name = validName(stock.name, stock.symbol)
        return name && summary.includes(name)
      }).slice(0, 3)
      const matches = (item.matches?.length ? item.matches : fallbackMatches).filter((stock) => validName(stock.name, stock.symbol))
      return { ...item, summary, matches, theme: matchTheme(summary) }
    }).filter((item) => {
      const key = item.summary.toLowerCase().replace(/[^가-힣a-z0-9]/g, '')
      if (!key || exactSeen.has(key)) return false
      exactSeen.add(key)
      return true
    }).sort((a, b) => timestamp(a.publishedAt) - timestamp(b.publishedAt))
  }, [news.items, topStocks])

  useEffect(() => {
    const node = timelineRef.current
    if (!node || !items.length || dragging) return
    const frame = window.requestAnimationFrame(() => {
      node.scrollTo({ left: node.scrollWidth, behavior: positionedRef.current ? 'smooth' : 'auto' })
      positionedRef.current = true
    })
    return () => window.cancelAnimationFrame(frame)
  }, [items.length, news.updatedAt, dragging])

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    event.currentTarget.scrollLeft += event.deltaY
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: event.currentTarget.scrollLeft, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return
    const delta = event.clientX - dragRef.current.startX
    if (!dragRef.current.moved && Math.abs(delta) > 4) {
      dragRef.current.moved = true
      setDragging(true)
    }
    if (!dragRef.current.moved) return
    event.preventDefault()
    event.currentTarget.scrollLeft = dragRef.current.startScrollLeft - delta
  }

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return
    if (dragRef.current.moved) suppressClickUntil.current = performance.now() + 300
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current.pointerId = -1
    dragRef.current.moved = false
    setDragging(false)
  }

  const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (performance.now() >= suppressClickUntil.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  return <section className="feature-news-shell" data-testid="feature-news">
    <header className="feature-news-head">
      <div><p>MARKET BRIEF / HIGH SIGNAL</p><h2>시황 요약</h2><small>오늘 06:00 이후 뉴스를 매번 다시 훑고 누적합니다. 테마를 움직일 수 있는 수주·투자·정책·승인·공급 이슈와 거래대금 집중 종목 재료, CPI·FOMC·전쟁·유가·환율 같은 시장 영향 뉴스만 중복 없이 압축합니다.</small></div>
      <div><b>{news.ok ? '● 시황 3분 최신화' : '● 시황 연결 중'}</b><span>{displayTime(news.updatedAt)}</span></div>
    </header>
    <div className={`feature-news-timeline${dragging ? ' dragging' : ''}`} ref={timelineRef} onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={finishPointerDrag} onPointerCancel={finishPointerDrag} onClickCapture={handleClickCapture} data-testid="feature-news-timeline">
      {items.map((item, index) => <a className="feature-news-item" href={item.link} target="_blank" rel="noreferrer" draggable={false} key={`${item.link}-${index}`}>
        <div className="feature-news-time"><time>{displayClock(item.publishedAt)}</time><span>{index + 1}</span></div>
        <h3>{item.summary}</h3>
        <div className="feature-news-tags">
          {item.category && <em>{item.category}</em>}
          {item.matches.map((stock) => <span key={stock.symbol ?? stock.name ?? ''}>{validName(stock.name, stock.symbol)}{fmtRate(stock.changeRate) ? ` ${fmtRate(stock.changeRate)}` : ''}</span>)}
          {item.theme && <em>{item.theme}</em>}
          {(item.duplicateCount ?? 1) > 1 && <b>{item.duplicateCount}건 종합</b>}
        </div>
        <div className="feature-news-source"><span>{(item.sourceCount ?? 1) > 1 ? `${item.sourceCount}개 매체 종합` : item.source || '뉴스'}</span>{item.matches.length > 0 && <b>거래대금 상위 연관</b>}</div>
      </a>)}
      {!items.length && <div className="feature-news-empty"><strong>06:00 이후 중요 뉴스를 다시 훑어 선별 중입니다.</strong><span>이미 지나간 기사도 재검색하며 같은 이슈가 아니면 당일 타임라인에 추가합니다.</span>{news.error && <small>{news.error}</small>}</div>}
    </div>
    <footer>06:00 이후 뉴스는 시간순으로 누적되며 같은 사건의 반복 기사는 하나로 묶습니다. 마우스 휠 또는 드래그로 좌우 이동할 수 있습니다.</footer>
  </section>
}

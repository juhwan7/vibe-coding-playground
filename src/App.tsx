import { useEffect, useState } from 'react'
import LiquidityDashboard from './LiquidityDashboard'
import MarketWorkspace from './MarketWorkspace'
import ThemeFlowPulse from './ThemeFlowPulse'
import IntradayBrief from './IntradayBrief'
import MarketReplay from './MarketReplay'
import UsMarketWorkspace from './UsMarketWorkspace'
import UsDataNotice from './UsDataNotice'
import StockQuiz, { warmQuizUniverse } from './StockQuiz'
import FeatureNews from './FeatureNews'
import DailyIssues from './DailyIssues'
import './liveMarket.css'
import './theme.css'
import './usMarketWorkspace.css'
import './refreshControl.css'
import './readability.css'
import './themeFlowSaas.css'
export { moneyFlowScore } from './marketData'
export { answerIsCorrect, buildQuizRound } from './StockQuiz'

type Theme = 'light' | 'dark'
type Page = 'liquidity' | 'flow' | 'us-flow' | 'daily-issues' | 'replay' | 'quiz'

export default function App() {
  const [page, setPage] = useState<Page>('flow')
  const [briefOpen, setBriefOpen] = useState(false)
  const [dataRevision, setDataRevision] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('k-market-theme-v3')
      return saved === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try { localStorage.setItem('k-market-theme-v3', theme) } catch { /* storage can be unavailable */ }
  }, [theme])

  useEffect(() => { void warmQuizUniverse() }, [])

  useEffect(() => {
    if (!briefOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBriefOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [briefOpen])

  const navigate = (nextPage: Page) => {
    setBriefOpen(false)
    setPage(nextPage)
  }

  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light')

  const manualRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshFailed(false)
    try {
      const response = await fetch('/api/market/refresh', { method: 'POST', headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('refresh failed')
      setDataRevision((value) => value + 1)
    } catch {
      setRefreshFailed(true)
    } finally {
      setRefreshing(false)
    }
  }

  let content = <div className="flow-page-with-news" key={`flow-${dataRevision}`}><ThemeFlowPulse /><MarketWorkspace /><FeatureNews /></div>
  if (page === 'liquidity') content = <LiquidityDashboard key={`liquidity-${dataRevision}`} />
  if (page === 'us-flow') content = <div key={`us-flow-${dataRevision}`}><UsDataNotice /><UsMarketWorkspace /></div>
  if (page === 'daily-issues') content = <DailyIssues key={`daily-issues-${dataRevision}`} />
  if (page === 'replay') content = <MarketReplay key={`replay-${dataRevision}`} />
  if (page === 'quiz') content = <StockQuiz key={`quiz-${dataRevision}`} />

  return <div className="app-root">
    <nav className="global-nav">
      <button className="brand" onClick={() => navigate('flow')}>MARKET FLOW</button>
      <div>
        <button className={page === 'flow' ? 'active' : ''} onClick={() => navigate('flow')}>국내 테마 흐름</button>
        <button className={page === 'liquidity' ? 'active' : ''} onClick={() => navigate('liquidity')}>증시 자금</button>
        <button className={page === 'us-flow' ? 'active' : ''} onClick={() => navigate('us-flow')}>미국 테마 흐름</button>
        <button className={page === 'daily-issues' ? 'active' : ''} onClick={() => navigate('daily-issues')}>금일 이슈 정리</button>
        <button className={page === 'replay' ? 'active' : ''} onClick={() => navigate('replay')}>시장 복기</button>
        <button className={page === 'quiz' ? 'active' : ''} onClick={() => navigate('quiz')}>종목 퀴즈</button>
      </div>
      <aside className="nav-actions">
        <span className="live-dot">● MARKET LAB</span>
        <button className={`manual-refresh ${refreshFailed ? 'failed' : ''}`} type="button" onClick={manualRefresh} disabled={refreshing} aria-label="시장 데이터 수동 새로고침" title="핵심 시장 데이터를 우선 갱신합니다. 서버에서 20초 쿨다운을 적용합니다.">{refreshing ? '갱신 중…' : refreshFailed ? '잠시 후 재시도' : '↻ 새로고침'}</button>
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? '다크 테마로 전환' : '화이트 테마로 전환'} title={theme === 'light' ? '다크 테마' : '화이트 테마'}><span className="theme-icon" aria-hidden="true">☀</span><span className="toggle-track"><span className="toggle-knob" /></span><span className="theme-icon moon" aria-hidden="true">☾</span></button>
      </aside>
    </nav>

    {content}

    {page === 'flow' && <button className="brief-drawer-trigger" type="button" aria-controls="intraday-brief-drawer" aria-expanded={briefOpen} onClick={() => setBriefOpen((value) => !value)}><span>장중</span><strong>시황 브리핑</strong></button>}

    {page === 'flow' && briefOpen && <>
      <div className="brief-drawer-backdrop" aria-hidden="true" onClick={() => setBriefOpen(false)} />
      <aside id="intraday-brief-drawer" className="brief-drawer" role="dialog" aria-modal="true" aria-label="장중 시황 브리핑">
        <div className="brief-drawer-toolbar">
          <div><b>LIVE BRIEF</b><span>필요할 때만 열어보는 장중 요약</span></div>
          <button type="button" onClick={() => setBriefOpen(false)} aria-label="장중 시황 브리핑 닫기">×</button>
        </div>
        <IntradayBrief />
      </aside>
    </>}
  </div>
}

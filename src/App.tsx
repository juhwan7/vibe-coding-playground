import { useEffect, useState } from 'react'
import LiquidityDashboard from './LiquidityDashboard'
import MarketWorkspace from './MarketWorkspace'
import UsMarketWorkspace from './UsMarketWorkspace'
import UsDataNotice from './UsDataNotice'
import StockQuiz from './StockQuiz'
import FeatureNews from './FeatureNews'
import './liveMarket.css'
import './theme.css'
import './usMarketWorkspace.css'
export { moneyFlowScore } from './marketData'
export { answerIsCorrect, buildQuizRound } from './StockQuiz'

type Theme = 'light' | 'dark'
type Page = 'liquidity' | 'flow' | 'us-flow' | 'quiz'

export default function App() {
  const [page, setPage] = useState<Page>('liquidity')
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

  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light')

  let content = <LiquidityDashboard />
  if (page === 'flow') content = <div className="flow-page-with-news"><FeatureNews /><MarketWorkspace /></div>
  if (page === 'us-flow') content = <div><UsDataNotice /><UsMarketWorkspace /></div>
  if (page === 'quiz') content = <StockQuiz />

  return <div className="app-root">
    <nav className="global-nav">
      <button className="brand" onClick={() => setPage('liquidity')}>MARKET FLOW</button>
      <div>
        <button className={page === 'liquidity' ? 'active' : ''} onClick={() => setPage('liquidity')}>증시 자금</button>
        <button className={page === 'flow' ? 'active' : ''} onClick={() => setPage('flow')}>국내 테마 흐름</button>
        <button className={page === 'us-flow' ? 'active' : ''} onClick={() => setPage('us-flow')}>미국 테마 흐름</button>
        <button className={page === 'quiz' ? 'active' : ''} onClick={() => setPage('quiz')}>종목 퀴즈</button>
      </div>
      <aside className="nav-actions"><span className="live-dot">● MARKET LAB</span><button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? '다크 테마로 전환' : '화이트 테마로 전환'} title={theme === 'light' ? '다크 테마' : '화이트 테마'}><span className="theme-icon" aria-hidden="true">☀</span><span className="toggle-track"><span className="toggle-knob" /></span><span className="theme-icon moon" aria-hidden="true">☾</span></button></aside>
    </nav>
    {content}
  </div>
}

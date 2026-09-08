import { useEffect, useState } from 'react'
import MarketDashboard from './MarketDashboard'
import './liveMarket.css'
import './theme.css'
export { moneyFlowScore } from './marketData'

type Theme = 'light' | 'dark'

type QuizItem = {
  stock: string
  ticker: string
  market: string
  correct: number
  choices: string[]
}

export const quizItems: QuizItem[] = [
  { stock: '삼성전자', ticker: '005930', market: 'KOSPI', correct: 1, choices: ['완성차와 자동차 부품을 생산하며 글로벌 전기차·수소차 사업을 확대하는 기업', '메모리 반도체, 스마트폰, TV, 가전 등을 생산하는 글로벌 전자·반도체 기업', '정유·석유화학 제품을 생산하고 주유소 네트워크를 운영하는 에너지 기업', '게임 개발과 퍼블리싱을 중심으로 PC·모바일 게임 서비스를 제공하는 기업'] },
  { stock: 'SK하이닉스', ticker: '000660', market: 'KOSPI', correct: 2, choices: ['배터리 셀과 에너지저장장치용 제품을 생산하는 2차전지 기업', '조선소에서 LNG선·컨테이너선·해양플랜트를 건조하는 조선 기업', 'DRAM·NAND 등 메모리 반도체와 HBM을 주력으로 생산하는 반도체 기업', '은행·카드·보험 등 금융 서비스를 제공하는 금융지주회사'] },
  { stock: '현대차', ticker: '005380', market: 'KOSPI', correct: 0, choices: ['승용차·SUV·상용차를 생산하고 전기차·수소차 사업을 전개하는 완성차 기업', '검색·광고·커머스·콘텐츠·클라우드 서비스를 운영하는 인터넷 플랫폼 기업', '바이오시밀러와 항체의약품을 개발·생산하는 바이오제약 기업', '철강 제품을 생산하고 자동차·조선·건설 산업에 공급하는 철강 기업'] },
  { stock: 'NAVER', ticker: '035420', market: 'KOSPI', correct: 3, choices: ['원전·화력발전소용 기자재를 제작하고 발전 설비 사업을 수행하는 기업', '면세점·호텔·레저 사업을 운영하는 유통·서비스 기업', '반도체 공정용 장비와 디스플레이 제조장비를 생산하는 장비 기업', '검색, 광고, 쇼핑, 웹툰, 클라우드 등 다양한 인터넷 서비스를 운영하는 플랫폼 기업'] },
  { stock: '한화에어로스페이스', ticker: '012450', market: 'KOSPI', correct: 1, choices: ['화장품 브랜드를 개발하고 국내외 유통망을 통해 판매하는 소비재 기업', '항공엔진과 방산 장비를 중심으로 우주·항공·방위산업 사업을 하는 기업', '편의점과 슈퍼마켓을 운영하는 오프라인 유통 기업', '시멘트와 레미콘을 생산해 건설 현장에 공급하는 건자재 기업'] },
]

export function isCorrectAnswer(item: QuizItem, selected: number) { return item.correct === selected }

function StockQuiz() {
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const item = quizItems[questionIndex]

  const choose = (choiceIndex: number) => { if (selected !== null) return; setSelected(choiceIndex); if (isCorrectAnswer(item, choiceIndex)) setScore((value) => value + 1) }
  const next = () => { if (questionIndex >= quizItems.length - 1) { setFinished(true); return }; setQuestionIndex((value) => value + 1); setSelected(null) }
  const restart = () => { setQuestionIndex(0); setSelected(null); setScore(0); setFinished(false) }

  if (finished) return <main className="game-shell"><section className="result-card"><p className="eyebrow">STOCK COMPANY QUIZ</p><div className="result-score">{score}<span> / {quizItems.length}</span></div><h1>기업 맞히기 완료</h1><button className="primary-button" onClick={restart}>다시 도전하기</button></section></main>

  return <main className="game-shell"><section className="quiz-layout"><header className="quiz-header"><div><p className="eyebrow">STOCK COMPANY QUIZ</p><h1>이 종목, 무슨 회사일까?</h1></div><div className="score-box"><span>점수</span><strong>{score}</strong></div></header><article className="question-card" data-testid="question-card"><div className="stock-meta"><span className="market-badge">{item.market}</span><span>{item.ticker}</span></div><p className="question-label">종목명</p><h2>{item.stock}</h2><p>아래 4개 설명 중 이 기업에 해당하는 설명을 선택하세요.</p></article><div className="choices">{item.choices.map((choice, index) => { const answered = selected !== null; const correct = index === item.correct; const picked = index === selected; return <button key={choice} className={`choice-card ${answered ? (correct ? 'correct' : picked ? 'wrong' : 'muted') : ''}`} onClick={() => choose(index)} disabled={answered}><span className="choice-number">{index + 1}</span><span>{choice}</span></button> })}</div>{selected !== null && <div className={`feedback ${isCorrectAnswer(item, selected) ? 'success' : 'fail'}`}><div><strong>{isCorrectAnswer(item, selected) ? '정답입니다.' : '아쉽습니다.'}</strong><p>정답: {item.choices[item.correct]}</p></div><button className="primary-button" onClick={next}>{questionIndex === quizItems.length - 1 ? '결과 보기' : '다음 문제'}</button></div>}</section></main>
}

export default function App() {
  const [page, setPage] = useState<'flow' | 'quiz'>('flow')
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('k-market-theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try { localStorage.setItem('k-market-theme', theme) } catch { /* storage can be unavailable */ }
  }, [theme])

  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light')

  return <div className="app-root"><nav className="global-nav"><button className="brand" onClick={() => setPage('flow')}>K-MARKET FLOW</button><div><button className={page === 'flow' ? 'active' : ''} onClick={() => setPage('flow')}>머니플로우</button><button className={page === 'quiz' ? 'active' : ''} onClick={() => setPage('quiz')}>종목 퀴즈</button></div><aside className="nav-actions"><span className="live-dot">● MARKET LAB</span><button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? '다크 테마로 전환' : '화이트 테마로 전환'} title={theme === 'light' ? '다크 테마' : '화이트 테마'}><span className="theme-icon" aria-hidden="true">☀</span><span className="toggle-track"><span className="toggle-knob" /></span><span className="theme-icon moon" aria-hidden="true">☾</span></button></aside></nav>{page === 'flow' ? <MarketDashboard /> : <StockQuiz />}</div>
}

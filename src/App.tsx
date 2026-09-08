import { useMemo, useState } from 'react'

type QuizItem = {
  stock: string
  ticker: string
  market: string
  correct: number
  choices: string[]
}

type Stock = {
  name: string
  ticker: string
  market: 'KOSPI' | 'KOSDAQ'
  change: number
  turnover: number
  foreign: number
  institution: number
}

type Theme = { name: string; stocks: Stock[] }

type Sector = {
  name: string
  change: number
  turnover: number
  advancers: number
  decliners: number
  foreign: number
  institution: number
  themes: Theme[]
}

export const quizItems: QuizItem[] = [
  { stock: '삼성전자', ticker: '005930', market: 'KOSPI', correct: 1, choices: ['완성차와 자동차 부품을 생산하며 글로벌 전기차·수소차 사업을 확대하는 기업', '메모리 반도체, 스마트폰, TV, 가전 등을 생산하는 글로벌 전자·반도체 기업', '정유·석유화학 제품을 생산하고 주유소 네트워크를 운영하는 에너지 기업', '게임 개발과 퍼블리싱을 중심으로 PC·모바일 게임 서비스를 제공하는 기업'] },
  { stock: 'SK하이닉스', ticker: '000660', market: 'KOSPI', correct: 2, choices: ['배터리 셀과 에너지저장장치용 제품을 생산하는 2차전지 기업', '조선소에서 LNG선·컨테이너선·해양플랜트를 건조하는 조선 기업', 'DRAM·NAND 등 메모리 반도체와 HBM을 주력으로 생산하는 반도체 기업', '은행·카드·보험 등 금융 서비스를 제공하는 금융지주회사'] },
  { stock: '현대차', ticker: '005380', market: 'KOSPI', correct: 0, choices: ['승용차·SUV·상용차를 생산하고 전기차·수소차 사업을 전개하는 완성차 기업', '검색·광고·커머스·콘텐츠·클라우드 서비스를 운영하는 인터넷 플랫폼 기업', '바이오시밀러와 항체의약품을 개발·생산하는 바이오제약 기업', '철강 제품을 생산하고 자동차·조선·건설 산업에 공급하는 철강 기업'] },
  { stock: 'NAVER', ticker: '035420', market: 'KOSPI', correct: 3, choices: ['원전·화력발전소용 기자재를 제작하고 발전 설비 사업을 수행하는 기업', '면세점·호텔·레저 사업을 운영하는 유통·서비스 기업', '반도체 공정용 장비와 디스플레이 제조장비를 생산하는 장비 기업', '검색, 광고, 쇼핑, 웹툰, 클라우드 등 다양한 인터넷 서비스를 운영하는 플랫폼 기업'] },
  { stock: '한화에어로스페이스', ticker: '012450', market: 'KOSPI', correct: 1, choices: ['화장품 브랜드를 개발하고 국내외 유통망을 통해 판매하는 소비재 기업', '항공엔진과 방산 장비를 중심으로 우주·항공·방위산업 사업을 하는 기업', '편의점과 슈퍼마켓을 운영하는 오프라인 유통 기업', '시멘트와 레미콘을 생산해 건설 현장에 공급하는 건자재 기업'] },
]

const sectors: Sector[] = [
  {
    name: '반도체', change: 2.64, turnover: 9.8, advancers: 34, decliners: 9, foreign: 2420, institution: 1180,
    themes: [
      { name: 'HBM', stocks: [
        { name: 'SK하이닉스', ticker: '000660', market: 'KOSPI', change: 4.18, turnover: 2.18, foreign: 1380, institution: 420 },
        { name: '한미반도체', ticker: '042700', market: 'KOSPI', change: 5.31, turnover: 0.74, foreign: 240, institution: 95 },
      ] },
      { name: '메모리/파운드리', stocks: [
        { name: '삼성전자', ticker: '005930', market: 'KOSPI', change: 1.82, turnover: 3.92, foreign: 860, institution: 540 },
        { name: 'DB하이텍', ticker: '000990', market: 'KOSPI', change: 2.11, turnover: 0.19, foreign: 62, institution: 31 },
      ] },
    ],
  },
  {
    name: '원전·전력', change: 3.42, turnover: 3.6, advancers: 21, decliners: 4, foreign: 680, institution: 490,
    themes: [
      { name: '원전', stocks: [
        { name: '두산에너빌리티', ticker: '034020', market: 'KOSPI', change: 4.67, turnover: 1.21, foreign: 410, institution: 265 },
        { name: '한전기술', ticker: '052690', market: 'KOSPI', change: 3.21, turnover: 0.22, foreign: 66, institution: 41 },
      ] },
      { name: '전력기기', stocks: [
        { name: 'HD현대일렉트릭', ticker: '267260', market: 'KOSPI', change: 3.88, turnover: 0.53, foreign: 172, institution: 109 },
        { name: '효성중공업', ticker: '298040', market: 'KOSPI', change: 2.74, turnover: 0.31, foreign: 84, institution: 77 },
      ] },
    ],
  },
  {
    name: '방산·조선', change: 1.93, turnover: 4.4, advancers: 25, decliners: 11, foreign: 940, institution: 620,
    themes: [
      { name: '방산', stocks: [
        { name: '한화에어로스페이스', ticker: '012450', market: 'KOSPI', change: 2.81, turnover: 0.88, foreign: 245, institution: 202 },
        { name: 'LIG넥스원', ticker: '079550', market: 'KOSPI', change: 2.34, turnover: 0.34, foreign: 91, institution: 63 },
      ] },
      { name: '조선', stocks: [
        { name: '한화오션', ticker: '042660', market: 'KOSPI', change: 1.77, turnover: 0.71, foreign: 188, institution: 102 },
        { name: 'HD한국조선해양', ticker: '009540', market: 'KOSPI', change: 1.26, turnover: 0.36, foreign: 106, institution: 74 },
      ] },
    ],
  },
  {
    name: '바이오', change: 0.86, turnover: 4.9, advancers: 48, decliners: 39, foreign: 350, institution: -120,
    themes: [
      { name: '신약/플랫폼', stocks: [
        { name: '알테오젠', ticker: '196170', market: 'KOSDAQ', change: 2.42, turnover: 0.84, foreign: 136, institution: -18 },
        { name: '에이비엘바이오', ticker: '298380', market: 'KOSDAQ', change: 1.89, turnover: 0.41, foreign: 77, institution: 21 },
      ] },
      { name: '바이오시밀러', stocks: [
        { name: '셀트리온', ticker: '068270', market: 'KOSPI', change: 0.51, turnover: 0.46, foreign: 88, institution: -34 },
      ] },
    ],
  },
  {
    name: '2차전지', change: -1.72, turnover: 4.1, advancers: 12, decliners: 38, foreign: -980, institution: -420,
    themes: [
      { name: '셀', stocks: [
        { name: 'LG에너지솔루션', ticker: '373220', market: 'KOSPI', change: -1.33, turnover: 0.71, foreign: -204, institution: -112 },
        { name: '삼성SDI', ticker: '006400', market: 'KOSPI', change: -2.11, turnover: 0.52, foreign: -161, institution: -96 },
      ] },
      { name: '소재', stocks: [
        { name: '에코프로비엠', ticker: '247540', market: 'KOSDAQ', change: -2.86, turnover: 0.61, foreign: -144, institution: -58 },
      ] },
    ],
  },
  {
    name: '인터넷·게임', change: -0.64, turnover: 2.3, advancers: 14, decliners: 24, foreign: -220, institution: 70,
    themes: [
      { name: '플랫폼', stocks: [
        { name: 'NAVER', ticker: '035420', market: 'KOSPI', change: -0.41, turnover: 0.44, foreign: -73, institution: 44 },
        { name: '카카오', ticker: '035720', market: 'KOSPI', change: -1.12, turnover: 0.31, foreign: -92, institution: 12 },
      ] },
      { name: '게임', stocks: [
        { name: '크래프톤', ticker: '259960', market: 'KOSPI', change: 0.38, turnover: 0.18, foreign: 31, institution: 17 },
      ] },
    ],
  },
  {
    name: '자동차', change: 1.18, turnover: 3.8, advancers: 27, decliners: 13, foreign: 520, institution: 260,
    themes: [
      { name: '완성차', stocks: [
        { name: '현대차', ticker: '005380', market: 'KOSPI', change: 1.44, turnover: 0.92, foreign: 281, institution: 122 },
        { name: '기아', ticker: '000270', market: 'KOSPI', change: 1.16, turnover: 0.68, foreign: 190, institution: 91 },
      ] },
    ],
  },
  {
    name: '금융', change: -0.21, turnover: 2.6, advancers: 19, decliners: 21, foreign: 80, institution: -90,
    themes: [
      { name: '은행', stocks: [
        { name: 'KB금융', ticker: '105560', market: 'KOSPI', change: 0.22, turnover: 0.29, foreign: 73, institution: -14 },
        { name: '신한지주', ticker: '055550', market: 'KOSPI', change: -0.37, turnover: 0.17, foreign: 21, institution: -28 },
      ] },
    ],
  },
]

export function isCorrectAnswer(item: QuizItem, selected: number) { return item.correct === selected }

export function moneyFlowScore(input: Pick<Sector, 'change' | 'turnover' | 'advancers' | 'decliners' | 'foreign' | 'institution'>) {
  const breadth = (input.advancers / Math.max(1, input.advancers + input.decliners) - 0.5) * 2
  const turnover = Math.min(input.turnover / 10, 1)
  const supply = Math.max(-1, Math.min(1, (input.foreign + input.institution) / 3000))
  const momentum = Math.max(-1, Math.min(1, input.change / 5))
  return Math.round((momentum * 35 + turnover * 20 + breadth * 20 + supply * 25) * 10) / 10
}

function signed(value: number, suffix = '') { return `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}` }
function fmtFlow(value: number) { return `${value > 0 ? '+' : ''}${value.toLocaleString()}억` }

function MarketDashboard() {
  const [minute, setMinute] = useState(390)
  const [sectorName, setSectorName] = useState('반도체')
  const [themeName, setThemeName] = useState('HBM')

  const timelineFactor = useMemo(() => 0.72 + (minute / 390) * 0.28, [minute])
  const ranked = useMemo(() => sectors.map((sector) => ({ ...sector, score: moneyFlowScore(sector) * timelineFactor })).sort((a, b) => b.score - a.score), [timelineFactor])
  const selectedSector = sectors.find((sector) => sector.name === sectorName) ?? sectors[0]
  const selectedTheme = selectedSector.themes.find((theme) => theme.name === themeName) ?? selectedSector.themes[0]
  const timeHour = 9 + Math.floor(minute / 60)
  const timeMinute = minute % 60
  const displayTime = `${String(timeHour).padStart(2, '0')}:${String(timeMinute).padStart(2, '0')}`

  const selectSector = (name: string) => {
    const next = sectors.find((sector) => sector.name === name) ?? sectors[0]
    setSectorName(next.name)
    setThemeName(next.themes[0].name)
  }

  return (
    <main className="terminal-shell" data-testid="moneyflow-dashboard">
      <section className="market-strip">
        <div><span>KOSPI</span><strong>3,287.41</strong><em className="up">+1.14%</em></div>
        <div><span>KOSDAQ</span><strong>921.08</strong><em className="up">+0.62%</em></div>
        <div><span>상승 / 하락</span><strong>1,487 / 1,192</strong><em>보합 118</em></div>
        <div><span>거래대금</span><strong>23.8조</strong><em>15:30 기준</em></div>
        <div><span>외국인 / 기관</span><strong className="up">+3,790억</strong><em className="down">-410억</em></div>
      </section>

      <section className="dashboard-grid">
        <div className="panel heatmap-panel">
          <div className="panel-head"><div><p>MARKET HEATMAP</p><h2>한국 시장 전체 Heatmap</h2></div><span className="demo-badge">DEMO SNAPSHOT</span></div>
          <div className="heatmap-grid">
            {ranked.map((sector) => {
              const score = sector.score
              const intensity = Math.min(0.82, 0.16 + Math.abs(score) / 100)
              return (
                <button key={sector.name} className={`heat-tile ${score >= 0 ? 'positive' : 'negative'} ${sector.name === selectedSector.name ? 'active' : ''}`} style={{ ['--heat' as string]: intensity }} onClick={() => selectSector(sector.name)}>
                  <span>{sector.name}</span><strong>{signed(sector.change * timelineFactor, '%')}</strong><small>Flow {signed(score)}</small>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="panel ranking-panel">
          <div className="panel-head"><div><p>MONEY FLOW</p><h2>Ranking</h2></div><span>{displayTime}</span></div>
          <div className="ranking-list">
            {ranked.map((sector, index) => <button key={sector.name} onClick={() => selectSector(sector.name)} className={sector.name === selectedSector.name ? 'active' : ''}><b>{String(index + 1).padStart(2, '0')}</b><span>{sector.name}<small>{fmtFlow(sector.foreign + sector.institution)}</small></span><strong className={sector.score >= 0 ? 'up' : 'down'}>{signed(sector.score)}</strong></button>)}
          </div>
        </aside>

        <section className="panel drill-panel">
          <div className="panel-head"><div><p>DRILL DOWN</p><h2>{selectedSector.name} → 세부테마 → 종목</h2></div><span>Score {signed(moneyFlowScore(selectedSector) * timelineFactor)}</span></div>
          <div className="sector-metrics">
            <div><span>등락률</span><strong className={selectedSector.change >= 0 ? 'up' : 'down'}>{signed(selectedSector.change * timelineFactor, '%')}</strong></div>
            <div><span>거래대금</span><strong>{(selectedSector.turnover * timelineFactor).toFixed(1)}조</strong></div>
            <div><span>상승 비율</span><strong>{Math.round(selectedSector.advancers / (selectedSector.advancers + selectedSector.decliners) * 100)}%</strong></div>
            <div><span>외국인</span><strong className={selectedSector.foreign >= 0 ? 'up' : 'down'}>{fmtFlow(Math.round(selectedSector.foreign * timelineFactor))}</strong></div>
            <div><span>기관</span><strong className={selectedSector.institution >= 0 ? 'up' : 'down'}>{fmtFlow(Math.round(selectedSector.institution * timelineFactor))}</strong></div>
          </div>
          <div className="theme-tabs">{selectedSector.themes.map((theme) => <button key={theme.name} className={theme.name === selectedTheme.name ? 'active' : ''} onClick={() => setThemeName(theme.name)}>{theme.name}</button>)}</div>
          <div className="stock-table">
            <div className="table-row table-head"><span>종목</span><span>시장</span><span>등락률</span><span>거래대금</span><span>외국인</span><span>기관</span></div>
            {selectedTheme.stocks.map((stock) => <div className="table-row" key={stock.ticker}><span><b>{stock.name}</b><small>{stock.ticker}</small></span><span>{stock.market}</span><span className={stock.change >= 0 ? 'up' : 'down'}>{signed(stock.change * timelineFactor, '%')}</span><span>{(stock.turnover * timelineFactor).toFixed(2)}조</span><span className={stock.foreign >= 0 ? 'up' : 'down'}>{fmtFlow(Math.round(stock.foreign * timelineFactor))}</span><span className={stock.institution >= 0 ? 'up' : 'down'}>{fmtFlow(Math.round(stock.institution * timelineFactor))}</span></div>)}
          </div>
        </section>

        <section className="panel timeline-panel">
          <div className="panel-head"><div><p>TIMELINE REPLAY</p><h2>09:00 → 15:30</h2></div><strong>{displayTime}</strong></div>
          <input aria-label="시장 시간 재생" type="range" min="0" max="390" step="10" value={minute} onChange={(event) => setMinute(Number(event.target.value))} />
          <div className="time-labels"><span>09:00</span><span>10:30</span><span>12:00</span><span>13:30</span><span>15:30</span></div>
          <p className="formula-note">Money Flow Score = 등락 모멘텀 35% + 거래대금 강도 20% + 상승종목 비율 20% + 외국인·기관 수급 25%</p>
        </section>
      </section>
    </main>
  )
}

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
  return <div className="app-root"><nav className="global-nav"><button className="brand" onClick={() => setPage('flow')}>K-MARKET FLOW</button><div><button className={page === 'flow' ? 'active' : ''} onClick={() => setPage('flow')}>머니플로우</button><button className={page === 'quiz' ? 'active' : ''} onClick={() => setPage('quiz')}>종목 퀴즈</button></div><span className="live-dot">● MARKET LAB</span></nav>{page === 'flow' ? <MarketDashboard /> : <StockQuiz />}</div>
}

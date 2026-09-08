import { useEffect, useMemo, useState } from 'react'
import './stockQuiz.css'

export type QuizStock = { code: string; name: string }
export type QuizPool = 'kospi200' | 'kosdaq150'
export type QuizQuestion = {
  stock: QuizStock
  promptMode: 'name-to-code' | 'code-to-name'
  choices: string[]
  correct: number
}

type UniversePayload = {
  ok?: boolean
  source?: string
  sourceDate?: string | null
  stale?: boolean
  etfExcluded?: boolean
  kospi200?: QuizStock[]
  kosdaq150?: QuizStock[]
  counts?: { kospi200?: number; kosdaq150?: number }
  error?: string | null
}

const FALLBACK: Record<QuizPool, QuizStock[]> = {
  kospi200: [
    { code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }, { code: '005380', name: '현대차' }, { code: '000270', name: '기아' },
    { code: '035420', name: 'NAVER' }, { code: '068270', name: '셀트리온' }, { code: '207940', name: '삼성바이오로직스' }, { code: '034020', name: '두산에너빌리티' },
    { code: '012450', name: '한화에어로스페이스' }, { code: '105560', name: 'KB금융' }, { code: '055550', name: '신한지주' }, { code: '373220', name: 'LG에너지솔루션' },
  ],
  kosdaq150: [
    { code: '196170', name: '알테오젠' }, { code: '086520', name: '에코프로' }, { code: '247540', name: '에코프로비엠' }, { code: '036930', name: '주성엔지니어링' },
    { code: '240810', name: '원익IPS' }, { code: '028300', name: 'HLB' }, { code: '039030', name: '이오테크닉스' }, { code: '277810', name: '레인보우로보틱스' },
    { code: '403870', name: 'HPSP' }, { code: '108490', name: '로보티즈' }, { code: '145020', name: '휴젤' }, { code: '214450', name: '파마리서치' },
  ],
}

function shuffled<T>(values: T[]) {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }
  return copy
}

export function buildQuizRound(pool: QuizStock[], count = 20): QuizQuestion[] {
  const clean = pool.filter((item, index, all) => /^\d{6}$/.test(item.code) && item.name && all.findIndex((candidate) => candidate.code === item.code) === index)
  if (clean.length < 4) return []
  return shuffled(clean).slice(0, Math.min(count, clean.length)).map((stock, index) => {
    const promptMode: QuizQuestion['promptMode'] = index % 2 === 0 ? 'name-to-code' : 'code-to-name'
    const distractors = shuffled(clean.filter((candidate) => candidate.code !== stock.code)).slice(0, 3)
    const answer = promptMode === 'name-to-code' ? stock.code : stock.name
    const choices = shuffled([answer, ...distractors.map((item) => promptMode === 'name-to-code' ? item.code : item.name)])
    return { stock, promptMode, choices, correct: choices.indexOf(answer) }
  })
}

export function answerIsCorrect(question: QuizQuestion, selected: number) {
  return question.correct === selected
}

function poolLabel(pool: QuizPool) { return pool === 'kospi200' ? 'KOSPI 200' : 'KOSDAQ 150' }

export default function StockQuiz() {
  const [universe, setUniverse] = useState<UniversePayload | null>(null)
  const [pool, setPool] = useState<QuizPool | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/quiz/universe', { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => response.ok ? await response.json() as UniversePayload : null)
      .then((payload) => { if (payload) setUniverse(payload) })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const pools = useMemo(() => ({
    kospi200: universe?.kospi200?.length && universe.kospi200.length >= 4 ? universe.kospi200 : FALLBACK.kospi200,
    kosdaq150: universe?.kosdaq150?.length && universe.kosdaq150.length >= 4 ? universe.kosdaq150 : FALLBACK.kosdaq150,
  }), [universe])

  const start = (nextPool: QuizPool) => {
    setPool(nextPool)
    setQuestions(buildQuizRound(pools[nextPool], 20))
    setQuestionIndex(0)
    setSelected(null)
    setScore(0)
    setFinished(false)
  }

  const choose = (choiceIndex: number) => {
    if (selected !== null) return
    setSelected(choiceIndex)
    if (answerIsCorrect(questions[questionIndex], choiceIndex)) setScore((value) => value + 1)
  }

  const next = () => {
    if (questionIndex >= questions.length - 1) { setFinished(true); return }
    setQuestionIndex((value) => value + 1)
    setSelected(null)
  }

  if (!pool) return <main className="index-quiz-shell" data-testid="index-quiz">
    <section className="index-quiz-select">
      <p className="index-quiz-eyebrow">STOCK RECOGNITION QUIZ</p>
      <h1>어느 시장 종목을 얼마나 알고 있을까?</h1>
      <p className="index-quiz-lead">KOSPI 200과 KOSDAQ 150을 완전히 분리했습니다. ETF·ETN 등 상장지수상품은 제외하고 종목명 ↔ 종목코드를 맞히는 방식으로 출제합니다.</p>
      <div className="index-pool-grid">
        <button onClick={() => start('kospi200')} data-testid="quiz-pool-kospi200"><span>KOSPI</span><strong>KOSPI 200</strong><em>{universe?.counts?.kospi200 ?? pools.kospi200.length}개 종목 풀</em><small>대형·대표주 중심</small></button>
        <button onClick={() => start('kosdaq150')} data-testid="quiz-pool-kosdaq150"><span>KOSDAQ</span><strong>KOSDAQ 150</strong><em>{universe?.counts?.kosdaq150 ?? pools.kosdaq150.length}개 종목 풀</em><small>성장·기술주 중심</small></button>
      </div>
      <div className="index-quiz-source"><b>ETF 제외</b><span>{universe?.source ?? 'KRX 구성종목 데이터 연결 중'}{universe?.sourceDate ? ` · 기준 ${universe.sourceDate}` : ''}{universe?.stale ? ' · 저장된 최근 목록 사용 중' : ''}</span></div>
    </section>
  </main>

  if (finished) return <main className="index-quiz-shell"><section className="index-quiz-result">
    <p className="index-quiz-eyebrow">{poolLabel(pool)} RESULT</p><h1>{score} / {questions.length}</h1><p>{poolLabel(pool)} 종목 인식 퀴즈 완료</p>
    <div><button onClick={() => start(pool)}>같은 시장 다시 풀기</button><button onClick={() => setPool(null)}>시장 다시 선택</button></div>
  </section></main>

  const question = questions[questionIndex]
  if (!question) return <main className="index-quiz-shell"><div className="index-quiz-loading">퀴즈 종목을 준비하고 있습니다.</div></main>
  const correctLabel = question.promptMode === 'name-to-code' ? question.stock.code : question.stock.name

  return <main className="index-quiz-shell">
    <section className="index-quiz-board">
      <header><div><p className="index-quiz-eyebrow">{poolLabel(pool)}</p><h1>종목 인식 퀴즈</h1></div><div className="index-quiz-score"><span>{questionIndex + 1} / {questions.length}</span><strong>{score}점</strong></div></header>
      <div className="index-quiz-progress"><i style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div>
      <article className="index-question-card" data-testid="question-card">
        <span>{question.promptMode === 'name-to-code' ? '종목명 → 코드' : '종목코드 → 종목명'}</span>
        <h2>{question.promptMode === 'name-to-code' ? question.stock.name : question.stock.code}</h2>
        <p>{question.promptMode === 'name-to-code' ? '이 종목의 6자리 종목코드는?' : '이 종목코드에 해당하는 회사는?'}</p>
      </article>
      <div className="index-quiz-choices">
        {question.choices.map((choice, index) => {
          const answered = selected !== null
          const correct = index === question.correct
          const picked = selected === index
          const state = answered ? correct ? 'correct' : picked ? 'wrong' : 'muted' : ''
          return <button key={`${choice}-${index}`} className={state} onClick={() => choose(index)} disabled={answered}><b>{index + 1}</b><span>{choice}</span></button>
        })}
      </div>
      {selected !== null && <div className={`index-quiz-feedback ${answerIsCorrect(question, selected) ? 'success' : 'fail'}`}><div><strong>{answerIsCorrect(question, selected) ? '정답' : '오답'}</strong><span>{question.stock.name} · {question.stock.code}</span><small>정답: {correctLabel}</small></div><button onClick={next}>{questionIndex === questions.length - 1 ? '결과 보기' : '다음 문제'}</button></div>}
      <button className="index-quiz-switch" onClick={() => setPool(null)}>KOSPI 200 / KOSDAQ 150 다시 선택</button>
    </section>
  </main>
}

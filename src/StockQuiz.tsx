import { useEffect, useMemo, useState } from 'react'
import './stockQuiz.css'

export type QuizStock = {
  code: string
  name: string
  description?: string | null
  source?: string | null
  sourceUrl?: string | null
  fetchedAt?: string | null
  stale?: boolean
}
export type QuizPool = 'kospi200' | 'kosdaq150'
export type QuizQuestion = {
  stock: QuizStock
  options: QuizStock[]
  correct: number
}

type PreparedQuizPayload = {
  ok?: boolean
  source?: string | null
  sourceDate?: string | null
  generatedAt?: string | null
  stale?: boolean
  kospi200?: QuizStock[]
  kosdaq150?: QuizStock[]
  counts?: { kospi200?: number; kosdaq150?: number; ready?: number }
  expectedCounts?: { kospi200?: number; kosdaq150?: number; total?: number }
  cacheStatus?: {
    running?: boolean
    targetCount?: number
    readyCount?: number
    freshCount?: number
    attempted?: number
    failed?: number
    startedAt?: string | null
    finishedAt?: string | null
  } | null
  error?: string | null
}

const BROWSER_CACHE_KEY = 'k-market-quiz-ready-v1'

function validPreparedPayload(value: unknown): value is PreparedQuizPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as PreparedQuizPayload
  return Array.isArray(payload.kospi200) && Array.isArray(payload.kosdaq150)
}

function readBrowserCache() {
  if (typeof localStorage === 'undefined') return null
  try {
    const parsed = JSON.parse(localStorage.getItem(BROWSER_CACHE_KEY) || 'null')
    return validPreparedPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

function saveBrowserCache(payload: PreparedQuizPayload) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(BROWSER_CACHE_KEY, JSON.stringify(payload)) } catch { /* storage can be unavailable */ }
}

let preparedCache: PreparedQuizPayload | null = readBrowserCache()
let preparedRequest: Promise<PreparedQuizPayload | null> | null = null

export function warmQuizPrepared(force = false) {
  if (!force && preparedCache) return Promise.resolve(preparedCache)
  if (preparedRequest) return preparedRequest
  preparedRequest = fetch('/data/quiz-prepared.json', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
    .then(async (response) => {
      if (!response.ok) return null
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) return null
      const payload = await response.json() as PreparedQuizPayload
      if (!validPreparedPayload(payload)) return null
      preparedCache = payload
      saveBrowserCache(payload)
      return payload
    })
    .catch(() => null)
    .finally(() => { preparedRequest = null })
  return preparedRequest
}

// App.tsx already calls this as soon as the app mounts. Refresh the KRX universe
// independently, but never make quiz-menu rendering wait for that network path.
export function warmQuizUniverse() {
  void fetch('/api/quiz/universe', { headers: { Accept: 'application/json' } }).catch(() => {})
  return warmQuizPrepared(true)
}

function shuffled<T>(values: T[]) {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }
  return copy
}

function cleanPool(pool: QuizStock[], maxCount = Infinity) {
  const seen = new Set<string>()
  return pool.filter((item) => {
    if (!/^\d{6}$/.test(item.code) || !item.name || !item.description || seen.has(item.code)) return false
    seen.add(item.code)
    return true
  }).slice(0, maxCount)
}

function distractorsFor(clean: QuizStock[], stock: QuizStock) {
  const result: QuizStock[] = []
  if (clean.length < 4) return result
  const start = Math.floor(Math.random() * clean.length)
  for (let offset = 0; offset < clean.length && result.length < 3; offset += 1) {
    const candidate = clean[(start + offset) % clean.length]
    if (candidate.code !== stock.code && !result.some((item) => item.code === candidate.code)) result.push(candidate)
  }
  return result
}

export function buildQuizRound(pool: QuizStock[], count = pool.length): QuizQuestion[] {
  const clean = cleanPool(pool)
  if (clean.length < 4) return []
  const questionStocks = shuffled(clean).slice(0, Math.min(count, clean.length))
  return questionStocks.map((stock) => {
    const options = shuffled([stock, ...distractorsFor(clean, stock)])
    return { stock, options, correct: options.findIndex((option) => option.code === stock.code) }
  })
}

export function answerIsCorrect(question: QuizQuestion, selected: number) {
  return question.correct === selected
}

function poolLabel(pool: QuizPool) { return pool === 'kospi200' ? 'KOSPI 200' : 'KOSDAQ 150' }
function poolLimit(pool: QuizPool) { return pool === 'kospi200' ? 200 : 150 }

function scrubCompanyNames(description: string, candidates: QuizStock[]) {
  let value = description
  for (const candidate of [...candidates].sort((a, b) => b.name.length - a.name.length)) {
    if (candidate.name.length < 2) continue
    value = value.split(candidate.name).join('동사')
  }
  return value
}

export default function StockQuiz() {
  const [prepared, setPrepared] = useState<PreparedQuizPayload | null>(() => preparedCache)
  const [loading, setLoading] = useState(() => !preparedCache)
  const [loadError, setLoadError] = useState(false)
  const [pool, setPool] = useState<QuizPool | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    let active = true
    let timer: number | undefined

    const refresh = async (force: boolean) => {
      if (!preparedCache) setLoading(true)
      const payload = await warmQuizPrepared(force)
      if (!active) return
      if (payload) {
        setPrepared(payload)
        setLoadError(false)
      } else if (!preparedCache) {
        setLoadError(true)
      }
      setLoading(false)
    }

    void refresh(Boolean(preparedCache))
    timer = window.setInterval(() => {
      if (pool) return
      const expected = preparedCache?.expectedCounts?.total ?? 350
      const ready = preparedCache?.counts?.ready ?? ((preparedCache?.kospi200?.length ?? 0) + (preparedCache?.kosdaq150?.length ?? 0))
      if (ready < expected) void refresh(true)
    }, 5000)

    return () => {
      active = false
      if (timer) window.clearInterval(timer)
    }
  }, [pool])

  const pools = useMemo(() => ({
    kospi200: cleanPool(prepared?.kospi200 ?? [], 200),
    kosdaq150: cleanPool(prepared?.kosdaq150 ?? [], 150),
  }), [prepared])

  const start = (nextPool: QuizPool) => {
    const selectedPool = pools[nextPool].slice(0, poolLimit(nextPool))
    if (selectedPool.length < 4) return
    const round = buildQuizRound(selectedPool, selectedPool.length)
    setPool(nextPool)
    setQuestions(round)
    setQuestionIndex(0)
    setSelected(null)
    setScore(0)
    setFinished(false)
  }

  const question = questions[questionIndex]
  const choiceDescriptions = useMemo(() => {
    if (!question) return []
    return question.options.map((option) => option.description ? scrubCompanyNames(option.description, question.options) : null)
  }, [question])
  const ready = Boolean(question && choiceDescriptions.length === 4 && choiceDescriptions.every(Boolean))

  const choose = (choiceIndex: number) => {
    if (selected !== null || !question || !ready) return
    setSelected(choiceIndex)
    if (answerIsCorrect(question, choiceIndex)) setScore((value) => value + 1)
  }

  const next = () => {
    if (questionIndex >= questions.length - 1) { setFinished(true); return }
    setQuestionIndex((value) => value + 1)
    setSelected(null)
  }

  if (!pool) {
    const kospiReady = pools.kospi200.length
    const kosdaqReady = pools.kosdaq150.length
    const kospiExpected = prepared?.expectedCounts?.kospi200 ?? 200
    const kosdaqExpected = prepared?.expectedCounts?.kosdaq150 ?? 150
    const cacheRunning = Boolean(prepared?.cacheStatus?.running) || kospiReady + kosdaqReady < kospiExpected + kosdaqExpected

    return <main className="index-quiz-shell" data-testid="index-quiz">
      <section className="index-quiz-select">
        <p className="index-quiz-eyebrow">STOCK COMPANY QUIZ</p>
        <h1>어느 시장의 기업을 더 많이 알고 있을까?</h1>
        <p className="index-quiz-lead">Raspberry Pi가 종목코드·종목명·시장·기업설명을 하나의 완성 캐시로 미리 저장합니다. 퀴즈 문제를 넘길 때는 외부 사이트나 API를 다시 조회하지 않습니다.</p>
        <div className="index-pool-grid">
          <button onClick={() => start('kospi200')} data-testid="quiz-pool-kospi200" disabled={kospiReady < 4}>
            <span>KOSPI</span><strong>KOSPI 200</strong><em>{kospiReady}개 즉시 출제 가능 / 전체 {kospiExpected}</em><small>{cacheRunning && kospiReady < kospiExpected ? 'Pi 백그라운드 캐시 채우는 중' : '완성 캐시에서 즉시 출제'}</small>
          </button>
          <button onClick={() => start('kosdaq150')} data-testid="quiz-pool-kosdaq150" disabled={kosdaqReady < 4}>
            <span>KOSDAQ</span><strong>KOSDAQ 150</strong><em>{kosdaqReady}개 즉시 출제 가능 / 전체 {kosdaqExpected}</em><small>{cacheRunning && kosdaqReady < kosdaqExpected ? 'Pi 백그라운드 캐시 채우는 중' : '완성 캐시에서 즉시 출제'}</small>
          </button>
        </div>
        <div className="index-quiz-source"><b>ETF·ETN 제외</b><span>{loading && !prepared ? 'Pi 완성 캐시 읽는 중' : prepared?.source ?? 'Pi 완성 퀴즈 캐시'}{prepared?.sourceDate ? ` · 기준 ${prepared.sourceDate}` : ''}{prepared?.stale ? ' · 저장된 최근 구성종목 사용 중' : ''}</span></div>
        {loadError && !prepared && <div className="index-description-state error"><strong>Pi 완성 퀴즈 캐시를 아직 읽지 못했습니다.</strong><span>Pi가 백그라운드에서 첫 캐시를 만드는 중일 수 있습니다.</span><button onClick={() => { setLoading(true); void warmQuizPrepared(true).then((payload) => { if (payload) { setPrepared(payload); setLoadError(false) } setLoading(false) }) }}>다시 확인</button></div>}
      </section>
    </main>
  }

  if (finished) return <main className="index-quiz-shell"><section className="index-quiz-result">
    <p className="index-quiz-eyebrow">{poolLabel(pool)} RESULT</p><h1>{score} / {questions.length}</h1><p>{poolLabel(pool)} 기업 설명 퀴즈 완료</p>
    <div><button onClick={() => start(pool)}>같은 시장 다시 풀기</button><button onClick={() => setPool(null)}>시장 다시 선택</button></div>
  </section></main>

  if (!question) return <main className="index-quiz-shell"><div className="index-quiz-loading">출제 가능한 완성 캐시를 확인하고 있습니다.</div></main>

  return <main className="index-quiz-shell">
    <section className="index-quiz-board">
      <header><div><p className="index-quiz-eyebrow">{poolLabel(pool)}</p><h1>기업 설명 맞히기</h1></div><div className="index-quiz-score"><span>{questionIndex + 1} / {questions.length}</span><strong>{score}점</strong></div></header>
      <div className="index-quiz-progress"><i style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div>
      <article className="index-question-card" data-testid="question-card">
        <span>{poolLabel(pool)}</span>
        <h2>{question.stock.name}</h2>
        <p>아래 4개 기업 설명 중 이 종목에 해당하는 설명을 선택하세요.</p>
      </article>

      <div className="index-quiz-choices description-choices">
        {question.options.map((option, index) => {
          const answered = selected !== null
          const correct = index === question.correct
          const picked = selected === index
          const state = answered ? correct ? 'correct' : picked ? 'wrong' : 'muted' : ''
          return <button key={`${option.code}-${index}`} className={state} onClick={() => choose(index)} disabled={answered || !ready}>
            <b>{index + 1}</b><span>{choiceDescriptions[index] ?? '준비된 설명 없음'}</span>
          </button>
        })}
      </div>

      {selected !== null && <div className={`index-quiz-feedback ${answerIsCorrect(question, selected) ? 'success' : 'fail'}`}><div><strong>{answerIsCorrect(question, selected) ? '정답' : '오답'}</strong><span>{question.stock.name}</span><small>정답 설명: {choiceDescriptions[question.correct]}</small><small>출처: {question.stock.source ?? 'Pi 기업설명 캐시'}</small></div><button onClick={next}>{questionIndex === questions.length - 1 ? '결과 보기' : '다음 문제'}</button></div>}
      <button className="index-quiz-switch" onClick={() => setPool(null)}>KOSPI 200 / KOSDAQ 150 다시 선택</button>
    </section>
  </main>
}

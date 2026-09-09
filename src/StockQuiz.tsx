import { useEffect, useMemo, useState } from 'react'
import './stockQuiz.css'

export type QuizStock = { code: string; name: string }
export type QuizPool = 'kospi200' | 'kosdaq150'
export type QuizQuestion = {
  stock: QuizStock
  options: QuizStock[]
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

type DescriptionItem = {
  code: string
  description: string | null
  source?: string | null
  sourceUrl?: string | null
  stale?: boolean
  error?: string | null
}

type DescriptionPayload = {
  ok?: boolean
  source?: string | null
  items?: DescriptionItem[]
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

let universeCache: UniversePayload | null = null
let universeRequest: Promise<UniversePayload | null> | null = null
const descriptionMemory = new Map<string, DescriptionItem>()
const descriptionBatchRequests = new Map<string, Promise<DescriptionPayload>>()

export function warmQuizUniverse() {
  if (universeCache) return Promise.resolve(universeCache)
  if (universeRequest) return universeRequest
  universeRequest = fetch('/api/quiz/universe', { headers: { Accept: 'application/json' } })
    .then(async (response) => response.ok ? await response.json() as UniversePayload : null)
    .then((payload) => {
      if (payload) universeCache = payload
      return payload
    })
    .catch(() => null)
    .finally(() => { universeRequest = null })
  return universeRequest
}

function descriptionSnapshot() {
  return Object.fromEntries(descriptionMemory.entries()) as Record<string, DescriptionItem>
}

async function fetchDescriptionBatch(stocks: QuizStock[]) {
  const codes = [...new Set(stocks.map((stock) => stock.code).filter((code) => /^\d{6}$/.test(code)))]
  if (!codes.length) return { ok: false, items: [] } satisfies DescriptionPayload

  const missingCodes = codes.filter((code) => !descriptionMemory.get(code)?.description)
  if (!missingCodes.length) {
    return { ok: true, items: codes.map((code) => descriptionMemory.get(code)).filter(Boolean) as DescriptionItem[] } satisfies DescriptionPayload
  }

  const key = [...missingCodes].sort().join(',')
  let request = descriptionBatchRequests.get(key)
  if (!request) {
    request = fetch(`/api/quiz/descriptions?codes=${encodeURIComponent(missingCodes.join(','))}`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as DescriptionPayload | null
        if (!payload) throw new Error('기업 설명 응답을 읽지 못했습니다.')
        for (const item of payload.items ?? []) {
          if (item.description) descriptionMemory.set(item.code, item)
        }
        return payload
      })
      .finally(() => { descriptionBatchRequests.delete(key) })
    descriptionBatchRequests.set(key, request)
  }

  const payload = await request
  return {
    ...payload,
    items: codes.map((code) => descriptionMemory.get(code) ?? payload.items?.find((item) => item.code === code)).filter(Boolean) as DescriptionItem[],
  }
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
    if (!/^\d{6}$/.test(item.code) || !item.name || seen.has(item.code)) return false
    seen.add(item.code)
    return true
  }).slice(0, maxCount)
}

export function buildQuizRound(pool: QuizStock[], count = pool.length): QuizQuestion[] {
  const clean = cleanPool(pool)
  if (clean.length < 4) return []
  return shuffled(clean).slice(0, Math.min(count, clean.length)).map((stock) => {
    const distractors = shuffled(clean.filter((candidate) => candidate.code !== stock.code)).slice(0, 3)
    const options = shuffled([stock, ...distractors])
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
  const [universe, setUniverse] = useState<UniversePayload | null>(() => universeCache)
  const [universeLoading, setUniverseLoading] = useState(() => !universeCache)
  const [pool, setPool] = useState<QuizPool | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [preparedRounds, setPreparedRounds] = useState<Partial<Record<QuizPool, QuizQuestion[]>>>({})
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const [descriptions, setDescriptions] = useState<Record<string, DescriptionItem>>(() => descriptionSnapshot())
  const [descriptionLoading, setDescriptionLoading] = useState(false)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [descriptionAttempt, setDescriptionAttempt] = useState(0)

  useEffect(() => {
    let active = true
    if (!universeCache) setUniverseLoading(true)
    void warmQuizUniverse()
      .then((payload) => { if (active && payload) setUniverse(payload) })
      .finally(() => { if (active) setUniverseLoading(false) })
    return () => { active = false }
  }, [])

  const livePools = useMemo(() => ({
    kospi200: cleanPool(universe?.kospi200 ?? [], 200),
    kosdaq150: cleanPool(universe?.kosdaq150 ?? [], 150),
  }), [universe])

  const pools = useMemo(() => ({
    kospi200: livePools.kospi200.length >= 4 ? livePools.kospi200 : FALLBACK.kospi200,
    kosdaq150: livePools.kosdaq150.length >= 4 ? livePools.kosdaq150 : FALLBACK.kosdaq150,
  }), [livePools])

  const usingFallback = useMemo(() => ({
    kospi200: livePools.kospi200.length < 4,
    kosdaq150: livePools.kosdaq150.length < 4,
  }), [livePools])

  useEffect(() => {
    if (universeLoading) return
    const nextRounds: Record<QuizPool, QuizQuestion[]> = {
      kospi200: buildQuizRound(pools.kospi200.slice(0, 200), Math.min(200, pools.kospi200.length)),
      kosdaq150: buildQuizRound(pools.kosdaq150.slice(0, 150), Math.min(150, pools.kosdaq150.length)),
    }
    setPreparedRounds(nextRounds)
  }, [pools, universeLoading])

  const start = (nextPool: QuizPool) => {
    const selectedPool = pools[nextPool].slice(0, poolLimit(nextPool))
    const round = preparedRounds[nextPool]?.length ? preparedRounds[nextPool]! : buildQuizRound(selectedPool, selectedPool.length)
    setPool(nextPool)
    setQuestions(round)
    setQuestionIndex(0)
    setSelected(null)
    setScore(0)
    setFinished(false)
    setDescriptions(descriptionSnapshot())
    setDescriptionError(null)
    setDescriptionAttempt(0)
    if (round[0]) void fetchDescriptionBatch(round[0].options).catch(() => {})
  }

  const question = questions[questionIndex]

  useEffect(() => {
    if (!question) return
    let active = true
    setDescriptions((current) => ({ ...current, ...descriptionSnapshot() }))
    const needed = question.options.filter((option) => !descriptionMemory.get(option.code)?.description)
    if (!needed.length) {
      setDescriptionLoading(false)
      setDescriptionError(null)
      return
    }

    setDescriptionLoading(true)
    setDescriptionError(null)
    void fetchDescriptionBatch(question.options)
      .then((payload) => {
        if (!active) return
        setDescriptions((current) => ({ ...current, ...descriptionSnapshot() }))
        const missing = needed.filter((option) => !(payload.items ?? []).some((item) => item.code === option.code && item.description))
        if (missing.length) throw new Error(`${missing.map((item) => item.name).join(', ')} 기업 설명을 아직 불러오지 못했습니다.`)
      })
      .catch((error) => {
        if (active) setDescriptionError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { if (active) setDescriptionLoading(false) })
    return () => { active = false }
  }, [question, descriptionAttempt])

  const choiceDescriptions = useMemo(() => {
    if (!question) return []
    return question.options.map((option) => {
      const raw = descriptions[option.code]?.description
      return raw ? scrubCompanyNames(raw, question.options) : null
    })
  }, [question, descriptions])

  const ready = Boolean(question && choiceDescriptions.length === 4 && choiceDescriptions.every(Boolean))

  useEffect(() => {
    if (!ready) return
    const upcoming = questions.slice(questionIndex + 1, questionIndex + 3)
    if (!upcoming.length) return

    let active = true
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const nextQuestion of upcoming) {
          try {
            await fetchDescriptionBatch(nextQuestion.options)
            if (!active) return
            setDescriptions((current) => ({ ...current, ...descriptionSnapshot() }))
          } catch {
            // Prefetch failure must never block the current question.
          }
        }
      })()
    }, 0)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [ready, questionIndex, questions])

  const choose = (choiceIndex: number) => {
    if (selected !== null || !question || !ready) return
    setSelected(choiceIndex)
    if (answerIsCorrect(question, choiceIndex)) setScore((value) => value + 1)
  }

  const next = () => {
    if (questionIndex >= questions.length - 1) { setFinished(true); return }
    setQuestionIndex((value) => value + 1)
    setSelected(null)
    setDescriptionError(null)
  }

  if (!pool) return <main className="index-quiz-shell" data-testid="index-quiz">
    <section className="index-quiz-select">
      <p className="index-quiz-eyebrow">STOCK COMPANY QUIZ</p>
      <h1>어느 시장의 기업을 더 많이 알고 있을까?</h1>
      <p className="index-quiz-lead">페이지가 열리면 KOSPI 200·KOSDAQ 150 종목명만 먼저 준비합니다. 시장을 선택하면 현재 문제의 기업 설명 4개를 우선 불러오고, 준비가 끝난 뒤 다음 문제와 다다음 문제를 4개씩 미리 받아둡니다.</p>
      <div className="index-pool-grid">
        <button onClick={() => start('kospi200')} data-testid="quiz-pool-kospi200" disabled={universeLoading && livePools.kospi200.length < 4}><span>KOSPI</span><strong>KOSPI 200</strong><em>{livePools.kospi200.length || pools.kospi200.length}개 종목 전체 출제</em><small>{usingFallback.kospi200 ? 'KRX 연결 전 임시 목록' : '현재 KRX 지수 구성종목 기준'}</small></button>
        <button onClick={() => start('kosdaq150')} data-testid="quiz-pool-kosdaq150" disabled={universeLoading && livePools.kosdaq150.length < 4}><span>KOSDAQ</span><strong>KOSDAQ 150</strong><em>{livePools.kosdaq150.length || pools.kosdaq150.length}개 종목 전체 출제</em><small>{usingFallback.kosdaq150 ? 'KRX 연결 전 임시 목록' : '현재 KRX 지수 구성종목 기준'}</small></button>
      </div>
      <div className="index-quiz-source"><b>ETF·ETN 제외</b><span>{universeLoading ? 'KRX 구성종목 확인 중' : universe?.source ?? 'KRX 연결 실패 · 임시 목록 사용'}{universe?.sourceDate ? ` · 기준 ${universe.sourceDate}` : ''}{universe?.stale ? ' · 저장된 최근 목록 사용 중' : ''}</span></div>
    </section>
  </main>

  if (finished) return <main className="index-quiz-shell"><section className="index-quiz-result">
    <p className="index-quiz-eyebrow">{poolLabel(pool)} RESULT</p><h1>{score} / {questions.length}</h1><p>{poolLabel(pool)} 기업 설명 퀴즈 완료</p>
    <div><button onClick={() => start(pool)}>같은 시장 다시 풀기</button><button onClick={() => setPool(null)}>시장 다시 선택</button></div>
  </section></main>

  if (!question) return <main className="index-quiz-shell"><div className="index-quiz-loading">퀴즈 종목을 준비하고 있습니다.</div></main>

  return <main className="index-quiz-shell">
    <section className="index-quiz-board">
      <header><div><p className="index-quiz-eyebrow">{poolLabel(pool)}</p><h1>기업 설명 맞히기</h1></div><div className="index-quiz-score"><span>{questionIndex + 1} / {questions.length}</span><strong>{score}점</strong></div></header>
      <div className="index-quiz-progress"><i style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div>
      <article className="index-question-card" data-testid="question-card">
        <span>{poolLabel(pool)}</span>
        <h2>{question.stock.name}</h2>
        <p>아래 4개 기업 설명 중 이 종목에 해당하는 설명을 선택하세요.</p>
      </article>

      {descriptionLoading && !ready && <div className="index-description-state"><strong>기업개요 불러오는 중</strong><span>현재 문제에 필요한 4개 설명만 먼저 준비하고 있습니다. 완료되면 다음 두 문제를 뒤에서 미리 불러옵니다.</span></div>}
      {descriptionError && !ready && <div className="index-description-state error"><strong>기업개요를 아직 불러오지 못했습니다.</strong><span>{descriptionError}</span><button onClick={() => setDescriptionAttempt((value) => value + 1)}>다시 불러오기</button></div>}

      <div className="index-quiz-choices description-choices">
        {question.options.map((option, index) => {
          const answered = selected !== null
          const correct = index === question.correct
          const picked = selected === index
          const state = answered ? correct ? 'correct' : picked ? 'wrong' : 'muted' : ''
          return <button key={`${option.code}-${index}`} className={state} onClick={() => choose(index)} disabled={answered || !ready}>
            <b>{index + 1}</b><span>{choiceDescriptions[index] ?? '기업 설명을 불러오는 중입니다.'}</span>
          </button>
        })}
      </div>

      {selected !== null && <div className={`index-quiz-feedback ${answerIsCorrect(question, selected) ? 'success' : 'fail'}`}><div><strong>{answerIsCorrect(question, selected) ? '정답' : '오답'}</strong><span>{question.stock.name}</span><small>정답 설명: {choiceDescriptions[question.correct]}</small><small>출처: {descriptions[question.stock.code]?.source ?? '기업개요 데이터'}</small></div><button onClick={next}>{questionIndex === questions.length - 1 ? '결과 보기' : '다음 문제'}</button></div>}
      <button className="index-quiz-switch" onClick={() => setPool(null)}>KOSPI 200 / KOSDAQ 150 다시 선택</button>
    </section>
  </main>
}

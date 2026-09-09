import { describe, expect, it } from 'vitest'
import { answerIsCorrect, buildQuizRound, moneyFlowScore } from './App'

describe('money flow score', () => {
  it('rewards positive momentum, breadth and institutional flow', () => {
    const strong = moneyFlowScore({ change: 3.2, turnover: 7, advancers: 80, decliners: 20, foreign: 1800, institution: 900 })
    const weak = moneyFlowScore({ change: -2.1, turnover: 3, advancers: 25, decliners: 75, foreign: -1100, institution: -600 })
    expect(strong).toBeGreaterThan(weak)
    expect(strong).toBeGreaterThan(0)
    expect(weak).toBeLessThan(0)
  })
})

describe('index company-description quiz', () => {
  const pool = [
    { code: '005930', name: '삼성전자', description: '메모리와 시스템 반도체를 생산함.' },
    { code: '000660', name: 'SK하이닉스', description: '메모리 반도체를 생산함.' },
    { code: '005380', name: '현대차', description: '완성차를 생산하고 판매함.' },
    { code: '000270', name: '기아', description: '자동차를 생산하고 판매함.' },
    { code: '035420', name: 'NAVER', description: '인터넷 플랫폼 서비스를 운영함.' },
  ]

  it('uses every available prepared stock by default and gives four company options', () => {
    const questions = buildQuizRound(pool)
    expect(questions).toHaveLength(pool.length)
    expect(questions.every((question) => question.options.length === 4)).toBe(true)
    expect(new Set(questions.map((question) => question.stock.code)).size).toBe(pool.length)
  })

  it('can limit a round without inventing stocks', () => {
    const questions = buildQuizRound(pool, 4)
    expect(questions).toHaveLength(4)
    expect(questions.every((question) => pool.some((stock) => stock.code === question.stock.code))).toBe(true)
  })

  it('marks only the configured company description option as correct', () => {
    const [question] = buildQuizRound(pool, 1)
    expect(question.options[question.correct].code).toBe(question.stock.code)
    expect(answerIsCorrect(question, question.correct)).toBe(true)
    expect(answerIsCorrect(question, (question.correct + 1) % 4)).toBe(false)
  })
})

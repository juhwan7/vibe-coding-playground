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

describe('index stock quiz', () => {
  const pool = [
    { code: '005930', name: '삼성전자' },
    { code: '000660', name: 'SK하이닉스' },
    { code: '005380', name: '현대차' },
    { code: '000270', name: '기아' },
    { code: '035420', name: 'NAVER' },
  ]

  it('builds questions with four choices from the selected index pool', () => {
    const questions = buildQuizRound(pool, 4)
    expect(questions).toHaveLength(4)
    expect(questions.every((question) => question.choices.length === 4)).toBe(true)
  })

  it('marks only the configured answer as correct', () => {
    const [question] = buildQuizRound(pool, 1)
    expect(answerIsCorrect(question, question.correct)).toBe(true)
    expect(answerIsCorrect(question, (question.correct + 1) % 4)).toBe(false)
  })
})

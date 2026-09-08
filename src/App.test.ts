import { describe, expect, it } from 'vitest'
import { isCorrectAnswer, moneyFlowScore, quizItems } from './App'

describe('money flow score', () => {
  it('rewards positive momentum, breadth and institutional flow', () => {
    const strong = moneyFlowScore({ change: 3.2, turnover: 7, advancers: 80, decliners: 20, foreign: 1800, institution: 900 })
    const weak = moneyFlowScore({ change: -2.1, turnover: 3, advancers: 25, decliners: 75, foreign: -1100, institution: -600 })
    expect(strong).toBeGreaterThan(weak)
    expect(strong).toBeGreaterThan(0)
    expect(weak).toBeLessThan(0)
  })
})

describe('stock company quiz', () => {
  it('marks the configured company description as correct', () => {
    const item = quizItems[0]
    expect(isCorrectAnswer(item, item.correct)).toBe(true)
  })

  it('rejects an incorrect company description', () => {
    const item = quizItems[0]
    const wrongChoice = item.correct === 0 ? 1 : 0
    expect(isCorrectAnswer(item, wrongChoice)).toBe(false)
  })
})

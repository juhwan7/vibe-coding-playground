import { describe, expect, it } from 'vitest'
import { isCorrectAnswer, quizItems } from './App'

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

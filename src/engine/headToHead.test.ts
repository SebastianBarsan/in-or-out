import { describe, expect, it } from 'vitest'
import { QUESTIONS } from '../data'
import { drawPool, previewAnswers, seedFrom } from './headToHead'
import { rankPercentiles } from './predictor'
import { createRng } from './rng'

describe('drawPool', () => {
  it('draws 10 distinct questions from the full set', () => {
    const pool = drawPool(QUESTIONS, createRng(1))
    expect(pool).toHaveLength(10)
    expect(new Set(pool).size).toBe(10)
    const known = new Set(QUESTIONS.map((q) => q.id))
    expect(pool.every((id) => known.has(id))).toBe(true)
  })
})

describe('previewAnswers', () => {
  it('samples 2 common, 2 mid and 2 obscure answers from every large question', () => {
    for (const question of QUESTIONS.filter((q) => q.answers.length > 6)) {
      const ranks = rankPercentiles(question)
      const sorted = [...question.answers].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!)
      const band = (id: string) => {
        const i = sorted.findIndex((a) => a.id === id)
        return i < Math.floor(sorted.length / 3) ? 0 : i < Math.floor((2 * sorted.length) / 3) ? 1 : 2
      }
      const preview = previewAnswers(question, createRng(7))
      expect(preview).toHaveLength(6)
      expect(new Set(preview.map((a) => a.id)).size).toBe(6)
      expect(preview.map((a) => band(a.id)).sort()).toEqual([0, 0, 1, 1, 2, 2])
    }
  })

  it('shows everything for a question with 6 answers or fewer', () => {
    for (const question of QUESTIONS.filter((q) => q.answers.length <= 6)) {
      const preview = previewAnswers(question, createRng(7))
      expect(preview.map((a) => a.id).sort()).toEqual(question.answers.map((a) => a.id).sort())
    }
  })

  it('does not list answers from most to least common', () => {
    const question = QUESTIONS.find((q) => q.answers.length > 30)!
    const ranks = rankPercentiles(question)
    const orders = Array.from({ length: 20 }, (_, seed) =>
      previewAnswers(question, createRng(seed)).map((a) => ranks.get(a.id)!),
    )
    const ascending = orders.filter((o) => o.every((r, i) => i === 0 || r >= o[i - 1]))
    expect(ascending.length).toBeLessThan(3)
  })

  it('gives the same preview for the same seed', () => {
    const question = QUESTIONS[0]
    const a = previewAnswers(question, createRng(seedFrom('game:1:q')))
    const b = previewAnswers(question, createRng(seedFrom('game:1:q')))
    expect(a).toEqual(b)
  })
})

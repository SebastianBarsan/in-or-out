import { describe, expect, it } from 'vitest'
import { QUESTIONS } from '../data'
import { drawPool, EXAMPLE_SHARE, exampleAnswer, seedFrom } from './headToHead'
import { rankPercentiles } from './predictor'
import { createRng } from './rng'

describe('drawPool', () => {
  const size = new Map(QUESTIONS.map((q) => [q.id, q.answers.length]))

  it('holds every question once, sorted by answer count', () => {
    const pool = drawPool(QUESTIONS, createRng(1))
    expect([...pool].sort()).toEqual(QUESTIONS.map((q) => q.id).sort())
    pool.forEach((id, i) => {
      if (i > 0) expect(size.get(id)!).toBeGreaterThanOrEqual(size.get(pool[i - 1])!)
    })
  })

  it('keeps each slice of a turn about the same size', () => {
    const pool = drawPool(QUESTIONS, createRng(1))
    const slice = Math.ceil(pool.length / 10)
    for (let i = 0; i + slice <= pool.length; i++) {
      const [low, high] = [size.get(pool[i])!, size.get(pool[i + slice - 1])!]
      expect(high - low).toBeLessThanOrEqual(Math.max(2, low * 0.75))
    }
  })

  it('varies the order of same-sized questions between games', () => {
    expect(drawPool(QUESTIONS, createRng(1))).not.toEqual(drawPool(QUESTIONS, createRng(2)))
  })
})

describe('exampleAnswer', () => {
  it('always comes from the more common answers of every question', () => {
    for (const question of QUESTIONS) {
      const ranks = rankPercentiles(question)
      const cutoff = [...ranks.values()].sort((a, b) => a - b)[
        Math.max(1, Math.ceil(question.answers.length * EXAMPLE_SHARE)) - 1
      ]
      for (let seed = 0; seed < 20; seed++) {
        expect(ranks.get(exampleAnswer(question, createRng(seed)).id)!).toBeLessThanOrEqual(cutoff)
      }
    }
  })

  it('gives the same example for the same seed', () => {
    const question = QUESTIONS[0]
    const a = exampleAnswer(question, createRng(seedFrom('game:1:q')))
    const b = exampleAnswer(question, createRng(seedFrom('game:1:q')))
    expect(a).toEqual(b)
  })
})

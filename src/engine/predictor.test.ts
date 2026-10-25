import { describe, expect, it } from 'vitest'
import {
  answerWeights,
  chooseGuess,
  DEFAULT_CONFIG,
  emptyProfile,
  nicheScore,
  rankPercentiles,
  recordAnswer,
  spread,
} from './predictor'
import { createRng } from './rng'
import { QUESTIONS } from '../data'

const africa = QUESTIONS.find((q) => q.id === 'africa')!

const profileOf = (...ranks: number[]) => ranks.reduce(recordAnswer, emptyProfile())

const guessRanks = (ranks: number[], samples = 2000) => {
  const rng = createRng(7)
  const percentiles = rankPercentiles(africa)
  const profile = profileOf(...ranks)
  let total = 0
  for (let i = 0; i < samples; i++) total += percentiles.get(chooseGuess(africa, profile, rng).id)!
  return total / samples
}

describe('rankPercentiles', () => {
  it('runs from 0 for the most common answer to 1 for the most obscure', () => {
    const ranks = rankPercentiles(africa)
    expect(ranks.get('egypt')).toBe(0)
    expect(ranks.get('sao-tome-and-principe')).toBe(1)
  })
})

describe('player profile', () => {
  it('starts at the prior and moves only partway after one odd answer', () => {
    expect(nicheScore(emptyProfile())).toBe(DEFAULT_CONFIG.priorNiche)
    expect(nicheScore(profileOf(1))).toBeCloseTo(0.625)
  })

  it('weighs later answers a little more', () => {
    expect(nicheScore(profileOf(0, 1))).toBeGreaterThan(nicheScore(profileOf(1, 0)))
  })

  it('keeps spread above the floor and widens for erratic players', () => {
    expect(spread(profileOf(0.5, 0.5, 0.5))).toBe(DEFAULT_CONFIG.spreadFloor)
    expect(spread(profileOf(0, 1, 0, 1))).toBeCloseTo(0.5)
  })
})

describe('chooseGuess', () => {
  it('follows popularity with no data', () => {
    const weights = answerWeights(africa, emptyProfile())
    expect(weights.every(({ answer, weight }) => weight === answer.pop)).toBe(true)
    expect(guessRanks([])).toBeLessThan(0.4)
  })

  it('hunts in the long tail once the player looks niche', () => {
    expect(guessRanks([0.95, 0.9, 0.95])).toBeGreaterThan(0.6)
  })

  it('is deterministic for a given seed', () => {
    const a = chooseGuess(africa, emptyProfile(), createRng(123))
    const b = chooseGuess(africa, emptyProfile(), createRng(123))
    expect(a.id).toBe(b.id)
  })
})

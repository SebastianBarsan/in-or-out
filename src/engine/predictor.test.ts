import { describe, expect, it } from 'vitest'
import {
  answerWeights,
  careerFromHistory,
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

const guessRanks = (ranks: number[], samples = 2000, history?: number[][]) => {
  const rng = createRng(7)
  const percentiles = rankPercentiles(africa)
  const profile = ranks.reduce(recordAnswer, emptyProfile(history && careerFromHistory(history)))
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

describe('career read', () => {
  const rounds = (count: number, rank: number) => Array.from({ length: count }, () => [rank, rank, rank])

  it('is absent with no history', () => {
    expect(careerFromHistory([])).toBeUndefined()
    expect(careerFromHistory([[], []])).toBeUndefined()
  })

  it('tracks the player across rounds and grows more confident with more of them', () => {
    const few = careerFromHistory(rounds(1, 0.9))!
    const many = careerFromHistory(rounds(20, 0.9))!
    expect(few.niche).toBeGreaterThan(DEFAULT_CONFIG.priorNiche)
    expect(many.niche).toBeGreaterThan(few.niche)
    expect(many.weight).toBeGreaterThan(few.weight)
    expect(many.weight).toBeLessThanOrEqual(DEFAULT_CONFIG.careerMaxWeight)
    expect(many.headStart).toBeLessThanOrEqual(DEFAULT_CONFIG.careerMaxHeadStart)
  })

  it('follows a change of style, favouring recent rounds', () => {
    const switched = careerFromHistory([...rounds(20, 0.9), ...rounds(15, 0)])!
    expect(switched.niche).toBeLessThan(0.35)
  })

  it('aims the first guess of a round at a known deep-cut player', () => {
    expect(guessRanks([], 2000, rounds(20, 0.95))).toBeGreaterThan(guessRanks([]) + 0.1)
  })

  it('gives an erratic history almost no head start', () => {
    const erratic = Array.from({ length: 20 }, () => [0, 1, 0, 1, 0])
    expect(careerFromHistory(erratic)!.headStart).toBeLessThan(0.1)
  })

  it('lets the current round pull away from the career read', () => {
    const history = rounds(20, 0.95)
    expect(guessRanks([0, 0, 0], 2000, history)).toBeLessThan(guessRanks([], 2000, history))
  })
})

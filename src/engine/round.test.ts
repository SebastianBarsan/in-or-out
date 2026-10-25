import { describe, expect, it } from 'vitest'
import { buildRound } from './round'
import { createRng } from './rng'
import { checkQuestions } from './content'
import { TIERS } from './types'
import { QUESTIONS } from '../data'

describe('buildRound', () => {
  it('picks one question per tier, in order, with no shared categories', () => {
    const rng = createRng(1)
    for (let i = 0; i < 200; i++) {
      const round = buildRound(QUESTIONS, new Set(), rng)
      expect(round.map((q) => q.tier)).toEqual(TIERS)
      expect(new Set(round.map((q) => q.category)).size).toBe(round.length)
    }
  })

  it('avoids recently seen questions while unseen ones remain', () => {
    const rng = createRng(2)
    for (let i = 0; i < 200; i++) {
      const first = buildRound(QUESTIONS, new Set(), rng)
      const second = buildRound(QUESTIONS, new Set(first.map((q) => q.id)), rng)
      expect(second.some((q) => first.includes(q))).toBe(false)
    }
  })

  it('still builds a round when everything has been seen', () => {
    const all = new Set(QUESTIONS.map((q) => q.id))
    expect(buildRound(QUESTIONS, all, createRng(3))).toHaveLength(5)
  })
})

describe('questions.json', () => {
  it('passes the content checks', () => {
    expect(checkQuestions(QUESTIONS).errors).toEqual([])
  })

  it('flags a broken question', () => {
    const broken = structuredClone(QUESTIONS)
    broken[0].answers.push({ ...broken[0].answers[0] })
    broken[1].answers[0].aliases = ['Washington']
    const { errors } = checkQuestions(broken)
    expect(errors.some((e) => e.includes('duplicate answer id'))).toBe(true)
    expect(errors.some((e) => e.includes('collides with the name'))).toBe(false)
    broken[1].answers[0].aliases = ['George Washington']
    expect(checkQuestions(broken).errors.some((e) => e.includes('collides with the name'))).toBe(true)
  })
})

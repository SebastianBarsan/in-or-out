import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearRoundInProgress,
  loadRankHistory,
  loadStreak,
  saveRoundInProgress,
  saveStreak,
  settleAbandonedRound,
} from './storage'

beforeEach(() => {
  const items = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  })
})

const turn = { question: 'q1', answer: 'a1', rank: 0.5, guess: 'a2', caught: false }

describe('settleAbandonedRound', () => {
  it('counts a round left unfinished as an OUT and logs the turns played', () => {
    saveStreak({ current: 4, best: 6 })
    saveRoundInProgress({ at: '2026-11-02T00:00:00.000Z', turns: [turn] })
    settleAbandonedRound()
    expect(loadStreak()).toEqual({ current: 0, best: 6 })
    expect(loadRankHistory()).toEqual([[0.5]])
  })

  it('settles a round only once', () => {
    saveStreak({ current: 0, best: 6 })
    saveRoundInProgress({ at: '2026-11-02T00:00:00.000Z', turns: [] })
    settleAbandonedRound()
    saveStreak({ current: 2, best: 6 })
    settleAbandonedRound()
    expect(loadStreak().current).toBe(2)
  })

  it('leaves the streak alone when the last round was finished', () => {
    saveStreak({ current: 3, best: 3 })
    saveRoundInProgress({ at: '2026-11-02T00:00:00.000Z', turns: [] })
    clearRoundInProgress()
    settleAbandonedRound()
    expect(loadStreak()).toEqual({ current: 3, best: 3 })
  })
})

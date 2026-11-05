import { useMemo, useRef, useState } from 'react'
import type { Answer, Question } from '../engine/types'
import { createRng, randomSeed } from '../engine/rng'
import { buildRound } from '../engine/round'
import {
  careerFromHistory,
  chooseGuess,
  emptyProfile,
  nicheScore,
  rankPercentiles,
  recordAnswer,
} from '../engine/predictor'
import { QUESTIONS } from '../data'
import {
  clearRoundInProgress,
  loadRankHistory,
  loadRecentIds,
  loadStreak,
  logRound,
  rememberRound,
  saveRoundInProgress,
  saveStreak,
  settleAbandonedRound,
} from '../storage'
import type { RoundLog } from '../storage'
import type { Turn } from './turn'

export type SoloScreen = 'start' | 'play' | 'result'

const logTurns = (played: Turn[]): RoundLog['turns'] =>
  played.map((t) => ({
    question: t.question.id,
    answer: t.answer?.id ?? null,
    rank: t.rank,
    guess: t.guess.id,
    caught: t.caught,
  }))

/** Runs a Solo round: building it, locking in each guess, scoring answers and saving the outcome. */
export function useSoloRound() {
  const rng = useRef(createRng(randomSeed())).current
  const [screen, setScreen] = useState<SoloScreen>('start')
  // A round left half-played last visit is settled as an OUT before the streak is read.
  // Running this twice is harmless: the second call finds nothing left to settle.
  const [streak, setStreak] = useState(() => {
    settleAbandonedRound()
    return loadStreak()
  })
  const [round, setRound] = useState<Question[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [profile, setProfile] = useState(emptyProfile)
  // The guess is chosen here, in the event that moves to a new question, and never recomputed.
  const [current, setCurrent] = useState<{ index: number; guess: Answer } | null>(null)
  // Re-read on every screen change so the start screen reflects the round just logged.
  const career = useMemo(() => careerFromHistory(loadRankHistory()), [screen])

  const start = () => {
    const questions = buildRound(QUESTIONS, loadRecentIds(), rng)
    rememberRound(questions.map((q) => q.id))
    saveRoundInProgress({ at: new Date().toISOString(), turns: [] })
    const fresh = emptyProfile(careerFromHistory(loadRankHistory()))
    setRound(questions)
    setTurns([])
    setProfile(fresh)
    setCurrent({ index: 0, guess: chooseGuess(questions[0], fresh, rng) })
    setScreen('play')
  }

  const finish = (played: Turn[], outcome: 'in' | 'out') => {
    const updated =
      outcome === 'in'
        ? { current: streak.current + 1, best: Math.max(streak.best, streak.current + 1) }
        : { current: 0, best: streak.best }
    setStreak(updated)
    saveStreak(updated)
    logRound({ at: new Date().toISOString(), outcome, turns: logTurns(played) })
    clearRoundInProgress()
  }

  const answer = (picked: Answer) => {
    if (!current) return
    const question = round[current.index]
    const rank = rankPercentiles(question).get(picked.id)!
    const next = recordAnswer(profile, rank)
    const caught = picked.id === current.guess.id
    const played = [...turns, { question, answer: picked, guess: current.guess, rank, caught, nicheAfter: nicheScore(next) }]
    setProfile(next)
    setTurns(played)
    // Save the outcome as soon as it's decided, so refreshing during the reveal can't undo an OUT.
    if (caught || current.index === round.length - 1) finish(played, caught ? 'out' : 'in')
    else saveRoundInProgress({ at: new Date().toISOString(), turns: logTurns(played) })
  }

  // Running out of time is an OUT. There's no answer to learn from, so the profile stays put.
  const timeout = () => {
    if (!current) return
    const question = round[current.index]
    const played = [
      ...turns,
      { question, answer: null, guess: current.guess, rank: null, caught: true, nicheAfter: nicheScore(profile) },
    ]
    setTurns(played)
    finish(played, 'out')
  }

  const next = () => {
    if (!current) return
    const last = turns[turns.length - 1]
    const finished = last.caught || current.index === round.length - 1
    if (!finished) {
      const index = current.index + 1
      setCurrent({ index, guess: chooseGuess(round[index], profile, rng) })
      return
    }
    setCurrent(null)
    setScreen('result')
  }

  return { screen, streak, career, round, turns, current, start, answer, timeout, next }
}

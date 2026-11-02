import { useMemo, useRef, useState } from 'react'
import type { Answer, Question } from './engine/types'
import { createRng, randomSeed } from './engine/rng'
import { buildRound } from './engine/round'
import {
  careerFromHistory,
  chooseGuess,
  emptyProfile,
  nicheScore,
  rankPercentiles,
  recordAnswer,
} from './engine/predictor'
import { QUESTIONS } from './data'
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
} from './storage'
import type { RoundLog } from './storage'
import type { Turn } from './ui/turn'
import { HeadToHead } from './ui/h2h/HeadToHead'
import { StartScreen } from './ui/StartScreen'
import { QuestionScreen } from './ui/QuestionScreen'
import { ResultScreen } from './ui/ResultScreen'

type Screen = 'start' | 'play' | 'result'

const logTurns = (played: Turn[]): RoundLog['turns'] =>
  played.map((t) => ({
    question: t.question.id,
    answer: t.answer?.id ?? null,
    rank: t.rank,
    guess: t.guess.id,
    caught: t.caught,
  }))

export function App() {
  const rng = useRef(createRng(randomSeed())).current
  const [screen, setScreen] = useState<Screen>('start')
  // A round left half-played last visit is settled as an OUT before the streak is read.
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
  // A head-to-head game lives in the URL, so the link is both the invite and the way back in.
  const [gameId, setGameId] = useState(() => new URLSearchParams(location.search).get('game'))

  const openGame = (id: string | null) => {
    const url = new URL(location.href)
    if (id) url.searchParams.set('game', id)
    else url.searchParams.delete('game')
    history.replaceState(null, '', url)
    setGameId(id)
  }

  const startRound = () => {
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

  const handleAnswer = (answer: Answer) => {
    if (!current) return
    const question = round[current.index]
    const rank = rankPercentiles(question).get(answer.id)!
    const next = recordAnswer(profile, rank)
    const caught = answer.id === current.guess.id
    const played = [...turns, { question, answer, guess: current.guess, rank, caught, nicheAfter: nicheScore(next) }]
    setProfile(next)
    setTurns(played)
    // Save the outcome as soon as it's decided, so refreshing during the reveal can't undo an OUT.
    if (caught || current.index === round.length - 1) finishRound(played, caught ? 'out' : 'in')
    else saveRoundInProgress({ at: new Date().toISOString(), turns: logTurns(played) })
  }

  // Running out of time is an OUT. There's no answer to learn from, so the profile stays put.
  const handleTimeout = () => {
    if (!current) return
    const question = round[current.index]
    const played = [
      ...turns,
      { question, answer: null, guess: current.guess, rank: null, caught: true, nicheAfter: nicheScore(profile) },
    ]
    setTurns(played)
    finishRound(played, 'out')
  }

  const finishRound = (played: Turn[], outcome: 'in' | 'out') => {
    const updated =
      outcome === 'in'
        ? { current: streak.current + 1, best: Math.max(streak.best, streak.current + 1) }
        : { current: 0, best: streak.best }
    setStreak(updated)
    saveStreak(updated)
    logRound({ at: new Date().toISOString(), outcome, turns: logTurns(played) })
    clearRoundInProgress()
  }

  const handleNext = () => {
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

  if (gameId) {
    return (
      <main className="app">
        <HeadToHead key={gameId} gameId={gameId} onLeave={() => openGame(null)} onSwitchGame={openGame} />
      </main>
    )
  }

  return (
    <main className="app">
      {screen === 'start' && <StartScreen streak={streak} career={career} onPlay={startRound} onGameCreated={openGame} />}
      {screen === 'play' && current && (
        <QuestionScreen
          key={round[current.index].id}
          question={round[current.index]}
          index={current.index}
          total={round.length}
          guess={current.guess}
          turns={turns}
          onAnswer={handleAnswer}
          onTimeout={handleTimeout}
          onNext={handleNext}
        />
      )}
      {screen === 'result' && <ResultScreen turns={turns} total={round.length} streak={streak} onPlayAgain={startRound} />}
    </main>
  )
}

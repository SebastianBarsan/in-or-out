import { useRef, useState } from 'react'
import type { Answer, Question } from './engine/types'
import { createRng, randomSeed } from './engine/rng'
import { buildRound } from './engine/round'
import { chooseGuess, emptyProfile, nicheScore, rankPercentiles, recordAnswer } from './engine/predictor'
import { QUESTIONS } from './data'
import { loadRecentIds, loadStreak, logRound, rememberRound, saveStreak } from './storage'
import type { Turn } from './ui/turn'
import { StartScreen } from './ui/StartScreen'
import { QuestionScreen } from './ui/QuestionScreen'
import { ResultScreen } from './ui/ResultScreen'

type Screen = 'start' | 'play' | 'result'

export function App() {
  const rng = useRef(createRng(randomSeed())).current
  const [screen, setScreen] = useState<Screen>('start')
  const [streak, setStreak] = useState(loadStreak)
  const [round, setRound] = useState<Question[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [profile, setProfile] = useState(emptyProfile)
  // The guess is chosen here, in the event that moves to a new question, and never recomputed.
  const [current, setCurrent] = useState<{ index: number; guess: Answer } | null>(null)

  const startRound = () => {
    const questions = buildRound(QUESTIONS, loadRecentIds(), rng)
    rememberRound(questions.map((q) => q.id))
    const fresh = emptyProfile()
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
    setProfile(next)
    setTurns((prev) => [
      ...prev,
      { question, answer, guess: current.guess, rank, caught: answer.id === current.guess.id, nicheAfter: nicheScore(next) },
    ])
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

    const outcome = last.caught ? 'out' : 'in'
    const updated =
      outcome === 'in'
        ? { current: streak.current + 1, best: Math.max(streak.best, streak.current + 1) }
        : { current: 0, best: streak.best }
    setStreak(updated)
    saveStreak(updated)
    logRound({
      at: new Date().toISOString(),
      outcome,
      turns: turns.map((t) => ({
        question: t.question.id,
        answer: t.answer.id,
        rank: t.rank,
        guess: t.guess.id,
        caught: t.caught,
      })),
    })
    setCurrent(null)
    setScreen('result')
  }

  return (
    <main className="app">
      {screen === 'start' && <StartScreen streak={streak} onPlay={startRound} />}
      {screen === 'play' && current && (
        <QuestionScreen
          key={round[current.index].id}
          question={round[current.index]}
          index={current.index}
          total={round.length}
          guess={current.guess}
          turns={turns}
          onAnswer={handleAnswer}
          onNext={handleNext}
        />
      )}
      {screen === 'result' && <ResultScreen turns={turns} total={round.length} streak={streak} onPlayAgain={startRound} />}
    </main>
  )
}

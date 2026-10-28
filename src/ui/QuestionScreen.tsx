import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Answer, Question } from '../engine/types'
import { validateAnswer } from '../engine/validate'
import type { Turn } from './turn'
import { FlipCard } from './FlipCard'
import { ProgressDots } from './ProgressDots'
import { TimerBar } from './TimerBar'

const THINKING_MS = 900
const FLIP_MS = 600
const ANSWER_MS = 10_000

type Phase = 'thinking' | 'answering' | 'flipping' | 'revealed'

interface Props {
  question: Question
  index: number
  total: number
  /** Already locked in by the parent before this screen mounts. */
  guess: Answer
  turns: Turn[]
  onAnswer: (answer: Answer) => void
  /** The clock ran out before a valid answer went in. */
  onTimeout: () => void
  onNext: () => void
}

export function QuestionScreen({ question, index, total, guess, turns, onAnswer, onTimeout, onNext }: Props) {
  const [phase, setPhase] = useState<Phase>('thinking')
  const [input, setInput] = useState('')
  const [error, setError] = useState<{ message: string; nonce: number } | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (phase === 'thinking') {
      const t = setTimeout(() => setPhase('answering'), THINKING_MS)
      return () => clearTimeout(t)
    }
    if (phase === 'answering') inputRef.current?.focus()
    if (phase === 'flipping') {
      const t = setTimeout(() => setPhase('revealed'), FLIP_MS)
      return () => clearTimeout(t)
    }
    if (phase === 'revealed') nextRef.current?.focus()
  }, [phase])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (phase !== 'answering') return
    const result = validateAnswer(question, input)
    if (result.kind === 'invalid') {
      setError({ message: 'Not a valid answer — try again', nonce: Date.now() })
      return
    }
    if (result.kind === 'ambiguous') {
      setError({ message: 'That could be more than one answer — be more specific', nonce: Date.now() })
      return
    }
    setError(null)
    setAnswer(result.answer)
    onAnswer(result.answer)
    setPhase('flipping')
  }

  const expire = () => {
    if (phase !== 'answering') return
    setError(null)
    setTimedOut(true)
    onTimeout()
    setPhase('flipping')
  }

  const caught = timedOut || (answer !== null && answer.id === guess.id)
  const isLast = index === total - 1
  const revealed = phase === 'revealed'

  return (
    <section className="screen play">
      {/* Hold back this question's dot until the flip, so it can't spoil the reveal. */}
      <ProgressDots total={total} index={index} turns={revealed ? turns : turns.slice(0, index)} />

      <header className="question">
        <p className="question-number">Question {index + 1} of {total}</p>
        <h2 className="prompt">{question.prompt}</h2>
        <span className="badge">{question.answers.length} possible answers</span>
      </header>

      <div className="table">
        <span aria-hidden="true" />
        <FlipCard thinking={phase === 'thinking'} flipped={phase === 'flipping' || revealed} guess={guess.name} />
        {(answer || timedOut) && (
          <div className={`your-answer${revealed ? ' shown' : ''}`}>
            <span className="label">You said</span>
            <span className="value">{answer ? answer.name : 'Nothing'}</span>
          </div>
        )}
      </div>

      {!answer && !timedOut && (
        <form className="answer-form" onSubmit={submit}>
          <TimerBar durationMs={ANSWER_MS} running={phase === 'answering'} onExpire={expire} />
          <input
            ref={inputRef}
            // Remounting on each error restarts the shake animation; autoFocus keeps the keyboard up.
            key={error?.nonce}
            autoFocus={phase === 'answering'}
            className={`answer-input${error ? ' shake' : ''}`}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              if (error) setError(null)
            }}
            disabled={phase !== 'answering'}
            placeholder={phase === 'thinking' ? 'Locking in…' : 'Your answer'}
            aria-label="Your answer"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'answer-error' : undefined}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <button className="btn btn-primary" type="submit" disabled={phase !== 'answering' || !input.trim()}>
            Submit
          </button>
          <p className="error" id="answer-error" role="alert">
            {error?.message}
          </p>
        </form>
      )}

      {revealed && (
        <div className={`verdict ${caught ? 'out' : 'safe'}`}>
          <p className="verdict-word">{caught ? 'OUT' : 'Safe'}</p>
          <p className="verdict-detail">
            {timedOut ? "Time's up." : caught ? 'I had you. Same answer.' : isLast ? 'You dodged every guess.' : 'Different answers. On you go.'}
          </p>
          <button ref={nextRef} className="btn btn-primary" onClick={onNext}>
            {caught || isLast ? 'See result' : 'Next question'}
          </button>
        </div>
      )}
    </section>
  )
}

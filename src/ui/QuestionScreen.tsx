import { useEffect, useRef, useState } from 'react'
import type { Answer, Question } from '../engine/types'
import type { Turn } from './turn'
import { AnswerForm } from './AnswerForm'
import { FlipCard } from './FlipCard'
import { ProgressDots } from './ProgressDots'
import { playOut, playSafe } from './sound'

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
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const nextRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (phase === 'thinking') {
      const t = setTimeout(() => setPhase('answering'), THINKING_MS)
      return () => clearTimeout(t)
    }
    if (phase === 'flipping') {
      const t = setTimeout(() => setPhase('revealed'), FLIP_MS)
      return () => clearTimeout(t)
    }
    if (phase === 'revealed') nextRef.current?.focus()
  }, [phase])

  const accept = (accepted: Answer) => {
    setAnswer(accepted)
    onAnswer(accepted)
    setPhase('flipping')
  }

  const expire = () => {
    if (phase !== 'answering') return
    setTimedOut(true)
    onTimeout()
    setPhase('flipping')
  }

  const caught = timedOut || (answer !== null && answer.id === guess.id)
  const isLast = index === total - 1
  const revealed = phase === 'revealed'

  useEffect(() => {
    if (revealed) (caught ? playOut : playSafe)()
    // Only on the reveal itself; `caught` is settled by then.
  }, [revealed])

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
        <AnswerForm
          question={question}
          active={phase === 'answering'}
          timerMs={ANSWER_MS}
          onExpire={expire}
          onAccept={accept}
          placeholder={phase === 'thinking' ? 'Locking in…' : 'Your answer'}
        />
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

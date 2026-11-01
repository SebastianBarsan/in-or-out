import { useState } from 'react'
import type { GameView } from '../../h2h/api'
import { AnswerForm } from '../AnswerForm'
import { FlipCard } from '../FlipCard'
import { nameOf, otherRole, questionById } from './lookup'
import { useTurnClock } from './useTurnClock'

interface Props {
  view: GameView
  /** Both resolve false if the move didn't reach the server. */
  start: () => Promise<boolean>
  submit: (answer: string | null) => Promise<boolean>
}

export function AnswerScreen({ view, start, submit }: Props) {
  // The answer waiting on the server. `undefined` means none yet; null means the clock ran out.
  const [pending, setPending] = useState<string | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const timerMs = useTurnClock(view.msLeft !== null && view.questionId !== null, view.msLeft, start)

  const send = async (answer: string | null) => {
    setPending(answer)
    setFailed(false)
    if (!(await submit(answer))) setFailed(true)
  }

  const question = view.questionId ? questionById(view.questionId) : undefined
  const setter = view.you ? nameOf(view, otherRole(view.you)) : ''

  if (!question || timerMs === null) {
    return (
      <section className="screen play">
        <p className="pitch" role="status">
          Opening the question…
        </p>
      </section>
    )
  }

  return (
    <section className="screen play">
      <header className="question">
        <p className="question-number">
          Turn {view.turn}
          {view.suddenDeath ? ' · Sudden death' : ''}
        </p>
        <h2 className="prompt">{question.prompt}</h2>
        <span className="badge">{question.answers.length} possible answers</span>
      </header>

      <FlipCard thinking={false} flipped={false} guess="" />
      <p className="pitch">{setter} locked in a prediction. Don't say it.</p>

      {pending === undefined ? (
        <AnswerForm
          question={question}
          active
          timerMs={timerMs}
          onExpire={() => void send(null)}
          onAccept={(answer) => void send(answer.id)}
        />
      ) : failed ? (
        <button className="btn btn-primary" onClick={() => void send(pending)}>
          Send again
        </button>
      ) : (
        <p className="pitch" role="status">
          Checking…
        </p>
      )}
    </section>
  )
}

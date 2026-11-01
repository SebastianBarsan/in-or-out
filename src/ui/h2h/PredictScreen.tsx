import { useState } from 'react'
import { AnswerForm } from '../AnswerForm'
import { TimerBar } from '../TimerBar'
import { questionById } from './lookup'

interface Props {
  questionId: string
  opponent: string
  msLeft: number
  /** Resolves false if the prediction didn't reach the server. */
  onLock: (prediction: string) => Promise<boolean>
  onTimeout: () => void
}

export function PredictScreen({ questionId, opponent, msLeft, onLock, onTimeout }: Props) {
  const [locking, setLocking] = useState(false)
  // Only the first reading sets the timer. Later polls would otherwise keep restarting the bar.
  const [timerMs] = useState(() => Math.max(msLeft, 1))
  const question = questionById(questionId)!

  return (
    <section className="screen play">
      <header className="question">
        <p className="question-number">Predict {opponent}'s answer</p>
        <h2 className="prompt">{question.prompt}</h2>
        <span className="badge">{question.answers.length} possible answers</span>
      </header>
      {/* Keeps draining during a lock: if the lock fails, the server's clock hasn't stopped either. */}
      <TimerBar durationMs={timerMs} running onExpire={() => !locking && onTimeout()} />
      <AnswerForm
        question={question}
        active={!locking}
        onAccept={async (answer) => {
          setLocking(true)
          if (!(await onLock(answer.id))) setLocking(false)
        }}
        placeholder={`What will ${opponent} say?`}
        label="Your prediction"
        submitLabel="Lock in"
      />
    </section>
  )
}

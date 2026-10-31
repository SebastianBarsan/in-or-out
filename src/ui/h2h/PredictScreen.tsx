import { useState } from 'react'
import { AnswerForm } from '../AnswerForm'
import { questionById } from './lookup'

interface Props {
  questionId: string
  opponent: string
  onBack: () => void
  /** Resolves false if the prediction didn't reach the server. */
  onLock: (prediction: string) => Promise<boolean>
}

export function PredictScreen({ questionId, opponent, onBack, onLock }: Props) {
  const [locking, setLocking] = useState(false)
  const question = questionById(questionId)!

  return (
    <section className="screen play">
      <header className="question">
        <p className="question-number">Predict {opponent}'s answer</p>
        <h2 className="prompt">{question.prompt}</h2>
        <span className="badge">{question.answers.length} possible answers</span>
      </header>
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
      <button className="btn btn-quiet" onClick={onBack} disabled={locking}>
        Pick a different question
      </button>
    </section>
  )
}

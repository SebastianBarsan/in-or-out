import type { ReactNode } from 'react'
import type { GameView } from '../../h2h/api'
import { FlipCard } from '../FlipCard'
import { answerName, questionById } from './lookup'

interface Props {
  view: GameView
  text: string
  leave: ReactNode
}

export function WaitingScreen({ view, text, leave }: Props) {
  return (
    <section className="screen h2h">
      <p className="question-number">
        Turn {view.turn}
        {view.suddenDeath ? ' · Sudden death' : ''}
      </p>
      <FlipCard thinking flipped={false} guess="" />
      <h2 className="prompt" role="status">
        {text}
      </h2>
      {view.questionId && view.prediction && (
        <p className="pitch">
          {questionById(view.questionId)?.prompt}
          <br />
          You predicted <strong>{answerName(view.questionId, view.prediction)}</strong>
        </p>
      )}
      {leave}
    </section>
  )
}

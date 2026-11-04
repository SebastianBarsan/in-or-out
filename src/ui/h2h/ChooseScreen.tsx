import { useMemo, useRef, useState } from 'react'
import { exampleAnswer, seedFrom } from '../../engine/headToHead'
import { createRng } from '../../engine/rng'
import type { GameView } from '../../h2h/api'
import { TimerBar } from '../TimerBar'
import { nameOf, questionById } from './lookup'
import { useTurnClock } from './useTurnClock'

interface Props {
  view: GameView
  /** Both resolve false if the move didn't reach the server. */
  start: () => Promise<boolean>
  onChoose: (questionId: string) => Promise<boolean>
  onTimeout: () => void
}

export function ChooseScreen({ view, start, onChoose, onTimeout }: Props) {
  const [picking, setPicking] = useState(false)
  // Set when the bar runs out mid-pick, so a pick that then fails still sends the timeout.
  const expired = useRef(false)
  const timerMs = useTurnClock(view.msLeft !== null, view.msLeft, start)
  const choices = view.choices.join()
  const cards = useMemo(
    () =>
      view.choices.flatMap((id) => {
        const question = questionById(id)
        if (!question) return []
        return [{ question, example: exampleAnswer(question, createRng(seedFrom(`${view.id}:${view.turn}:${id}`))) }]
      }),
    [view.id, view.turn, choices],
  )

  if (timerMs === null) {
    return (
      <section className="screen h2h">
        <p className="pitch" role="status">
          Opening the turn…
        </p>
      </section>
    )
  }

  return (
    <section className="screen h2h">
      <p className="question-number">
        Turn {view.turn} · {view.poolSize} questions left{view.suddenDeath ? ' · Sudden death' : ''}
      </p>
      <h2 className="prompt">{nameOf(view, view.setter)}, pick a question</h2>
      {/* Keeps draining during a pick: if the pick fails, the server's clock hasn't stopped either. */}
      <TimerBar
        durationMs={timerMs}
        running
        onExpire={() => {
          expired.current = true
          if (!picking) onTimeout()
        }}
      />
      <ul className="choices">
        {cards.map(({ question, example }) => (
          <li key={question.id}>
            <button
              className="choice"
              disabled={picking}
              onClick={async () => {
                setPicking(true)
                if (await onChoose(question.id)) return
                setPicking(false)
                if (expired.current) onTimeout()
              }}
            >
              <span className="choice-prompt">{question.prompt}</span>
              <span className="badge">{question.answers.length} possible answers</span>
              <span className="choice-example">ex. {example.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

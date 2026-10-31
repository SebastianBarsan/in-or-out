import { useMemo } from 'react'
import { previewAnswers, seedFrom } from '../../engine/headToHead'
import { createRng } from '../../engine/rng'
import type { GameView } from '../../h2h/api'
import { nameOf, questionById } from './lookup'

interface Props {
  view: GameView
  onChoose: (questionId: string) => void
}

export function ChooseScreen({ view, onChoose }: Props) {
  const choices = view.choices.join()
  const cards = useMemo(
    () =>
      view.choices.flatMap((id) => {
        const question = questionById(id)
        if (!question) return []
        return [{ question, preview: previewAnswers(question, createRng(seedFrom(`${view.id}:${view.turn}:${id}`))) }]
      }),
    [view.id, view.turn, choices],
  )

  return (
    <section className="screen h2h">
      <p className="question-number">
        Turn {view.turn} · {view.poolSize} questions left{view.suddenDeath ? ' · Sudden death' : ''}
      </p>
      <h2 className="prompt">{nameOf(view, view.setter)}, pick a question</h2>
      <ul className="choices">
        {cards.map(({ question, preview }) => (
          <li key={question.id}>
            <button className="choice" onClick={() => onChoose(question.id)}>
              <span className="choice-prompt">{question.prompt}</span>
              <span className="badge">{question.answers.length} possible answers</span>
              <span className="choice-preview">{preview.map((a) => a.name).join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

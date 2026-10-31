import { useEffect, useRef, useState } from 'react'
import type { GameView, PlayedTurn } from '../../h2h/api'
import { FlipCard } from '../FlipCard'
import { playOut, playSafe } from '../sound'
import { answerName, nameOf, otherRole, questionById } from './lookup'

const FLIP_MS = 600

interface Props {
  view: GameView
  played: PlayedTurn
  onNext: () => void
}

/** What this turn did to the game, in the words both players see. */
function outcomeLine(played: PlayedTurn, setter: string, answerer: string): string {
  switch (played.outcome) {
    case 'reply':
      return `${answerer} gets a reply turn to catch ${setter} back.`
    case 'sudden-death':
      return 'Caught back! Sudden death: the next catch wins.'
    case 'win':
      return played.caught ? `${setter} wins.` : `${answerer} dodged the reply and wins.`
    case 'draw':
      return 'No questions left.'
    case 'continue':
      return `${answerer} sets next.`
  }
}

export function RevealScreen({ view, played, onNext }: Props) {
  const [phase, setPhase] = useState<'down' | 'flipping' | 'revealed'>('down')
  const nextRef = useRef<HTMLButtonElement>(null)
  const setter = nameOf(view, played.setter)
  const answerer = nameOf(view, otherRole(played.setter))
  const ends = played.outcome === 'win' || played.outcome === 'draw'

  useEffect(() => {
    if (phase === 'down') {
      // One frame face down first, so the card visibly turns over.
      const frame = requestAnimationFrame(() => setPhase('flipping'))
      return () => cancelAnimationFrame(frame)
    }
    if (phase === 'flipping') {
      const t = setTimeout(() => setPhase('revealed'), FLIP_MS)
      return () => clearTimeout(t)
    }
    nextRef.current?.focus()
    ;(played.caught ? playOut : playSafe)()
    // `played` is fixed for this screen: the parent keys it by turn.
  }, [phase])

  const revealed = phase === 'revealed'

  return (
    <section className="screen play">
      <header className="question">
        <p className="question-number">Turn {played.turn}</p>
        <h2 className="prompt">{questionById(played.questionId)?.prompt}</h2>
      </header>

      <div className="table">
        <span aria-hidden="true" />
        <FlipCard
          thinking={false}
          flipped={phase !== 'down'}
          guess={answerName(played.questionId, played.prediction)}
          guessLabel={`${setter} predicted`}
        />
        <div className={`your-answer${revealed ? ' shown' : ''}`}>
          <span className="label">{answerer} said</span>
          <span className="value">{played.answer ? answerName(played.questionId, played.answer) : 'Nothing'}</span>
        </div>
      </div>

      {revealed && (
        <div className={`verdict ${played.caught ? 'out' : 'safe'}`}>
          <p className="verdict-word">{played.caught ? 'Caught' : 'Safe'}</p>
          <p className="verdict-detail">
            {played.answer === null ? "Time's up. " : ''}
            {outcomeLine(played, setter, answerer)}
          </p>
          <button ref={nextRef} className="btn btn-primary" onClick={onNext}>
            {ends ? 'See result' : 'Next turn'}
          </button>
        </div>
      )}
    </section>
  )
}

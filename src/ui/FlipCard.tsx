interface Props {
  thinking: boolean
  flipped: boolean
  guess: string
}

/** The app's face-down commitment. The guess is in the DOM only once the card flips. */
export function FlipCard({ thinking, flipped, guess }: Props) {
  return (
    <div className={`card${flipped ? ' flipped' : ''}${thinking ? ' thinking' : ''}`} aria-live="polite">
      <div className="card-inner">
        <div className="card-face card-back" aria-hidden={flipped}>
          <span className="card-mark">?</span>
          <span className="card-label">{thinking ? 'Thinking…' : 'Locked in'}</span>
        </div>
        <div className="card-face card-front" aria-hidden={!flipped}>
          <span className="card-label">I guessed</span>
          <span className="card-guess">{flipped ? guess : ''}</span>
        </div>
      </div>
    </div>
  )
}

import { describeRead } from '../engine/predictor'
import type { Career, Read } from '../engine/predictor'
import type { Streak } from '../storage'

interface Props {
  streak: Streak
  career?: Career
  onPlay: () => void
}

const STYLE_LABELS: Record<Read, string> = {
  mainstream: 'Mainstream',
  mixed: 'Mixed',
  'deep-cut': 'Deep-cut',
}

export function StartScreen({ streak, career, onPlay }: Props) {
  return (
    <section className="screen start">
      <div className="logo" aria-hidden="true">
        <span className="logo-card">?</span>
      </div>
      <h1 className="title">In or Out</h1>
      <p className="pitch">Answer 5 questions. Don't let the app guess you.</p>

      <button className="btn btn-primary" onClick={onPlay} autoFocus>
        Play
      </button>

      <dl className="streaks">
        <div>
          <dt>Streak</dt>
          <dd>{streak.current}</dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd>{streak.best}</dd>
        </div>
        {career && (
          <div>
            <dt>Your style</dt>
            <dd>{STYLE_LABELS[describeRead(career.niche)]}</dd>
          </div>
        )}
      </dl>

      <ol className="how">
        <li>Before you answer, the app locks in its guess face down.</li>
        <li>If it matches your answer, you're out.</li>
        <li>It learns how you play, so the obvious and the obscure both get risky.</li>
      </ol>
    </section>
  )
}

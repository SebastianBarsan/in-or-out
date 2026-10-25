import { describeRead } from '../engine/predictor'
import type { Read } from '../engine/predictor'
import type { Streak } from '../storage'
import type { Turn } from './turn'

interface Props {
  turns: Turn[]
  total: number
  streak: Streak
  onPlayAgain: () => void
}

const READ_PHRASES: Record<Read, string> = {
  mainstream: 'I had you down as a mainstream player.',
  mixed: "I couldn't decide if you were mainstream or a deep-cut player.",
  'deep-cut': 'I had you down as a deep-cut player.',
}

/** One line on how the model read the player, e.g. "After Q2 I had you down as a deep-cut player." */
export function modelReadLine(turns: Turn[]): string {
  if (turns.length === 0) return ''
  if (turns.length === 1 && turns[0].caught) return "You went with the one I expected. I didn't even need a read on you."

  const reads = turns.map((t) => describeRead(t.nicheAfter))
  const final = reads[reads.length - 1]
  let since = reads.length - 1
  while (since > 0 && reads[since - 1] === final) since--
  return `After Q${since + 1} ${READ_PHRASES[final]}`
}

export function ResultScreen({ turns, total, streak, onPlayAgain }: Props) {
  const out = turns.some((t) => t.caught)

  return (
    <section className="screen result">
      <p className={`outcome ${out ? 'out' : 'in'}`}>{out ? 'OUT' : 'IN'}</p>
      <p className="outcome-detail">
        {out ? `Caught on question ${turns.length}.` : `You survived all ${total} questions.`}
      </p>

      <p className="read-line">“{modelReadLine(turns)}”</p>

      <ol className="recap">
        {turns.map((t, i) => (
          <li key={t.question.id} className={t.caught ? 'caught' : 'safe'}>
            <span className="recap-q">
              Q{i + 1} · {t.question.prompt}
            </span>
            <span className="recap-pair">
              <span>
                <span className="recap-label">You</span> {t.answer.name}
              </span>
              <span>
                <span className="recap-label">Me</span> {t.guess.name}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <dl className="streaks">
        <div>
          <dt>Streak</dt>
          <dd>{streak.current}</dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd>{streak.best}</dd>
        </div>
      </dl>

      <button className="btn btn-primary" onClick={onPlayAgain} autoFocus>
        Play again
      </button>
    </section>
  )
}

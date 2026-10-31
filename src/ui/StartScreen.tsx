import { useState } from 'react'
import { describeRead } from '../engine/predictor'
import type { Career, Read } from '../engine/predictor'
import type { Streak } from '../storage'
import { CreateGame } from './h2h/CreateGame'

interface Props {
  streak: Streak
  career?: Career
  onPlay: () => void
  onGameCreated: (gameId: string) => void
}

const STYLE_LABELS: Record<Read, string> = {
  mainstream: 'Mainstream',
  mixed: 'Mixed',
  'deep-cut': 'Deep-cut',
}

export function StartScreen({ streak, career, onPlay, onGameCreated }: Props) {
  const [tab, setTab] = useState<'solo' | 'friends'>('solo')

  return (
    <section className="screen start">
      <div className="logo" aria-hidden="true">
        <span className="logo-card">?</span>
      </div>
      <h1 className="title">In or Out</h1>

      <div className="tabs" role="tablist" aria-label="Game mode">
        <button type="button" role="tab" aria-selected={tab === 'solo'} className="tab" onClick={() => setTab('solo')}>
          Solo
        </button>
        <button type="button" role="tab" aria-selected={tab === 'friends'} className="tab" onClick={() => setTab('friends')}>
          Compete with friends
        </button>
      </div>

      {tab === 'solo' ? (
        <>
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
        </>
      ) : (
        <>
          <p className="pitch">Set a question. Predict your friend's answer. Catch them to win.</p>

          <CreateGame onCreated={onGameCreated} />

          <ol className="how">
            <li>Take turns picking a question and secretly predicting your friend's answer.</li>
            <li>They get 10 seconds to answer. If it matches, you caught them.</li>
            <li>Setting first is an edge, so a catch by the first setter earns a reply turn.</li>
          </ol>
        </>
      )}
    </section>
  )
}

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { GameView } from '../../h2h/api'
import { nameOf, otherRole } from './lookup'

interface Props {
  view: GameView
  leave: ReactNode
  onRematch: () => Promise<void>
}

export function ResultScreen({ view, leave, onRematch }: Props) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const won = view.winner !== null && view.winner === view.you
  const opponent = view.you ? nameOf(view, otherRole(view.you)) : ''

  const rematch = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await onRematch()
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <section className="screen result">
      <p className={`outcome h2h-outcome ${view.winner === null ? 'draw' : won ? 'in' : 'out'}`}>
        {view.winner === null ? 'Draw' : `${nameOf(view, view.winner)} wins`}
      </p>
      <p className="outcome-detail">
        {view.history.length} {view.history.length === 1 ? 'turn' : 'turns'} played
      </p>
      {view.rematchId && (
        <p className="pitch" role="status">
          {opponent} is up for a rematch.
        </p>
      )}
      <button className="btn btn-primary" onClick={rematch} disabled={busy} autoFocus>
        {view.rematchId ? 'Join rematch' : 'Rematch'}
      </button>
      <p className="error" role="alert">
        {failed ? "Couldn't reach the game — try again" : ''}
      </p>
      {leave}
    </section>
  )
}

import { QUESTIONS } from '../../data'
import { answerIds, drawPool } from '../../engine/headToHead'
import { createRng, randomSeed } from '../../engine/rng'
import { createGame, isConfigured } from '../../h2h/api'
import { saveSeatToken } from '../../storage'
import { NameForm } from './NameForm'

export function CreateGame({ onCreated }: { onCreated: (gameId: string) => void }) {
  if (!isConfigured) return <p className="h2h-note">Head-to-head isn't set up on this site yet.</p>

  return (
    <NameForm
      submitLabel="Create game"
      submit={async (name) => {
        const seat = await createGame(name, drawPool(QUESTIONS, createRng(randomSeed())), answerIds(QUESTIONS))
        saveSeatToken(seat.id, seat.token)
        onCreated(seat.id)
      }}
    />
  )
}

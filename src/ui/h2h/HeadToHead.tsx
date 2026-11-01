import { useState } from 'react'
import type { ReactNode } from 'react'
import { QUESTIONS } from '../../data'
import { answerIds, drawPool } from '../../engine/headToHead'
import { createRng, randomSeed } from '../../engine/rng'
import {
  isConfigured,
  joinGame,
  lockPrediction,
  pickQuestion,
  rematch,
  setterTimeout,
  startAnswer,
  startChoosing,
  submitAnswer,
} from '../../h2h/api'
import { useGame } from '../../h2h/useGame'
import { loadSeatToken, loadSeenReveals, saveSeatToken, saveSeenReveals } from '../../storage'
import { AnswerScreen } from './AnswerScreen'
import { ChooseScreen } from './ChooseScreen'
import { Lobby } from './Lobby'
import { nameOf, otherRole } from './lookup'
import { NameForm } from './NameForm'
import { PredictScreen } from './PredictScreen'
import { ResultScreen } from './ResultScreen'
import { RevealScreen } from './RevealScreen'
import { WaitingScreen } from './WaitingScreen'

interface Props {
  gameId: string
  onLeave: () => void
  onSwitchGame: (gameId: string) => void
}

export function HeadToHead({ gameId, onLeave, onSwitchGame }: Props) {
  const [token, setToken] = useState(() => loadSeatToken(gameId))
  const [seen, setSeen] = useState(() => loadSeenReveals(gameId))
  const { view, missing, offline, move, nudge } = useGame(gameId, token)

  const leave = (
    <button className="btn btn-quiet" onClick={onLeave}>
      Back to start
    </button>
  )
  const notice = (message: string, action: ReactNode = leave) => (
    <section className="screen h2h">
      <p className="pitch">{message}</p>
      {action}
    </section>
  )

  if (!isConfigured) return notice("Head-to-head isn't set up on this site yet.")
  if (missing) return notice("That game doesn't exist. Check the link with whoever sent it.")
  if (!view) return notice(offline ? "Can't reach the game. Still trying…" : 'Loading the game…')

  if (!view.you || !token) {
    if (view.status !== 'lobby') return notice('This game already has two players.')
    return (
      <section className="screen h2h">
        <h2 className="prompt">{view.hostName} challenged you</h2>
        <p className="pitch">Enter your name and the game starts.</p>
        <NameForm
          submitLabel="Join game"
          submit={async (name) => {
            const seat = await joinGame(gameId, name)
            saveSeatToken(gameId, seat.token)
            setToken(seat.token)
            nudge()
          }}
        />
        {leave}
      </section>
    )
  }

  const opponent = nameOf(view, otherRole(view.you))
  const unseen = view.history[seen]

  const screen = () => {
    if (view.status === 'lobby') return <Lobby gameId={gameId} leave={leave} />
    // Reveals come first, so a player reads the last turn even if the next one has already begun.
    if (unseen) {
      return (
        <RevealScreen
          key={unseen.turn}
          view={view}
          played={unseen}
          onNext={() => {
            saveSeenReveals(gameId, seen + 1)
            setSeen(seen + 1)
          }}
        />
      )
    }
    if (view.status === 'finished') {
      return (
        <ResultScreen
          view={view}
          leave={leave}
          onRematch={async () => {
            const { id } = await rematch(gameId, token, drawPool(QUESTIONS, createRng(randomSeed())), answerIds(QUESTIONS))
            saveSeatToken(id, token)
            nudge()
            onSwitchGame(id)
          }}
        />
      )
    }
    if (view.setter !== view.you) {
      if (view.status === 'choosing') return <WaitingScreen view={view} text={`${opponent} is choosing…`} leave={leave} />
      return (
        <AnswerScreen
          key={view.turn}
          view={view}
          start={() => move(() => startAnswer(gameId, token, view.turn))}
          submit={(answer) => move(() => submitAnswer(gameId, token, view.turn, answer))}
        />
      )
    }
    if (view.status === 'answering') return <WaitingScreen view={view} text={`${opponent} is answering…`} leave={leave} />
    const timeout = () => void move(() => setterTimeout(gameId, token, view.turn))
    const { questionId } = view
    if (questionId) {
      return (
        <PredictScreen
          key={view.turn}
          questionId={questionId}
          opponent={opponent}
          msLeft={view.msLeft ?? 0}
          onLock={(prediction) => move(() => lockPrediction(gameId, token, view.turn, questionId, prediction))}
          onTimeout={timeout}
        />
      )
    }
    return (
      <ChooseScreen
        key={view.turn}
        view={view}
        start={() => move(() => startChoosing(gameId, token, view.turn))}
        onChoose={(picked) => move(() => pickQuestion(gameId, token, view.turn, picked))}
        onTimeout={timeout}
      />
    )
  }

  return (
    <>
      {offline && (
        <p className="h2h-offline" role="status">
          Connection lost. Trying again…
        </p>
      )}
      {screen()}
    </>
  )
}

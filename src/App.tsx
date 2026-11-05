import { useState } from 'react'
import { HeadToHead } from './ui/h2h/HeadToHead'
import { StartScreen } from './ui/StartScreen'
import { QuestionScreen } from './ui/QuestionScreen'
import { ResultScreen } from './ui/ResultScreen'
import { useSoloRound } from './ui/useSoloRound'

export function App() {
  const solo = useSoloRound()
  // A head-to-head game lives in the URL, so the link is both the invite and the way back in.
  const [gameId, setGameId] = useState(() => new URLSearchParams(location.search).get('game'))

  const openGame = (id: string | null) => {
    const url = new URL(location.href)
    if (id) url.searchParams.set('game', id)
    else url.searchParams.delete('game')
    history.replaceState(null, '', url)
    setGameId(id)
  }

  if (gameId) {
    return (
      <main className="app">
        <HeadToHead key={gameId} gameId={gameId} onLeave={() => openGame(null)} onSwitchGame={openGame} />
      </main>
    )
  }

  const { screen, streak, career, round, turns, current } = solo
  return (
    <main className="app">
      {screen === 'start' && <StartScreen streak={streak} career={career} onPlay={solo.start} onGameCreated={openGame} />}
      {screen === 'play' && current && (
        <QuestionScreen
          key={round[current.index].id}
          question={round[current.index]}
          index={current.index}
          total={round.length}
          guess={current.guess}
          turns={turns}
          onAnswer={solo.answer}
          onTimeout={solo.timeout}
          onNext={solo.next}
        />
      )}
      {screen === 'result' && <ResultScreen turns={turns} total={round.length} streak={streak} onPlayAgain={solo.start} />}
    </main>
  )
}

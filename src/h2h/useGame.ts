import { useCallback, useEffect, useRef, useState } from 'react'
import { getGame, listen } from './api'
import type { GameView } from './api'

const POLL_MS = 3000

/** Keeps one player's view of a game current and runs their moves against it. */
export function useGame(gameId: string, token: string | null) {
  const [view, setView] = useState<GameView | null>(null)
  const [missing, setMissing] = useState(false)
  const [offline, setOffline] = useState(false)
  const latest = useRef(0)
  const moving = useRef(0)
  const channel = useRef<ReturnType<typeof listen> | null>(null)

  const refresh = useCallback(async () => {
    // A read racing a move could land after it and briefly rewind the screen.
    if (moving.current > 0) return
    const request = ++latest.current
    try {
      const next = await getGame(gameId, token)
      if (request !== latest.current) return
      setView(next)
      setOffline(false)
    } catch (e) {
      if (request !== latest.current) return
      const message = e instanceof Error ? e.message : ''
      if (/game not found|invalid input syntax/i.test(message)) setMissing(true)
      else setOffline(true)
    }
  }, [gameId, token])

  useEffect(() => {
    void refresh()
    const poll = setInterval(refresh, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    const live = listen(gameId, () => void refresh())
    channel.current = live
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      live.close()
    }
  }, [gameId, refresh])

  /** Runs a move and shows its result. Returns false if it didn't reach the server. */
  const move = useCallback(async (run: () => Promise<GameView>): Promise<boolean> => {
    moving.current++
    latest.current++
    try {
      const next = await run()
      setView(next)
      setOffline(false)
      channel.current?.nudge()
      return true
    } catch {
      setOffline(true)
      return false
    } finally {
      moving.current--
    }
  }, [])

  const nudge = useCallback(() => channel.current?.nudge(), [])

  return { view, missing, offline, move, nudge }
}

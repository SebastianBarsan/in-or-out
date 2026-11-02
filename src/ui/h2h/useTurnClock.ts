import { useEffect, useRef } from 'react'

/**
 * Asks the server to start a clock, retrying until it has, and returns the time to show on the
 * timer. That time is null until the clock is open.
 */
export function useTurnClock(opened: boolean, msLeft: number | null, start: () => Promise<boolean>): number | null {
  // Only the first reading sets the timer. Later polls would otherwise keep restarting the bar.
  const timerMs = useRef<number | null>(null)
  if (opened && timerMs.current === null) timerMs.current = Math.max(msLeft!, 1)

  // Callers pass a fresh `start` on every render. Reading it from a ref keeps the effect from
  // restarting, and firing an extra request, each time a poll re-renders the screen.
  const startRef = useRef(start)
  startRef.current = start

  const starting = useRef(false)
  useEffect(() => {
    if (opened) return
    // A turn arriving in a background tab mustn't start a clock nobody is watching.
    const open = () => {
      if (document.visibilityState !== 'visible' || starting.current) return
      starting.current = true
      void startRef.current().finally(() => {
        starting.current = false
      })
    }
    open()
    const retry = setInterval(open, 2000)
    document.addEventListener('visibilitychange', open)
    return () => {
      clearInterval(retry)
      document.removeEventListener('visibilitychange', open)
    }
  }, [opened])

  return timerMs.current
}

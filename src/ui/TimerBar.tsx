import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

interface Props {
  durationMs: number
  /** The bar sits full until this turns true, then drains once. */
  running: boolean
  onExpire: () => void
}

// Driven from JS rather than a CSS animation: the reduced-motion rule cuts animations to
// 0.01ms, which would empty the bar instantly, and the countdown is information, not decoration.
export function TimerBar({ durationMs, running, onExpire }: Props) {
  const [left, setLeft] = useState(1)
  const expire = useRef(onExpire)
  expire.current = onExpire

  useEffect(() => {
    if (!running) return
    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const remaining = Math.max(0, 1 - (now - start) / durationMs)
      setLeft(remaining)
      if (remaining === 0) expire.current()
      else frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [running, durationMs])

  const seconds = Math.ceil((left * durationMs) / 1000)
  return (
    <div
      className="timer"
      role="timer"
      aria-label={`${seconds} seconds left`}
      style={{ '--left': left } as CSSProperties}
    >
      <div className="timer-fill" />
    </div>
  )
}

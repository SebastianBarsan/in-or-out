import type { Turn } from './turn'

interface Props {
  total: number
  index: number
  turns: Turn[]
}

export function ProgressDots({ total, index, turns }: Props) {
  return (
    <ol className="dots" aria-label={`Question ${index + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const turn = turns[i]
        const state = turn ? (turn.caught ? 'caught' : 'safe') : i === index ? 'current' : 'upcoming'
        return <li key={i} className={`dot ${state}`} />
      })}
    </ol>
  )
}

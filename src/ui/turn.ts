import type { Answer, Question } from '../engine/types'

/** One answered question in the current round. */
export interface Turn {
  question: Question
  answer: Answer
  guess: Answer
  /** Rank percentile of the player's answer: 0 = most common, 1 = most obscure. */
  rank: number
  caught: boolean
  /** The model's niche score for the player after this answer. */
  nicheAfter: number
}

import type { Answer, Question, Rng } from './types'
import { rankPercentiles } from './predictor'
import { shuffle } from './rng'

/** The share of a question's answers, most common first, that its example comes from. */
export const EXAMPLE_SHARE = 0.25

/**
 * The questions one game draws its turns from, sorted by answer count. Each turn the server
 * offers 3 from its own slice of this order, working down from the biggest questions.
 */
export function drawPool(questions: readonly Question[], rng: Rng): string[] {
  return shuffle(questions, rng)
    .sort((a, b) => a.answers.length - b.answers.length)
    .map((q) => q.id)
}

/** An answer to show the setter as an example, picked from the question's more common ones. */
export function exampleAnswer(question: Question, rng: Rng): Answer {
  const ranks = rankPercentiles(question)
  const sorted = [...question.answers].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!)
  const common = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * EXAMPLE_SHARE)))
  return common[Math.floor(rng() * common.length)]
}

/** Turns a string into an RNG seed (FNV-1a), so a preview stays the same across refreshes. */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  }
  return hash >>> 0
}

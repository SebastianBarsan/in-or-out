import type { Answer, Question, Rng } from './types'
import { rankPercentiles } from './predictor'
import { shuffle } from './rng'

/** Settings from the design doc. The choices per turn and the 10 s timer live on the server. */
export const POOL_SIZE = 10
export const PREVIEW_SIZE = 6

/** The questions one game draws its turns from. */
export function drawPool(questions: readonly Question[], rng: Rng, size = POOL_SIZE): string[] {
  return shuffle(questions, rng)
    .slice(0, size)
    .map((q) => q.id)
}

/**
 * The setter's sample of a question's answers: 2 common, 2 mid and 2 obscure, shuffled so the
 * setter has to judge popularity themselves. Smaller questions show everything they have.
 */
export function previewAnswers(question: Question, rng: Rng, size = PREVIEW_SIZE): Answer[] {
  if (question.answers.length <= size) return shuffle(question.answers, rng)
  const ranks = rankPercentiles(question)
  const sorted = [...question.answers].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!)
  const third = sorted.length / 3
  const bands = [
    sorted.slice(0, Math.floor(third)),
    sorted.slice(Math.floor(third), Math.floor(2 * third)),
    sorted.slice(Math.floor(2 * third)),
  ]
  return shuffle(bands.flatMap((band) => shuffle(band, rng).slice(0, size / 3)), rng)
}

/** Turns a string into an RNG seed (FNV-1a), so a preview stays the same across refreshes. */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  }
  return hash >>> 0
}

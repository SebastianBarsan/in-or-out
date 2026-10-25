import type { Question, Rng } from './types'
import { TIERS } from './types'
import { shuffle } from './rng'

/**
 * Pick one question per tier (XL → XS) so that no two share a category, using as few
 * questions from `recentIds` as possible. Candidates are shuffled, so the first valid
 * round found is a random one.
 */
export function buildRound(questions: readonly Question[], recentIds: ReadonlySet<string>, rng: Rng): Question[] {
  const byTier = TIERS.map((t) => shuffle(questions.filter((q) => q.tier === t), rng))

  for (let staleAllowed = 0; staleAllowed <= TIERS.length; staleAllowed++) {
    const round = search(byTier, recentIds, staleAllowed)
    if (round) return round
  }
  throw new Error('No valid round: every tier needs a question and categories must not overlap')
}

/** Depth-first search for a round with at most `staleAllowed` recently seen questions. */
function search(byTier: Question[][], recentIds: ReadonlySet<string>, staleAllowed: number): Question[] | null {
  const picked: Question[] = []
  const usedCategories = new Set<string>()

  const walk = (depth: number, stale: number): boolean => {
    if (depth === byTier.length) return true
    for (const q of byTier[depth]) {
      const nextStale = stale + (recentIds.has(q.id) ? 1 : 0)
      if (nextStale > staleAllowed || usedCategories.has(q.category)) continue
      picked.push(q)
      usedCategories.add(q.category)
      if (walk(depth + 1, nextStale)) return true
      picked.pop()
      usedCategories.delete(q.category)
    }
    return false
  }

  return walk(0, 0) ? picked : null
}

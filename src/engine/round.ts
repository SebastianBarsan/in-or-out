import type { Question, Rng, Tier } from './types'
import { TIERS } from './types'
import { shuffle } from './rng'

/**
 * Pick one question per tier (XL → XS) so that no two share a category, preferring
 * questions not in `recentIds`. Among all valid rounds with the most unseen questions,
 * one is chosen at random.
 */
export function buildRound(questions: readonly Question[], recentIds: ReadonlySet<string>, rng: Rng): Question[] {
  const byTier = new Map<Tier, Question[]>(TIERS.map((t) => [t, shuffle(questions.filter((q) => q.tier === t), rng)]))

  let best: Question[][] = []
  let bestFresh = -1

  const walk = (depth: number, picked: Question[], usedCategories: Set<string>, fresh: number) => {
    if (depth === TIERS.length) {
      if (fresh > bestFresh) {
        bestFresh = fresh
        best = [picked]
      } else if (fresh === bestFresh) {
        best.push(picked)
      }
      return
    }
    for (const q of byTier.get(TIERS[depth])!) {
      if (usedCategories.has(q.category)) continue
      usedCategories.add(q.category)
      walk(depth + 1, [...picked, q], usedCategories, fresh + (recentIds.has(q.id) ? 0 : 1))
      usedCategories.delete(q.category)
    }
  }
  walk(0, [], new Set(), 0)

  if (best.length === 0) throw new Error('No valid round: every tier needs a question and categories must not overlap')
  return best[Math.floor(rng() * best.length)]
}

import type { Question } from './types'
import { TIERS, TIER_SIZES } from './types'
import { answerKeys } from './validate'
import { buildRound } from './round'
import { createRng } from './rng'

export interface ContentReport {
  errors: string[]
  /** Deliberately shared aliases, e.g. "roosevelt". The validator asks players to be more specific. */
  ambiguous: string[]
}

/**
 * Catch content mistakes before players see them: tier sizes, duplicate IDs, bad pop values,
 * and aliases that collide with another answer's own name (which would make that answer unreachable).
 * Two answers sharing an alias is allowed and reported as ambiguous.
 */
export function checkQuestions(questions: readonly Question[]): ContentReport {
  const errors: string[] = []
  const ambiguous: string[] = []
  const questionIds = new Set<string>()

  for (const q of questions) {
    const where = `question "${q.id}"`
    if (questionIds.has(q.id)) errors.push(`${where}: duplicate question id`)
    questionIds.add(q.id)

    if (!TIERS.includes(q.tier)) {
      errors.push(`${where}: unknown tier "${q.tier}"`)
      continue
    }
    const [min, max] = TIER_SIZES[q.tier]
    if (q.answers.length < min || q.answers.length > max) {
      errors.push(`${where}: tier ${q.tier} needs ${min}–${max} answers, has ${q.answers.length}`)
    }
    if (!q.prompt.trim()) errors.push(`${where}: empty prompt`)
    if (!q.category.trim()) errors.push(`${where}: empty category`)

    const answerIds = new Set<string>()
    const nameOwner = new Map<string, string>()
    const keyOwners = new Map<string, string[]>()

    for (const a of q.answers) {
      if (answerIds.has(a.id)) errors.push(`${where}: duplicate answer id "${a.id}"`)
      answerIds.add(a.id)
      if (!(a.pop >= 0 && a.pop <= 1)) errors.push(`${where}: "${a.id}" pop must be 0–1, got ${a.pop}`)

      const keys = answerKeys(a)
      if (keys.length === 0) errors.push(`${where}: "${a.id}" has no usable name`)
      const [ownName] = keys
      if (ownName) {
        if (nameOwner.has(ownName)) errors.push(`${where}: "${a.id}" and "${nameOwner.get(ownName)}" have the same name`)
        nameOwner.set(ownName, a.id)
      }
      for (const key of keys) keyOwners.set(key, [...(keyOwners.get(key) ?? []), a.id])
    }

    for (const [key, owners] of keyOwners) {
      if (owners.length < 2) continue
      const namedBy = nameOwner.get(key)
      if (namedBy) {
        const others = owners.filter((id) => id !== namedBy)
        if (others.length) errors.push(`${where}: alias "${key}" on ${others.join(', ')} collides with the name of "${namedBy}"`)
      } else {
        ambiguous.push(`${q.id}: "${key}" → ${owners.join(', ')}`)
      }
    }
  }

  try {
    buildRound(questions, new Set(), createRng(1))
  } catch (e) {
    errors.push((e as Error).message)
  }

  return { errors, ambiguous }
}

import type { Answer, Question } from './types'

export type ValidationResult =
  | { kind: 'ok'; answer: Answer }
  | { kind: 'ambiguous'; candidates: Answer[] }
  | { kind: 'invalid' }

/**
 * Lowercase, strip accents, drop punctuation and a leading "the", collapse spaces.
 * "São Tomé" -> "sao tome", "The Winter's Tale" -> "winters tale".
 */
export function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')
}

/** Every normalised string that should resolve to this answer. */
export function answerKeys(answer: Answer): string[] {
  return [...new Set([answer.name, ...(answer.aliases ?? [])].map(normalize).filter(Boolean))]
}

/** Typo budget by input length: exact under 5 chars, 1 edit for 5–8, 2 beyond. */
export function maxTypos(length: number): number {
  if (length < 5) return 0
  if (length <= 8) return 1
  return 2
}

/** Damerau–Levenshtein distance (optimal string alignment variant). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j < cols; j++) d[0][j] = j

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}

export function validateAnswer(question: Question, input: string): ValidationResult {
  const text = normalize(input)
  if (!text) return { kind: 'invalid' }

  const keyed = question.answers.map((answer) => ({ answer, keys: answerKeys(answer) }))

  const exact = keyed.filter(({ keys }) => keys.includes(text)).map(({ answer }) => answer)
  if (exact.length === 1) return { kind: 'ok', answer: exact[0] }
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact }

  const budget = maxTypos(text.length)
  if (budget === 0) return { kind: 'invalid' }

  let best = Infinity
  let closest: Answer[] = []
  for (const { answer, keys } of keyed) {
    const distance = Math.min(...keys.map((key) => editDistance(text, key)))
    if (distance > budget) continue
    if (distance < best) {
      best = distance
      closest = [answer]
    } else if (distance === best) {
      closest.push(answer)
    }
  }

  if (closest.length === 1) return { kind: 'ok', answer: closest[0] }
  if (closest.length > 1) return { kind: 'ambiguous', candidates: closest }
  return { kind: 'invalid' }
}

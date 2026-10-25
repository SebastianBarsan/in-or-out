import type { Answer, Question, Rng } from './types'

/** Tuning knobs from the design doc. */
export interface PredictorConfig {
  /** Sampling temperature. Higher = more random, easier to beat. */
  temperature: number
  /** Prior niche score, counted as one observation. */
  priorNiche: number
  /** Minimum spread, so the model never aims infinitely tight. */
  spreadFloor: number
  /** Extra weight each later answer gets over the one before it. */
  recencyStep: number
  /** Confidence after k answers. */
  confidence: (k: number) => number
}

export const DEFAULT_CONFIG: PredictorConfig = {
  temperature: 0.7,
  priorNiche: 0.25,
  spreadFloor: 0.15,
  recencyStep: 0.25,
  confidence: (k) => k / (k + 1),
}

/** What the model has learned about the player this round. */
export interface Profile {
  /** Rank percentile of each accepted answer so far, in order. */
  ranks: number[]
}

export const emptyProfile = (): Profile => ({ ranks: [] })

export function recordAnswer(profile: Profile, rank: number): Profile {
  return { ranks: [...profile.ranks, rank] }
}

/**
 * Rank percentile of every answer in a question: 0 = most common, 1 = most obscure.
 * Ties in `pop` keep their order in the file.
 */
export function rankPercentiles(question: Question): Map<string, number> {
  const sorted = question.answers
    .map((answer, index) => ({ answer, index }))
    .sort((a, b) => b.answer.pop - a.answer.pop || a.index - b.index)
  const last = Math.max(sorted.length - 1, 1)
  return new Map(sorted.map(({ answer }, i) => [answer.id, i / last]))
}

/** Weighted mean of recorded ranks, pulled toward the prior; later answers weigh a little more. */
export function nicheScore(profile: Profile, config = DEFAULT_CONFIG): number {
  let total = config.priorNiche
  let weight = 1
  profile.ranks.forEach((r, i) => {
    const w = 1 + config.recencyStep * i
    total += w * r
    weight += w
  })
  return total / weight
}

/** Standard deviation of recorded ranks, never below the floor. */
export function spread(profile: Profile, config = DEFAULT_CONFIG): number {
  const { ranks } = profile
  if (ranks.length < 2) return config.spreadFloor
  const mean = ranks.reduce((s, r) => s + r, 0) / ranks.length
  const variance = ranks.reduce((s, r) => s + (r - mean) ** 2, 0) / ranks.length
  return Math.max(Math.sqrt(variance), config.spreadFloor)
}

/** w(a) = (1 - c)·pop(a) + c·exp(-(r(a) - N)² / 2σ²) */
export function answerWeights(
  question: Question,
  profile: Profile,
  config = DEFAULT_CONFIG,
): { answer: Answer; weight: number }[] {
  const ranks = rankPercentiles(question)
  const c = config.confidence(profile.ranks.length)
  const n = nicheScore(profile, config)
  const s = spread(profile, config)
  return question.answers.map((answer) => {
    const r = ranks.get(answer.id)!
    const fit = Math.exp(-((r - n) ** 2) / (2 * s * s))
    return { answer, weight: (1 - c) * answer.pop + c * fit }
  })
}

/** Sample the app's guess with probability ∝ w^(1/T). Call once per question and keep the result. */
export function chooseGuess(question: Question, profile: Profile, rng: Rng, config = DEFAULT_CONFIG): Answer {
  const weighted = answerWeights(question, profile, config).map(({ answer, weight }) => ({
    answer,
    p: Math.pow(weight, 1 / config.temperature),
  }))
  const total = weighted.reduce((s, x) => s + x.p, 0)
  let roll = rng() * total
  for (const { answer, p } of weighted) {
    roll -= p
    if (roll < 0) return answer
  }
  return weighted[weighted.length - 1].answer
}

export type Read = 'mainstream' | 'mixed' | 'deep-cut'

/** Plain-language label for a niche score, used in the recap. */
export function describeRead(niche: number): Read {
  if (niche < 0.35) return 'mainstream'
  if (niche < 0.55) return 'mixed'
  return 'deep-cut'
}

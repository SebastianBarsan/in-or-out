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
  /** How much each older round counts relative to the one after it. */
  careerDecay: number
  /** Rounds of history at which the career read reaches half its full strength. */
  careerHalfRounds: number
  /** Most observations the career read can count as at the start of a round. */
  careerMaxWeight: number
  /** Most answers' worth of confidence the career read can add before Q1. */
  careerMaxHeadStart: number
}

export const DEFAULT_CONFIG: PredictorConfig = {
  temperature: 0.7,
  priorNiche: 0.25,
  spreadFloor: 0.15,
  recencyStep: 0.25,
  confidence: (k) => k / (k + 1),
  careerDecay: 0.9,
  careerHalfRounds: 3,
  careerMaxWeight: 3,
  careerMaxHeadStart: 1,
}

/** What the model carries over about the player from earlier rounds. */
export interface Career {
  /** Long-run niche score, used as this round's prior. */
  niche: number
  /** Long-run spread, used until the round has its own. */
  spread: number
  /** How many observations the prior counts as. */
  weight: number
  /** Answers' worth of confidence the model starts the round with. */
  headStart: number
}

/** What the model has learned about the player this round. */
export interface Profile {
  /** Rank percentile of each accepted answer so far, in order. */
  ranks: number[]
  /** Read from earlier rounds; absent for a new player. */
  career?: Career
}

export const emptyProfile = (career?: Career): Profile => ({ ranks: [], career })

export function recordAnswer(profile: Profile, rank: number): Profile {
  return { ...profile, ranks: [...profile.ranks, rank] }
}

/**
 * Builds the career read from past rounds' answer ranks, oldest first.
 * Recent rounds count more, so a player who changes style is followed within a dozen or so rounds.
 */
export function careerFromHistory(history: number[][], config = DEFAULT_CONFIG): Career | undefined {
  let total = config.priorNiche
  let weight = 1
  let squares = config.priorNiche ** 2
  let rounds = 0
  history.forEach((ranks, i) => {
    const w = config.careerDecay ** (history.length - 1 - i)
    if (ranks.length > 0) rounds += w
    for (const r of ranks) {
      total += w * r
      squares += w * r * r
      weight += w
    }
  })
  if (rounds === 0) return undefined

  const niche = total / weight
  const spread = Math.max(Math.sqrt(Math.max(squares / weight - niche ** 2, 0)), config.spreadFloor)
  const strength = rounds / (rounds + config.careerHalfRounds)
  // An erratic history says little about the next answer, so it earns no head start.
  // 0.5 is the spread of a player who swings between the two extremes.
  const consistency = Math.max(0, 1 - (spread - config.spreadFloor) / (0.5 - config.spreadFloor))
  return {
    niche,
    spread,
    weight: 1 + (config.careerMaxWeight - 1) * strength,
    headStart: config.careerMaxHeadStart * strength * consistency,
  }
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

/**
 * Weighted mean of recorded ranks, pulled toward the prior (the career read if there is one);
 * later answers weigh a little more.
 */
export function nicheScore(profile: Profile, config = DEFAULT_CONFIG): number {
  const { career } = profile
  let weight = career?.weight ?? 1
  let total = (career?.niche ?? config.priorNiche) * weight
  profile.ranks.forEach((r, i) => {
    const w = 1 + config.recencyStep * i
    total += w * r
    weight += w
  })
  return total / weight
}

/** Standard deviation of recorded ranks, blended with the career spread, never below the floor. */
export function spread(profile: Profile, config = DEFAULT_CONFIG): number {
  const { ranks, career } = profile
  const prior = career?.spread ?? config.spreadFloor
  if (ranks.length < 2) return Math.max(prior, config.spreadFloor)
  const mean = ranks.reduce((s, r) => s + r, 0) / ranks.length
  let variance = ranks.reduce((s, r) => s + (r - mean) ** 2, 0) / ranks.length
  if (career) variance = (career.weight * prior ** 2 + ranks.length * variance) / (career.weight + ranks.length)
  return Math.max(Math.sqrt(variance), config.spreadFloor)
}

/** w(a) = (1 - c)·pop(a) + c·exp(-(r(a) - N)² / 2σ²) */
export function answerWeights(
  question: Question,
  profile: Profile,
  config = DEFAULT_CONFIG,
): { answer: Answer; weight: number }[] {
  const ranks = rankPercentiles(question)
  const c = config.confidence(profile.ranks.length + (profile.career?.headStart ?? 0))
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

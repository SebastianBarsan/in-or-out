export type Tier = 'XL' | 'L' | 'M' | 'S' | 'XS'

export const TIERS: readonly Tier[] = ['XL', 'L', 'M', 'S', 'XS']

/** Valid answer-count range for each tier (inclusive). */
export const TIER_SIZES: Record<Tier, readonly [number, number]> = {
  XL: [30, 55],
  L: [13, 25],
  M: [8, 12],
  S: [5, 7],
  XS: [3, 4],
}

export interface Answer {
  id: string
  name: string
  aliases?: string[]
  /** Hand-set popularity, 0–1. Relative order matters more than the exact value. */
  pop: number
}

export interface Question {
  id: string
  prompt: string
  tier: Tier
  category: string
  answers: Answer[]
}

/** Returns a float in [0, 1). */
export type Rng = () => number

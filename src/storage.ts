// Everything persisted in localStorage. Reads and writes never throw: private windows and
// blocked storage just mean the game forgets between sessions.

const KEYS = {
  streak: 'in-or-out:streak',
  recent: 'in-or-out:recent-rounds',
  log: 'in-or-out:round-log',
}

const RECENT_ROUNDS = 3
const LOG_LIMIT = 200

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : (JSON.parse(value) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable: carry on without it.
  }
}

export interface Streak {
  current: number
  best: number
}

export function loadStreak(): Streak {
  return read<Streak>(KEYS.streak, { current: 0, best: 0 })
}

export function saveStreak(streak: Streak): void {
  write(KEYS.streak, streak)
}

/** Question IDs from the player's last few rounds. */
export function loadRecentIds(): Set<string> {
  return new Set(read<string[][]>(KEYS.recent, []).flat())
}

export function rememberRound(questionIds: string[]): void {
  const rounds = read<string[][]>(KEYS.recent, [])
  write(KEYS.recent, [...rounds, questionIds].slice(-RECENT_ROUNDS))
}

/** One finished round, kept locally for tuning the predictor. */
export interface RoundLog {
  at: string
  outcome: 'in' | 'out'
  /** `answer` and `rank` are null when the player ran out of time. */
  turns: { question: string; answer: string | null; rank: number | null; guess: string; caught: boolean }[]
}

export function logRound(entry: RoundLog): void {
  write(KEYS.log, [...read<RoundLog[]>(KEYS.log, []), entry].slice(-LOG_LIMIT))
}

/** Answer ranks from each logged round, oldest first. */
export function loadRankHistory(): number[][] {
  const log = read<RoundLog[]>(KEYS.log, [])
  return Array.isArray(log) ? log.map((round) => (round.turns ?? []).map((t) => t.rank).filter((r): r is number => Number.isFinite(r))) : []
}

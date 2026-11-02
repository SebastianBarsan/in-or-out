// Everything persisted in localStorage. Reads and writes never throw: private windows and
// blocked storage just mean the game forgets between sessions.

const KEYS = {
  streak: 'in-or-out:streak',
  recent: 'in-or-out:recent-rounds',
  log: 'in-or-out:round-log',
  seats: 'in-or-out:h2h-seats',
  name: 'in-or-out:h2h-name',
  inProgress: 'in-or-out:round-in-progress',
}

const RECENT_ROUNDS = 3
const LOG_LIMIT = 200
const SEATS_LIMIT = 20

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

function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage unavailable: nothing was saved to remove.
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

/** The round still being played: the turns answered so far, saved from the moment it starts. */
export type RoundInProgress = Omit<RoundLog, 'outcome'>

export function saveRoundInProgress(entry: RoundInProgress): void {
  write(KEYS.inProgress, entry)
}

export function clearRoundInProgress(): void {
  remove(KEYS.inProgress)
}

/**
 * A round that was never finished, because the page was refreshed or closed mid-round, counts as
 * an OUT. Otherwise reloading on a hard question would dodge it. Run once when the app loads.
 */
export function settleAbandonedRound(): void {
  const entry = read<RoundInProgress | null>(KEYS.inProgress, null)
  if (!entry) return
  clearRoundInProgress()
  saveStreak({ ...loadStreak(), current: 0 })
  logRound({ at: entry.at, outcome: 'out', turns: Array.isArray(entry.turns) ? entry.turns : [] })
}

/** A head-to-head seat on this device, so refreshing or reopening the link gets back in. */
interface Seat {
  token: string
  /** How many of the game's reveals this device has already shown. */
  seen: number
}

function loadSeats(): Record<string, Seat> {
  return read<Record<string, Seat>>(KEYS.seats, {})
}

function saveSeat(gameId: string, seat: Seat): void {
  // Insertion order is oldest first, so the slice drops the games played longest ago.
  const others = Object.entries(loadSeats()).filter(([id]) => id !== gameId)
  write(KEYS.seats, Object.fromEntries([...others, [gameId, seat]].slice(-SEATS_LIMIT)))
}

export function loadSeatToken(gameId: string): string | null {
  return loadSeats()[gameId]?.token ?? null
}

export function saveSeatToken(gameId: string, token: string): void {
  saveSeat(gameId, { token, seen: 0 })
}

export function loadSeenReveals(gameId: string): number {
  return loadSeats()[gameId]?.seen ?? 0
}

export function saveSeenReveals(gameId: string, seen: number): void {
  const seat = loadSeats()[gameId]
  if (seat) saveSeat(gameId, { ...seat, seen })
}

export function loadPlayerName(): string {
  return read<string>(KEYS.name, '')
}

export function savePlayerName(name: string): void {
  write(KEYS.name, name)
}

/** Answer ranks from each logged round, oldest first. */
export function loadRankHistory(): number[][] {
  const log = read<RoundLog[]>(KEYS.log, [])
  return Array.isArray(log) ? log.map((round) => (round.turns ?? []).map((t) => t.rank).filter((r): r is number => Number.isFinite(r))) : []
}

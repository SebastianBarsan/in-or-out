// The only code that talks to the backend. The client library loads on demand, so Solo players
// never download it and the game still runs with no backend configured.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { statsPlayerId } from '../stats'

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(URL_ && KEY)

export type Role = 'host' | 'guest'

export interface PlayedTurn {
  turn: number
  setter: Role
  questionId: string
  prediction: string
  /** Null when the clock ran out. */
  answer: string | null
  caught: boolean
  outcome: 'continue' | 'reply' | 'sudden-death' | 'win' | 'draw'
}

/** One player's view of a game. Someone who hasn't joined gets only the first four fields. */
export interface GameView {
  id: string
  status: 'lobby' | 'choosing' | 'answering' | 'finished'
  you: Role | null
  hostName: string
  guestName: string | null
  setter: Role
  turn: number
  poolSize: number
  suddenDeath: boolean
  winner: Role | null
  history: PlayedTurn[]
  rematchId: string | null
  /** Setter only, while choosing. */
  choices: string[]
  /** Setter once picked; answerer once their clock is running. */
  questionId: string | null
  /** Setter only, and not until it's locked. The answerer sees it in `history` after the turn. */
  prediction: string | null
  answering: boolean
  /** Only for the player whose clock is running. Relative rather than a timestamp, so device clocks don't matter. */
  msLeft: number | null
}

export interface Seat {
  id: string
  token: string
}

let client: Promise<SupabaseClient> | null = null

function connect(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } }),
  )
  return client
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await connect()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const createGame = (name: string, pool: string[], answers: Record<string, string[]>) =>
  rpc<Seat>('h2h_create_game', { p_name: name, p_pool: pool, p_answers: answers, p_player: statsPlayerId() })

export const joinGame = (game: string, name: string) =>
  rpc<Seat>('h2h_join_game', { p_game: game, p_name: name, p_player: statsPlayerId() })

export const getGame = (game: string, token: string | null) =>
  rpc<GameView>('h2h_get_game', { p_game: game, p_token: token })

export const startChoosing = (game: string, token: string, turn: number) =>
  rpc<GameView>('h2h_start_choosing', { p_game: game, p_token: token, p_turn: turn })

export const pickQuestion = (game: string, token: string, turn: number, question: string) =>
  rpc<GameView>('h2h_pick_question', { p_game: game, p_token: token, p_turn: turn, p_question: question })

/** The setter's clock ran out. The server fills in whatever is missing at random. */
export const setterTimeout = (game: string, token: string, turn: number) =>
  rpc<GameView>('h2h_setter_timeout', { p_game: game, p_token: token, p_turn: turn })

export const lockPrediction = (game: string, token: string, turn: number, question: string, prediction: string) =>
  rpc<GameView>('h2h_lock_prediction', {
    p_game: game,
    p_token: token,
    p_turn: turn,
    p_question: question,
    p_prediction: prediction,
  })

export const startAnswer = (game: string, token: string, turn: number) =>
  rpc<GameView>('h2h_start_answer', { p_game: game, p_token: token, p_turn: turn })

/** A null answer means the clock ran out. */
export const submitAnswer = (game: string, token: string, turn: number, answer: string | null) =>
  rpc<GameView>('h2h_submit_answer', { p_game: game, p_token: token, p_turn: turn, p_answer: answer })

export const rematch = (game: string, token: string, pool: string[], answers: Record<string, string[]>) =>
  rpc<{ id: string }>('h2h_rematch', { p_game: game, p_token: token, p_pool: pool, p_answers: answers })

/**
 * A nudge between the two devices that something changed. It carries no game data: the receiver
 * re-reads its own filtered view. Returns the sender and a cleanup function.
 */
export function listen(game: string, onNudge: () => void): { nudge: () => void; close: () => void } {
  let channel: RealtimeChannel | null = null
  let closed = false
  void connect()
    .then((supabase) => {
      if (closed) return
      channel = supabase.channel(`h2h:${game}`).on('broadcast', { event: 'nudge' }, onNudge).subscribe()
    })
    .catch(() => {
      // Nudges only make turns arrive faster. Polling still delivers them.
    })
  return {
    nudge: () => void channel?.send({ type: 'broadcast', event: 'nudge', payload: {} }),
    close: () => {
      closed = true
      if (channel) void client?.then((supabase) => supabase.removeChannel(channel!))
    },
  }
}

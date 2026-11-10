// Runs every migration on PGlite and plays head-to-head games as `anon`, checking that each
// finished game lands in stats_private.h2h_games and that the browser can't read it back.
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const DIR = new URL('./migrations/', import.meta.url)
const MIGRATIONS = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(new URL(f, DIR), 'utf8'))
const POOL = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10']
const ANSWERS = JSON.stringify(Object.fromEntries(POOL.map((q) => [q, ['p', 'other']])))

interface View {
  setter: string
  turn: number
  status: string
  winner: string | null
  choices: string[]
}

let db: PGlite

async function call<T = View>(fn: string, ...args: unknown[]): Promise<T> {
  const params = args.map((_, i) => `$${i + 1}`).join(', ')
  return (await db.query<{ r: T }>(`select public.${fn}(${params}) as r`, args)).rows[0].r
}

async function asOwner<T>(sql: string, params: unknown[] = []) {
  await db.exec('reset role')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('set role anon')
  }
}

async function withCountry<T>(country: string, run: () => Promise<T>) {
  await asOwner(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'cf-ipcountry': country })])
  try {
    return await run()
  } finally {
    await asOwner(`select set_config('request.headers', '', false)`)
  }
}

async function playTurn(id: string, tokens: Record<string, string>, answer: string | null) {
  const before = await call('h2h_get_game', id, tokens.host)
  const setter = tokens[before.setter]
  const answerer = before.setter === 'host' ? tokens.guest : tokens.host
  const seen = await call('h2h_get_game', id, setter)
  await call('h2h_lock_prediction', id, setter, seen.turn, seen.choices[0], 'p')
  await call('h2h_start_answer', id, answerer, seen.turn)
  return call('h2h_submit_answer', id, answerer, seen.turn, answer)
}

/** Host catches the guest, guest misses the reply: host wins in two turns. */
async function playHostWin(id: string, tokens: Record<string, string>) {
  await playTurn(id, tokens, 'p')
  return playTurn(id, tokens, 'other')
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec('create role anon nologin; create role authenticated nologin;')
  for (const migration of MIGRATIONS) await db.exec(migration)
  await db.exec('set role anon')
}, 60_000)

describe('head-to-head stats', () => {
  it('logs a finished game with both players', async () => {
    const hostPlayer = crypto.randomUUID()
    const guestPlayer = crypto.randomUUID()
    const host = await withCountry('GB', () =>
      call<{ id: string; token: string }>('h2h_create_game', 'Ann', POOL, ANSWERS, hostPlayer),
    )
    const guest = await withCountry('FR', () => call<{ id: string; token: string }>('h2h_join_game', host.id, 'Bo', guestPlayer))
    const tokens = { host: host.token, guest: guest.token }

    const before = await asOwner('select 1 from stats_private.h2h_games where game_id = $1', [host.id])
    expect(before).toHaveLength(0)

    const end = await playHostWin(host.id, tokens)
    expect(end).toMatchObject({ status: 'finished', winner: 'host' })

    const [row] = await asOwner<Record<string, unknown>>('select * from stats_private.h2h_games where game_id = $1', [host.id])
    expect(row).toMatchObject({
      host_player_id: hostPlayer,
      guest_player_id: guestPlayer,
      host_name: 'Ann',
      guest_name: 'Bo',
      result: 'host',
      winner_name: 'Ann',
      winner_player_id: hostPlayer,
      turns_played: 2,
      catches: 1,
      timeouts: 0,
      sudden_death: false,
      host_country: 'GB',
      guest_country: 'FR',
      rematch_of: null,
    })
    expect(row.duration_ms).toEqual(expect.any(Number))

    // Reading the finished game again doesn't log it twice.
    await call('h2h_get_game', host.id, tokens.host)
    expect(await asOwner('select 1 from stats_private.h2h_games where game_id = $1', [host.id])).toHaveLength(1)
  })

  it('carries player IDs into a rematch and links it to the first game', async () => {
    const hostPlayer = crypto.randomUUID()
    const host = await call<{ id: string; token: string }>('h2h_create_game', 'Ann', POOL, ANSWERS, hostPlayer)
    const guest = await call<{ id: string; token: string }>('h2h_join_game', host.id, 'Bo')
    const tokens = { host: host.token, guest: guest.token }
    await playHostWin(host.id, tokens)

    const { id: next } = await call<{ id: string }>('h2h_rematch', host.id, tokens.host, POOL, ANSWERS)
    // The guest sets first in the rematch, so the same two turns make the guest win.
    const end = await playHostWin(next, tokens)
    expect(end.winner).toBe('guest')

    const [row] = await asOwner<Record<string, unknown>>('select * from stats_private.h2h_games where game_id = $1', [next])
    expect(row).toMatchObject({
      rematch_of: host.id,
      host_player_id: hostPlayer,
      guest_player_id: null,
      result: 'guest',
      winner_name: 'Bo',
    })
  })

  it('still accepts calls without a player ID', async () => {
    const host = await call<{ id: string; token: string }>('h2h_create_game', 'Ann', POOL, ANSWERS)
    const guest = await call<{ id: string; token: string }>('h2h_join_game', host.id, 'Bo')
    await playHostWin(host.id, { host: host.token, guest: guest.token })
    const [row] = await asOwner<{ host_player_id: string | null }>(
      'select host_player_id from stats_private.h2h_games where game_id = $1',
      [host.id],
    )
    expect(row.host_player_id).toBeNull()
  })

  it('never lets the browser read or write the log', async () => {
    await expect(db.query('select * from stats_private.h2h_games')).rejects.toThrow(/permission denied/)
    await expect(db.query('select stats_private.log_h2h_game()')).rejects.toThrow()
  })
})

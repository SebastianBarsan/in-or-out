// Runs the real migration on PGlite (Postgres in WASM), calling the API as the same `anon` role
// a browser gets on Supabase, so permissions are exercised as well as the rules.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const MIGRATION = readFileSync(new URL('./migrations/20261030000000_head_to_head.sql', import.meta.url), 'utf8')
const POOL = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10']

interface View {
  status: string
  you: string | null
  setter: string
  turn: number
  poolSize: number
  suddenDeath: boolean
  winner: string | null
  choices: string[]
  questionId: string | null
  prediction: string | null
  answering: boolean
  msLeft: number | null
  rematchId: string | null
  history: { turn: number; setter: string; questionId: string; prediction: string; answer: string | null; caught: boolean; outcome: string }[]
}

let db: PGlite

async function call<T = View>(fn: string, ...args: unknown[]): Promise<T> {
  const params = args.map((_, i) => `$${i + 1}`).join(', ')
  const res = await db.query<{ r: T }>(`select public.${fn}(${params}) as r`, args)
  return res.rows[0].r
}

/** A joined game: host sets first. */
async function start(pool = POOL) {
  const host = await call<{ id: string; token: string }>('h2h_create_game', 'Ann', pool)
  const guest = await call<{ id: string; token: string }>('h2h_join_game', host.id, 'Bo')
  return { id: host.id, tokens: { host: host.token, guest: guest.token } as Record<string, string> }
}

/** Plays one whole turn. The prediction is always "p"; answering "p" gets the answerer caught. */
async function playTurn(game: { id: string; tokens: Record<string, string> }, answer: string | null) {
  const { id, tokens } = game
  const before = await call('h2h_get_game', id, tokens.host)
  const setter = tokens[before.setter]
  const answerer = before.setter === 'host' ? tokens.guest : tokens.host
  const seen = await call('h2h_get_game', id, setter)
  await call('h2h_lock_prediction', id, setter, seen.turn, seen.choices[0], 'p')
  await call('h2h_start_answer', id, answerer, seen.turn)
  return call('h2h_submit_answer', id, answerer, seen.turn, answer)
}

// One database for the whole file: booting takes seconds, and each test plays its own game.
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin;`)
  await db.exec(MIGRATION)
  await db.exec('set role anon')
}, 60_000)

describe('secrecy', () => {
  it('never sends the prediction or the choices to the answerer', async () => {
    const game = await start()
    const { host, guest } = game.tokens
    const setterView = await call('h2h_get_game', game.id, host)
    expect((await call('h2h_get_game', game.id, guest)).choices).toEqual([])

    const question = setterView.choices[0]
    await call('h2h_lock_prediction', game.id, host, 1, question, 'secret-answer')
    expect(JSON.stringify(await call('h2h_get_game', game.id, guest))).not.toContain('secret-answer')

    const started = await call('h2h_start_answer', game.id, guest, 1)
    expect(started.questionId).toBe(question)
    expect(JSON.stringify(started)).not.toContain('secret-answer')
    expect((await call('h2h_get_game', game.id, host)).prediction).toBe('secret-answer')
  })

  it('holds the question back from the answerer until their clock is running', async () => {
    const game = await start()
    const { host, guest } = game.tokens
    const { choices } = await call('h2h_get_game', game.id, host)
    await call('h2h_lock_prediction', game.id, host, 1, choices[0], 'p')
    expect((await call('h2h_get_game', game.id, guest)).questionId).toBeNull()
  })

  it('gives someone without a token only what the join screen needs', async () => {
    const game = await start()
    const view = await call<Record<string, unknown>>('h2h_get_game', game.id, null)
    expect(Object.keys(view).sort()).toEqual(['hostName', 'id', 'status', 'you'])
  })

  it('blocks direct access to the tables and internals', async () => {
    const game = await start()
    await expect(db.query('select * from h2h_private.games')).rejects.toThrow(/permission denied/)
    await expect(db.query('select h2h_private.other($1)', ['host'])).rejects.toThrow(/permission denied/)
    await expect(call('h2h_lock_prediction', game.id, crypto.randomUUID(), 1, 'q1', 'p')).rejects.toThrow(/Not a player/)
  })
})

describe('turn rules', () => {
  it('offers 3 questions, returns the 2 passed over, and shrinks the pool by 1', async () => {
    const game = await start()
    const { host, guest } = game.tokens
    const view = await call('h2h_get_game', game.id, host)
    expect(view.choices).toHaveLength(3)
    expect(new Set(view.choices).size).toBe(3)
    await call('h2h_lock_prediction', game.id, host, 1, view.choices[0], 'p')
    await call('h2h_start_answer', game.id, guest, 1)
    const after = await call('h2h_submit_answer', game.id, guest, 1, 'other')
    expect(after.poolSize).toBe(9)
    expect(after.setter).toBe('guest')
    expect(after.turn).toBe(2)
    expect(after.history[0]).toMatchObject({ caught: false, answer: 'other', prediction: 'p', outcome: 'continue' })
  })

  it('rejects a question outside the choices and a setter from the wrong side', async () => {
    const game = await start()
    const { host, guest } = game.tokens
    const { choices } = await call('h2h_get_game', game.id, host)
    const outside = POOL.find((q) => !choices.includes(q))
    await expect(call('h2h_lock_prediction', game.id, host, 1, outside, 'p')).rejects.toThrow(/not one of your choices/)
    await expect(call('h2h_lock_prediction', game.id, guest, 1, choices[0], 'p')).rejects.toThrow(/Not your turn/)
  })

  it('lets the setter choose from what is left once fewer than 3 remain', async () => {
    const game = await start(['q1', 'q2'])
    const view = await call('h2h_get_game', game.id, game.tokens.host)
    expect(view.choices).toHaveLength(2)
    const next = await playTurn(game, 'other')
    const guestView = await call('h2h_get_game', game.id, game.tokens.guest)
    expect(next.poolSize).toBe(1)
    expect(guestView.choices).toHaveLength(1)
  })

  it('ends in a draw when the pool empties with nobody caught', async () => {
    const game = await start(['q1', 'q2'])
    await playTurn(game, 'other')
    const end = await playTurn(game, 'other')
    expect(end.status).toBe('finished')
    expect(end.winner).toBeNull()
    expect(end.history[1].outcome).toBe('draw')
  })

  it('treats a retried submit as a no-op', async () => {
    const game = await start()
    const { host, guest } = game.tokens
    const { choices } = await call('h2h_get_game', game.id, host)
    await call('h2h_lock_prediction', game.id, host, 1, choices[0], 'p')
    await call('h2h_lock_prediction', game.id, host, 1, choices[1], 'changed')
    await call('h2h_start_answer', game.id, guest, 1)
    expect((await call('h2h_get_game', game.id, host)).prediction).toBe('p')
    await call('h2h_submit_answer', game.id, guest, 1, 'other')
    const again = await call('h2h_submit_answer', game.id, guest, 1, 'p')
    expect(again.history).toHaveLength(1)
    expect(again.history[0].caught).toBe(false)
  })
})

describe('fairness', () => {
  it('gives the opponent a reply turn after the first setter catches them', async () => {
    const game = await start()
    const first = await playTurn(game, 'p')
    expect(first.status).toBe('choosing')
    expect(first.winner).toBeNull()
    expect(first.setter).toBe('guest')
    expect(first.history[0].outcome).toBe('reply')
  })

  it('awards the first setter the win if the reply misses', async () => {
    const game = await start()
    await playTurn(game, 'p')
    const end = await playTurn(game, 'other')
    expect(end.status).toBe('finished')
    expect(end.winner).toBe('host')
  })

  it('goes to sudden death on a catch back, where the next catch wins outright', async () => {
    const game = await start()
    await playTurn(game, 'p')
    const tied = await playTurn(game, 'p')
    expect(tied.suddenDeath).toBe(true)
    expect(tied.status).toBe('choosing')
    expect(tied.history[1].outcome).toBe('sudden-death')

    const miss = await playTurn(game, 'other')
    expect(miss.status).toBe('choosing')
    const end = await playTurn(game, 'p')
    expect(end.status).toBe('finished')
    expect(end.winner).toBe('guest')
  })

  it('lets the second setter win at once, since the first has already had their shot', async () => {
    const game = await start()
    await playTurn(game, 'other')
    const end = await playTurn(game, 'p')
    expect(end.status).toBe('finished')
    expect(end.winner).toBe('guest')
  })

  it('draws if sudden death runs out of questions', async () => {
    const game = await start(['q1', 'q2', 'q3'])
    await playTurn(game, 'p')
    await playTurn(game, 'p')
    const end = await playTurn(game, 'other')
    expect(end.status).toBe('finished')
    expect(end.winner).toBeNull()
  })

  it('lets a catch stand when no question is left for the reply', async () => {
    const game = await start(['q1'])
    const end = await playTurn(game, 'p')
    expect(end.status).toBe('finished')
    expect(end.winner).toBe('host')
  })
})

describe('timer', () => {
  async function opened() {
    const game = await start()
    const { host, guest } = game.tokens
    const { choices } = await call('h2h_get_game', game.id, host)
    await call('h2h_lock_prediction', game.id, host, 1, choices[0], 'p')
    return { game, guest, host, started: await call('h2h_start_answer', game.id, guest, 1) }
  }

  /** Winds the clock back, which only the table's owner can do. */
  async function expire(id: string) {
    await db.exec('reset role')
    await db.query(`update h2h_private.games set deadline = now() - interval '1 second' where id = $1`, [id])
    await db.exec('set role anon')
  }

  it('starts at 10 seconds and does not restart on a second open', async () => {
    const { game, guest, started } = await opened()
    expect(started.msLeft).toBeGreaterThan(9000)
    expect(started.msLeft).toBeLessThanOrEqual(10000)
    await db.exec('reset role')
    const before = await db.query<{ deadline: string }>('select deadline from h2h_private.games where id = $1', [game.id])
    await db.exec('set role anon')
    await call('h2h_start_answer', game.id, guest, 1)
    await db.exec('reset role')
    const after = await db.query<{ deadline: string }>('select deadline from h2h_private.games where id = $1', [game.id])
    await db.exec('set role anon')
    expect(after.rows[0].deadline).toEqual(before.rows[0].deadline)
  })

  it('counts a null answer from the client as caught', async () => {
    const { game, guest } = await opened()
    const after = await call('h2h_submit_answer', game.id, guest, 1, null)
    expect(after.history[0]).toMatchObject({ caught: true, answer: null, outcome: 'reply' })
  })

  it('settles a closed tab as a timeout when the setter next asks', async () => {
    const { game, host } = await opened()
    await expire(game.id)
    const after = await call('h2h_get_game', game.id, host)
    expect(after.history[0]).toMatchObject({ caught: true, answer: null })
    expect(after.turn).toBe(2)
  })

  it('refuses an answer sent after the deadline', async () => {
    const { game, guest } = await opened()
    await expire(game.id)
    const after = await call('h2h_submit_answer', game.id, guest, 1, 'other')
    expect(after.history).toHaveLength(1)
    expect(after.history[0]).toMatchObject({ caught: true, answer: null })
  })

  it('waits as long as it takes for an answerer who has not opened the question', async () => {
    const game = await start()
    const { host } = game.tokens
    const { choices } = await call('h2h_get_game', game.id, host)
    await call('h2h_lock_prediction', game.id, host, 1, choices[0], 'p')
    const view = await call('h2h_get_game', game.id, host)
    expect(view.status).toBe('answering')
    expect(view.answering).toBe(false)
  })
})

describe('joining and rematch', () => {
  it('refuses a third player and bad names', async () => {
    const game = await start()
    await expect(call('h2h_join_game', game.id, 'Cy')).rejects.toThrow(/two players/)
    await expect(call('h2h_create_game', '   ', POOL)).rejects.toThrow(/Name/)
    await expect(call('h2h_create_game', 'x'.repeat(21), POOL)).rejects.toThrow(/Name/)
  })

  it('makes one rematch for both devices, with the other player setting first', async () => {
    const game = await start()
    await playTurn(game, 'other')
    await playTurn(game, 'p')
    const a = await call<{ id: string }>('h2h_rematch', game.id, game.tokens.host, POOL)
    const b = await call<{ id: string }>('h2h_rematch', game.id, game.tokens.guest, POOL)
    expect(a.id).toBe(b.id)
    const fresh = await call('h2h_get_game', a.id, game.tokens.guest)
    expect(fresh.you).toBe('guest')
    expect(fresh.setter).toBe('guest')
    expect(fresh.turn).toBe(1)
    expect(fresh.choices).toHaveLength(3)
    expect((await call('h2h_get_game', game.id, game.tokens.host)).rematchId).toBe(a.id)
  })

  it('applies the reply rule to the new first setter in a rematch', async () => {
    const game = await start()
    await playTurn(game, 'other')
    await playTurn(game, 'p')
    const { id } = await call<{ id: string }>('h2h_rematch', game.id, game.tokens.host, POOL)
    const next = { id, tokens: game.tokens }
    await playTurn(next, 'p')
    const end = await playTurn(next, 'other')
    expect(end.winner).toBe('guest')
  })

  it('refuses a rematch while the game is still going', async () => {
    const game = await start()
    await expect(call('h2h_rematch', game.id, game.tokens.host, POOL)).rejects.toThrow(/still going/)
  })
})

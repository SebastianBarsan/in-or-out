// Runs the stats migration on PGlite as the browser's `anon` role: it can add rounds, never read them.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const MIGRATION = readFileSync(new URL('./migrations/20261109000000_stats.sql', import.meta.url), 'utf8')

let db: PGlite

const round = (overrides: Record<string, unknown> = {}) => ({
  playerId: crypto.randomUUID(),
  nickname: 'Ann',
  mode: 'solo',
  outcome: 'in',
  streak: 3,
  bestStreak: 5,
  durationMs: 41234,
  turns: [
    { question: 'q1', answer: 'a', rank: 0.2, guess: 'b', caught: false },
    { question: 'q2', answer: 'c', rank: 0.8, guess: 'd', caught: false },
  ],
  language: 'en-GB',
  timezone: 'Europe/London',
  localHour: 21,
  screen: '390x844',
  viewport: '390x700',
  touch: true,
  darkMode: false,
  referrer: 'https://example.com/',
  ref: 'friends',
  ...overrides,
})

const log = (r: unknown) => db.query('select public.stats_log_round($1)', [JSON.stringify(r)])

async function asOwner<T>(sql: string, params: unknown[] = []) {
  await db.exec('reset role')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('set role anon')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec('create role anon nologin; create role authenticated nologin;')
  await db.exec(MIGRATION)
  await db.exec('set role anon')
}, 60_000)

describe('stats', () => {
  it('stores a round with the request headers, keeping the country but not the IP', async () => {
    const r = round()
    await db.exec('reset role')
    await db.query(`select set_config('request.headers', $1, false)`, [
      JSON.stringify({ 'user-agent': 'TestBrowser/1', 'cf-ipcountry': 'GB', 'x-forwarded-for': '1.2.3.4' }),
    ])
    await db.exec('set role anon')
    await log(r)
    await db.exec('reset role')
    await db.query(`select set_config('request.headers', '', false)`)
    await db.exec('set role anon')

    const [row] = await asOwner<Record<string, unknown>>('select * from stats_private.rounds where player_id = $1', [r.playerId])
    expect(row).toMatchObject({
      nickname: 'Ann',
      outcome: 'in',
      streak: 3,
      best_streak: 5,
      questions_answered: 2,
      timed_out: false,
      duration_ms: 41234,
      local_hour: 21,
      user_agent: 'TestBrowser/1',
      country: 'GB',
    })
    expect(JSON.stringify(row)).not.toContain('1.2.3.4')
  })

  it('works without request headers and flags a timeout', async () => {
    const r = round({ outcome: 'out', turns: [{ question: 'q1', answer: null, rank: null, guess: 'b', caught: true }] })
    await log(r)
    const [row] = await asOwner<{ timed_out: boolean; country: string | null }>(
      'select timed_out, country from stats_private.rounds where player_id = $1',
      [r.playerId],
    )
    expect(row).toEqual({ timed_out: true, country: null })
  })

  it('sums each player up in the players view', async () => {
    const playerId = crypto.randomUUID()
    await log(round({ playerId, outcome: 'in', bestStreak: 2 }))
    await log(round({ playerId, outcome: 'out', bestStreak: 4, streak: 0 }))
    const [row] = await asOwner<{ rounds: string; wins: string; best_streak: number; avg_niche: string }>(
      'select rounds, wins, best_streak, avg_niche from stats_private.players where player_id = $1',
      [playerId],
    )
    expect(row).toEqual({ rounds: 2, wins: 1, best_streak: 4, avg_niche: '0.500' })
  })

  it('rejects bad rounds', async () => {
    await expect(log(round({ outcome: 'maybe' }))).rejects.toThrow()
    await expect(log(round({ playerId: 'not-a-uuid' }))).rejects.toThrow()
    await expect(log(round({ turns: 'nope' }))).rejects.toThrow(/Invalid turns/)
    await expect(log(round({ referrer: 'x'.repeat(30000) }))).rejects.toThrow(/too large/)
  })

  it('clips long text', async () => {
    const r = round({ nickname: 'x'.repeat(50) })
    await log(r)
    const [row] = await asOwner<{ nickname: string }>('select nickname from stats_private.rounds where player_id = $1', [r.playerId])
    expect(row.nickname).toHaveLength(20)
  })

  it('never lets the browser read the stats back', async () => {
    await expect(db.query('select * from stats_private.rounds')).rejects.toThrow(/permission denied/)
    await expect(db.query('select * from stats_private.players')).rejects.toThrow(/permission denied/)
  })
})

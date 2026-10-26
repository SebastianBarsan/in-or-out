// Pits the predictor against scripted players and reports how often each one survives a round,
// both as a new player and as a returning one whose earlier rounds feed the career read.
// Usage: npm run simulate [-- --rounds 20000 --seed 42]
import type { Answer, Question, Rng } from '../src/engine/types'
import { QUESTIONS } from '../src/data'
import { createRng } from '../src/engine/rng'
import { buildRound } from '../src/engine/round'
import { careerFromHistory, chooseGuess, emptyProfile, rankPercentiles, recordAnswer } from '../src/engine/predictor'

type Player = (question: Question, turn: number, rng: Rng) => Answer

const byRank = (question: Question) => {
  const ranks = rankPercentiles(question)
  return [...question.answers].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!)
}
const mostCommon = (q: Question) => byRank(q)[0]
const mostObscure = (q: Question) => byRank(q).at(-1)!

const PLAYERS: Record<string, Player> = {
  'always-popular': (q) => mostCommon(q),
  'always-niche': (q) => mostObscure(q),
  random: (q, _turn, rng) => q.answers[Math.floor(rng() * q.answers.length)],
  alternating: (q, turn) => (turn % 2 === 0 ? mostCommon(q) : mostObscure(q)),
}

const EXPLOIT_THRESHOLD = 0.6
const TARGET = [0.3, 0.4] as const

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}

const rounds = arg('rounds', 20000)
const seed = arg('seed', 42)
const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6)

console.log(`Simulating ${rounds} rounds per player (seed ${seed})\n`)
/** Matches the round log's limit in storage.ts. */
const HISTORY_LIMIT = 200

/** Plays one round; returns the question the player was caught on (-1 if they survived) and their answer ranks. */
function playRound(play: Player, rng: Rng, history: number[][] | null): { caughtAt: number; ranks: number[] } {
  let profile = emptyProfile(history ? careerFromHistory(history) : undefined)
  for (const [turn, question] of buildRound(QUESTIONS, new Set(), rng).entries()) {
    const guess = chooseGuess(question, profile, rng)
    const answer = play(question, turn, rng)
    const rank = rankPercentiles(question).get(answer.id)!
    profile = recordAnswer(profile, rank)
    if (answer.id === guess.id) return { caughtAt: turn, ranks: profile.ranks }
  }
  return { caughtAt: -1, ranks: profile.ranks }
}

console.log(`${'player'.padEnd(16)} ${'mode'.padEnd(9)} ${'survive'.padStart(7)}   caught on Q1…Q5`)

let anyExploit = false
const totals = { new: 0, returning: 0 }
for (const [name, play] of Object.entries(PLAYERS)) {
  for (const mode of ['new', 'returning'] as const) {
    const rng = createRng(seed)
    const caughtAt = [0, 0, 0, 0, 0]
    const history: number[][] = []
    let survived = 0

    for (let r = 0; r < rounds; r++) {
      const result = playRound(play, rng, mode === 'returning' ? history : null)
      if (result.caughtAt < 0) survived++
      else caughtAt[result.caughtAt]++
      if (mode === 'returning') {
        history.push(result.ranks)
        if (history.length > HISTORY_LIMIT) history.shift()
      }
    }

    const rate = survived / rounds
    totals[mode] += survived
    const exploit = rate > EXPLOIT_THRESHOLD
    anyExploit ||= exploit
    const breakdown = caughtAt.map((n) => pct(n / rounds)).join(' ')
    console.log(
      `${name.padEnd(16)} ${mode.padEnd(9)} ${pct(rate)}   ${breakdown}${exploit ? '   ← beats the model too often' : ''}`,
    )
  }
}

const players = Object.keys(PLAYERS).length
const target = TARGET.map((t) => pct(t).trim()).join('–')
console.log(`
Average survival: ${pct(totals.new / (rounds * players)).trim()} new, ` +
  `${pct(totals.returning / (rounds * players)).trim()} returning (target ${target})`)
if (anyExploit) {
  console.log(`At least one style survives more than ${EXPLOIT_THRESHOLD * 100}% of rounds: the model is too easy to exploit.`)
  process.exitCode = 1
}

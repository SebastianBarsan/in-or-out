// Pits the predictor against scripted players and reports how often each one survives a round.
// Usage: npm run simulate [-- --rounds 20000 --seed 42]
import type { Answer, Question, Rng } from '../src/engine/types'
import { QUESTIONS } from '../src/data'
import { createRng } from '../src/engine/rng'
import { buildRound } from '../src/engine/round'
import { chooseGuess, emptyProfile, rankPercentiles, recordAnswer } from '../src/engine/predictor'

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
console.log(`${'player'.padEnd(16)} ${'survive'.padStart(7)}   caught on Q1…Q5`)

let anyExploit = false
let totalSurvived = 0
for (const [name, play] of Object.entries(PLAYERS)) {
  const rng = createRng(seed)
  const caughtAt = [0, 0, 0, 0, 0]
  let survived = 0

  for (let r = 0; r < rounds; r++) {
    let profile = emptyProfile()
    let caught = false
    buildRound(QUESTIONS, new Set(), rng).forEach((question, turn) => {
      if (caught) return
      const guess = chooseGuess(question, profile, rng)
      const answer = play(question, turn, rng)
      if (answer.id === guess.id) {
        caught = true
        caughtAt[turn]++
        return
      }
      profile = recordAnswer(profile, rankPercentiles(question).get(answer.id)!)
    })
    if (!caught) survived++
  }

  const rate = survived / rounds
  totalSurvived += survived
  const exploit = rate > EXPLOIT_THRESHOLD
  anyExploit ||= exploit
  const breakdown = caughtAt.map((n) => pct(n / rounds)).join(' ')
  console.log(`${name.padEnd(16)} ${pct(rate)}   ${breakdown}${exploit ? '   ← beats the model too often' : ''}`)
}

const overall = totalSurvived / (rounds * Object.keys(PLAYERS).length)
console.log(`\nAverage survival: ${pct(overall).trim()} (target ${TARGET.map((t) => pct(t).trim()).join('–')})`)
if (anyExploit) {
  console.log(`At least one style survives more than ${EXPLOIT_THRESHOLD * 100}% of rounds: the model is too easy to exploit.`)
  process.exitCode = 1
}

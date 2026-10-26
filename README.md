# In or Out

A small trivia game you win by being unpredictable.

Each round is five questions like "Name a country in Africa" or "Name a member of the Beatles". Before you type anything, the app quietly locks in its guess of what you'll say and shows it as a face-down card. Then the card flips. If it guessed your answer, you're out. Get through all five and you're in.

It isn't guessing blindly, though. It watches how you play, both this round and in the rounds before it. Go with the obvious answers and it keeps guessing the obvious ones. Start digging up obscure ones and it follows you into the long tail. The questions also get narrower as you go, from 30-odd possible answers down to three or four, so the last couple are where it usually catches people.

## Running it

You'll need Node 22.12 or newer.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the unit tests for the game engine |
| `npm run validate` | Checks `questions.json` for content mistakes |
| `npm run simulate` | Plays thousands of rounds against scripted players, as new and as returning players, and reports how often each one survives |
| `npm run build` | Validates the questions, type-checks, and builds a static site into `dist/` |

There's no backend. The build is plain static files, so it can go on GitHub Pages, Netlify, Vercel or anywhere else that serves HTML. Streaks, recently seen questions and the round log behind the career read live in `localStorage`.

## How the guessing works

Every answer has a hand-set popularity score between 0 and 1. Within a question, answers are ranked from most common (0) to most obscure (1).

After each of your answers, the app updates two numbers about you:

- **Niche score**: roughly how obscure your answers tend to be. It starts from your career read (or 0.25 for a new player) and moves partway with each answer, so one weird pick doesn't throw it completely.
- **Spread**: how consistent you are. Steady players get a tight aim, and erratic ones get a looser one.

Each candidate answer gets a weight that blends "what most people would say" with "what this player tends to say". As the round goes on, the second part counts for more.

### Career read

Rounds don't start from scratch. Every finished round is logged locally (the last 200), and at the start of each round the app turns that log into a **career read**: your long-run niche score and spread, with recent rounds counting more (each older round counts 0.9× the one after it). So if you change style, it catches up within a dozen or so rounds.

The career read is the round's starting point. It counts as up to three answers' worth of evidence, so the current round can still pull away from it. A consistent player also gives the app a head start of up to one answer's worth of confidence on Q1. An erratic history earns no head start, because it says little about what you'll pick next. The start screen shows your style once you have a history. The guess is then sampled from those weights rather than picked outright, so there's always some randomness and you can't game it perfectly.

The guess is chosen before the input box unlocks and is never recomputed. The face-down card is the app showing it already committed.

All of this lives in [`src/engine/predictor.ts`](src/engine/predictor.ts), with the tuning knobs at the top.

## Answers and typos

You don't have to spell things perfectly. Input is lowercased and stripped of accents and punctuation (a leading "the" is dropped too), then matched against each answer's name and aliases. If nothing matches exactly, small typos are forgiven: one mistake for 5–8 letters, two for longer words. Short answers like "Pi" or "Leo" have to be exact.

If what you typed could mean more than one answer ("Roosevelt", "Congo", "Henry VI"), it asks you to be more specific instead of guessing. Different spellings of the same thing count as one answer, so "Spurs" and "Tottenham Hotspur" are equally likely to get you caught.

## Adding questions

All content is in [`src/data/questions.json`](src/data/questions.json):

```json
{
  "id": "beatles",
  "prompt": "Name a member of the Beatles",
  "tier": "XS",
  "category": "music",
  "answers": [
    { "id": "lennon", "name": "John Lennon", "aliases": ["John", "Lennon"], "pop": 0.9 },
    ...
  ]
}
```

A few rules, all enforced by `npm run validate`:

- `tier` sets the question's slot in a round and how many answers it needs: XL (30–55), L (13–25), M (8–12), S (5–7) or XS (3–4).
- No two questions in a round share a `category`, so tag them sensibly.
- `pop` is between 0 and 1. The order matters more than the exact numbers.
- An alias can't match another answer's actual name. Two answers can share an alias (both Bushes answer to "Bush"), and the validator lists those so you can check they're intentional.

There are 60 questions so far, twelve per tier, covering everything from US states and Pixar films to Pokémon types and the Spice Girls.

## Project layout

```
src/
  engine/     game logic: round building, answer matching, the predictor (no React)
  ui/         start, question and result screens, plus the flip card
  data/       questions.json
scripts/      content validation and the balance simulator
```

The engine takes a seedable random-number generator, which keeps the tests and the simulator deterministic.

## Status

This is the first playable version. The simulator says the model catches players about as often as intended overall. It also says one style, alternating between the most common and the most obscure answer, survives a bit too often (around 61% of rounds). Tuning that is next on the list.

Ideas for later: learning popularity from what real players actually type, a daily challenge with a shareable result, and a model that spots habits beyond "obscure or not".

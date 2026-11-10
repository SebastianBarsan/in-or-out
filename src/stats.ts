// Sends each finished Solo round to a private stats table. Nothing here is shown to players and
// nothing can be read back. It needs no permission prompts: everything comes from the game or from
// what every browser shares anyway. Failures are ignored, so stats can never break a round.
//
// It calls the database function with a plain fetch rather than the Supabase client, so Solo
// players still never download that library.
import type { RoundLog } from './storage'
import { loadPlayerId, loadPlayerName } from './storage'

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
// Rounds you play while developing locally stay out of the real stats.
const ENABLED = Boolean(URL_ && KEY) && !import.meta.env.DEV

// Read once at load: where the player came from, before the app changes the URL.
const LANDING = (() => {
  try {
    const params = new URLSearchParams(location.search)
    let referrer: string | null = null
    if (document.referrer) {
      // Origin and path only: a query string can carry someone else's private details.
      const from = new URL(document.referrer)
      if (from.origin !== location.origin) referrer = from.origin + from.pathname
    }
    return { referrer, ref: params.get('ref') ?? params.get('utm_source') }
  } catch {
    return { referrer: null, ref: null }
  }
})()

function browserDetails() {
  try {
    return {
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localHour: new Date().getHours(),
      screen: `${screen.width}x${screen.height}`,
      viewport: `${innerWidth}x${innerHeight}`,
      touch: matchMedia('(pointer: coarse)').matches,
      darkMode: matchMedia('(prefers-color-scheme: dark)').matches,
    }
  } catch {
    return {}
  }
}

export interface RoundStats {
  round: RoundLog
  streak: number
  bestStreak: number
  /** From the first question appearing to the outcome. Unknown for an abandoned round. */
  durationMs: number | null
  abandoned?: boolean
}

export function sendRoundStats({ round, streak, bestStreak, durationMs, abandoned = false }: RoundStats): void {
  if (!ENABLED) return
  const playerId = loadPlayerId()
  if (!playerId) return
  const body = {
    p_round: {
      playerId,
      nickname: loadPlayerName() || null,
      mode: 'solo',
      outcome: round.outcome,
      abandoned,
      streak,
      bestStreak,
      durationMs: durationMs === null ? null : Math.round(durationMs),
      turns: round.turns,
      ...browserDetails(),
      ...LANDING,
    },
  }
  try {
    void fetch(`${URL_}/rest/v1/rpc/stats_log_round`, {
      method: 'POST',
      headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Lets the request finish even if the player closes the tab straight after the round.
      keepalive: true,
    }).catch(() => {})
  } catch {
    // No network or fetch blocked: skip this round's stats.
  }
}

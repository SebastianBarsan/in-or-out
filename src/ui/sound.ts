// Reveal sounds, synthesised with Web Audio so there are no files to load. Kept short, soft
// and pure-toned: a bright rising fifth for a dodge, a muffled falling third for a catch.

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (ctx) return ctx
  try {
    ctx = new AudioContext()
  } catch {
    return null
  }
  return ctx
}

// Browsers keep audio suspended until a user gesture, and a timeout reveal has none of its
// own, so wake the context on the first interaction of any kind.
if (typeof window !== 'undefined') {
  const unlock = () => {
    void audio()?.resume()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

interface Note {
  freq: number
  /** Seconds after the sound starts. */
  at: number
  decay: number
  gain: number
  /** Ratio the pitch drifts to over the note, for a slight sag. */
  bend?: number
}

function play(notes: Note[], cutoff: number) {
  const ac = audio()
  if (!ac || ac.state !== 'running') return
  const now = ac.currentTime + 0.01

  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = cutoff
  filter.Q.value = 0.5
  filter.connect(ac.destination)

  for (const note of notes) {
    const start = now + note.at
    const end = start + note.decay
    const env = ac.createGain()
    env.gain.setValueAtTime(0, start)
    env.gain.linearRampToValueAtTime(note.gain, start + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0001, end)
    env.connect(filter)

    // A quiet octave partial gives the sine a glassy edge without turning it into a buzzer.
    for (const [mult, level] of [[1, 1], [2, 0.18]] as const) {
      const osc = ac.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(note.freq * mult, start)
      if (note.bend) osc.frequency.exponentialRampToValueAtTime(note.freq * mult * note.bend, end)
      const partial = ac.createGain()
      partial.gain.value = level
      osc.connect(partial).connect(env)
      osc.start(start)
      osc.stop(end + 0.05)
    }
  }
}

export function playSafe() {
  play(
    [
      { freq: 659.25, at: 0, decay: 0.45, gain: 0.12 }, // E5
      { freq: 987.77, at: 0.075, decay: 0.7, gain: 0.1 }, // B5
    ],
    5000,
  )
}

export function playOut() {
  play(
    [
      { freq: 311.13, at: 0, decay: 0.5, gain: 0.14 }, // E♭4
      { freq: 261.63, at: 0.16, decay: 0.95, gain: 0.13, bend: 0.97 }, // C4, sagging
    ],
    1400,
  )
}

import { useState } from 'react'
import type { FormEvent } from 'react'
import { loadPlayerName, savePlayerName } from '../../storage'

interface Props {
  submitLabel: string
  submit: (name: string) => Promise<void>
}

export function NameForm({ submitLabel, submit }: Props) {
  const [name, setName] = useState(loadPlayerName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    savePlayerName(trimmed)
    try {
      await submit(trimmed)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setError(/two players/.test(message) ? message : "Couldn't reach the game — try again")
      setBusy(false)
    }
  }

  return (
    <form className="answer-form" onSubmit={onSubmit}>
      <input
        className="answer-input"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        aria-label="Your name"
        maxLength={20}
        autoComplete="off"
        enterKeyHint="go"
      />
      <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>
        {submitLabel}
      </button>
      <p className="error" role="alert">
        {error}
      </p>
    </form>
  )
}

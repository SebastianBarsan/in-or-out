import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Answer, Question } from '../engine/types'
import { validateAnswer } from '../engine/validate'
import { TimerBar } from './TimerBar'

interface Props {
  question: Question
  /** Input is locked until this turns true, which also starts the timer. */
  active: boolean
  /** Leave out for no time limit. */
  timerMs?: number
  onExpire?: () => void
  onAccept: (answer: Answer) => void
  placeholder?: string
  label?: string
  submitLabel?: string
}

/** The input every typed answer goes through, with its validation messages and optional timer. */
export function AnswerForm({
  question,
  active,
  timerMs,
  onExpire,
  onAccept,
  placeholder = 'Your answer',
  label = 'Your answer',
  submitLabel = 'Submit',
}: Props) {
  const [input, setInput] = useState('')
  const [error, setError] = useState<{ message: string; nonce: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!active) return
    const result = validateAnswer(question, input)
    if (result.kind === 'invalid') {
      setError({ message: 'Not a valid answer — try again', nonce: Date.now() })
      return
    }
    if (result.kind === 'ambiguous') {
      setError({ message: 'That could be more than one answer — be more specific', nonce: Date.now() })
      return
    }
    setError(null)
    onAccept(result.answer)
  }

  return (
    <form className="answer-form" onSubmit={submit}>
      {timerMs !== undefined && <TimerBar durationMs={timerMs} running={active} onExpire={onExpire ?? (() => {})} />}
      <input
        ref={inputRef}
        // Remounting on each error restarts the shake animation; autoFocus keeps the keyboard up.
        key={error?.nonce}
        autoFocus={active}
        className={`answer-input${error ? ' shake' : ''}`}
        type="text"
        value={input}
        onChange={(e) => {
          setInput(e.target.value)
          if (error) setError(null)
        }}
        disabled={!active}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'answer-error' : undefined}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
      />
      <button className="btn btn-primary" type="submit" disabled={!active || !input.trim()}>
        {submitLabel}
      </button>
      <p className="error" id="answer-error" role="alert">
        {error?.message}
      </p>
    </form>
  )
}

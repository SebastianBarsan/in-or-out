import { QUESTIONS } from '../../data'
import type { GameView, Role } from '../../h2h/api'

export function nameOf(view: GameView, role: Role): string {
  return (role === 'host' ? view.hostName : view.guestName) ?? 'Your friend'
}

export const otherRole = (role: Role): Role => (role === 'host' ? 'guest' : 'host')

export function questionById(id: string) {
  return QUESTIONS.find((q) => q.id === id)
}

export function answerName(questionId: string, answerId: string): string {
  return questionById(questionId)?.answers.find((a) => a.id === answerId)?.name ?? answerId
}

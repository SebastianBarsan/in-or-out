import type { Question } from '../engine/types'
import raw from './questions.json'

// The JSON's tier field is a plain string; scripts/validate-questions.ts checks it at build time.
export const QUESTIONS = raw as Question[]

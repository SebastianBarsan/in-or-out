import { describe, expect, it } from 'vitest'
import { editDistance, normalize, validateAnswer } from './validate'
import { QUESTIONS } from '../data'

const question = (id: string) => QUESTIONS.find((q) => q.id === id)!

const accepted = (id: string, input: string) => {
  const result = validateAnswer(question(id), input)
  return result.kind === 'ok' ? result.answer.id : result.kind
}

describe('normalize', () => {
  it('lowercases, strips accents, punctuation and a leading "the"', () => {
    expect(normalize('  São Tomé and Príncipe ')).toBe('sao tome and principe')
    expect(normalize("The Winter's Tale")).toBe('winters tale')
    expect(normalize('Guinea-Bissau')).toBe('guinea bissau')
    expect(normalize('Brighton & Hove Albion')).toBe('brighton and hove albion')
    expect(normalize('John F.  Kennedy')).toBe('john f kennedy')
  })
})

describe('editDistance', () => {
  it('counts a transposition as one edit', () => {
    expect(editDistance('ghana', 'ghnaa')).toBe(1)
    expect(editDistance('kenya', 'kenya')).toBe(0)
    expect(editDistance('mars', 'venus')).toBe(4)
  })
})

describe('validateAnswer', () => {
  it('matches names and aliases exactly', () => {
    expect(accepted('africa', 'Rwanda')).toBe('rwanda')
    expect(accepted('africa', 'swaziland')).toBe('eswatini')
    expect(accepted('africa', "Côte d'Ivoire")).toBe('ivory-coast')
    expect(accepted('one-letter-elements', 'W')).toBe('tungsten')
    expect(accepted('grand-slams', 'Roland Garros')).toBe('french-open')
  })

  it('tolerates typos scaled to input length', () => {
    expect(accepted('africa', 'Rwnada')).toBe('rwanda') // 6 chars, 1 edit
    expect(accepted('africa', 'Mozanbiqe')).toBe('mozambique') // 9 chars, 2 edits
    expect(accepted('africa', 'Madgascr')).toBe('invalid') // 8 chars, 2 edits is too many
    expect(accepted('africa', 'Nigera')).toBe('ambiguous') // 1 edit from both Niger and Nigeria
  })

  it('requires an exact match under 5 characters', () => {
    expect(accepted('africa', 'Chda')).toBe('invalid')
    expect(accepted('africa', 'Chad')).toBe('chad')
  })

  it('asks for more detail when two answers fit equally well', () => {
    expect(accepted('us-presidents', 'Roosevelt')).toBe('ambiguous')
    expect(accepted('africa', 'Congo')).toBe('ambiguous')
    expect(accepted('premier-league', 'Manchester')).toBe('ambiguous')
  })

  it('rejects the gotchas from the design doc', () => {
    expect(accepted('planets', 'Pluto')).toBe('invalid')
    expect(accepted('africa', 'Western Sahara')).toBe('invalid')
    expect(accepted('premier-league', 'Leicester')).toBe('invalid')
    expect(accepted('premier-league', 'Southampton')).toBe('invalid')
    expect(accepted('south-america', 'French Guiana')).toBe('invalid')
  })

  it('rejects empty input', () => {
    expect(accepted('beatles', '   ')).toBe('invalid')
  })

  it('resolves different spellings to the same canonical answer', () => {
    expect(accepted('premier-league', 'Spurs')).toBe(accepted('premier-league', 'Tottenham Hotspur'))
  })
})

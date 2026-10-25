// Checks src/data/questions.json for content mistakes. Runs before every build.
import { QUESTIONS } from '../src/data'
import { checkQuestions } from '../src/engine/content'

const { errors, ambiguous } = checkQuestions(QUESTIONS)

console.log(`Checked ${QUESTIONS.length} questions.`)
if (ambiguous.length) {
  console.log(`\nShared aliases (players are asked to be more specific):`)
  for (const line of ambiguous) console.log(`  ${line}`)
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`)
  for (const line of errors) console.error(`  ✗ ${line}`)
  process.exit(1)
}
console.log('\nAll good.')

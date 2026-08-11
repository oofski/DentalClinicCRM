// Offline regression suite for the Dental Scribe dictation parser.
//   node scripts/scribe-corpus.mjs
// Cases come from scripts/scribe-corpus.json. Conventions:
//   expectTeeth      = EXACT set (an extra or missing tooth is a failure)
//   expectTreatments = REQUIRED SUBSET (extra suggestions are allowed)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'scribe-corpus.mjs')
fs.mkdirSync(path.dirname(OUT), { recursive: true })
execFileSync('npx', ['esbuild', 'shared/scribe.ts', '--bundle', '--format=esm', '--platform=node',
  '--log-level=error', `--outfile=${OUT}`], { cwd: ROOT, stdio: 'inherit' })

const { analyzeDictation } = await import(OUT)
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'scribe-corpus.json'), 'utf8'))

const key = (t) => `${t.tooth}:${t.condition}:${[...(t.surfaces || [])].sort().join('')}`
let pass = 0
const failures = []

for (const c of cases) {
  const r = analyzeDictation(c.input)
  const got = r.teeth.map(key).sort()
  const want = c.expectTeeth.map(key).sort()
  const errs = []
  if (got.join('|') !== want.join('|')) errs.push(`teeth\n      want ${want.join(', ') || '(none)'}\n      got  ${got.join(', ') || '(none)'}`)
  if (r.markOthersHealthy !== c.expectMarkOthersHealthy)
    errs.push(`markOthersHealthy want ${c.expectMarkOthersHealthy} got ${r.markOthersHealthy}`)
  for (const t of c.expectTreatments || []) {
    if (!r.treatments.some((x) => x.tooth === t.tooth && x.treatment === t.treatment))
      errs.push(`missing treatment ${t.treatment} on tooth ${t.tooth}`)
  }
  // Over-treatment guard: booking a procedure onto a tooth that never needed it is a
  // clinical error, not a harmless extra suggestion, so those cases name it explicitly.
  for (const t of c.forbidTreatments || []) {
    if (r.treatments.some((x) => x.tooth === t.tooth && x.treatment === t.treatment))
      errs.push(`treatment ${t.treatment} must NOT be booked on tooth ${t.tooth}`)
  }
  if (errs.length) failures.push({ name: c.name, input: c.input, errs })
  else pass++
}

for (const f of failures) {
  console.log(`\n✗ ${f.name}\n   IN: ${f.input.slice(0, 130)}`)
  for (const e of f.errs) console.log(`   - ${e}`)
}
console.log(`\n${pass}/${cases.length} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

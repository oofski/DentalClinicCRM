// Offline regression suite for the clinical-note composer.
//   node scripts/scribe-note.mjs
//
// The note is a medical record, so the checks here are mostly about what must NOT be in
// it: chit-chat, findings repeated in looser words, and — above all — nothing the doctor
// did not say. `mustContain` / `mustNotContain` are substring checks against the
// composed note.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'scribe-note-bundle.mjs')
const ENTRY = path.join(ROOT, 'node_modules', '.cache', 'scribe-note-entry.ts')
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(
  ENTRY,
  `export { analyzeDictation } from '${path.join(ROOT, 'shared', 'scribe').replace(/\\/g, '/')}'\n` +
    `export { composeClinicalNote } from '${path.join(ROOT, 'shared', 'scribeNote').replace(/\\/g, '/')}'\n`
)
execFileSync(
  'npx',
  ['esbuild', ENTRY, '--bundle', '--format=esm', '--platform=node', '--log-level=error', `--outfile=${OUT}`],
  { cwd: ROOT, stdio: 'inherit' }
)
const { analyzeDictation, composeClinicalNote } = await import(OUT)

const REAL = `Yeah, so I think, you know, tooth number 32, we'll need treatment plus an extraction for sure to number 31 30. We're gonna both need treatment. And then, for me, looking at the rest of your teeth, they're pretty healthy. I mean, you should be happy about that. They're pretty healthy. I think definitely tooth number 14 11 and then also one, we'll have cavities. So yeah, that's something to note for. And I would definitely recommend extracting tooth number one, tooth number 16, and 17, some of those are your wisdom teeth. But aside from those, the rest of your teeth look really healthy. So you should be happy with that. And yet, you have any questions?`

const CASES = [
  {
    name: 'real-dictation-writes-up-as-a-note',
    input: REAL,
    verbatim: false,
    mustContain: [
      'FINDINGS',
      '#32', 'Extraction',
      '#11', 'Cavity',
      'TREATMENT PLAN',
      'All remaining teeth examined and charted healthy',
      'Some of those are your wisdom teeth.'
    ],
    // The chit-chat was really said and still has no place in a medical record.
    mustNotContain: [
      'you should be happy',
      'Yeah, so I think',
      'that’s something to note for',
      "that's something to note for",
      'any questions'
    ]
  },
  {
    name: 'verbatim-dictation-retained-when-asked',
    input: REAL,
    verbatim: true,
    mustContain: ['DICTATION (verbatim)', 'you should be happy about that'],
    mustNotContain: []
  },
  {
    name: 'clinical-remarks-are-kept',
    input: `Okay so patient reports sensitivity on the lower left when drinking cold. Tooth 19 has a MOD cavity and needs a crown ASAP. Gums are bleeding on probing in the lower anterior. Advised to floss daily and referred to the hygienist. Patient is pregnant so we'll hold off on x-rays for now. Everything else looks healthy.`,
    verbatim: false,
    mustContain: [
      'Patient reports sensitivity on the lower left when drinking cold.',
      'Gums are bleeding on probing in the lower anterior.',
      'Advised to floss daily and referred to the hygienist.',
      'Patient is pregnant so we',
      '#19', '(MOD)', 'Crown', 'ASAP'
    ],
    mustNotContain: ['Okay so patient reports']
  },
  {
    name: 'discussed-procedure-not-in-plan-is-kept',
    input: `Um, tooth 30 needs a root canal within 2 weeks. She grinds at night, discussed a night guard. All other teeth are healthy.`,
    verbatim: false,
    // The night guard was discussed but never booked, so no plan item records it.
    mustContain: ['discussed a night guard', 'Root Canal', 'Within 2 weeks'],
    mustNotContain: ['Um, tooth 30']
  },
  {
    name: 'empty-sections-are-omitted',
    input: `All teeth are healthy.`,
    verbatim: false,
    mustContain: ['EXAMINATION'],
    mustNotContain: ['TREATMENT PLAN', 'NOTES & DISCUSSION']
  }
]

let pass = 0
const failures = []
for (const c of CASES) {
  const r = analyzeDictation(c.input)
  const named = new Set(r.teeth.map((t) => t.tooth))
  const note = composeClinicalNote({
    teeth: r.teeth,
    treatments: r.treatments,
    markOthersHealthy: r.markOthersHealthy,
    othersCount: 32 - named.size,
    asides: r.notes,
    transcript: c.input,
    includeTranscript: c.verbatim,
    date: new Date(2026, 7, 11)
  })
  const errs = []
  for (const m of c.mustContain) if (!note.includes(m)) errs.push(`missing ${JSON.stringify(m)}`)
  for (const m of c.mustNotContain) if (note.includes(m)) errs.push(`must NOT contain ${JSON.stringify(m)}`)
  if (errs.length) failures.push({ name: c.name, errs, note })
  else pass++
}

for (const f of failures) {
  console.log(`\n✗ ${f.name}`)
  for (const e of f.errs) console.log(`   - ${e}`)
  console.log('   --- note ---\n' + f.note.split('\n').map((l) => '   ' + l).join('\n'))
}
console.log(`\n${pass}/${CASES.length} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

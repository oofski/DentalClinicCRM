// Guards the one-way rule between the odontogram and the legacy chart blob.
//   node scripts/legacy-bridge.mjs
//
// The odontogram is the record; the legacy blob is a derived cache. The failure this
// suite exists to prevent is a second writeable copy of a patient's chart — most sharply,
// re-importing an old blob over a chart the dentist has since edited and resurrecting a
// tooth they extracted.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'legacy-bridge.mjs')
fs.mkdirSync(path.dirname(OUT), { recursive: true })
execFileSync('npx', ['esbuild', 'src/components/odontogram/legacyBridge.ts', '--bundle',
  '--format=esm', '--platform=node', '--log-level=error',
  `--alias:@shared=${path.join(ROOT, 'shared')}`, `--outfile=${OUT}`], { cwd: ROOT, stdio: 'inherit' })
const { projectToLegacy, needsLegacyImport, droppedByLegacy } = await import(OUT)

let n = 0
const C = (tooth, type, status, extra = {}) => ({
  id: ++n, examination_id: 1, tooth, type, status,
  zone: extra.zone ?? 'whole', surfaces: extra.surfaces ?? [],
  date_recorded: '2026-08-11', ...extra
})
const data = (conditions) => ({
  examination_id: 1, dentition: 'permanent', conditions, bridges: [], procedures: [], plans: []
})

let pass = 0
const fail = []
const check = (name, fn) => {
  try { const note = fn(); pass++; console.log(`  ok    ${name}${note ? ' — ' + note : ''}`) }
  catch (e) { fail.push(name); console.log(`  FAIL  ${name}\n        ${e.message}`) }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`) }
const ok = (c, m) => { if (!c) throw new Error(m) }

console.log('\nlegacyBridge — the odontogram is the record, the blob is a cache\n')

check('a tooth with several findings projects as the most SERIOUS one', () => {
  // A missing tooth that also has an old filling recorded is missing. Projecting the
  // filling would put a tooth back in the patient's mouth in the PDF.
  const d = data([C('30', 'restoration', 'existing'), C('30', 'missing', 'existing')])
  eq(projectToLegacy(d)[30].condition, 'missing', 'tooth 30')
  return 'missing beats a restoration'
})

check('severity, not recency, decides', () => {
  const d = data([C('8', 'missing', 'existing'), C('8', 'caries', 'condition')])
  eq(projectToLegacy(d)[8].condition, 'missing', 'tooth 8')
})

check('the incisal edge becomes occlusal, which is all the old format has', () => {
  const d = data([C('8', 'caries', 'condition', { surfaces: ['incisal', 'mesial'] })])
  const t = projectToLegacy(d)[8]
  ok(t.surfaces.includes('occlusal'), 'incisal did not become occlusal')
  ok(!t.surfaces.includes('incisal'), 'incisal leaked into the legacy blob')
  return t.surfaces.join(',')
})

check('surfaces from several findings on one tooth are merged, not lost', () => {
  const d = data([
    C('14', 'restoration', 'existing', { surfaces: ['mesial', 'occlusal'] }),
    C('14', 'caries', 'condition', { surfaces: ['distal'] })
  ])
  const s = projectToLegacy(d)[14].surfaces.sort()
  eq(s, ['distal', 'mesial', 'occlusal'], 'tooth 14 surfaces')
})

check('an unrecorded tooth stays absent rather than becoming healthy', () => {
  const out = projectToLegacy(data([C('3', 'caries', 'condition')]))
  ok(out[3], 'tooth 3 missing from the projection')
  ok(!out[4], 'tooth 4 was invented')
  eq(Object.keys(out), ['3'], 'projected teeth')
})

check('primary teeth are dropped by the OLD format, and reported', () => {
  const d = data([C('3', 'caries', 'condition'), C('K', 'caries', 'condition')])
  const out = projectToLegacy(d)
  eq(Object.keys(out), ['3'], 'legacy blob keys')
  eq(droppedByLegacy(d), ['K'], 'dropped teeth')
  return 'K reported as unrepresentable, not silently lost'
})

check('every condition type has a legacy bucket', () => {
  const TYPES = ['healthy','caries','restoration','crown','veneer','sealant','root_canal','post_core',
    'apicoectomy','implant','bridge_abutment','bridge_pontic','denture','extraction','missing',
    'impacted','unerupted','fracture','abscess','mobility','recession','watch']
  const LEGACY = ['unexamined','healthy','cavity','filled','missing','implant','treatment','extraction']
  for (const t of TYPES) {
    const got = projectToLegacy(data([C('1', t, 'existing')]))[1]
    ok(got, `${t} projected to nothing`)
    ok(LEGACY.includes(got.condition), `${t} -> ${got.condition}, not a legacy condition`)
  }
  return `${TYPES.length} types, all land on a legacy condition`
})

console.log('\n  import happens once, and never over a chart in use\n')

check('an exam charted before the upgrade IS imported', () => {
  const legacy = { 3: { condition: 'cavity', surfaces: [], note: '' } }
  ok(needsLegacyImport(data([]), legacy), 'empty odontogram + real blob should import')
})

check('an odontogram with ANY finding is never re-imported', () => {
  const legacy = { 3: { condition: 'cavity', surfaces: [], note: '' }, 30: { condition: 'healthy', surfaces: [], note: '' } }
  ok(!needsLegacyImport(data([C('9', 'caries', 'condition')]), legacy),
    'a chart in use was about to be overwritten from the old blob')
  return 'this is what stops an extracted tooth growing back'
})

check('a blob of nothing but unexamined teeth is not worth importing', () => {
  const legacy = { 1: { condition: 'unexamined', surfaces: [], note: '' } }
  ok(!needsLegacyImport(data([]), legacy), 'imported an empty chart')
})

check('missing or malformed input never triggers an import', () => {
  ok(!needsLegacyImport(null, null), 'null')
  ok(!needsLegacyImport(data([]), null), 'no blob')
  ok(!needsLegacyImport(data([]), {}), 'empty blob')
  ok(!needsLegacyImport(undefined, { 3: { condition: 'cavity', surfaces: [], note: '' } }), 'no odontogram')
})

check('projection is pure — it does not touch the odontogram', () => {
  const d = data([C('3', 'caries', 'condition', { surfaces: ['occlusal'] })])
  const before = JSON.stringify(d)
  projectToLegacy(d)
  eq(JSON.stringify(d), before, 'the record was mutated by reading it')
})

console.log(`\n${pass} passed, ${fail.length} failed\n`)
process.exit(fail.length ? 1 : 0)

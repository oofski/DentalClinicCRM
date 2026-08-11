// Tests for the procedure ledger's filter/sort/count logic.
//
//   node src/components/odontogram/ledgerFilter.test.mjs
//
// The module is TypeScript and imports the shared contract through the '@shared' alias, so
// the test bundles it with esbuild first (into a temp dir, never into the repo) and imports
// the bundle. No DOM, no React, no test framework.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-filter-'))
const outFile = path.join(outDir, 'ledgerFilter.mjs')

const localEsbuild = path.join(root, 'node_modules', '.bin', 'esbuild')
const [cmd, argv] = fs.existsSync(localEsbuild) ? [localEsbuild, []] : ['npx', ['esbuild']]
execFileSync(
  cmd,
  [
    ...argv,
    path.join(here, 'ledgerFilter.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--tsconfig=${path.join(root, 'tsconfig.web.json')}`,
    `--outfile=${outFile}`
  ],
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] }
)

const L = await import(pathToFileURL(outFile).href)

// ---------------------------------------------------------------------------
// Fixtures — one mixed ledger, plus hand-written expectations for each row so the
// assertions never lean on the implementation they are checking.
// ---------------------------------------------------------------------------

const plans = [
  { id: 1, examination_id: 1, name: 'Phase One — restorative', accepted: true, created_at: '2026-01-02' },
  { id: 2, examination_id: 1, name: 'Alternative — bridge', accepted: false, created_at: '2026-01-03' }
]

const p = (over) => ({
  id: 0,
  examination_id: 1,
  tx_plan_id: null,
  phase: 1,
  code: '',
  description: '',
  teeth: [],
  surfaces: [],
  status: 'planned',
  created_at: '2026-01-01T00:00:00Z',
  ...over
})

const LEDGER = [
  p({ id: 1, code: 'D2391', description: 'Composite, one surface', teeth: ['3'], surfaces: ['occlusal'],
      status: 'planned', date: '2026-03-02', provider_name: 'Dr. Amara Osei', location: 'Op 1',
      tx_plan_id: 1, phase: 1, note: 'Watch the mesial margin', fee: 240, insurance_estimate: 168, patient_portion: 72 }),
  p({ id: 2, code: 'D2740', description: 'Crown, porcelain', teeth: ['14'], surfaces: [],
      status: 'completed', date: '2026-01-15', provider_name: 'Dr. Ben Cole', location: 'Op 2',
      tx_plan_id: 1, phase: 2 }),
  // Three teeth, ONE procedure — the row every count in this file is really about.
  p({ id: 3, code: '', description: 'Bridge, three unit', teeth: ['19', '20', '21'], surfaces: [],
      status: 'planned', tx_plan_id: 2, phase: 1, note: 'Patient still deciding' }),
  p({ id: 4, code: 'D1110', description: 'Adult prophylaxis', teeth: [], surfaces: [],
      status: 'today', date: '2026-08-11', provider_name: 'Hana Lee, RDH', location: 'Hygiene', phase: 1 }),
  p({ id: 5, code: 'D2161', description: 'Existing amalgam', teeth: ['30'],
      surfaces: ['distal', 'occlusal', 'mesial'], status: 'existing', date: '2019-06-04',
      provider_name: 'Dr. Ben Cole', location: 'Op 2', phase: 1 }),
  p({ id: 6, code: '', description: 'Caries, distal', teeth: ['12'], surfaces: ['distal'],
      status: 'condition', date: '2026-08-11', note: 'Deep, close to the pulp', phase: 1 }),
  p({ id: 7, code: 'D3330', description: 'Root canal, molar', teeth: ['12'], surfaces: [],
      status: 'to_start', tx_plan_id: 2, phase: 2 }),
  // Codes here deliberately contain none of the tooth numbers searched for below, so the
  // tooth assertions prove tooth matching rather than an accidental code substring.
  p({ id: 8, code: 'D7210', description: 'Extraction, erupted tooth', teeth: ['1'], surfaces: [],
      status: 'to_review', date: '2026-05-05', provider_name: 'Dr. Amara Osei', location: 'Op 3', phase: 3 }),
  p({ id: 9, code: 'D1351', description: 'Sealant', teeth: ['J'], surfaces: ['occlusal'],
      status: 'to_complete', phase: 1 }),
  p({ id: 10, code: '', description: 'Denture reline, referred out', teeth: [], surfaces: [],
      status: 'referred', phase: 1, note: 'Sent to the lab' })
]

// Hand-written per-row keys: expected surface shorthand and tooth sort rank.
const EXPECT = {
  1: { surface: 'O', tooth: 3 },
  2: { surface: '', tooth: 14 },
  3: { surface: '', tooth: 19 },
  4: { surface: '', tooth: 999 },
  5: { surface: 'MOD', tooth: 30 },
  6: { surface: 'D', tooth: 12 },
  7: { surface: '', tooth: 12 },
  8: { surface: '', tooth: 1 },
  9: { surface: 'O', tooth: 109 }, // primary J — after every permanent tooth
  10: { surface: '', tooth: 999 }
}

const ids = (list) => list.map((x) => x.id)

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0
const failures = []
function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures.push({ name, err })
    console.log(`FAIL  ${name}`)
    console.log(String(err && err.message).split('\n').map((l) => `        ${l}`).join('\n'))
  }
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

test('statusCounts is correct across a mixed ledger', () => {
  const c = L.statusCounts(LEDGER)
  assert.equal(c.condition, 1)
  assert.equal(c.existing, 1)
  assert.equal(c.planned, 2)
  assert.equal(c.to_start, 1)
  assert.equal(c.today, 1)
  assert.equal(c.in_progress, 0)
  assert.equal(c.to_complete, 1)
  assert.equal(c.completed, 1)
  assert.equal(c.to_review, 1)
  assert.equal(c.referred, 1)
  assert.equal(c.declined, 0)
  // Every status in the contract gets a key, so a pill can never render "undefined".
  const total = Object.entries(c).filter(([k]) => k !== 'notes').reduce((n, [, v]) => n + v, 0)
  assert.equal(total, LEDGER.length)
})

test('the Notes count counts procedures carrying a note, in any status', () => {
  const c = L.statusCounts(LEDGER)
  assert.equal(c.notes, 4) // ids 1, 3, 6, 10 — planned, planned, condition, referred
  const blank = L.statusCounts([p({ id: 1, note: '   ' }), p({ id: 2 })])
  assert.equal(blank.notes, 0, 'whitespace is not a note')
})

test('a procedure spanning multiple teeth is counted ONCE, not once per tooth', () => {
  const bridge = LEDGER.find((x) => x.id === 3)
  assert.equal(bridge.teeth.length, 3)
  const c = L.statusCounts([bridge])
  assert.equal(c.planned, 1)
  assert.equal(c.notes, 1)
  // And inside the full ledger: two planned rows, not the four a per-tooth tally gives.
  assert.equal(L.statusCounts(LEDGER).planned, 2)
  assert.equal(L.countOnTooth(LEDGER, '20'), 1)
})

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

test('no selected pills means no status filter', () => {
  assert.deepEqual(ids(L.filterProcedures(LEDGER, {})), ids(LEDGER))
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { statuses: [] })), ids(LEDGER))
  assert.deepEqual(ids(L.filterProcedures(LEDGER)), ids(LEDGER))
})

test('multi-status filtering is a UNION, not an intersection', () => {
  const both = L.filterProcedures(LEDGER, { statuses: ['planned', 'today'] })
  assert.deepEqual(ids(both), [1, 3, 4])
  // An intersection would be empty — a procedure only ever holds one status.
  assert.ok(both.length > L.filterProcedures(LEDGER, { statuses: ['today'] }).length)
  const three = L.filterProcedures(LEDGER, { statuses: ['planned', 'today', 'completed'] })
  assert.deepEqual(ids(three), [1, 2, 3, 4])
})

test('the Notes pill unions with statuses instead of narrowing them', () => {
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { statuses: ['notes'] })), [1, 3, 6, 10])
  // 'today' has no notes; the union still shows it alongside the noted rows.
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { statuses: ['notes', 'today'] })), [1, 3, 4, 6, 10])
})

test('search matches the code', () => {
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: 'D2740' })), [2])
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: 'd2740' })), [2], 'case-insensitive')
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: 'D13' })), [9], 'partial code')
})

test('search matches the description', () => {
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: 'crown' })), [2])
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: 'distal' })), [6])
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: 'BRIDGE' })), [3])
})

test('search matches the tooth, exactly, and once for a multi-tooth procedure', () => {
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: '14' })), [2])
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: '#14' })), [2], 'a leading # is fine')
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: '20' })), [3], 'middle tooth of the bridge')
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: 'j' })), [9], 'primary letters, case-insensitive')
  // '2' must not drag in 12, 20, 21, 30 — a tooth number is an identifier, not a word.
  assert.equal(ids(L.filterProcedures(LEDGER, { search: '2' })).includes(3), false)
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: '  ' })), ids(LEDGER), 'blank search filters nothing')
})

test('tooth, plan and phase filters', () => {
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { toothId: '12' })), [6, 7])
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { toothId: '21' })), [3])
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { planId: 1 })), [1, 2])
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { planId: null })), [4, 5, 6, 8, 9, 10], 'unassigned')
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { phase: 2 })), [2, 7])
})

test('filters combine with AND across kinds, union within the pills', () => {
  const r = L.filterProcedures(LEDGER, { statuses: ['planned', 'to_start'], search: 'root' })
  assert.deepEqual(ids(r), [7])
})

test('empty and missing input return empty rather than crashing', () => {
  assert.deepEqual(L.filterProcedures([], { statuses: ['planned'], search: 'crown' }), [])
  assert.deepEqual(L.filterProcedures(undefined, { search: 'x' }), [])
  assert.deepEqual(L.sortProcedures([], 'date', 'asc'), [])
  assert.deepEqual(L.sortProcedures(undefined, 'status', 'desc'), [])
  const c = L.statusCounts([])
  assert.equal(c.notes, 0)
  assert.equal(c.planned, 0)
  assert.equal(L.countOnTooth([], '3'), 0)
  assert.deepEqual(ids(L.filterProcedures(LEDGER, { search: 'no such thing' })), [])
})

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const blanksLast = (compare) => (a, b) => {
  const x = typeof a === 'string' ? a.trim() : a
  const y = typeof b === 'string' ? b.trim() : b
  if (!x && !y) return 0
  if (!x) return 1
  if (!y) return -1
  return compare(x, y)
}
const textCmp = blanksLast((a, b) => COLLATOR.compare(a, b))
const dateCmp = blanksLast((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const numCmp = (a, b) => a - b
const planNameOf = (id) => (plans.find((x) => x.id === id) || {}).name || ''
const STATUS_SEQ = ['condition', 'existing', 'planned', 'to_start', 'today', 'in_progress',
  'to_complete', 'completed', 'to_review', 'referred', 'declined']

// Independent key/comparator per column, written out rather than imported.
const COLUMNS = {
  date: [(x) => x.date || '', dateCmp],
  code: [(x) => x.code || '', textCmp],
  description: [(x) => x.description || '', textCmp],
  tooth: [(x) => EXPECT[x.id].tooth, numCmp],
  surface: [(x) => EXPECT[x.id].surface, textCmp],
  provider: [(x) => x.provider_name || '', textCmp],
  location: [(x) => x.location || '', textCmp],
  plan: [(x) => planNameOf(x.tx_plan_id), textCmp],
  phase: [(x) => x.phase, numCmp],
  status: [(x) => STATUS_SEQ.indexOf(x.status), numCmp]
}

test('SORT_COLUMNS covers exactly the sortable columns the table offers', () => {
  assert.deepEqual([...L.SORT_COLUMNS].sort(), Object.keys(COLUMNS).sort())
})

test('every sortable column sorts in both directions', () => {
  for (const column of L.SORT_COLUMNS) {
    const [key, cmp] = COLUMNS[column]
    for (const direction of ['asc', 'desc']) {
      const sorted = L.sortProcedures(LEDGER, column, direction, plans)
      assert.equal(sorted.length, LEDGER.length, `${column} ${direction}: dropped rows`)
      assert.deepEqual([...ids(sorted)].sort(numCmp), [...ids(LEDGER)].sort(numCmp),
        `${column} ${direction}: changed the set of rows`)
      for (let i = 1; i < sorted.length; i++) {
        const step = cmp(key(sorted[i - 1]), key(sorted[i]))
        const ok = direction === 'asc' ? step <= 0 : step >= 0
        assert.ok(ok, `${column} ${direction}: row ${sorted[i - 1].id} before ${sorted[i].id} ` +
          `(${JSON.stringify(key(sorted[i - 1]))} vs ${JSON.stringify(key(sorted[i]))})`)
      }
    }
  }
})

test('date sorts oldest-first ascending, with undated rows last', () => {
  assert.deepEqual(ids(L.sortProcedures(LEDGER, 'date', 'asc')), [5, 2, 1, 8, 4, 6, 3, 7, 9, 10])
  assert.deepEqual(ids(L.sortProcedures(LEDGER, 'date', 'desc')), [3, 7, 9, 10, 4, 6, 8, 1, 2, 5])
})

test('tooth sorts 1–32, then primary letters, then whole-mouth rows', () => {
  assert.deepEqual(ids(L.sortProcedures(LEDGER, 'tooth', 'asc')), [8, 1, 6, 7, 2, 3, 5, 9, 4, 10])
})

test('status sorts by the clinical lifecycle, not the alphabet', () => {
  assert.deepEqual(ids(L.sortProcedures(LEDGER, 'status', 'asc')), [6, 5, 1, 3, 7, 4, 9, 2, 8, 10])
})

test('sorting is stable — ties keep their incoming order in BOTH directions', () => {
  // Rows 4 and 6 share a date; 6 and 7 share a tooth; six rows share phase 1.
  assert.deepEqual(ids(L.sortProcedures(LEDGER, 'date', 'asc')).filter((i) => i === 4 || i === 6), [4, 6])
  assert.deepEqual(ids(L.sortProcedures(LEDGER, 'date', 'desc')).filter((i) => i === 4 || i === 6), [4, 6])
  assert.deepEqual(ids(L.sortProcedures(LEDGER, 'tooth', 'asc')).filter((i) => i === 6 || i === 7), [6, 7])
  assert.deepEqual(ids(L.sortProcedures(LEDGER, 'tooth', 'desc')).filter((i) => i === 6 || i === 7), [6, 7])
  const phase1 = LEDGER.filter((x) => x.phase === 1).map((x) => x.id)
  assert.deepEqual(ids(L.sortProcedures(LEDGER, 'phase', 'asc')).filter((i) => phase1.includes(i)), phase1)
  assert.deepEqual(ids(L.sortProcedures(LEDGER, 'phase', 'desc')).filter((i) => phase1.includes(i)), phase1)
  // Reversing twice returns the original order, which a non-stable reverse would not.
  const asc = L.sortProcedures(LEDGER, 'phase', 'asc')
  assert.deepEqual(ids(L.sortProcedures(L.sortProcedures(asc, 'phase', 'desc'), 'phase', 'asc')), ids(asc))
})

test('sorting does not mutate the caller list', () => {
  const before = ids(LEDGER)
  L.sortProcedures(LEDGER, 'description', 'desc', plans)
  assert.deepEqual(ids(LEDGER), before)
})

test('sorting by plan uses plan names, with unplanned rows last', () => {
  const sorted = ids(L.sortProcedures(LEDGER, 'plan', 'asc', plans))
  assert.deepEqual(sorted.slice(0, 4), [3, 7, 1, 2]) // 'Alternative…' then 'Phase One…'
  assert.deepEqual(sorted.slice(4), [4, 5, 6, 8, 9, 10]) // unplanned, in input order
})

test('nextSort reverses the current column and resets a new one', () => {
  assert.deepEqual(L.nextSort({ column: 'date', direction: 'desc' }, 'date'), { column: 'date', direction: 'asc' })
  assert.deepEqual(L.nextSort({ column: 'date', direction: 'asc' }, 'code'), { column: 'code', direction: 'asc' })
  assert.deepEqual(L.nextSort({ column: 'code', direction: 'asc' }, 'date'), { column: 'date', direction: 'desc' })
})

// ---------------------------------------------------------------------------
// Labels the table renders
// ---------------------------------------------------------------------------

test('pill labels come from the contract, and Notes is not a status', () => {
  assert.deepEqual(L.LEDGER_FILTER_KEYS, ['condition', 'existing', 'planned', 'today', 'completed',
    'to_start', 'to_complete', 'to_review', 'notes'])
  assert.equal(L.filterLabel('to_complete'), 'To Complete')
  assert.equal(L.filterLabel('condition'), 'Condition')
  assert.equal(L.filterLabel('notes'), 'Notes')
})

test('cells format as the table renders them', () => {
  const bridge = LEDGER.find((x) => x.id === 3)
  const amalgam = LEDGER.find((x) => x.id === 5)
  assert.equal(L.toothSummary(bridge.teeth), '19, 20, 21')
  assert.equal(L.toothSummary([]), '—')
  assert.equal(L.surfaceSummary(amalgam), 'MOD', 'shorthand, in write-up order')
  assert.equal(L.surfaceSummary(bridge), '—')
  assert.equal(L.formatMoney(null), '—')
  assert.equal(L.formatMoney(undefined), '—')
  assert.equal(L.formatMoney(240), '$240.00')
  assert.equal(L.formatMoney(0), '$0.00', 'a zero fee is a fee, not a blank')
  assert.equal(L.planLabel(plans, 2), 'Alternative — bridge')
  assert.equal(L.planLabel(plans, null), '—')
  assert.equal(L.dash(''), '—')
})

test('the empty state can name the filters that are hiding everything', () => {
  assert.equal(L.isFilterActive({ statuses: [], search: '' }), false)
  assert.equal(L.isFilterActive({ statuses: ['today'] }), true)
  assert.equal(L.isFilterActive({ search: 'crown' }), true)
  assert.deepEqual(
    L.describeActiveFilters({ statuses: ['planned', 'notes'], search: 'crown', toothId: '14', planId: 2, phase: 1 }, plans),
    ['Status: Planned, Notes', 'Search: “crown”', 'Tooth: #14', 'Plan: Alternative — bridge', 'Phase: 1']
  )
  assert.deepEqual(L.describeActiveFilters({}), [])
})

test('the status dropdown offers the current status plus its legal transitions', () => {
  assert.deepEqual(L.statusOptions('completed'), ['completed', 'to_review', 'existing'])
  assert.deepEqual(L.statusOptions('today'), ['today', 'in_progress', 'completed', 'to_complete', 'planned'])
})

// ---------------------------------------------------------------------------

fs.rmSync(outDir, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

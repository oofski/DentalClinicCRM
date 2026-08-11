// Verifies the odontogram migration against a real SQLite database.
//
// This is not a mock. It builds a throwaway v1.5-era database (the schema an installed copy
// of Giving Smiles actually has), fills it with the kind of tooth_chart_data a clinic would
// have recorded, and then runs the REAL electron/main/db.ts startup path over it — the same
// createSchema() + migrate() an upgrading install runs — with Electron stubbed out.
//
// Run it with:  node scripts/odontogram-migrate.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import initSqlJs from 'sql.js'
import * as esbuild from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WASM = path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
// The bundle lives under node_modules so its `import 'sql.js'` / `import 'bcryptjs'`
// resolve the same way they do inside the app.
const BUILD_DIR = path.join(ROOT, 'node_modules', '.cache', 'odontogram-verify')

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------
let passed = 0
const failures = []

function check(label, condition, detail) {
  if (condition) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failures.push(label)
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function equal(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(label, a === b, `expected ${b}, got ${a}`)
}

function section(title) {
  console.log(`\n${title}`)
}

// ---------------------------------------------------------------------------
// 1. Build a legacy database — the schema an installed v1.5.x copy has on disk
// ---------------------------------------------------------------------------

// Copied from electron/main/db.ts as it stands BEFORE the odontogram tables exist: this is
// deliberately the old schema, because that is what the migration has to cope with.
const LEGACY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'doctor',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    preferred_language TEXT NOT NULL DEFAULT 'english',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS examinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL,
    exam_date TEXT NOT NULL,
    tooth_chart_data TEXT,
    treatment_items TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (doctor_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT,
    event_date TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`

// A real mixed chart: caries with surfaces, an old MOD amalgam, a missing tooth, an implant,
// a planned extraction, a watch, a healthy tooth — and teeth that were never examined.
const CHART_ONE = {
  3: { condition: 'cavity', surfaces: ['occlusal', 'distal'], note: 'Deep occlusal caries — check pulp vitality' },
  5: { condition: 'treatment', surfaces: ['buccal'], note: 'Buccal decalcification, review in 6 months' },
  8: { condition: 'filled', surfaces: ['occlusal'], note: '' },
  9: { condition: 'healthy', surfaces: [], note: '' },
  12: { condition: 'unexamined', surfaces: [], note: '' },
  14: { condition: 'filled', surfaces: ['mesial', 'occlusal', 'distal'], note: 'MOD amalgam, placed 2019' },
  17: { condition: 'missing', surfaces: [], note: 'Extracted 2018' },
  19: { condition: 'implant', surfaces: [], note: '' },
  30: { condition: 'extraction', surfaces: [], note: 'Non-restorable — plan extraction' },
  31: { condition: 'unexamined', surfaces: [], note: '' },
  99: { condition: 'cavity', surfaces: [], note: 'not a tooth in the Universal notation' }
}
const CHART_TWO = {
  2: { condition: 'cavity', surfaces: ['occlusal'], note: '' },
  24: { condition: 'healthy', surfaces: [], note: '' }
}

const EXPECTED_ONE = {
  3: { type: 'caries', status: 'condition', zone: 'crown', surfaces: ['occlusal', 'distal'] },
  5: { type: 'watch', status: 'condition', zone: 'whole', surfaces: ['buccal'] },
  // Tooth 8 is a central incisor: the old chart's "occlusal" is its incisal edge.
  8: { type: 'restoration', status: 'existing', zone: 'crown', surfaces: ['incisal'] },
  9: { type: 'healthy', status: 'existing', zone: 'whole', surfaces: [] },
  14: { type: 'restoration', status: 'existing', zone: 'crown', surfaces: ['mesial', 'occlusal', 'distal'] },
  17: { type: 'missing', status: 'existing', zone: 'whole', surfaces: [] },
  19: { type: 'implant', status: 'existing', zone: 'whole', surfaces: [] },
  30: { type: 'extraction', status: 'planned', zone: 'whole', surfaces: [] }
}

async function buildLegacyDatabase(dbPath) {
  const SQL = await initSqlJs({ locateFile: () => WASM })
  const db = new SQL.Database()
  db.exec(LEGACY_SCHEMA)
  db.run(
    "INSERT INTO users (username, password_hash, full_name, role) VALUES ('mchen','$2a$10$notarealhash','Dr. Maya Chen','doctor')"
  )
  db.run(
    "INSERT INTO patients (patient_id, first_name, last_name, date_of_birth) VALUES ('GS-000001','Rosa','Alvarez','1979-04-12')"
  )
  db.run(
    "INSERT INTO app_settings (key, value) VALUES ('clinic_name','Giving Smiles'),('default_language','english')"
  )

  const exams = [
    ['2024-02-11', JSON.stringify(CHART_ONE)],
    ['2024-08-03', JSON.stringify(CHART_TWO)],
    ['2024-09-19', '{}'], // charted but empty — nothing to import
    ['2024-10-02', 'this blob got corrupted'], // must not crash the upgrade
    ['2024-10-30', null] // never charted
  ]
  for (const [date, chart] of exams) {
    db.run(
      'INSERT INTO examinations (patient_id, doctor_id, exam_date, tooth_chart_data, treatment_items) VALUES (1, 1, ?, ?, ?)',
      [date, chart, '[]']
    )
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  db.close()
}

// ---------------------------------------------------------------------------
// 2. Bundle the real main-process modules with Electron stubbed
// ---------------------------------------------------------------------------
async function bundleMain(userDataDir) {
  fs.mkdirSync(BUILD_DIR, { recursive: true })
  const outfile = path.join(BUILD_DIR, 'main-under-test.mjs')
  const entry = path.join(BUILD_DIR, 'entry.ts')
  fs.writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(ROOT, 'electron/main/db.ts'))}\n` +
      `export * from ${JSON.stringify(path.join(ROOT, 'electron/main/odontogramRepo.ts'))}\n`
  )

  const electronStub = `
    export const app = {
      isPackaged: false,
      getPath: () => ${JSON.stringify(userDataDir)},
      getAppPath: () => ${JSON.stringify(ROOT)}
    }
  `

  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['sql.js', 'bcryptjs'],
    logLevel: 'warning',
    plugins: [
      {
        name: 'giving-smiles-test-harness',
        setup(build) {
          // @shared/* is an electron-vite alias; resolve it the same way here.
          build.onResolve({ filter: /^@shared\// }, (args) => ({
            path: path.join(ROOT, 'shared', `${args.path.slice('@shared/'.length)}.ts`)
          }))
          build.onResolve({ filter: /^electron$/ }, () => ({
            path: 'electron-stub',
            namespace: 'harness'
          }))
          build.onLoad({ filter: /.*/, namespace: 'harness' }, () => ({
            contents: electronStub,
            loader: 'js'
          }))
        }
      }
    ]
  })
  return outfile
}

/** Reads straight from the file on disk, so persistence is proved rather than assumed. */
async function readTable(dbFile, sql) {
  const SQL = await initSqlJs({ locateFile: () => WASM })
  const db = new SQL.Database(fs.readFileSync(dbFile))
  const res = db.exec(sql)
  const out = res[0]
    ? res[0].values.map((row) => Object.fromEntries(row.map((v, i) => [res[0].columns[i], v])))
    : []
  db.close()
  return out
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-odontogram-'))
  const dbPath = path.join(tmp, 'GivingSmilesData', 'givingsmiles.db')
  console.log(`Legacy database: ${dbPath}`)

  await buildLegacyDatabase(dbPath)
  const before = await readTable(dbPath, 'SELECT id, tooth_chart_data FROM examinations ORDER BY id')
  const legacyBlobs = JSON.stringify(before)

  const bundle = await bundleMain(tmp)
  const main = await import(pathToFileURL(bundle).href)

  // ---- First launch after the upgrade -------------------------------------
  section('Upgrade: first launch')
  await main.initDatabase()

  const tables = main
    .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .map((r) => r.name)
  for (const t of [
    'tooth_conditions',
    'bridge_groups',
    'procedures',
    'tx_plans',
    'procedure_codes',
    'tooth_history'
  ]) {
    check(`table ${t} exists`, tables.includes(t))
  }
  const indexes = main
    .query("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
    .map((r) => r.name)
  check(
    'index on tooth_conditions(examination_id)',
    indexes.includes('idx_tooth_conditions_exam')
  )
  check('index on tooth_conditions(tooth)', indexes.includes('idx_tooth_conditions_tooth'))

  section('Migrated findings')
  const conditions = main.query(
    'SELECT * FROM tooth_conditions ORDER BY examination_id, CAST(tooth AS INTEGER)'
  )
  const examOne = conditions.filter((c) => c.examination_id === 1)
  const examTwo = conditions.filter((c) => c.examination_id === 2)

  equal('exam 1 produced one row per charted tooth', examOne.length, 8)
  equal('exam 2 produced one row per charted tooth', examTwo.length, 2)
  equal('no rows for empty / corrupt / uncharted exams', conditions.length, 10)

  for (const [tooth, want] of Object.entries(EXPECTED_ONE)) {
    const row = examOne.find((c) => c.tooth === String(tooth))
    if (!row) {
      check(`tooth ${tooth} migrated`, false, 'no row')
      continue
    }
    equal(`tooth ${tooth} -> ${want.type} / ${want.status}`, [row.type, row.status], [
      want.type,
      want.status
    ])
    equal(`tooth ${tooth} zone`, row.zone, want.zone)
    equal(`tooth ${tooth} surfaces`, JSON.parse(row.surfaces), want.surfaces)
  }

  check('unexamined tooth 12 has no row', !examOne.some((c) => c.tooth === '12'))
  check('unexamined tooth 31 has no row', !examOne.some((c) => c.tooth === '31'))
  check('non-tooth key "99" was dropped', !examOne.some((c) => c.tooth === '99'))

  const t3 = examOne.find((c) => c.tooth === '3')
  equal('note carried across', t3.note, 'Deep occlusal caries — check pulp vitality')
  equal('recorded on the examination date', t3.date_recorded, '2024-02-11')
  equal('attributed to the examining doctor', t3.provider_name, 'Dr. Maya Chen')
  equal('provider id kept', t3.provider_id, 1)
  const t9 = examOne.find((c) => c.tooth === '9')
  equal('a tooth with no note stores NULL, not ""', t9.note, null)

  section('The legacy chart is left alone')
  const after = await readTable(dbPath, 'SELECT id, tooth_chart_data FROM examinations ORDER BY id')
  check('examinations.tooth_chart_data is byte-identical', JSON.stringify(after) === legacyBlobs)
  equal('the corrupt blob is still there untouched', after[3].tooth_chart_data, 'this blob got corrupted')

  section('Audit trail')
  const migrationLog = main.query(
    "SELECT * FROM tooth_history WHERE entity = 'chart' AND field = 'migration' ORDER BY examination_id"
  )
  equal('one history entry per converted examination', migrationLog.length, 2)
  equal('attributed to the upgrade, not to a user', migrationLog[0].user_name, 'System (upgrade)')
  equal('history records what it imported', migrationLog[0].after, '8 finding(s) imported from the previous chart')

  section('Procedure codes')
  const codes = main.query('SELECT * FROM procedure_codes ORDER BY id')
  check(`seeded ${codes.length} descriptions (>= 40)`, codes.length >= 40, `got ${codes.length}`)
  check(
    'every seeded code field is blank (CDT codes are ADA-copyrighted)',
    codes.every((c) => c.code === '')
  )
  check(
    'descriptions are real procedures',
    ['Prophylaxis, adult', 'Porcelain crown', 'Root canal, molar', 'Extraction, erupted tooth', 'Amalgam restoration, one surface'].every(
      (d) => codes.some((c) => c.description === d)
    )
  )

  // ---- Second launch: the migration must not run again ---------------------
  section('Second launch (idempotence)')
  const flag = main.query(`SELECT value FROM app_settings WHERE key = '${main.MIGRATION_FLAG}'`)
  equal('migration flag recorded', flag[0]?.value, '1')

  await main.initDatabase()
  const afterSecond = main.query('SELECT COUNT(*) AS c FROM tooth_conditions')[0].c
  equal('running the upgrade twice does not duplicate findings', afterSecond, 10)
  const historyAfterSecond = main.query(
    "SELECT COUNT(*) AS c FROM tooth_history WHERE field = 'migration'"
  )[0].c
  equal('nor duplicate the history entries', historyAfterSecond, 2)
  const codesAfterSecond = main.query('SELECT COUNT(*) AS c FROM procedure_codes')[0].c
  equal('nor re-seed the procedure codes', codesAfterSecond, codes.length)

  section('Third run with the flag wiped (per-examination guard)')
  main.execute("DELETE FROM app_settings WHERE key = '" + main.MIGRATION_FLAG + "'")
  const forced = main.migrateLegacyToothCharts({ force: true })
  equal('nothing left to convert', [forced.examinations, forced.conditions], [0, 0])
  equal(
    'still exactly the original findings',
    main.query('SELECT COUNT(*) AS c FROM tooth_conditions')[0].c,
    10
  )

  // ---- A chart written by the old view after the upgrade ------------------
  section('A legacy chart saved after the upgrade')
  main.execute(
    'INSERT INTO examinations (patient_id, doctor_id, exam_date, tooth_chart_data, treatment_items) VALUES (1, 1, ?, ?, ?)',
    ['2025-01-15', JSON.stringify({ 4: { condition: 'cavity', surfaces: ['mesial'], note: 'new' } }), '[]']
  )
  const newExamId = main.query('SELECT MAX(id) AS id FROM examinations')[0].id
  const imported = main.Odontogram.importLegacyChart(newExamId, { id: 1, name: 'Dr. Maya Chen' })
  equal('the single-examination import picks it up', imported, 1)
  equal(
    'and is itself idempotent',
    main.Odontogram.importLegacyChart(newExamId, { id: 1, name: 'Dr. Maya Chen' }),
    0
  )

  // ---- Charting on top of the migrated data -------------------------------
  section('Charting: create / update / delete')
  const drMaya = { id: 1, name: 'Dr. Maya Chen' }
  const historyBefore = main.query('SELECT COUNT(*) AS c FROM tooth_history')[0].c

  // A tooth carrying several findings at once is the whole point of the new model.
  const cond = main.Odontogram.addCondition(
    1,
    { tooth: '14', type: 'crown', status: 'planned', material: 'zirconia', surfaces: [] },
    drMaya
  )
  equal('a second finding can live on tooth 14', main.query("SELECT COUNT(*) AS c FROM tooth_conditions WHERE examination_id = 1 AND tooth = '14'")[0].c, 2)
  equal('zone defaults from the finding type', cond.zone, 'crown')

  main.Odontogram.updateCondition(cond.id, { material: 'gold', note: 'patient prefers gold' }, drMaya)
  const edits = main.query(
    "SELECT * FROM tooth_history WHERE entity = 'condition' AND entity_id = ? AND action = 'updated' ORDER BY id",
    [cond.id]
  )
  equal('one history row per changed field', edits.map((e) => [e.field, e.before, e.after]), [
    ['material', 'zirconia', 'gold'],
    ['note', '', 'patient prefers gold']
  ])

  const bridge = main.Odontogram.addBridge(
    1,
    { type: 'bridge', teeth: ['18', '19', '20'], status: 'existing', label: 'LR bridge' },
    drMaya
  )
  equal('an appliance spans its teeth', bridge.teeth, ['18', '19', '20'])
  let bridgeRefused = ''
  try {
    main.Odontogram.addBridge(1, { teeth: ['18'] }, drMaya)
  } catch (e) {
    bridgeRefused = e.message
  }
  check('a one-tooth bridge is refused', bridgeRefused.includes('at least two teeth'), bridgeRefused)

  const plan = main.Odontogram.addPlan(1, { name: 'Phase 1 — stabilise', accepted: false }, drMaya)
  const proc = main.Odontogram.addProcedure(
    1,
    {
      tx_plan_id: plan.id,
      phase: 1,
      description: 'Composite restoration, two surfaces, posterior',
      teeth: ['3'],
      surfaces: ['occlusal', 'distal'],
      status: 'planned'
    },
    drMaya
  )
  equal('the procedure keeps its blank code', proc.code, '')
  equal('and its surfaces', proc.surfaces, ['occlusal', 'distal'])

  // A primary tooth alongside permanent teeth makes this a mixed-dentition chart.
  const primary = main.Odontogram.addCondition(
    1,
    { tooth: 'A', type: 'caries', status: 'condition' },
    drMaya
  )
  const chart = main.Odontogram.get(1)
  equal('getOdontogram reports mixed dentition', chart.dentition, 'mixed')
  equal('and returns every part of the chart', [
    chart.examination_id,
    chart.conditions.length,
    chart.bridges.length,
    chart.procedures.length,
    chart.plans.length
  ], [1, 10, 1, 1, 1])

  main.Odontogram.deleteCondition(primary.id, drMaya)
  main.Odontogram.deleteProcedure(proc.id, drMaya)
  main.Odontogram.deleteBridge(bridge.id, drMaya)
  main.Odontogram.deletePlan(plan.id, drMaya)
  check(
    'a deleted finding is gone from the chart',
    !main.Odontogram.get(1).conditions.some((c) => c.id === primary.id)
  )
  equal('deletes remove the rows', [
    main.query('SELECT COUNT(*) AS c FROM procedures')[0].c,
    main.query('SELECT COUNT(*) AS c FROM bridge_groups')[0].c,
    main.query('SELECT COUNT(*) AS c FROM tx_plans')[0].c
  ], [0, 0, 0])
  const deletions = main.query("SELECT entity FROM tooth_history WHERE action = 'deleted' ORDER BY id").map((r) => r.entity)
  equal('every delete is in the history', deletions, ['condition', 'procedure', 'bridge', 'chart'])
  check(
    'the history only ever grows',
    main.query('SELECT COUNT(*) AS c FROM tooth_history')[0].c > historyBefore
  )

  // ---- Status transitions -------------------------------------------------
  section('Status transitions are policed by the contract')
  const planned = main.query("SELECT id FROM tooth_conditions WHERE tooth = '30'")[0].id
  let refused = ''
  try {
    main.Odontogram.setStatus('condition', planned, 'completed', { id: 1, name: 'Dr. Maya Chen' })
  } catch (e) {
    refused = e.message
  }
  check('planned -> completed is refused', refused.includes('cannot move'), refused || 'no error thrown')
  equal(
    'and the row is unchanged',
    main.query('SELECT status FROM tooth_conditions WHERE id = ?', [planned])[0].status,
    'planned'
  )
  main.Odontogram.setStatus('condition', planned, 'to_start', { id: 1, name: 'Dr. Maya Chen' })
  equal(
    'planned -> to_start is allowed',
    main.query('SELECT status FROM tooth_conditions WHERE id = ?', [planned])[0].status,
    'to_start'
  )
  const statusLog = main.query(
    "SELECT * FROM tooth_history WHERE action = 'status_changed' ORDER BY id DESC"
  )
  equal('the move is in the history', [statusLog.length, statusLog[0].user_name, statusLog[0].before, statusLog[0].after], [
    1,
    'Dr. Maya Chen',
    'Planned',
    'To Start'
  ])

  // ---- Rollback -----------------------------------------------------------
  section('A migration that throws leaves the database untouched')
  main.execute(
    'INSERT INTO examinations (patient_id, doctor_id, exam_date, tooth_chart_data, treatment_items) VALUES (1, 1, ?, ?, ?)',
    ['2025-02-02', JSON.stringify({ 6: { condition: 'cavity', surfaces: [], note: 'rollback probe' } }), '[]']
  )
  const countBefore = main.query('SELECT COUNT(*) AS c FROM tooth_conditions')[0].c
  const real = main.odontogramDbHandle
  main.bindOdontogramDb({
    ...real,
    run: (sql, params) => {
      if (sql.includes('INSERT INTO tooth_conditions')) throw new Error('disk full (simulated)')
      return real.run(sql, params)
    }
  })
  const failedRun = main.migrateLegacyToothCharts({ force: true })
  main.bindOdontogramDb(real)
  check('the failure is reported, not thrown at the app', failedRun.error === 'disk full (simulated)', failedRun.error)
  equal('no findings were written', main.query('SELECT COUNT(*) AS c FROM tooth_conditions')[0].c, countBefore)
  equal(
    'the legacy blob survived',
    main.query('SELECT tooth_chart_data FROM examinations ORDER BY id DESC LIMIT 1')[0].tooth_chart_data,
    JSON.stringify({ 6: { condition: 'cavity', surfaces: [], note: 'rollback probe' } })
  )
  const retry = main.migrateLegacyToothCharts({ force: true })
  equal('and a retry converts it cleanly', [retry.examinations, retry.conditions], [1, 1])

  section('On disk')
  const persisted = await readTable(dbPath, 'SELECT COUNT(*) AS c FROM tooth_conditions')
  equal('the file on disk holds every finding', persisted[0].c, countBefore + 1)

  // ---- Report -------------------------------------------------------------
  console.log(`\n${'-'.repeat(64)}`)
  if (failures.length) {
    console.log(`FAILED — ${passed} passed, ${failures.length} failed`)
    for (const f of failures) console.log(`  * ${f}`)
  } else {
    console.log(`OK — ${passed} checks passed`)
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  process.exit(failures.length ? 1 : 0)
}

main().catch((e) => {
  console.error('\nThe verification itself blew up:')
  console.error(e)
  process.exit(1)
})

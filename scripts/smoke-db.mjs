// Verifies a Giving Smiles SQLite file: prints seeded users and clinic name.
import initSqlJs from 'sql.js'
import fs from 'node:fs'

const path = process.argv[2]
if (!path || !fs.existsSync(path)) {
  console.error('DB not found at', path)
  process.exit(1)
}
const SQL = await initSqlJs({ locateFile: () => 'node_modules/sql.js/dist/sql-wasm.wasm' })
const db = new SQL.Database(fs.readFileSync(path))

const users = db.exec('SELECT username, full_name, role FROM users ORDER BY id')
console.log('USERS:', JSON.stringify(users[0]?.values))

const clinic = db.exec("SELECT value FROM app_settings WHERE key='clinic_name'")
console.log('CLINIC:', clinic[0]?.values?.[0]?.[0])

const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
console.log('TABLES:', JSON.stringify(tables[0]?.values?.flat()))

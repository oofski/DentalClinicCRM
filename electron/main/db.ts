import { app } from 'electron'
import { join } from 'node:path'
import fs from 'node:fs'
import initSqlJs, { type Database } from 'sql.js'
import bcrypt from 'bcryptjs'

let db: Database
let dbPath: string

function wasmPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'sql-wasm.wasm')
  }
  return join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
}

export function dataDir(): string {
  const dir = join(app.getPath('userData'), 'GivingSmilesData')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmPath() })
  dbPath = join(dataDir(), 'givingsmiles.db')

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA foreign_keys = ON;')
  createSchema()
  migrate()
  seedDefaults()
  persist()
}

// Adds columns introduced after v1.0 without disturbing existing installed databases.
function migrate(): void {
  ensureColumn('patients', 'event_id', 'event_id INTEGER REFERENCES events(id)')
}

function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = query<{ name: string }>(`PRAGMA table_info(${table})`)
  if (!cols.some((c) => c.name === column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

function createSchema(): void {
  db.exec(`
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
      phone TEXT,
      email TEXT,
      address TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      allergies TEXT,
      medical_conditions TEXT,
      medications TEXT,
      dental_history TEXT,
      insurance_info TEXT,
      referring_doctor TEXT,
      preferred_language TEXT NOT NULL DEFAULT 'english',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS consent_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      form_type TEXT,
      language TEXT,
      signed_by_name TEXT,
      signed_at TEXT NOT NULL,
      pdf_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id)
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

    CREATE TABLE IF NOT EXISTS clinical_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      examination_id INTEGER NOT NULL,
      note_type TEXT,
      content TEXT NOT NULL,
      linked_teeth TEXT,
      edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (examination_id) REFERENCES examinations(id)
    );

    CREATE TABLE IF NOT EXISTS treatment_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      examination_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      pdf_path TEXT,
      approved_by_doctor_id INTEGER,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (examination_id) REFERENCES examinations(id),
      FOREIGN KEY (approved_by_doctor_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS patient_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      image_type TEXT,
      file_path TEXT NOT NULL,
      date_taken TEXT,
      notes TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      patient_id INTEGER,
      action TEXT,
      detail TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT,
      event_date TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referral_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      specialty TEXT,
      clinic_name TEXT NOT NULL DEFAULT '',
      clinic_address TEXT,
      clinic_phone TEXT,
      clinic_email TEXT,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      template_id INTEGER,
      doctor_id INTEGER NOT NULL,
      pdf_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (template_id) REFERENCES referral_templates(id),
      FOREIGN KEY (doctor_id) REFERENCES users(id)
    );
  `)
}

const DEFAULT_PASSWORD = 'admin123'

function seedDefaults(): void {
  const row = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM users')
  if (!row || row.c === 0) {
    // A fresh install bootstraps with a single generic administrator account.
    // The clinic signs in as admin / admin123 and creates their own staff logins
    // (and should change this password) from Settings → User Management.
    const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10)
    db.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)', [
      'admin',
      hash,
      'Administrator',
      'admin'
    ])
  }

  const tpl = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM referral_templates')
  if (!tpl || tpl.c === 0) {
    db.run(
      `INSERT INTO referral_templates (name, specialty, clinic_name, clinic_address, clinic_phone, clinic_email, body)
       VALUES (?,?,?,?,?,?,?)`,
      [
        'Standard Referral',
        '',
        'Receiving Clinic',
        '',
        '',
        '',
        'Dear Colleague,\n\nI am referring the above patient to your office for evaluation and treatment. The relevant clinical information is included in this letter.\n\nPlease contact our office if you require any additional records or have any questions.\n\nThank you for your care of this patient.'
      ]
    )
  }

  const defaults: Record<string, string> = {
    clinic_name: 'Giving Smiles',
    address: '123 Wellness Avenue, Suite 200, Your City, ST 00000',
    phone: '(000) 000-0000',
    license_number: 'LIC-000000',
    email: 'hello@givingsmiles.example',
    default_language: 'english',
    active_event_id: '',
    smtp_host: '',
    smtp_port: '587',
    smtp_secure: 'false',
    smtp_user: '',
    smtp_pass: '',
    smtp_from: ''
  }
  for (const [key, value] of Object.entries(defaults)) {
    const existing = queryOne<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
      key
    ])
    if (!existing) {
      db.run('INSERT INTO app_settings (key, value) VALUES (?, ?)', [key, value])
    }
  }
}

// ---- Persistence (synchronous write-through, atomic) ----
export function persist(): void {
  if (!db) return
  const data = Buffer.from(db.export())
  const tmp = `${dbPath}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, dbPath)
}

// ---- Query helpers ----
type Param = string | number | null | Uint8Array

export function query<T = Record<string, unknown>>(sql: string, params: Param[] = []): T[] {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) rows.push(stmt.getAsObject() as unknown as T)
    return rows
  } finally {
    stmt.free()
  }
}

export function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: Param[] = []
): T | undefined {
  return query<T>(sql, params)[0]
}

export function execute(sql: string, params: Param[] = []): void {
  db.run(sql, params)
  persist()
}

export function executeReturningId(sql: string, params: Param[] = []): number {
  db.run(sql, params)
  const row = queryOne<{ id: number }>('SELECT last_insert_rowid() AS id')
  persist()
  return row ? Number(row.id) : 0
}

export function exportDatabase(): Uint8Array {
  return db.export()
}

export function getDbPath(): string {
  return dbPath
}

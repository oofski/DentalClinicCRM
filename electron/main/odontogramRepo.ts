// Odontogram persistence: the relational chart that replaces the one-condition-per-tooth
// JSON blob in `examinations.tooth_chart_data`.
//
// Everything here is written against shared/odontogram.ts — that file is the contract and
// this file never invents a field or a status the contract does not define.
//
// The module deliberately does NOT import ./db. The database handle is injected by db.ts
// (`bindOdontogramDb`) for two reasons: it keeps the import graph one-way (db -> repo), and
// it lets scripts/odontogram-migrate.mjs drive the real migration against a throwaway
// database without dragging Electron into the process.
import {
  canTransition,
  isPrimary,
  STATUS_LABELS,
  SURFACE_LETTER,
  TOOTH_BY_ID,
  type ApplianceType,
  type BridgeGroup,
  type ClinicalStatus,
  type ConditionType,
  type Dentition,
  type OdontogramData,
  type Procedure,
  type ProcedureCode,
  type SurfaceKey,
  type ToothCondition,
  type ToothHistoryEntry,
  type ToothId,
  type ToothZone,
  type TxPlan
} from '@shared/odontogram'

// ---------------------------------------------------------------------------
// Database handle (injected by db.ts)
// ---------------------------------------------------------------------------

export type Param = string | number | null | Uint8Array

export interface OdontogramDb {
  /** Read rows. */
  query<T = Record<string, unknown>>(sql: string, params?: Param[]): T[]
  /** Execute one statement WITHOUT writing the file — persistence is batched per operation. */
  run(sql: string, params?: Param[]): void
  /** Flush the in-memory database to disk. */
  persist(): void
  /** rowid of the last insert on this connection. */
  lastInsertId(): number
}

let handle: OdontogramDb | null = null

export function bindOdontogramDb(h: OdontogramDb): void {
  handle = h
}

function dbh(): OdontogramDb {
  if (!handle) throw new Error('Odontogram database is not initialised')
  return handle
}

function rows<T = Record<string, unknown>>(sql: string, params: Param[] = []): T[] {
  return dbh().query<T>(sql, params)
}

function one<T = Record<string, unknown>>(sql: string, params: Param[] = []): T | undefined {
  return rows<T>(sql, params)[0]
}

// A single logical edit (the row plus its history entry) is one transaction, so the audit
// trail can never be missing for a change that made it into the chart.
let txDepth = 0
function tx<T>(fn: () => T): T {
  const db = dbh()
  if (txDepth > 0) return fn()
  txDepth = 1
  db.run('BEGIN')
  try {
    const result = fn()
    db.run('COMMIT')
    txDepth = 0
    db.persist()
    return result
  } catch (e) {
    try {
      db.run('ROLLBACK')
    } catch {
      /* the transaction was already unwound */
    }
    txDepth = 0
    // No persist(): the file on disk still holds the pre-transaction state.
    throw e
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

// Created by db.ts's createSchema() with the rest of the schema, so an existing install
// picks the tables up on the next launch without a separate upgrade step.
export const ODONTOGRAM_DDL = `
  CREATE TABLE IF NOT EXISTS bridge_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    examination_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'bridge',
    teeth TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'existing',
    label TEXT,
    note TEXT,
    FOREIGN KEY (examination_id) REFERENCES examinations(id)
  );

  CREATE TABLE IF NOT EXISTS tx_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    examination_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (examination_id) REFERENCES examinations(id)
  );

  CREATE TABLE IF NOT EXISTS procedures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    examination_id INTEGER NOT NULL,
    tx_plan_id INTEGER,
    phase INTEGER NOT NULL DEFAULT 1,
    code TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    teeth TEXT NOT NULL DEFAULT '[]',
    surfaces TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'planned',
    provider_id INTEGER,
    provider_name TEXT,
    location TEXT,
    date TEXT,
    fee REAL,
    insurance_estimate REAL,
    patient_portion REAL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (examination_id) REFERENCES examinations(id),
    FOREIGN KEY (tx_plan_id) REFERENCES tx_plans(id),
    FOREIGN KEY (provider_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tooth_conditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    examination_id INTEGER NOT NULL,
    tooth TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    zone TEXT NOT NULL DEFAULT 'whole',
    surfaces TEXT NOT NULL DEFAULT '[]',
    material TEXT,
    badge TEXT,
    bridge_group_id INTEGER,
    procedure_id INTEGER,
    provider_id INTEGER,
    provider_name TEXT,
    date_recorded TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT,
    FOREIGN KEY (examination_id) REFERENCES examinations(id),
    FOREIGN KEY (bridge_group_id) REFERENCES bridge_groups(id),
    FOREIGN KEY (procedure_id) REFERENCES procedures(id),
    FOREIGN KEY (provider_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS procedure_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    default_fee REAL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS tooth_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    examination_id INTEGER NOT NULL,
    tooth TEXT,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    action TEXT NOT NULL,
    field TEXT,
    "before" TEXT,
    "after" TEXT,
    user_id INTEGER,
    user_name TEXT,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tooth_conditions_exam ON tooth_conditions(examination_id);
  CREATE INDEX IF NOT EXISTS idx_tooth_conditions_tooth ON tooth_conditions(tooth);
  CREATE INDEX IF NOT EXISTS idx_tooth_conditions_exam_tooth ON tooth_conditions(examination_id, tooth);
  CREATE INDEX IF NOT EXISTS idx_bridge_groups_exam ON bridge_groups(examination_id);
  CREATE INDEX IF NOT EXISTS idx_tx_plans_exam ON tx_plans(examination_id);
  CREATE INDEX IF NOT EXISTS idx_procedures_exam ON procedures(examination_id);
  CREATE INDEX IF NOT EXISTS idx_procedures_plan ON procedures(tx_plan_id);
  CREATE INDEX IF NOT EXISTS idx_tooth_history_exam ON tooth_history(examination_id);
  CREATE INDEX IF NOT EXISTS idx_tooth_history_tooth ON tooth_history(tooth);
  CREATE INDEX IF NOT EXISTS idx_procedure_codes_desc ON procedure_codes(description);
`

// ---------------------------------------------------------------------------
// Validation — everything below crosses an IPC boundary, so nothing is trusted
// ---------------------------------------------------------------------------

// Written as an exhaustive Record so a ConditionType added to the contract fails the build
// here until it is handled, instead of silently being rejected at runtime.
const CONDITION_TYPE_SET: Record<ConditionType, true> = {
  healthy: true, caries: true, restoration: true, crown: true, veneer: true, sealant: true,
  root_canal: true, post_core: true, apicoectomy: true, implant: true, bridge_abutment: true,
  bridge_pontic: true, denture: true, extraction: true, missing: true, impacted: true,
  unerupted: true, fracture: true, abscess: true, mobility: true, recession: true, watch: true
}
const ZONE_SET: Record<ToothZone, true> = { crown: true, root: true, whole: true }
const APPLIANCE_SET: Record<ApplianceType, true> = {
  bridge: true, denture: true, partial: true, splint: true, retainer: true
}

function isConditionType(v: unknown): v is ConditionType {
  return typeof v === 'string' && v in CONDITION_TYPE_SET
}
function isStatus(v: unknown): v is ClinicalStatus {
  return typeof v === 'string' && v in STATUS_LABELS
}
function isZone(v: unknown): v is ToothZone {
  return typeof v === 'string' && v in ZONE_SET
}
function isAppliance(v: unknown): v is ApplianceType {
  return typeof v === 'string' && v in APPLIANCE_SET
}
function isSurface(v: unknown): v is SurfaceKey {
  return typeof v === 'string' && v in SURFACE_LETTER
}

function assertType(v: unknown): ConditionType {
  if (!isConditionType(v)) throw new Error(`Unknown condition type: ${String(v)}`)
  return v
}
function assertStatus(v: unknown): ClinicalStatus {
  if (!isStatus(v)) throw new Error(`Unknown status: ${String(v)}`)
  return v
}
function assertZone(v: unknown): ToothZone {
  if (!isZone(v)) throw new Error(`Unknown tooth zone: ${String(v)}`)
  return v
}
function assertAppliance(v: unknown): ApplianceType {
  if (!isAppliance(v)) throw new Error(`Unknown appliance type: ${String(v)}`)
  return v
}
function assertTooth(v: unknown): ToothId {
  const id = String(v ?? '').trim().toUpperCase()
  if (!TOOTH_BY_ID.has(id)) throw new Error(`Not a tooth in the Universal notation: ${String(v)}`)
  return id
}
function assertTeeth(v: unknown): ToothId[] {
  const list = Array.isArray(v) ? v : []
  return list.map(assertTooth)
}
function cleanSurfaces(v: unknown): SurfaceKey[] {
  const list = Array.isArray(v) ? v : []
  const out: SurfaceKey[] = []
  for (const s of list) if (isSurface(s) && !out.includes(s)) out.push(s)
  return out
}

/** A status move that the contract's state machine forbids is refused, not recorded. */
function assertTransition(from: ClinicalStatus, to: ClinicalStatus, what: string): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `${what} cannot move from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}`
    )
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s.length ? s : null
}

function mapCondition(r: any): ToothCondition {
  return {
    id: Number(r.id),
    examination_id: Number(r.examination_id),
    tooth: String(r.tooth),
    type: r.type as ConditionType,
    status: r.status as ClinicalStatus,
    zone: (r.zone ?? 'whole') as ToothZone,
    surfaces: safeJson<SurfaceKey[]>(r.surfaces, []),
    material: r.material ?? undefined,
    badge: r.badge ?? undefined,
    bridge_group_id: r.bridge_group_id != null ? Number(r.bridge_group_id) : null,
    procedure_id: r.procedure_id != null ? Number(r.procedure_id) : null,
    provider_id: r.provider_id != null ? Number(r.provider_id) : null,
    provider_name: r.provider_name ?? undefined,
    date_recorded: r.date_recorded,
    note: r.note ?? undefined
  }
}

function mapBridge(r: any): BridgeGroup {
  return {
    id: Number(r.id),
    examination_id: Number(r.examination_id),
    type: r.type as ApplianceType,
    teeth: safeJson<ToothId[]>(r.teeth, []),
    status: r.status as ClinicalStatus,
    label: r.label ?? undefined,
    note: r.note ?? undefined
  }
}

function mapProcedure(r: any): Procedure {
  return {
    id: Number(r.id),
    examination_id: Number(r.examination_id),
    tx_plan_id: r.tx_plan_id != null ? Number(r.tx_plan_id) : null,
    phase: Number(r.phase ?? 1),
    code: r.code ?? '',
    description: r.description ?? '',
    teeth: safeJson<ToothId[]>(r.teeth, []),
    surfaces: safeJson<SurfaceKey[]>(r.surfaces, []),
    status: r.status as ClinicalStatus,
    provider_id: r.provider_id != null ? Number(r.provider_id) : null,
    provider_name: r.provider_name ?? undefined,
    location: r.location ?? undefined,
    date: r.date ?? undefined,
    fee: r.fee != null ? Number(r.fee) : null,
    insurance_estimate: r.insurance_estimate != null ? Number(r.insurance_estimate) : null,
    patient_portion: r.patient_portion != null ? Number(r.patient_portion) : null,
    note: r.note ?? undefined,
    created_at: r.created_at
  }
}

function mapPlan(r: any): TxPlan {
  return {
    id: Number(r.id),
    examination_id: Number(r.examination_id),
    name: r.name,
    accepted: Number(r.accepted) === 1,
    created_at: r.created_at
  }
}

function mapCode(r: any): ProcedureCode {
  return {
    id: Number(r.id),
    code: r.code ?? '',
    description: r.description ?? '',
    category: r.category ?? '',
    default_fee: r.default_fee != null ? Number(r.default_fee) : null,
    active: Number(r.active) === 1
  }
}

function mapHistory(r: any): ToothHistoryEntry {
  return {
    id: Number(r.id),
    examination_id: Number(r.examination_id),
    tooth: r.tooth ?? null,
    entity: r.entity,
    entity_id: r.entity_id != null ? Number(r.entity_id) : null,
    action: r.action,
    field: r.field ?? undefined,
    before: r.before ?? undefined,
    after: r.after ?? undefined,
    user_id: r.user_id != null ? Number(r.user_id) : null,
    user_name: r.user_name ?? undefined,
    at: r.at
  }
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/** Who is making the change. ipc.ts fills this in from requireUser(). */
export interface ActingUser {
  id: number | null
  name: string
}

const SYSTEM_USER: ActingUser = { id: null, name: 'System (upgrade)' }

interface HistoryInput {
  examination_id: number
  tooth?: ToothId | null
  entity: ToothHistoryEntry['entity']
  entity_id?: number | null
  action: ToothHistoryEntry['action']
  field?: string | null
  before?: string | null
  after?: string | null
}

// Append-only: nothing in this module ever UPDATEs or DELETEs a tooth_history row.
function writeHistory(entry: HistoryInput, user: ActingUser): void {
  dbh().run(
    `INSERT INTO tooth_history
       (examination_id, tooth, entity, entity_id, action, field, "before", "after", user_id, user_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      entry.examination_id,
      entry.tooth ?? null,
      entry.entity,
      entry.entity_id ?? null,
      entry.action,
      entry.field ?? null,
      entry.before ?? null,
      entry.after ?? null,
      user.id ?? null,
      user.name
    ]
  )
}

/** History values are plain strings, so a JSON column reads as MOD rather than ["mesial",…]. */
function display(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

// ---------------------------------------------------------------------------
// Field definitions shared by create / update / history
// ---------------------------------------------------------------------------

type Coerce = (value: unknown) => Param

const jsonList: Coerce = (v) => JSON.stringify(Array.isArray(v) ? v : [])

const CONDITION_FIELDS: Record<string, Coerce> = {
  tooth: (v) => assertTooth(v),
  type: (v) => assertType(v),
  status: (v) => assertStatus(v),
  zone: (v) => assertZone(v),
  surfaces: (v) => JSON.stringify(cleanSurfaces(v)),
  material: (v) => text(v),
  badge: (v) => text(v),
  bridge_group_id: (v) => num(v),
  procedure_id: (v) => num(v),
  provider_id: (v) => num(v),
  provider_name: (v) => text(v),
  date_recorded: (v) => text(v) ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
  note: (v) => text(v)
}

const BRIDGE_FIELDS: Record<string, Coerce> = {
  type: (v) => assertAppliance(v),
  teeth: (v) => JSON.stringify(assertTeeth(v)),
  status: (v) => assertStatus(v),
  label: (v) => text(v),
  note: (v) => text(v)
}

const PROCEDURE_FIELDS: Record<string, Coerce> = {
  tx_plan_id: (v) => num(v),
  phase: (v) => num(v) ?? 1,
  code: (v) => String(v ?? ''),
  description: (v) => String(v ?? ''),
  teeth: (v) => JSON.stringify(assertTeeth(v)),
  surfaces: (v) => JSON.stringify(cleanSurfaces(v)),
  status: (v) => assertStatus(v),
  provider_id: (v) => num(v),
  provider_name: (v) => text(v),
  location: (v) => text(v),
  date: (v) => text(v),
  fee: (v) => num(v),
  insurance_estimate: (v) => num(v),
  patient_portion: (v) => num(v),
  note: (v) => text(v)
}

const PLAN_FIELDS: Record<string, Coerce> = {
  name: (v) => String(v ?? '').trim(),
  accepted: (v) => (v ? 1 : 0)
}

/** Findings that belong to a specific part of the tooth, so the renderer draws the right row. */
const ZONE_BY_TYPE: Partial<Record<ConditionType, ToothZone>> = {
  caries: 'crown',
  restoration: 'crown',
  crown: 'crown',
  veneer: 'crown',
  sealant: 'crown',
  fracture: 'crown',
  root_canal: 'root',
  post_core: 'root',
  apicoectomy: 'root',
  abscess: 'root',
  recession: 'root'
}

function defaultZone(type: ConditionType): ToothZone {
  return ZONE_BY_TYPE[type] ?? 'whole'
}

// Builds the column/value lists for an INSERT from a caller-supplied object.
function buildInsert(
  fields: Record<string, Coerce>,
  input: Record<string, unknown>,
  required: string[] = []
): { cols: string[]; params: Param[] } {
  const cols: string[] = []
  const params: Param[] = []
  for (const [col, coerce] of Object.entries(fields)) {
    const provided = Object.prototype.hasOwnProperty.call(input, col) && input[col] !== undefined
    if (!provided && !required.includes(col)) continue
    cols.push(col)
    params.push(coerce(input[col]))
  }
  return { cols, params }
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

function conditionById(id: number): ToothCondition | undefined {
  const r = one('SELECT * FROM tooth_conditions WHERE id = ?', [id])
  return r ? mapCondition(r) : undefined
}

function listConditions(examinationId: number): ToothCondition[] {
  return rows(
    'SELECT * FROM tooth_conditions WHERE examination_id = ? ORDER BY date_recorded ASC, id ASC',
    [examinationId]
  ).map(mapCondition)
}

function addCondition(
  examinationId: number,
  input: Record<string, unknown>,
  user: ActingUser
): ToothCondition {
  const tooth = assertTooth(input.tooth)
  const type = assertType(input.type)
  const status = assertStatus(input.status ?? 'condition')
  const payload = {
    ...input,
    tooth,
    type,
    status,
    zone: input.zone ?? defaultZone(type)
  }
  return tx(() => {
    const { cols, params } = buildInsert(CONDITION_FIELDS, payload, [
      'tooth',
      'type',
      'status',
      'zone',
      'surfaces',
      'date_recorded'
    ])
    dbh().run(
      `INSERT INTO tooth_conditions (examination_id, ${cols.join(', ')})
       VALUES (${['?', ...cols.map(() => '?')].join(', ')})`,
      [examinationId, ...params]
    )
    const id = dbh().lastInsertId()
    writeHistory(
      {
        examination_id: examinationId,
        tooth,
        entity: 'condition',
        entity_id: id,
        action: 'created',
        after: `${type} (${STATUS_LABELS[status]})`
      },
      user
    )
    return conditionById(id)!
  })
}

function updateCondition(
  id: number,
  patch: Record<string, unknown>,
  user: ActingUser
): ToothCondition {
  const current = conditionById(id)
  if (!current) throw new Error('That finding no longer exists')

  return tx(() => {
    const sets: string[] = []
    const params: Param[] = []
    const changes: HistoryInput[] = []

    for (const [col, coerce] of Object.entries(CONDITION_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(patch, col)) continue
      if (patch[col] === undefined) continue

      const before = (current as unknown as Record<string, unknown>)[col]
      if (col === 'status') {
        const next = assertStatus(patch[col])
        if (next === current.status) continue
        assertTransition(current.status, next, 'This finding')
        sets.push('status = ?')
        params.push(next)
        changes.push({
          examination_id: current.examination_id,
          tooth: current.tooth,
          entity: 'condition',
          entity_id: id,
          action: 'status_changed',
          field: 'status',
          before: STATUS_LABELS[current.status],
          after: STATUS_LABELS[next]
        })
        continue
      }

      const value = coerce(patch[col])
      const beforeText = display(before)
      const afterText =
        col === 'surfaces' ? display(cleanSurfaces(patch[col])) : display(patch[col])
      if (beforeText === afterText) continue
      sets.push(`${col} = ?`)
      params.push(value)
      changes.push({
        examination_id: current.examination_id,
        tooth: col === 'tooth' ? String(value) : current.tooth,
        entity: 'condition',
        entity_id: id,
        action: 'updated',
        field: col,
        before: beforeText,
        after: afterText
      })
    }

    if (!sets.length) return current
    dbh().run(`UPDATE tooth_conditions SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
    for (const c of changes) writeHistory(c, user)
    return conditionById(id)!
  })
}

function deleteCondition(id: number, user: ActingUser): void {
  const current = conditionById(id)
  if (!current) return
  tx(() => {
    dbh().run('DELETE FROM tooth_conditions WHERE id = ?', [id])
    writeHistory(
      {
        examination_id: current.examination_id,
        tooth: current.tooth,
        entity: 'condition',
        entity_id: id,
        action: 'deleted',
        before: `${current.type} (${STATUS_LABELS[current.status]})`
      },
      user
    )
  })
}

// ---------------------------------------------------------------------------
// Bridges / appliances
// ---------------------------------------------------------------------------

function bridgeById(id: number): BridgeGroup | undefined {
  const r = one('SELECT * FROM bridge_groups WHERE id = ?', [id])
  return r ? mapBridge(r) : undefined
}

function listBridges(examinationId: number): BridgeGroup[] {
  return rows('SELECT * FROM bridge_groups WHERE examination_id = ? ORDER BY id ASC', [
    examinationId
  ]).map(mapBridge)
}

function addBridge(
  examinationId: number,
  input: Record<string, unknown>,
  user: ActingUser
): BridgeGroup {
  const teeth = assertTeeth(input.teeth)
  if (teeth.length < 2) throw new Error('An appliance has to span at least two teeth')
  const type = assertAppliance(input.type ?? 'bridge')
  const status = assertStatus(input.status ?? 'existing')
  return tx(() => {
    const { cols, params } = buildInsert(
      BRIDGE_FIELDS,
      { ...input, teeth, type, status },
      ['type', 'teeth', 'status']
    )
    dbh().run(
      `INSERT INTO bridge_groups (examination_id, ${cols.join(', ')})
       VALUES (${['?', ...cols.map(() => '?')].join(', ')})`,
      [examinationId, ...params]
    )
    const id = dbh().lastInsertId()
    writeHistory(
      {
        examination_id: examinationId,
        tooth: teeth[0],
        entity: 'bridge',
        entity_id: id,
        action: 'created',
        after: `${type} ${teeth.join('-')} (${STATUS_LABELS[status]})`
      },
      user
    )
    return bridgeById(id)!
  })
}

function updateBridge(
  id: number,
  patch: Record<string, unknown>,
  user: ActingUser
): BridgeGroup {
  const current = bridgeById(id)
  if (!current) throw new Error('That appliance no longer exists')
  return tx(() => {
    const sets: string[] = []
    const params: Param[] = []
    const changes: HistoryInput[] = []
    for (const [col, coerce] of Object.entries(BRIDGE_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(patch, col) || patch[col] === undefined) continue
      if (col === 'status') {
        const next = assertStatus(patch[col])
        if (next === current.status) continue
        assertTransition(current.status, next, 'This appliance')
        sets.push('status = ?')
        params.push(next)
        changes.push({
          examination_id: current.examination_id,
          tooth: current.teeth[0] ?? null,
          entity: 'bridge',
          entity_id: id,
          action: 'status_changed',
          field: 'status',
          before: STATUS_LABELS[current.status],
          after: STATUS_LABELS[next]
        })
        continue
      }
      const before = display((current as unknown as Record<string, unknown>)[col])
      const after = col === 'teeth' ? display(assertTeeth(patch[col])) : display(patch[col])
      if (before === after) continue
      sets.push(`${col} = ?`)
      params.push(coerce(patch[col]))
      changes.push({
        examination_id: current.examination_id,
        tooth: current.teeth[0] ?? null,
        entity: 'bridge',
        entity_id: id,
        action: 'updated',
        field: col,
        before,
        after
      })
    }
    if (!sets.length) return current
    dbh().run(`UPDATE bridge_groups SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
    for (const c of changes) writeHistory(c, user)
    return bridgeById(id)!
  })
}

function deleteBridge(id: number, user: ActingUser): void {
  const current = bridgeById(id)
  if (!current) return
  tx(() => {
    // The teeth keep their own findings; only the connection between them goes.
    dbh().run('UPDATE tooth_conditions SET bridge_group_id = NULL WHERE bridge_group_id = ?', [id])
    dbh().run('DELETE FROM bridge_groups WHERE id = ?', [id])
    writeHistory(
      {
        examination_id: current.examination_id,
        tooth: current.teeth[0] ?? null,
        entity: 'bridge',
        entity_id: id,
        action: 'deleted',
        before: `${current.type} ${current.teeth.join('-')}`
      },
      user
    )
  })
}

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

function procedureById(id: number): Procedure | undefined {
  const r = one('SELECT * FROM procedures WHERE id = ?', [id])
  return r ? mapProcedure(r) : undefined
}

function listProcedures(examinationId: number): Procedure[] {
  return rows(
    'SELECT * FROM procedures WHERE examination_id = ? ORDER BY phase ASC, id ASC',
    [examinationId]
  ).map(mapProcedure)
}

function addProcedure(
  examinationId: number,
  input: Record<string, unknown>,
  user: ActingUser
): Procedure {
  const teeth = assertTeeth(input.teeth)
  const status = assertStatus(input.status ?? 'planned')
  const description = String(input.description ?? '').trim()
  if (!description) throw new Error('A procedure needs a description')
  return tx(() => {
    const { cols, params } = buildInsert(
      PROCEDURE_FIELDS,
      { ...input, teeth, status, description },
      ['phase', 'code', 'description', 'teeth', 'surfaces', 'status']
    )
    dbh().run(
      `INSERT INTO procedures (examination_id, ${cols.join(', ')})
       VALUES (${['?', ...cols.map(() => '?')].join(', ')})`,
      [examinationId, ...params]
    )
    const id = dbh().lastInsertId()
    writeHistory(
      {
        examination_id: examinationId,
        tooth: teeth[0] ?? null,
        entity: 'procedure',
        entity_id: id,
        action: 'created',
        after: `${description}${teeth.length ? ` — ${teeth.join(', ')}` : ''} (${STATUS_LABELS[status]})`
      },
      user
    )
    return procedureById(id)!
  })
}

function updateProcedure(
  id: number,
  patch: Record<string, unknown>,
  user: ActingUser
): Procedure {
  const current = procedureById(id)
  if (!current) throw new Error('That procedure no longer exists')
  return tx(() => {
    const sets: string[] = []
    const params: Param[] = []
    const changes: HistoryInput[] = []
    for (const [col, coerce] of Object.entries(PROCEDURE_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(patch, col) || patch[col] === undefined) continue
      if (col === 'status') {
        const next = assertStatus(patch[col])
        if (next === current.status) continue
        assertTransition(current.status, next, 'This procedure')
        sets.push('status = ?')
        params.push(next)
        changes.push({
          examination_id: current.examination_id,
          tooth: current.teeth[0] ?? null,
          entity: 'procedure',
          entity_id: id,
          action: 'status_changed',
          field: 'status',
          before: STATUS_LABELS[current.status],
          after: STATUS_LABELS[next]
        })
        continue
      }
      const before = display((current as unknown as Record<string, unknown>)[col])
      const after =
        col === 'teeth'
          ? display(assertTeeth(patch[col]))
          : col === 'surfaces'
            ? display(cleanSurfaces(patch[col]))
            : display(patch[col])
      if (before === after) continue
      sets.push(`${col} = ?`)
      params.push(coerce(patch[col]))
      changes.push({
        examination_id: current.examination_id,
        tooth: current.teeth[0] ?? null,
        entity: 'procedure',
        entity_id: id,
        action: 'updated',
        field: col,
        before,
        after
      })
    }
    if (!sets.length) return current
    dbh().run(`UPDATE procedures SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
    for (const c of changes) writeHistory(c, user)
    return procedureById(id)!
  })
}

function deleteProcedure(id: number, user: ActingUser): void {
  const current = procedureById(id)
  if (!current) return
  tx(() => {
    dbh().run('UPDATE tooth_conditions SET procedure_id = NULL WHERE procedure_id = ?', [id])
    dbh().run('DELETE FROM procedures WHERE id = ?', [id])
    writeHistory(
      {
        examination_id: current.examination_id,
        tooth: current.teeth[0] ?? null,
        entity: 'procedure',
        entity_id: id,
        action: 'deleted',
        before: `${current.description}${current.teeth.length ? ` — ${current.teeth.join(', ')}` : ''}`
      },
      user
    )
  })
}

// ---------------------------------------------------------------------------
// Treatment plans
// ---------------------------------------------------------------------------

function planById(id: number): TxPlan | undefined {
  const r = one('SELECT * FROM tx_plans WHERE id = ?', [id])
  return r ? mapPlan(r) : undefined
}

function listPlans(examinationId: number): TxPlan[] {
  return rows('SELECT * FROM tx_plans WHERE examination_id = ? ORDER BY id ASC', [
    examinationId
  ]).map(mapPlan)
}

function addPlan(examinationId: number, input: Record<string, unknown>, user: ActingUser): TxPlan {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('A treatment plan needs a name')
  return tx(() => {
    const { cols, params } = buildInsert(PLAN_FIELDS, { ...input, name }, ['name', 'accepted'])
    dbh().run(
      `INSERT INTO tx_plans (examination_id, ${cols.join(', ')})
       VALUES (${['?', ...cols.map(() => '?')].join(', ')})`,
      [examinationId, ...params]
    )
    const id = dbh().lastInsertId()
    writeHistory(
      {
        examination_id: examinationId,
        entity: 'chart',
        entity_id: id,
        action: 'created',
        field: 'plan',
        after: name
      },
      user
    )
    return planById(id)!
  })
}

function updatePlan(id: number, patch: Record<string, unknown>, user: ActingUser): TxPlan {
  const current = planById(id)
  if (!current) throw new Error('That treatment plan no longer exists')
  return tx(() => {
    const sets: string[] = []
    const params: Param[] = []
    const changes: HistoryInput[] = []
    for (const [col, coerce] of Object.entries(PLAN_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(patch, col) || patch[col] === undefined) continue
      const before = display((current as unknown as Record<string, unknown>)[col])
      const after = col === 'accepted' ? display(!!patch[col]) : display(patch[col])
      if (before === after) continue
      sets.push(`${col} = ?`)
      params.push(coerce(patch[col]))
      changes.push({
        examination_id: current.examination_id,
        entity: 'chart',
        entity_id: id,
        action: 'updated',
        field: `plan.${col}`,
        before,
        after
      })
    }
    if (!sets.length) return current
    dbh().run(`UPDATE tx_plans SET ${sets.join(', ')} WHERE id = ?`, [...params, id])
    for (const c of changes) writeHistory(c, user)
    return planById(id)!
  })
}

function deletePlan(id: number, user: ActingUser): void {
  const current = planById(id)
  if (!current) return
  tx(() => {
    // Procedures survive their plan; they simply stop belonging to one.
    dbh().run('UPDATE procedures SET tx_plan_id = NULL WHERE tx_plan_id = ?', [id])
    dbh().run('DELETE FROM tx_plans WHERE id = ?', [id])
    writeHistory(
      {
        examination_id: current.examination_id,
        entity: 'chart',
        entity_id: id,
        action: 'deleted',
        field: 'plan',
        before: current.name
      },
      user
    )
  })
}

// ---------------------------------------------------------------------------
// Status changes (the one entry point the ledger uses)
// ---------------------------------------------------------------------------

export type StatusEntity = 'condition' | 'procedure' | 'bridge'

function setStatus(
  entity: StatusEntity,
  id: number,
  status: unknown,
  user: ActingUser
): ToothCondition | Procedure | BridgeGroup {
  const next = assertStatus(status)
  if (entity === 'condition') return updateCondition(id, { status: next }, user)
  if (entity === 'procedure') return updateProcedure(id, { status: next }, user)
  if (entity === 'bridge') return updateBridge(id, { status: next }, user)
  throw new Error(`Unknown chart entity: ${String(entity)}`)
}

// ---------------------------------------------------------------------------
// The whole chart
// ---------------------------------------------------------------------------

function dentitionOf(teeth: ToothId[]): Dentition | 'mixed' {
  let primary = false
  let permanent = false
  for (const t of teeth) {
    if (isPrimary(t)) primary = true
    else permanent = true
  }
  if (primary && permanent) return 'mixed'
  if (primary) return 'primary'
  return 'permanent'
}

export function getOdontogram(examinationId: number): OdontogramData {
  const conditions = listConditions(examinationId)
  const bridges = listBridges(examinationId)
  const procedures = listProcedures(examinationId)
  const plans = listPlans(examinationId)
  const teeth = [
    ...conditions.map((c) => c.tooth),
    ...bridges.flatMap((b) => b.teeth),
    ...procedures.flatMap((p) => p.teeth)
  ]
  return {
    examination_id: examinationId,
    dentition: dentitionOf(teeth),
    conditions,
    bridges,
    procedures,
    plans
  }
}

function history(examinationId: number, tooth?: ToothId | null): ToothHistoryEntry[] {
  if (tooth) {
    return rows(
      'SELECT * FROM tooth_history WHERE examination_id = ? AND tooth = ? ORDER BY id DESC',
      [examinationId, assertTooth(tooth)]
    ).map(mapHistory)
  }
  return rows('SELECT * FROM tooth_history WHERE examination_id = ? ORDER BY id DESC', [
    examinationId
  ]).map(mapHistory)
}

// ---------------------------------------------------------------------------
// Procedure codes
// ---------------------------------------------------------------------------

// Descriptions only. CDT/ADA codes are copyrighted and licensed per practice, so `code` is
// seeded blank on purpose — the clinic types in or imports the codes they are licensed for.
// Nothing in this list is or resembles a CDT code.
const SEED_PROCEDURE_CODES: Array<[category: string, description: string]> = [
  ['Diagnostic', 'Comprehensive oral evaluation, new patient'],
  ['Diagnostic', 'Periodic oral evaluation, established patient'],
  ['Diagnostic', 'Limited oral evaluation, problem focused'],
  ['Diagnostic', 'Intraoral radiograph, single image'],
  ['Diagnostic', 'Intraoral radiographs, complete series'],
  ['Diagnostic', 'Bitewing radiographs, two images'],
  ['Diagnostic', 'Bitewing radiographs, four images'],
  ['Diagnostic', 'Panoramic radiograph'],
  ['Diagnostic', 'Diagnostic casts / study models'],
  ['Preventive', 'Prophylaxis, adult'],
  ['Preventive', 'Prophylaxis, child'],
  ['Preventive', 'Topical fluoride varnish application'],
  ['Preventive', 'Sealant, per tooth'],
  ['Preventive', 'Space maintainer, fixed unilateral'],
  ['Preventive', 'Oral hygiene instruction'],
  ['Restorative', 'Amalgam restoration, one surface'],
  ['Restorative', 'Amalgam restoration, two surfaces'],
  ['Restorative', 'Amalgam restoration, three or more surfaces'],
  ['Restorative', 'Composite restoration, one surface, anterior'],
  ['Restorative', 'Composite restoration, two surfaces, anterior'],
  ['Restorative', 'Composite restoration, one surface, posterior'],
  ['Restorative', 'Composite restoration, two surfaces, posterior'],
  ['Restorative', 'Prefabricated stainless steel crown, primary tooth'],
  ['Restorative', 'Core build-up, including any pins'],
  ['Restorative', 'Prefabricated post and core'],
  ['Endodontics', 'Pulp cap, direct'],
  ['Endodontics', 'Therapeutic pulpotomy, primary tooth'],
  ['Endodontics', 'Root canal, anterior tooth'],
  ['Endodontics', 'Root canal, premolar'],
  ['Endodontics', 'Root canal, molar'],
  ['Endodontics', 'Retreatment of previous root canal'],
  ['Endodontics', 'Apicoectomy, per root'],
  ['Periodontics', 'Scaling and root planing, per quadrant'],
  ['Periodontics', 'Full mouth debridement'],
  ['Periodontics', 'Periodontal maintenance'],
  ['Periodontics', 'Gingivectomy, per quadrant'],
  ['Prosthodontics, fixed', 'Porcelain crown'],
  ['Prosthodontics, fixed', 'Porcelain fused to metal crown'],
  ['Prosthodontics, fixed', 'Full cast metal crown'],
  ['Prosthodontics, fixed', 'Zirconia crown'],
  ['Prosthodontics, fixed', 'Porcelain veneer, laboratory made'],
  ['Prosthodontics, fixed', 'Bridge pontic, porcelain fused to metal'],
  ['Prosthodontics, fixed', 'Recement fixed bridge'],
  ['Prosthodontics, removable', 'Complete denture, upper'],
  ['Prosthodontics, removable', 'Complete denture, lower'],
  ['Prosthodontics, removable', 'Partial denture, resin base'],
  ['Prosthodontics, removable', 'Denture reline, chairside'],
  ['Prosthodontics, removable', 'Denture repair, broken base'],
  ['Oral surgery', 'Extraction, erupted tooth'],
  ['Oral surgery', 'Surgical extraction, erupted tooth requiring bone removal'],
  ['Oral surgery', 'Removal of impacted tooth, soft tissue'],
  ['Oral surgery', 'Removal of impacted tooth, full bony'],
  ['Oral surgery', 'Incision and drainage of abscess, intraoral'],
  ['Oral surgery', 'Alveoloplasty, per quadrant'],
  ['Oral surgery', 'Implant placement, endosteal'],
  ['Adjunctive', 'Palliative treatment of dental pain'],
  ['Adjunctive', 'Local anaesthesia'],
  ['Adjunctive', 'Occlusal guard, hard appliance'],
  ['Adjunctive', 'Nitrous oxide analgesia'],
  ['Adjunctive', 'Consultation / second opinion']
]

/** Runs once on a database whose code list is still empty; safe to call on every launch. */
export function seedProcedureCodes(): void {
  const count = one<{ c: number }>('SELECT COUNT(*) AS c FROM procedure_codes')
  if (count && Number(count.c) > 0) return
  const db = dbh()
  db.run('BEGIN')
  try {
    for (const [category, description] of SEED_PROCEDURE_CODES) {
      db.run(
        "INSERT INTO procedure_codes (code, description, category, active) VALUES ('', ?, ?, 1)",
        [description, category]
      )
    }
    db.run('COMMIT')
    db.persist()
  } catch (e) {
    try {
      db.run('ROLLBACK')
    } catch {
      /* already unwound */
    }
    throw e
  }
}

function listCodes(includeInactive = false): ProcedureCode[] {
  const sql = includeInactive
    ? 'SELECT * FROM procedure_codes ORDER BY category, description'
    : 'SELECT * FROM procedure_codes WHERE active = 1 ORDER BY category, description'
  return rows(sql).map(mapCode)
}

export interface CodeImportRow {
  code?: string
  description?: string
  category?: string
  default_fee?: number | null
  active?: boolean
}

/**
 * The clinic's own list. A row whose description already exists is updated in place (that is
 * how a practice fills the blank codes in on the seeded descriptions); anything else is added.
 */
function importCodes(list: CodeImportRow[]): { inserted: number; updated: number } {
  const clean = (Array.isArray(list) ? list : [])
    .map((r) => ({
      code: String(r?.code ?? '').trim(),
      description: String(r?.description ?? '').trim(),
      category: String(r?.category ?? '').trim(),
      default_fee: num(r?.default_fee),
      active: r?.active === false ? 0 : 1
    }))
    .filter((r) => r.description.length > 0)

  let inserted = 0
  let updated = 0
  tx(() => {
    for (const r of clean) {
      const existing = one<{ id: number }>(
        'SELECT id FROM procedure_codes WHERE lower(description) = lower(?) LIMIT 1',
        [r.description]
      )
      if (existing) {
        dbh().run(
          'UPDATE procedure_codes SET code = ?, category = ?, default_fee = ?, active = ? WHERE id = ?',
          [r.code, r.category, r.default_fee, r.active, Number(existing.id)]
        )
        updated++
      } else {
        dbh().run(
          'INSERT INTO procedure_codes (code, description, category, default_fee, active) VALUES (?,?,?,?,?)',
          [r.code, r.description, r.category, r.default_fee, r.active]
        )
        inserted++
      }
    }
  })
  return { inserted, updated }
}

// ---------------------------------------------------------------------------
// Migration from the legacy tooth_chart_data blob
// ---------------------------------------------------------------------------

/**
 * How the old single-condition chart translates into findings. `unexamined` is absent on
 * purpose: "we did not look at this tooth" is not a finding and must not become a row.
 */
const LEGACY_MAP: Record<string, { type: ConditionType; status: ClinicalStatus }> = {
  healthy: { type: 'healthy', status: 'existing' },
  cavity: { type: 'caries', status: 'condition' },
  filled: { type: 'restoration', status: 'existing' },
  missing: { type: 'missing', status: 'existing' },
  implant: { type: 'implant', status: 'existing' },
  treatment: { type: 'watch', status: 'condition' },
  extraction: { type: 'extraction', status: 'planned' }
}

export const MIGRATION_FLAG = 'odontogram_migrated'

interface LegacyToothState {
  condition?: string
  surfaces?: unknown
  note?: unknown
}

// The old chart called an incisor's biting edge "occlusal"; the contract calls it incisal on
// anterior teeth. Same surface, correct name — without this the surface would not render.
function legacySurfaces(tooth: ToothId, raw: unknown): SurfaceKey[] {
  const info = TOOTH_BY_ID.get(tooth)
  const anterior = !!info && (info.type === 'incisor' || info.type === 'canine')
  const mapped = (Array.isArray(raw) ? raw : []).map((s) =>
    anterior && s === 'occlusal' ? 'incisal' : s
  )
  return cleanSurfaces(mapped)
}

interface LegacyExamRow {
  id: number
  tooth_chart_data: string | null
  exam_date: string | null
  created_at: string | null
  doctor_id: number | null
  doctor_name: string | null
}

/**
 * Converts one examination's legacy blob into tooth_conditions rows. Returns the number of
 * rows written. Callers run inside a transaction. The blob itself is only ever READ — it
 * stays in place as the fallback for the old chart view.
 */
function convertLegacyExam(exam: LegacyExamRow, user: ActingUser): number {
  const chart = safeJson<Record<string, LegacyToothState>>(exam.tooth_chart_data, {})
  if (!chart || typeof chart !== 'object') return 0

  const recordedAt = exam.exam_date || exam.created_at || new Date().toISOString().slice(0, 10)
  let written = 0

  for (const [key, state] of Object.entries(chart)) {
    if (!state || typeof state !== 'object') continue
    const mapped = LEGACY_MAP[String(state.condition ?? '')]
    if (!mapped) continue // 'unexamined' and anything unrecognised: no row at all.

    const tooth = String(key).trim().toUpperCase()
    if (!TOOTH_BY_ID.has(tooth)) continue // a key that is not a tooth is not data we can keep.

    const note = typeof state.note === 'string' && state.note.trim() ? state.note.trim() : null
    dbh().run(
      `INSERT INTO tooth_conditions
         (examination_id, tooth, type, status, zone, surfaces, provider_id, provider_name, date_recorded, note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        exam.id,
        tooth,
        mapped.type,
        mapped.status,
        defaultZone(mapped.type),
        JSON.stringify(legacySurfaces(tooth, state.surfaces)),
        exam.doctor_id ?? null,
        exam.doctor_name ?? null,
        recordedAt,
        note
      ]
    )
    written++
  }

  if (written > 0) {
    writeHistory(
      {
        examination_id: exam.id,
        entity: 'chart',
        entity_id: exam.id,
        action: 'created',
        field: 'migration',
        before: 'tooth_chart_data',
        after: `${written} finding(s) imported from the previous chart`
      },
      user
    )
  }
  return written
}

/** Exams that already carry findings are never touched — that is the per-exam duplicate guard. */
function legacyExamsToConvert(examinationId?: number): LegacyExamRow[] {
  const where = examinationId ? 'AND e.id = ?' : ''
  const params: Param[] = examinationId ? [examinationId] : []
  return rows<LegacyExamRow>(
    `SELECT e.id, e.tooth_chart_data, e.exam_date, e.created_at, e.doctor_id,
            u.full_name AS doctor_name
       FROM examinations e
       LEFT JOIN users u ON u.id = e.doctor_id
      WHERE e.tooth_chart_data IS NOT NULL
        AND e.tooth_chart_data != ''
        AND e.tooth_chart_data != '{}'
        AND NOT EXISTS (SELECT 1 FROM tooth_conditions tc WHERE tc.examination_id = e.id)
        ${where}
      ORDER BY e.id ASC`,
    params
  )
}

export interface MigrationResult {
  ran: boolean
  examinations: number
  conditions: number
  error?: string
}

/**
 * Turns every legacy chart in the database into odontogram rows.
 *
 * - Idempotent twice over: a flag in app_settings stops it running again, and any
 *   examination that already has findings is skipped even if the flag is lost.
 * - Atomic: one transaction. If anything throws, the database is rolled back and left
 *   exactly as it was, including the flag.
 * - Non-destructive: examinations.tooth_chart_data is only read, never written or cleared.
 */
export function migrateLegacyToothCharts(options: { force?: boolean } = {}): MigrationResult {
  const db = dbh()
  const flag = one<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
    MIGRATION_FLAG
  ])
  if (!options.force && flag?.value === '1') {
    return { ran: false, examinations: 0, conditions: 0 }
  }

  db.run('BEGIN')
  try {
    const exams = legacyExamsToConvert()
    let conditions = 0
    let converted = 0
    for (const exam of exams) {
      const written = convertLegacyExam(exam, SYSTEM_USER)
      if (written > 0) converted++
      conditions += written
    }
    db.run(
      `INSERT INTO app_settings (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [MIGRATION_FLAG]
    )
    db.run('COMMIT')
    db.persist()
    return { ran: true, examinations: converted, conditions }
  } catch (e) {
    try {
      db.run('ROLLBACK')
    } catch {
      /* already unwound */
    }
    // Deliberately swallowed: a chart that cannot be converted must not stop the clinic
    // from opening the app. The legacy blob is untouched, so nothing is lost and the next
    // launch tries again (the flag was rolled back with everything else).
    return {
      ran: false,
      examinations: 0,
      conditions: 0,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/** Same conversion for a single examination, e.g. one charted in the old view after the upgrade. */
function importLegacyChart(examinationId: number, user: ActingUser): number {
  const [exam] = legacyExamsToConvert(examinationId)
  if (!exam) return 0
  return tx(() => convertLegacyExam(exam, user))
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export const Odontogram = {
  get: getOdontogram,
  listConditions,
  getCondition: conditionById,
  addCondition,
  updateCondition,
  deleteCondition,
  setStatus,
  listBridges,
  addBridge,
  updateBridge,
  deleteBridge,
  listProcedures,
  addProcedure,
  updateProcedure,
  deleteProcedure,
  listPlans,
  addPlan,
  updatePlan,
  deletePlan,
  listCodes,
  importCodes,
  history,
  importLegacyChart
}

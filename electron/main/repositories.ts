import { query, queryOne, execute, executeReturningId } from './db'
import type {
  User,
  Patient,
  PatientInput,
  Examination,
  ToothChartData,
  ClinicalNote,
  NoteType,
  ConsentForm,
  TreatmentReport,
  PatientImage,
  ClinicSettings,
  AuditEntry,
  TreatmentItem,
  Language,
  Role,
  ClinicEvent,
  ReferralTemplate,
  Referral
} from '@shared/types'

// ---------- Mappers ----------
function mapUser(r: any): User {
  return {
    id: Number(r.id),
    username: r.username,
    full_name: r.full_name,
    role: r.role as Role,
    created_at: r.created_at
  }
}

function mapPatient(r: any): Patient {
  return {
    id: Number(r.id),
    patient_id: r.patient_id,
    first_name: r.first_name,
    last_name: r.last_name,
    date_of_birth: r.date_of_birth,
    phone: r.phone ?? null,
    email: r.email ?? null,
    address: r.address ?? null,
    emergency_contact: r.emergency_contact ?? null,
    emergency_phone: r.emergency_phone ?? null,
    allergies: r.allergies ?? null,
    medical_conditions: r.medical_conditions ?? null,
    medications: r.medications ?? null,
    dental_history: r.dental_history ?? null,
    insurance_info: r.insurance_info ?? null,
    referring_doctor: r.referring_doctor ?? null,
    preferred_language: (r.preferred_language ?? 'english') as Language,
    event_id: r.event_id != null ? Number(r.event_id) : null,
    event_name: r.event_name ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at
  }
}

const PATIENT_SELECT = `SELECT p.*, ev.name AS event_name
  FROM patients p LEFT JOIN events ev ON ev.id = p.event_id`

function mapExamination(r: any): Examination {
  return {
    id: Number(r.id),
    patient_id: Number(r.patient_id),
    doctor_id: Number(r.doctor_id),
    doctor_name: r.doctor_name ?? undefined,
    exam_date: r.exam_date,
    tooth_chart_data: safeJson<ToothChartData>(r.tooth_chart_data, {} as ToothChartData),
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at
  }
}

function examTreatmentItems(r: any): TreatmentItem[] {
  return safeJson<TreatmentItem[]>(r.treatment_items, [])
}

function mapNote(r: any): ClinicalNote {
  return {
    id: Number(r.id),
    examination_id: Number(r.examination_id),
    note_type: r.note_type as NoteType,
    content: r.content,
    linked_teeth: safeJson<number[]>(r.linked_teeth, []),
    created_at: r.created_at,
    updated_at: r.updated_at,
    edited: Number(r.edited) === 1
  }
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

// ---------- Users ----------
export const Users = {
  list(): User[] {
    return query('SELECT * FROM users WHERE active = 1 ORDER BY full_name').map(mapUser)
  },
  getById(id: number): User | undefined {
    const r = queryOne('SELECT * FROM users WHERE id = ?', [id])
    return r ? mapUser(r) : undefined
  },
  getRawByUsername(username: string): any | undefined {
    return queryOne('SELECT * FROM users WHERE username = ? AND active = 1', [
      username.trim().toLowerCase()
    ])
  },
  // Like getRawByUsername but ignores `active`, so duplicate checks also catch a
  // previously-removed account (the username column is globally UNIQUE in SQLite).
  getAnyByUsername(username: string): any | undefined {
    return queryOne('SELECT * FROM users WHERE username = ?', [username.trim().toLowerCase()])
  },
  create(username: string, passwordHash: string, fullName: string, role: Role): number {
    return executeReturningId(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)',
      [username.trim().toLowerCase(), passwordHash, fullName, role]
    )
  },
  // Revive a removed account in place (reusing its row keeps the UNIQUE username happy).
  reactivate(id: number, passwordHash: string, fullName: string, role: Role): void {
    execute('UPDATE users SET active = 1, password_hash = ?, full_name = ?, role = ? WHERE id = ?', [
      passwordHash,
      fullName,
      role,
      id
    ])
  },
  updatePassword(id: number, passwordHash: string): void {
    execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id])
  },
  deactivate(id: number): void {
    execute('UPDATE users SET active = 0 WHERE id = ?', [id])
  }
}

// ---------- Patients ----------
export const Patients = {
  create(input: PatientInput, eventId: number | null = null): Patient {
    const id = executeReturningId(
      `INSERT INTO patients
        (first_name, last_name, date_of_birth, phone, email, address, emergency_contact,
         emergency_phone, allergies, medical_conditions, medications, dental_history,
         insurance_info, referring_doctor, preferred_language, event_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.first_name,
        input.last_name,
        input.date_of_birth,
        input.phone,
        input.email,
        input.address,
        input.emergency_contact,
        input.emergency_phone,
        input.allergies,
        input.medical_conditions,
        input.medications,
        input.dental_history,
        input.insurance_info,
        input.referring_doctor,
        input.preferred_language,
        eventId
      ]
    )
    const patientId = `GS-${String(id).padStart(6, '0')}`
    execute('UPDATE patients SET patient_id = ? WHERE id = ?', [patientId, id])
    return this.getById(id)!
  },
  update(id: number, input: PatientInput): Patient {
    execute(
      `UPDATE patients SET
        first_name=?, last_name=?, date_of_birth=?, phone=?, email=?, address=?,
        emergency_contact=?, emergency_phone=?, allergies=?, medical_conditions=?,
        medications=?, dental_history=?, insurance_info=?, referring_doctor=?,
        preferred_language=?, updated_at=datetime('now')
       WHERE id=?`,
      [
        input.first_name,
        input.last_name,
        input.date_of_birth,
        input.phone,
        input.email,
        input.address,
        input.emergency_contact,
        input.emergency_phone,
        input.allergies,
        input.medical_conditions,
        input.medications,
        input.dental_history,
        input.insurance_info,
        input.referring_doctor,
        input.preferred_language,
        id
      ]
    )
    return this.getById(id)!
  },
  getById(id: number): Patient | undefined {
    const r = queryOne(`${PATIENT_SELECT} WHERE p.id = ?`, [id])
    return r ? mapPatient(r) : undefined
  },
  search(term: string): Patient[] {
    const t = `%${term.trim()}%`
    return query(
      `${PATIENT_SELECT}
       WHERE p.first_name LIKE ? OR p.last_name LIKE ? OR p.patient_id LIKE ?
          OR (p.first_name || ' ' || p.last_name) LIKE ?
       ORDER BY p.updated_at DESC LIMIT 200`,
      [t, t, t, t]
    ).map(mapPatient)
  },
  recent(limit = 50): Patient[] {
    return query(`${PATIENT_SELECT} ORDER BY p.updated_at DESC LIMIT ?`, [limit]).map(mapPatient)
  },
  setEvent(patientId: number, eventId: number | null): void {
    execute("UPDATE patients SET event_id = ?, updated_at = datetime('now') WHERE id = ?", [
      eventId,
      patientId
    ])
  },
  listByEvent(eventId: number): Patient[] {
    return query(`${PATIENT_SELECT} WHERE p.event_id = ? ORDER BY p.last_name, p.first_name`, [
      eventId
    ]).map(mapPatient)
  },
  count(): number {
    const r = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM patients')
    return r ? Number(r.c) : 0
  },
  lastVisit(patientId: number): string | null {
    const r = queryOne<{ exam_date: string }>(
      'SELECT exam_date FROM examinations WHERE patient_id = ? ORDER BY exam_date DESC LIMIT 1',
      [patientId]
    )
    return r ? r.exam_date : null
  },
  // Removes the patient and related DB records. Saved PDFs/images on disk are kept (archived).
  deleteWithRelated(id: number): void {
    execute(
      'DELETE FROM clinical_notes WHERE examination_id IN (SELECT id FROM examinations WHERE patient_id = ?)',
      [id]
    )
    execute('DELETE FROM treatment_reports WHERE patient_id = ?', [id])
    execute('DELETE FROM examinations WHERE patient_id = ?', [id])
    execute('DELETE FROM consent_forms WHERE patient_id = ?', [id])
    execute('DELETE FROM patient_images WHERE patient_id = ?', [id])
    execute('DELETE FROM referrals WHERE patient_id = ?', [id])
    execute('DELETE FROM patients WHERE id = ?', [id])
  }
}

// ---------- Examinations ----------
export const Examinations = {
  create(patientId: number, doctorId: number, examDate: string): number {
    return executeReturningId(
      `INSERT INTO examinations (patient_id, doctor_id, exam_date, tooth_chart_data, treatment_items, status)
       VALUES (?,?,?,?,?,'in_progress')`,
      [patientId, doctorId, examDate, '{}', '[]']
    )
  },
  getById(id: number): Examination | undefined {
    const r = queryOne(
      `SELECT e.*, u.full_name AS doctor_name
       FROM examinations e LEFT JOIN users u ON u.id = e.doctor_id
       WHERE e.id = ?`,
      [id]
    )
    return r ? mapExamination(r) : undefined
  },
  getTreatmentItems(id: number): TreatmentItem[] {
    const r = queryOne('SELECT treatment_items FROM examinations WHERE id = ?', [id])
    return r ? examTreatmentItems(r) : []
  },
  listByPatient(patientId: number): Examination[] {
    return query(
      `SELECT e.*, u.full_name AS doctor_name
       FROM examinations e LEFT JOIN users u ON u.id = e.doctor_id
       WHERE e.patient_id = ? ORDER BY e.exam_date DESC, e.id DESC`,
      [patientId]
    ).map(mapExamination)
  },
  saveToothChart(id: number, data: ToothChartData): void {
    execute(
      "UPDATE examinations SET tooth_chart_data = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify(data), id]
    )
  },
  saveTreatmentItems(id: number, items: TreatmentItem[]): void {
    execute(
      "UPDATE examinations SET treatment_items = ?, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify(items), id]
    )
  },
  setStatus(id: number, status: 'in_progress' | 'completed'): void {
    execute("UPDATE examinations SET status = ?, updated_at = datetime('now') WHERE id = ?", [
      status,
      id
    ])
  }
}

// ---------- Clinical notes ----------
export const Notes = {
  create(examinationId: number, noteType: NoteType, content: string, linkedTeeth: number[]): number {
    return executeReturningId(
      `INSERT INTO clinical_notes (examination_id, note_type, content, linked_teeth)
       VALUES (?,?,?,?)`,
      [examinationId, noteType, content, JSON.stringify(linkedTeeth)]
    )
  },
  update(id: number, content: string, linkedTeeth: number[]): void {
    execute(
      `UPDATE clinical_notes SET content = ?, linked_teeth = ?, edited = 1, updated_at = datetime('now')
       WHERE id = ?`,
      [content, JSON.stringify(linkedTeeth), id]
    )
  },
  // System update (auto-charting reconcile): refresh content in place WITHOUT marking
  // the note as user-edited, and only while it's still unedited — so a doctor's manual
  // edit is never overwritten. Preserving the row id keeps the React key stable.
  updateAuto(id: number, content: string, linkedTeeth: number[]): void {
    execute(
      `UPDATE clinical_notes SET content = ?, linked_teeth = ?, updated_at = datetime('now')
       WHERE id = ? AND edited = 0`,
      [content, JSON.stringify(linkedTeeth), id]
    )
  },
  delete(id: number): void {
    execute('DELETE FROM clinical_notes WHERE id = ?', [id])
  },
  listByExam(examinationId: number): ClinicalNote[] {
    return query(
      'SELECT * FROM clinical_notes WHERE examination_id = ? ORDER BY created_at ASC, id ASC',
      [examinationId]
    ).map(mapNote)
  }
}

// ---------- Consent forms ----------
export const Consents = {
  create(
    patientId: number,
    formType: string,
    language: Language,
    signedByName: string,
    signedAt: string,
    pdfPath: string | null
  ): number {
    return executeReturningId(
      `INSERT INTO consent_forms (patient_id, form_type, language, signed_by_name, signed_at, pdf_path)
       VALUES (?,?,?,?,?,?)`,
      [patientId, formType, language, signedByName, signedAt, pdfPath]
    )
  },
  listByPatient(patientId: number): ConsentForm[] {
    return query('SELECT * FROM consent_forms WHERE patient_id = ? ORDER BY signed_at DESC', [
      patientId
    ]).map((r: any) => ({
      id: Number(r.id),
      patient_id: Number(r.patient_id),
      form_type: r.form_type,
      language: r.language,
      signed_by_name: r.signed_by_name,
      signed_at: r.signed_at,
      pdf_path: r.pdf_path ?? null,
      created_at: r.created_at
    }))
  }
}

// ---------- Treatment reports ----------
export const Reports = {
  create(
    examinationId: number,
    patientId: number,
    pdfPath: string,
    approvedById: number | null,
    approvedAt: string | null
  ): number {
    return executeReturningId(
      `INSERT INTO treatment_reports (examination_id, patient_id, pdf_path, approved_by_doctor_id, approved_at)
       VALUES (?,?,?,?,?)`,
      [examinationId, patientId, pdfPath, approvedById, approvedAt]
    )
  },
  listByPatient(patientId: number): TreatmentReport[] {
    return query(
      `SELECT r.*, u.full_name AS approved_by_name
       FROM treatment_reports r LEFT JOIN users u ON u.id = r.approved_by_doctor_id
       WHERE r.patient_id = ? ORDER BY r.created_at DESC`,
      [patientId]
    ).map((r: any) => ({
      id: Number(r.id),
      examination_id: Number(r.examination_id),
      patient_id: Number(r.patient_id),
      pdf_path: r.pdf_path ?? null,
      approved_by_doctor_id: r.approved_by_doctor_id ? Number(r.approved_by_doctor_id) : null,
      approved_by_name: r.approved_by_name ?? null,
      approved_at: r.approved_at ?? null,
      created_at: r.created_at
    }))
  }
}

// ---------- Images ----------
export const Images = {
  create(
    patientId: number,
    imageType: string,
    filePath: string,
    dateTaken: string | null,
    notes: string | null
  ): number {
    return executeReturningId(
      `INSERT INTO patient_images (patient_id, image_type, file_path, date_taken, notes)
       VALUES (?,?,?,?,?)`,
      [patientId, imageType, filePath, dateTaken, notes]
    )
  },
  listByPatient(patientId: number): PatientImage[] {
    return query('SELECT * FROM patient_images WHERE patient_id = ? ORDER BY uploaded_at DESC', [
      patientId
    ]).map((r: any) => ({
      id: Number(r.id),
      patient_id: Number(r.patient_id),
      image_type: r.image_type,
      file_path: r.file_path,
      date_taken: r.date_taken ?? null,
      notes: r.notes ?? null,
      uploaded_at: r.uploaded_at
    }))
  },
  delete(id: number): void {
    execute('DELETE FROM patient_images WHERE id = ?', [id])
  }
}

// ---------- Settings ----------
export const Settings = {
  getAll(): ClinicSettings {
    const rows = query<{ key: string; value: string }>('SELECT key, value FROM app_settings')
    const map = new Map(rows.map((r) => [r.key, r.value]))
    return {
      clinic_name: map.get('clinic_name') ?? 'Giving Smiles',
      address: map.get('address') ?? '',
      phone: map.get('phone') ?? '',
      license_number: map.get('license_number') ?? '',
      email: map.get('email') ?? '',
      default_language: (map.get('default_language') ?? 'english') as Language,
      smtp_host: map.get('smtp_host') ?? '',
      smtp_port: map.get('smtp_port') ?? '587',
      smtp_secure: (map.get('smtp_secure') ?? 'false') === 'true',
      smtp_user: map.get('smtp_user') ?? '',
      smtp_pass: map.get('smtp_pass') ?? '',
      smtp_from: map.get('smtp_from') ?? ''
    }
  },
  update(settings: Partial<ClinicSettings>): void {
    for (const [key, value] of Object.entries(settings)) {
      const stringValue = typeof value === 'boolean' ? String(value) : String(value ?? '')
      execute(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, stringValue]
      )
    }
  }
}

// ---------- Events ----------
function mapEvent(r: any): ClinicEvent {
  return {
    id: Number(r.id),
    name: r.name,
    location: r.location ?? null,
    event_date: r.event_date ?? null,
    notes: r.notes ?? null,
    status: r.status === 'archived' ? 'archived' : 'open',
    created_at: r.created_at,
    patient_count: r.patient_count != null ? Number(r.patient_count) : undefined
  }
}

export const Events = {
  create(name: string, location: string | null, eventDate: string | null, notes: string | null): number {
    return executeReturningId(
      'INSERT INTO events (name, location, event_date, notes) VALUES (?,?,?,?)',
      [name, location, eventDate, notes]
    )
  },
  update(
    id: number,
    fields: { name: string; location: string | null; event_date: string | null; notes: string | null }
  ): void {
    execute('UPDATE events SET name = ?, location = ?, event_date = ?, notes = ? WHERE id = ?', [
      fields.name,
      fields.location,
      fields.event_date,
      fields.notes,
      id
    ])
  },
  setStatus(id: number, status: 'open' | 'archived'): void {
    execute('UPDATE events SET status = ? WHERE id = ?', [status, id])
  },
  delete(id: number): { ok: boolean; untagged: number } {
    const c = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM patients WHERE event_id = ?', [id])
    const untagged = c ? Number(c.c) : 0
    // Patients are kept — only their tag to this event is removed (their records/files are untouched).
    if (untagged > 0) execute('UPDATE patients SET event_id = NULL WHERE event_id = ?', [id])
    execute('DELETE FROM events WHERE id = ?', [id])
    return { ok: true, untagged }
  },
  getById(id: number): ClinicEvent | undefined {
    const r = queryOne(
      `SELECT e.*, (SELECT COUNT(*) FROM patients p WHERE p.event_id = e.id) AS patient_count
       FROM events e WHERE e.id = ?`,
      [id]
    )
    return r ? mapEvent(r) : undefined
  },
  list(): ClinicEvent[] {
    return query(
      `SELECT e.*, (SELECT COUNT(*) FROM patients p WHERE p.event_id = e.id) AS patient_count
       FROM events e ORDER BY e.status ASC, e.event_date DESC, e.id DESC`
    ).map(mapEvent)
  }
}

// Active event is stored in app_settings so it survives restarts.
export const ActiveEvent = {
  getId(): number | null {
    const r = queryOne<{ value: string }>("SELECT value FROM app_settings WHERE key = 'active_event_id'")
    const v = r?.value ? Number(r.value) : NaN
    return Number.isFinite(v) && v > 0 ? v : null
  },
  set(id: number | null): void {
    execute(
      `INSERT INTO app_settings (key, value) VALUES ('active_event_id', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [id ? String(id) : '']
    )
  },
  get(): ClinicEvent | null {
    const id = this.getId()
    if (!id) return null
    const ev = Events.getById(id)
    return ev && ev.status === 'open' ? ev : null
  }
}

// ---------- Referral templates ----------
function mapTemplate(r: any): ReferralTemplate {
  return {
    id: Number(r.id),
    name: r.name,
    specialty: r.specialty ?? null,
    clinic_name: r.clinic_name ?? '',
    clinic_address: r.clinic_address ?? null,
    clinic_phone: r.clinic_phone ?? null,
    clinic_email: r.clinic_email ?? null,
    body: r.body ?? '',
    created_at: r.created_at,
    updated_at: r.updated_at
  }
}

export const ReferralTemplates = {
  list(): ReferralTemplate[] {
    return query('SELECT * FROM referral_templates ORDER BY name').map(mapTemplate)
  },
  getById(id: number): ReferralTemplate | undefined {
    const r = queryOne('SELECT * FROM referral_templates WHERE id = ?', [id])
    return r ? mapTemplate(r) : undefined
  },
  create(t: Omit<ReferralTemplate, 'id' | 'created_at' | 'updated_at'>): number {
    return executeReturningId(
      `INSERT INTO referral_templates (name, specialty, clinic_name, clinic_address, clinic_phone, clinic_email, body)
       VALUES (?,?,?,?,?,?,?)`,
      [t.name, t.specialty, t.clinic_name, t.clinic_address, t.clinic_phone, t.clinic_email, t.body]
    )
  },
  update(id: number, t: Omit<ReferralTemplate, 'id' | 'created_at' | 'updated_at'>): void {
    execute(
      `UPDATE referral_templates SET name=?, specialty=?, clinic_name=?, clinic_address=?,
        clinic_phone=?, clinic_email=?, body=?, updated_at=datetime('now') WHERE id=?`,
      [t.name, t.specialty, t.clinic_name, t.clinic_address, t.clinic_phone, t.clinic_email, t.body, id]
    )
  },
  delete(id: number): void {
    // Past referrals keep their PDFs; just detach the template reference.
    execute('UPDATE referrals SET template_id = NULL WHERE template_id = ?', [id])
    execute('DELETE FROM referral_templates WHERE id = ?', [id])
  }
}

// ---------- Referrals ----------
export const Referrals = {
  create(patientId: number, templateId: number | null, doctorId: number, pdfPath: string): number {
    return executeReturningId(
      'INSERT INTO referrals (patient_id, template_id, doctor_id, pdf_path) VALUES (?,?,?,?)',
      [patientId, templateId, doctorId, pdfPath]
    )
  },
  listByPatient(patientId: number): Referral[] {
    return query(
      `SELECT r.*, t.name AS template_name, u.full_name AS doctor_name
       FROM referrals r
       LEFT JOIN referral_templates t ON t.id = r.template_id
       LEFT JOIN users u ON u.id = r.doctor_id
       WHERE r.patient_id = ? ORDER BY r.created_at DESC`,
      [patientId]
    ).map((r: any) => ({
      id: Number(r.id),
      patient_id: Number(r.patient_id),
      template_id: r.template_id != null ? Number(r.template_id) : null,
      template_name: r.template_name ?? null,
      doctor_id: Number(r.doctor_id),
      doctor_name: r.doctor_name ?? null,
      pdf_path: r.pdf_path ?? null,
      created_at: r.created_at
    }))
  }
}

// ---------- Audit ----------
export const Audit = {
  log(userId: number, patientId: number | null, action: string, detail: string | null = null): void {
    execute('INSERT INTO audit_log (user_id, patient_id, action, detail) VALUES (?,?,?,?)', [
      userId,
      patientId,
      action,
      detail
    ])
  },
  recent(limit = 200): AuditEntry[] {
    return query(
      `SELECT a.*, u.full_name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.timestamp DESC, a.id DESC LIMIT ?`,
      [limit]
    ).map((r: any) => ({
      id: Number(r.id),
      user_id: Number(r.user_id),
      user_name: r.user_name ?? undefined,
      patient_id: r.patient_id ? Number(r.patient_id) : null,
      action: r.action,
      detail: r.detail ?? null,
      timestamp: r.timestamp
    }))
  },
  all(): AuditEntry[] {
    return this.recent(1_000_000)
  },
  clear(userId: number): void {
    execute('DELETE FROM audit_log')
    // Keep one accountability entry recording who cleared the log.
    execute("INSERT INTO audit_log (user_id, action, detail) VALUES (?, 'clear_audit_log', 'Activity log cleared')", [
      userId
    ])
  }
}

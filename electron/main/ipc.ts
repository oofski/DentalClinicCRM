import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron'
import { basename, extname } from 'node:path'
import fs from 'node:fs'
import {
  Users,
  Patients,
  Examinations,
  Notes,
  Consents,
  Reports,
  Images,
  Settings,
  Audit,
  Events,
  ActiveEvent,
  ReferralTemplates,
  Referrals
} from './repositories'
import { Odontogram, type ActingUser, type CodeImportRow, type StatusEntity } from './odontogramRepo'
import { exportDatabase, getDbPath, dataDir } from './db'
import { verifyLogin, changePassword, hashPassword } from './auth'
import { patientDirs, writeFileBuffer, copyInto, timestampName } from './files'
import { renderHtmlToPdf, printHtml } from './pdf'
import { buildConsentHtml } from './templates/consent'
import { buildReportHtml } from './templates/report'
import { buildSummaryHtml } from './templates/summary'
import { buildReferralHtml } from './templates/referral'
import { emailPdf } from './email'
import { startKioskServer, stopKioskServer, kioskServerStatus } from './kioskServer'
import { checkForUpdates, downloadUpdate, quitAndInstall, getUpdateStatus } from './updater'
import { isActivated, activate } from './license'
import { saveCheckInToUsb, importCheckInsFromUsb } from './checkinTransfer'
import { join } from 'node:path'
import type {
  User,
  PatientInput,
  Language,
  NoteType,
  TreatmentItem,
  Role,
  ReferralTemplate,
  ReferralRequest
} from '@shared/types'

let currentUser: User | null = null

export function mediaUrl(filePath: string): string {
  return `gsmedia://media/${encodeURIComponent(filePath)}`
}

function requireUser(): User {
  if (!currentUser) throw new Error('Not authenticated')
  return currentUser
}

function ok<T>(data: T) {
  return { ok: true as const, data }
}

export function registerIpc(): void {
  // ---------------- License gate (before sign-in; no auth required) ----------------
  ipcMain.handle('license:status', () => ({ activated: isActivated() }))
  ipcMain.handle('license:activate', (_e, code: string) => activate(code))

  // ---------------- Auth ----------------
  ipcMain.handle('auth:login', (_e, username: string, password: string) => {
    const res = verifyLogin(username, password)
    if (res.ok && res.user) {
      currentUser = res.user
      Audit.log(res.user.id, null, 'login', `${res.user.username} signed in`)
    }
    return res
  })

  ipcMain.handle('auth:logout', () => {
    if (currentUser) Audit.log(currentUser.id, null, 'logout', `${currentUser.username} signed out`)
    currentUser = null
    return ok(true)
  })

  ipcMain.handle('auth:current', () => currentUser)

  ipcMain.handle('auth:changePassword', (_e, oldPw: string, newPw: string) => {
    const u = requireUser()
    return changePassword(u.id, oldPw, newPw)
  })

  // ---------------- Users (admin) ----------------
  ipcMain.handle('users:list', () => Users.list())

  ipcMain.handle(
    'users:create',
    (_e, args: { username: string; fullName: string; role: Role; password: string }) => {
      const u = requireUser()
      if (u.role !== 'admin') return { ok: false, error: 'Only administrators can add users' }

      const username = (args?.username || '').trim().toLowerCase()
      const fullName = (args?.fullName || '').trim()
      const password = args?.password || ''
      const role = args?.role
      if (!username) return { ok: false, error: 'Enter a username' }
      if (!fullName) return { ok: false, error: 'Enter the full name' }
      if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters' }
      if (!['doctor', 'front_desk', 'admin'].includes(role)) return { ok: false, error: 'Pick a role' }

      try {
        const existing = Users.getAnyByUsername(username)
        if (existing && existing.active) {
          return { ok: false, error: 'That username already exists' }
        }
        if (existing && !existing.active) {
          // The username was used by a removed account — revive it with the new details
          // instead of hitting the UNIQUE constraint (which used to fail silently).
          Users.reactivate(existing.id, hashPassword(password), fullName, role)
          Audit.log(u.id, null, 'create_user', `Re-created ${username} (${role})`)
          return ok(Users.getById(existing.id))
        }
        const id = Users.create(username, hashPassword(password), fullName, role)
        Audit.log(u.id, null, 'create_user', `Created ${username} (${role})`)
        return ok(Users.getById(id))
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Could not create the account' }
      }
    }
  )

  // Admin sets/resets another user's password (no need to know the old one).
  ipcMain.handle('users:setPassword', (_e, id: number, newPw: string) => {
    const u = requireUser()
    if (u.role !== 'admin') return { ok: false, error: 'Only administrators can reset passwords' }
    if (!newPw || newPw.length < 6) return { ok: false, error: 'Password must be at least 6 characters' }
    const target = Users.getById(id)
    if (!target) return { ok: false, error: 'User not found' }
    try {
      Users.updatePassword(id, hashPassword(newPw))
      Audit.log(u.id, null, 'reset_password', `Reset password for ${target.username}`)
      return ok(true)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not set the password' }
    }
  })

  ipcMain.handle('users:deactivate', (_e, id: number) => {
    const u = requireUser()
    if (u.role !== 'admin') return { ok: false, error: 'Only administrators can remove users' }
    if (id === u.id) return { ok: false, error: 'You cannot remove your own account' }
    Users.deactivate(id)
    Audit.log(u.id, null, 'deactivate_user', `Deactivated user #${id}`)
    return ok(true)
  })

  // ---------------- Patients ----------------
  ipcMain.handle('patients:create', (_e, input: PatientInput) => {
    const u = requireUser()
    // New patients are auto-tagged to the active event (if one is set).
    const patient = Patients.create(input, ActiveEvent.getId())
    Audit.log(
      u.id,
      patient.id,
      'create_patient',
      `Created ${patient.patient_id}${patient.event_name ? ` (event: ${patient.event_name})` : ''}`
    )
    return ok(patient)
  })

  ipcMain.handle('patients:setEvent', (_e, patientId: number, eventId: number | null) => {
    const u = requireUser()
    Patients.setEvent(patientId, eventId)
    Audit.log(u.id, patientId, 'set_event', eventId ? `Tagged to event #${eventId}` : 'Untagged from event')
    return ok(Patients.getById(patientId))
  })

  ipcMain.handle('patients:update', (_e, id: number, input: PatientInput) => {
    const u = requireUser()
    const patient = Patients.update(id, input)
    Audit.log(u.id, id, 'edit_patient', `Updated ${patient.patient_id}`)
    return ok(patient)
  })

  ipcMain.handle('patients:get', (_e, id: number) => Patients.getById(id))
  ipcMain.handle('patients:search', (_e, term: string) =>
    term && term.trim() ? Patients.search(term) : Patients.recent(50)
  )
  ipcMain.handle('patients:recent', (_e, limit?: number) => Patients.recent(limit ?? 50))
  ipcMain.handle('patients:count', () => Patients.count())

  ipcMain.handle('patients:fullRecord', (_e, id: number) => {
    const u = requireUser()
    const patient = Patients.getById(id)
    if (!patient) return null
    Audit.log(u.id, id, 'view_patient', `Viewed ${patient.patient_id}`)
    const images = Images.listByPatient(id).map((img) => ({ ...img, url: mediaUrl(img.file_path) }))
    return {
      patient,
      lastVisit: Patients.lastVisit(id),
      exams: Examinations.listByPatient(id),
      consents: Consents.listByPatient(id),
      reports: Reports.listByPatient(id),
      referrals: Referrals.listByPatient(id),
      images
    }
  })

  ipcMain.handle('patients:delete', (_e, patientId: number) => {
    const u = requireUser()
    if (u.role !== 'admin' && u.role !== 'doctor') {
      return { ok: false, error: 'Only a doctor or administrator can delete patients' }
    }
    const patient = Patients.getById(patientId)
    if (!patient) return { ok: false, error: 'Patient not found' }
    // Remove database records. Saved PDFs/images remain archived on disk.
    Patients.deleteWithRelated(patientId)
    Audit.log(u.id, null, 'delete_patient', `Deleted ${patient.patient_id} (files kept on disk)`)
    return { ok: true }
  })

  ipcMain.handle('patient:printSummary', async (_e, patientId: number) => {
    const u = requireUser()
    const patient = Patients.getById(patientId)
    if (!patient) return { ok: false, error: 'Patient not found' }
    const html = buildSummaryHtml({
      clinic: Settings.getAll(),
      patient,
      exams: Examinations.listByPatient(patientId),
      consents: Consents.listByPatient(patientId),
      reports: Reports.listByPatient(patientId),
      lastVisit: Patients.lastVisit(patientId)
    })
    Audit.log(u.id, patientId, 'print_summary', null)
    return printHtml(html)
  })

  // ---------------- Examinations ----------------
  ipcMain.handle('exams:create', (_e, patientId: number, examDate: string) => {
    const u = requireUser()
    const id = Examinations.create(patientId, u.id, examDate)
    Audit.log(u.id, patientId, 'create_exam', `Started exam #${id}`)
    return ok(Examinations.getById(id))
  })

  ipcMain.handle('exams:get', (_e, id: number) => Examinations.getById(id))
  ipcMain.handle('exams:listByPatient', (_e, patientId: number) =>
    Examinations.listByPatient(patientId)
  )
  ipcMain.handle('exams:treatmentItems', (_e, id: number) => Examinations.getTreatmentItems(id))

  ipcMain.handle('exams:saveChart', (_e, id: number, data: Record<number, unknown>) => {
    Examinations.saveToothChart(id, data as never)
    return ok(true)
  })

  ipcMain.handle('exams:saveTreatmentItems', (_e, id: number, items: TreatmentItem[]) => {
    Examinations.saveTreatmentItems(id, items)
    return ok(true)
  })

  ipcMain.handle('exams:setStatus', (_e, id: number, status: 'in_progress' | 'completed') => {
    Examinations.setStatus(id, status)
    return ok(true)
  })

  // ---------------- Clinical notes ----------------
  ipcMain.handle(
    'notes:create',
    (_e, examId: number, type: NoteType, content: string, teeth: number[]) => {
      const id = Notes.create(examId, type, content, teeth || [])
      return ok(id)
    }
  )
  ipcMain.handle('notes:update', (_e, id: number, content: string, teeth: number[]) => {
    Notes.update(id, content, teeth || [])
    return ok(true)
  })
  ipcMain.handle('notes:updateAuto', (_e, id: number, content: string, teeth: number[]) => {
    Notes.updateAuto(id, content, teeth || [])
    return ok(true)
  })
  ipcMain.handle('notes:delete', (_e, id: number) => {
    Notes.delete(id)
    return ok(true)
  })
  ipcMain.handle('notes:listByExam', (_e, examId: number) => Notes.listByExam(examId))

  // ---------------- Odontogram ----------------
  // Every write is attributed to the signed-in user and lands in tooth_history; an illegal
  // status move (one the contract's state machine forbids) comes back as a plain message
  // instead of a rejected promise, so the chart can show it inline.
  const acting = (): ActingUser => {
    const u = requireUser()
    return { id: u.id, name: u.full_name }
  }

  function attempt<T>(fn: () => T): { ok: true; data: T } | { ok: false; error: string } {
    try {
      return ok(fn())
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Could not save the change' }
    }
  }

  ipcMain.handle('odontogram:get', (_e, examinationId: number) => {
    requireUser()
    return Odontogram.get(examinationId)
  })

  ipcMain.handle('odontogram:addCondition', (_e, examinationId: number, input: unknown) =>
    attempt(() => Odontogram.addCondition(examinationId, (input ?? {}) as Record<string, unknown>, acting()))
  )

  ipcMain.handle('odontogram:updateCondition', (_e, id: number, patch: unknown) =>
    attempt(() => Odontogram.updateCondition(id, (patch ?? {}) as Record<string, unknown>, acting()))
  )

  ipcMain.handle('odontogram:deleteCondition', (_e, id: number) =>
    attempt(() => {
      Odontogram.deleteCondition(id, acting())
      return true
    })
  )

  ipcMain.handle('odontogram:setStatus', (_e, entity: StatusEntity, id: number, status: string) =>
    attempt(() => Odontogram.setStatus(entity, id, status, acting()))
  )

  ipcMain.handle('odontogram:addBridge', (_e, examinationId: number, input: unknown) =>
    attempt(() => Odontogram.addBridge(examinationId, (input ?? {}) as Record<string, unknown>, acting()))
  )

  ipcMain.handle('odontogram:updateBridge', (_e, id: number, patch: unknown) =>
    attempt(() => Odontogram.updateBridge(id, (patch ?? {}) as Record<string, unknown>, acting()))
  )

  ipcMain.handle('odontogram:deleteBridge', (_e, id: number) =>
    attempt(() => {
      Odontogram.deleteBridge(id, acting())
      return true
    })
  )

  ipcMain.handle('odontogram:addProcedure', (_e, examinationId: number, input: unknown) =>
    attempt(() => Odontogram.addProcedure(examinationId, (input ?? {}) as Record<string, unknown>, acting()))
  )

  ipcMain.handle('odontogram:updateProcedure', (_e, id: number, patch: unknown) =>
    attempt(() => Odontogram.updateProcedure(id, (patch ?? {}) as Record<string, unknown>, acting()))
  )

  ipcMain.handle('odontogram:deleteProcedure', (_e, id: number) =>
    attempt(() => {
      Odontogram.deleteProcedure(id, acting())
      return true
    })
  )

  ipcMain.handle('odontogram:addPlan', (_e, examinationId: number, input: unknown) =>
    attempt(() => Odontogram.addPlan(examinationId, (input ?? {}) as Record<string, unknown>, acting()))
  )

  ipcMain.handle('odontogram:updatePlan', (_e, id: number, patch: unknown) =>
    attempt(() => Odontogram.updatePlan(id, (patch ?? {}) as Record<string, unknown>, acting()))
  )

  ipcMain.handle('odontogram:deletePlan', (_e, id: number) =>
    attempt(() => {
      Odontogram.deletePlan(id, acting())
      return true
    })
  )

  ipcMain.handle('odontogram:listCodes', (_e, includeInactive?: boolean) => {
    requireUser()
    return Odontogram.listCodes(!!includeInactive)
  })

  ipcMain.handle('odontogram:importCodes', (_e, list: CodeImportRow[]) =>
    attempt(() => {
      const u = requireUser()
      const res = Odontogram.importCodes(list || [])
      Audit.log(
        u.id,
        null,
        'import_procedure_codes',
        `${res.inserted} added, ${res.updated} updated`
      )
      return res
    })
  )

  ipcMain.handle('odontogram:history', (_e, examinationId: number, tooth?: string | null) => {
    requireUser()
    return Odontogram.history(examinationId, tooth ?? null)
  })

  // Converts one examination's old-style chart into findings (the startup migration does
  // this for every examination; this is for a chart written in the old view afterwards).
  ipcMain.handle('odontogram:importLegacy', (_e, examinationId: number) =>
    attempt(() => Odontogram.importLegacyChart(examinationId, acting()))
  )

  // ---------------- Consent ----------------
  ipcMain.handle(
    'consent:generate',
    async (
      _e,
      args: {
        patientId: number
        language: Language
        signatureDataUrl: string | null
        signedByName: string
        providerName?: string | null
      }
    ) => {
      const u = requireUser()
      const patient = Patients.getById(args.patientId)
      if (!patient) return { ok: false, error: 'Patient not found' }
      const clinic = Settings.getAll()
      const signedAt = new Date().toISOString()
      const html = buildConsentHtml({
        clinic,
        patient,
        language: args.language,
        signatureDataUrl: args.signatureDataUrl,
        signedByName: args.signedByName,
        signedAt,
        providerName: args.providerName ?? u.full_name
      })
      const pdf = await renderHtmlToPdf(html)
      const dirs = patientDirs(patient.patient_id)
      const path = writeFileBuffer(dirs.consents, timestampName(`Consent_${args.language}`, 'pdf'), pdf)
      const consentId = Consents.create(
        patient.id,
        'general_consent',
        args.language,
        args.signedByName,
        signedAt,
        path
      )
      Audit.log(u.id, patient.id, 'consent_signed', `Consent (${args.language}) #${consentId}`)
      return { ok: true, pdfPath: path, consentId }
    }
  )

  ipcMain.handle('consent:listByPatient', (_e, patientId: number) =>
    Consents.listByPatient(patientId)
  )

  // ---------------- Treatment report ----------------
  ipcMain.handle(
    'report:generate',
    async (
      _e,
      args: {
        examinationId: number
        toothChartSvg: string
        treatmentItems: TreatmentItem[]
        summaryNote?: string
        approve?: boolean
      }
    ) => {
      const u = requireUser()
      const exam = Examinations.getById(args.examinationId)
      if (!exam) return { ok: false, error: 'Examination not found' }
      const patient = Patients.getById(exam.patient_id)
      if (!patient) return { ok: false, error: 'Patient not found' }

      Examinations.saveTreatmentItems(exam.id, args.treatmentItems || [])
      const approvedAt = args.approve ? new Date().toISOString() : null
      if (args.approve) Examinations.setStatus(exam.id, 'completed')

      const html = buildReportHtml({
        clinic: Settings.getAll(),
        patient,
        exam,
        doctorName: exam.doctor_name || u.full_name,
        notes: Notes.listByExam(exam.id),
        treatmentItems: args.treatmentItems || [],
        language: patient.preferred_language,
        summaryNote: args.summaryNote,
        approvedAt
      })
      const pdf = await renderHtmlToPdf(html)
      const dirs = patientDirs(patient.patient_id)
      const path = writeFileBuffer(dirs.reports, timestampName('AdditionalNotes', 'pdf'), pdf)
      const reportId = Reports.create(
        exam.id,
        patient.id,
        path,
        args.approve ? u.id : null,
        approvedAt
      )
      Audit.log(u.id, patient.id, 'generate_report', `Report #${reportId}`)
      return { ok: true, pdfPath: path, reportId }
    }
  )

  ipcMain.handle(
    'report:print',
    async (
      _e,
      args: {
        examinationId: number
        toothChartSvg: string
        treatmentItems: TreatmentItem[]
        summaryNote?: string
      }
    ) => {
      const u = requireUser()
      const exam = Examinations.getById(args.examinationId)
      if (!exam) return { ok: false, error: 'Examination not found' }
      const patient = Patients.getById(exam.patient_id)
      if (!patient) return { ok: false, error: 'Patient not found' }
      const html = buildReportHtml({
        clinic: Settings.getAll(),
        patient,
        exam,
        doctorName: exam.doctor_name || u.full_name,
        notes: Notes.listByExam(exam.id),
        treatmentItems: args.treatmentItems || [],
        language: patient.preferred_language,
        summaryNote: args.summaryNote,
        approvedAt: null
      })
      return printHtml(html)
    }
  )

  ipcMain.handle('report:listByPatient', (_e, patientId: number) =>
    Reports.listByPatient(patientId)
  )

  ipcMain.handle(
    'report:email',
    async (_e, args: { pdfPath: string; to: string; patientName: string }) => {
      const u = requireUser()
      const clinic = Settings.getAll()
      const res = await emailPdf({
        to: args.to,
        subject: `Your Dental Report — ${clinic.clinic_name}`,
        text: `Dear ${args.patientName},\n\nPlease find attached your dental examination report from ${clinic.clinic_name}.\n\nKind regards,\n${clinic.clinic_name}\n${clinic.phone}`,
        attachmentPath: args.pdfPath
      })
      Audit.log(u.id, null, 'email_report', `via ${res.method}`)
      return res
    }
  )

  // ---------------- Events ----------------
  ipcMain.handle('events:list', () => {
    requireUser()
    return Events.list()
  })

  ipcMain.handle(
    'events:create',
    (_e, args: { name: string; location: string | null; event_date: string | null; notes: string | null }) => {
      const u = requireUser()
      if (u.role !== 'admin') return { ok: false, error: 'Only administrators can create events' }
      if (!args.name?.trim()) return { ok: false, error: 'Event name is required' }
      const id = Events.create(args.name.trim(), args.location, args.event_date, args.notes)
      Audit.log(u.id, null, 'create_event', `Created event "${args.name.trim()}"`)
      return ok(Events.getById(id))
    }
  )

  ipcMain.handle(
    'events:update',
    (_e, id: number, args: { name: string; location: string | null; event_date: string | null; notes: string | null }) => {
      const u = requireUser()
      if (u.role !== 'admin') return { ok: false, error: 'Only administrators can edit events' }
      Events.update(id, args)
      Audit.log(u.id, null, 'edit_event', `Updated event #${id}`)
      return ok(Events.getById(id))
    }
  )

  ipcMain.handle('events:setStatus', (_e, id: number, status: 'open' | 'archived') => {
    const u = requireUser()
    if (u.role !== 'admin') return { ok: false, error: 'Only administrators can archive events' }
    Events.setStatus(id, status)
    if (status === 'archived' && ActiveEvent.getId() === id) ActiveEvent.set(null)
    Audit.log(u.id, null, 'event_status', `Event #${id} → ${status}`)
    return ok(true)
  })

  ipcMain.handle('events:delete', (_e, id: number) => {
    const u = requireUser()
    if (u.role !== 'admin') return { ok: false, error: 'Only administrators can delete events' }
    if (ActiveEvent.getId() === id) ActiveEvent.set(null)
    const res = Events.delete(id)
    Audit.log(
      u.id,
      null,
      'delete_event',
      `Deleted event #${id}${res.untagged ? ` (untagged ${res.untagged} patient(s))` : ''}`
    )
    return res
  })

  // Activating an event is an operational action — any signed-in role may do it.
  ipcMain.handle('events:setActive', (_e, id: number | null) => {
    const u = requireUser()
    ActiveEvent.set(id)
    Audit.log(u.id, null, 'set_active_event', id ? `Activated event #${id}` : 'Deactivated event')
    return ok(ActiveEvent.get())
  })

  ipcMain.handle('events:getActive', () => ActiveEvent.get())

  ipcMain.handle('events:listPatients', (_e, id: number) => {
    requireUser()
    return Patients.listByEvent(id)
  })

  ipcMain.handle('events:export', async (_e, id: number) => {
    const u = requireUser()
    const ev = Events.getById(id)
    if (!ev) return { ok: false, error: 'Event not found' }
    const picked = await dialog.showOpenDialog({
      title: 'Choose where to save the event folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, error: 'Cancelled' }
    const safe = (s: string) => s.replace(/[^a-z0-9 _\-.]/gi, '_').trim()
    const dest = join(
      picked.filePaths[0],
      `${safe(ev.name)}${ev.event_date ? ` - ${safe(ev.event_date)}` : ''}`
    )
    fs.mkdirSync(dest, { recursive: true })

    const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['Patient ID', 'First Name', 'Last Name', 'Date of Birth', 'Phone', 'Email', 'Allergies', 'Medical Conditions']
        .map(csv)
        .join(',')
    ]
    const patients = Patients.listByEvent(id)
    for (const p of patients) {
      const src = patientDirs(p.patient_id).base
      fs.cpSync(src, join(dest, `${p.patient_id} - ${safe(`${p.first_name} ${p.last_name}`)}`), {
        recursive: true
      })
      rows.push(
        [p.patient_id, p.first_name, p.last_name, p.date_of_birth, p.phone, p.email, p.allergies, p.medical_conditions]
          .map(csv)
          .join(',')
      )
    }
    // UTF-8 BOM so Excel opens the roster with correct characters.
    fs.writeFileSync(join(dest, 'patient-roster.csv'), '\uFEFF' + rows.join('\r\n'))
    shell.showItemInFolder(dest)
    Audit.log(u.id, null, 'event_export', `"${ev.name}" → ${dest} (${patients.length} patients)`)
    return { ok: true, path: dest, count: patients.length }
  })

  // ---------------- Referral templates ----------------
  const canRefer = (u: User) => u.role === 'admin' || u.role === 'doctor'

  ipcMain.handle('reftpl:list', () => {
    requireUser()
    return ReferralTemplates.list()
  })

  ipcMain.handle(
    'reftpl:create',
    (_e, t: Omit<ReferralTemplate, 'id' | 'created_at' | 'updated_at'>) => {
      const u = requireUser()
      if (!canRefer(u)) return { ok: false, error: 'Only doctors and administrators can manage templates' }
      if (!t.name?.trim() || !t.clinic_name?.trim())
        return { ok: false, error: 'Template name and receiving clinic name are required' }
      const id = ReferralTemplates.create(t)
      Audit.log(u.id, null, 'create_ref_template', `"${t.name}"`)
      return ok(ReferralTemplates.getById(id))
    }
  )

  ipcMain.handle(
    'reftpl:update',
    (_e, id: number, t: Omit<ReferralTemplate, 'id' | 'created_at' | 'updated_at'>) => {
      const u = requireUser()
      if (!canRefer(u)) return { ok: false, error: 'Only doctors and administrators can manage templates' }
      ReferralTemplates.update(id, t)
      Audit.log(u.id, null, 'edit_ref_template', `#${id}`)
      return ok(ReferralTemplates.getById(id))
    }
  )

  ipcMain.handle('reftpl:delete', (_e, id: number) => {
    const u = requireUser()
    if (!canRefer(u)) return { ok: false, error: 'Only doctors and administrators can manage templates' }
    ReferralTemplates.delete(id)
    Audit.log(u.id, null, 'delete_ref_template', `#${id}`)
    return ok(true)
  })

  // ---------------- Referrals ----------------
  function buildReferralForRequest(args: ReferralRequest, doctorName: string) {
    const patient = Patients.getById(args.patientId)
    if (!patient) return { error: 'Patient not found' as const }
    const template = ReferralTemplates.getById(args.templateId)
    if (!template) return { error: 'Referral template not found' as const }
    const latestExam = Examinations.listByPatient(patient.id)[0] ?? null
    const findingNotes = latestExam
      ? Notes.listByExam(latestExam.id).filter(
          (n) => n.note_type === 'finding' || n.note_type === 'observation'
        )
      : []
    const html = buildReferralHtml({
      clinic: Settings.getAll(),
      patient,
      template,
      doctorName,
      reason: args.reason || '',
      urgency: args.urgency === 'urgent' ? 'urgent' : 'routine',
      extraNotes: args.extraNotes || '',
      includeAlerts: !!args.includeAlerts,
      includeFindings: !!args.includeFindings,
      includeToothChart: !!args.includeToothChart,
      latestExam,
      findingNotes
    })
    return { html, patient, template }
  }

  ipcMain.handle('referral:generate', async (_e, args: ReferralRequest) => {
    const u = requireUser()
    if (!canRefer(u)) return { ok: false, error: 'Only doctors and administrators can create referrals' }
    const built = buildReferralForRequest(args, u.full_name)
    if ('error' in built) return { ok: false, error: built.error }
    const pdf = await renderHtmlToPdf(built.html)
    const dirs = patientDirs(built.patient.patient_id)
    const path = writeFileBuffer(dirs.referrals, timestampName('Referral', 'pdf'), pdf)
    const id = Referrals.create(built.patient.id, built.template.id, u.id, path)
    Audit.log(u.id, built.patient.id, 'create_referral', `Referral #${id} → ${built.template.clinic_name}`)
    return {
      ok: true,
      pdfPath: path,
      referralId: id,
      suggestedEmail: built.template.clinic_email || ''
    }
  })

  ipcMain.handle('referral:print', async (_e, args: ReferralRequest) => {
    const u = requireUser()
    if (!canRefer(u)) return { ok: false, error: 'Only doctors and administrators can print referrals' }
    const built = buildReferralForRequest(args, u.full_name)
    if ('error' in built) return { ok: false, error: built.error }
    return printHtml(built.html)
  })

  // ---------------- Generic document email ----------------
  ipcMain.handle(
    'doc:email',
    async (_e, args: { pdfPath: string; to: string; subject: string; text: string }) => {
      const u = requireUser()
      const res = await emailPdf({
        to: args.to,
        subject: args.subject,
        text: args.text,
        attachmentPath: args.pdfPath
      })
      Audit.log(u.id, null, 'email_document', `via ${res.method}`)
      return res
    }
  )

  // ---------------- Tablet check-in server ----------------
  ipcMain.handle('kioskserver:start', async () => {
    requireUser()
    try {
      return { ok: true, status: await startKioskServer() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to start server' }
    }
  })
  ipcMain.handle('kioskserver:stop', () => {
    requireUser()
    return { ok: true, status: stopKioskServer() }
  })
  ipcMain.handle('kioskserver:status', () => kioskServerStatus())

  // ---------------- Software updates ----------------
  ipcMain.handle('updates:status', () => getUpdateStatus())
  ipcMain.handle('updates:check', () => {
    requireUser()
    return checkForUpdates()
  })
  ipcMain.handle('updates:download', () => {
    const u = requireUser()
    if (u.role !== 'admin') return { ok: false, error: 'Only administrators can install updates' }
    return downloadUpdate()
  })
  ipcMain.handle('updates:install', () => {
    const u = requireUser()
    if (u.role !== 'admin') return { ok: false, error: 'Only administrators can install updates' }
    Audit.log(u.id, null, 'install_update', `Updating from v${app.getVersion()}`)
    quitAndInstall()
    return { ok: true }
  })

  // ---------------- Documents ----------------
  ipcMain.handle('doc:open', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('doc:reveal', (_e, path: string) => {
    shell.showItemInFolder(path)
    return ok(true)
  })

  // ---------------- Images ----------------
  ipcMain.handle('images:pick', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Select images to add',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'] }]
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle(
    'images:add',
    (
      _e,
      args: {
        patientId: number
        sourcePath: string
        imageType: string
        dateTaken: string | null
        notes: string | null
      }
    ) => {
      const u = requireUser()
      const patient = Patients.getById(args.patientId)
      if (!patient) return { ok: false, error: 'Patient not found' }
      const dirs = patientDirs(patient.patient_id)
      const ext = extname(args.sourcePath) || '.img'
      const stored = copyInto(
        dirs.images,
        args.sourcePath,
        timestampName(`${args.imageType}_${basename(args.sourcePath, ext)}`, ext.replace('.', ''))
      )
      const id = Images.create(patient.id, args.imageType, stored, args.dateTaken, args.notes)
      Audit.log(u.id, patient.id, 'add_image', `${args.imageType}`)
      const img = Images.listByPatient(patient.id).find((i) => i.id === id)!
      return { ok: true, image: { ...img, url: mediaUrl(img.file_path) } }
    }
  )

  ipcMain.handle('images:delete', (_e, id: number, filePath: string, deleteFile: boolean) => {
    Images.delete(id)
    if (deleteFile && filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
      } catch {
        /* ignore */
      }
    }
    return ok(true)
  })

  // ---------------- Settings ----------------
  ipcMain.handle('settings:get', () => Settings.getAll())
  ipcMain.handle('settings:update', (_e, partial) => {
    const u = requireUser()
    if (u.role !== 'admin') return { ok: false, error: 'Only administrators can change settings' }
    Settings.update(partial)
    Audit.log(u.id, null, 'update_settings', null)
    return ok(Settings.getAll())
  })

  // ---------------- Audit ----------------
  ipcMain.handle('audit:recent', (_e, limit?: number) => {
    const u = requireUser()
    if (u.role !== 'admin') return []
    return Audit.recent(limit ?? 200)
  })

  ipcMain.handle('audit:export', async () => {
    const u = requireUser()
    if (u.role !== 'admin') return { ok: false, error: 'Only administrators can export the activity log' }
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = Audit.all()
    const header = ['Timestamp', 'User', 'Action', 'Detail', 'Patient ID'].map(cell).join(',')
    const lines = rows.map((a) =>
      [a.timestamp, a.user_name || `#${a.user_id}`, a.action, a.detail || '', a.patient_id ?? '']
        .map(cell)
        .join(',')
    )
    const def = `GivingSmiles-ActivityLog-${new Date().toISOString().slice(0, 10)}.csv`
    const res = await dialog.showSaveDialog({ title: 'Download activity log', defaultPath: def })
    if (res.canceled || !res.filePath) return { ok: false, error: 'Cancelled' }
    // UTF-8 BOM so Excel renders names/symbols correctly.
    fs.writeFileSync(res.filePath, '\uFEFF' + [header, ...lines].join('\r\n'))
    Audit.log(u.id, null, 'export_audit_log', `${rows.length} entries → ${res.filePath}`)
    return { ok: true, path: res.filePath, count: rows.length }
  })

  ipcMain.handle('audit:clear', () => {
    const u = requireUser()
    if (u.role !== 'admin') return { ok: false, error: 'Only administrators can clear the activity log' }
    Audit.clear(u.id)
    return { ok: true }
  })

  // ---------------- Backup / data ----------------
  ipcMain.handle('data:openFolder', () => shell.openPath(dataDir()))
  ipcMain.handle('data:backup', async () => {
    const u = requireUser()
    const def = `GivingSmiles-Backup-${new Date().toISOString().slice(0, 10)}.db`
    const res = await dialog.showSaveDialog({ title: 'Backup database', defaultPath: def })
    if (res.canceled || !res.filePath) return { ok: false, error: 'Cancelled' }
    fs.writeFileSync(res.filePath, Buffer.from(exportDatabase()))
    Audit.log(u.id, null, 'backup', res.filePath)
    return { ok: true, path: res.filePath }
  })

  ipcMain.handle('app:info', () => ({
    dataDir: dataDir(),
    dbPath: getDbPath(),
    version: app.getVersion()
  }))

  // ---------------- Kiosk window ----------------
  ipcMain.handle('kiosk:open', (_e, mode?: string) => {
    openKioskWindow(mode === 'offline' ? 'offline' : 'local')
    return ok(true)
  })

  // ---------------- Offline (USB) check-in transfer ----------------
  ipcMain.handle('checkin:saveBundle', (_e, bundle: unknown) =>
    saveCheckInToUsb(bundle as never)
  )
  ipcMain.handle('checkin:importFromUsb', () => {
    const u = requireUser()
    return importCheckInsFromUsb(u.id, u.full_name)
  })
}

let kioskWin: BrowserWindow | null = null
let buildKioskWindow: ((mode: string) => BrowserWindow) | null = null

export function setKioskFactory(factory: (mode: string) => BrowserWindow): void {
  buildKioskWindow = factory
}

function openKioskWindow(mode: string): void {
  if (kioskWin && !kioskWin.isDestroyed()) {
    kioskWin.focus()
    return
  }
  if (!buildKioskWindow) return
  kioskWin = buildKioskWindow(mode)
  kioskWin.on('closed', () => {
    kioskWin = null
  })
}

import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
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
  Audit
} from './repositories'
import { exportDatabase, getDbPath, dataDir } from './db'
import { verifyLogin, changePassword, hashPassword } from './auth'
import { patientDirs, writeFileBuffer, copyInto, timestampName } from './files'
import { renderHtmlToPdf, printHtml } from './pdf'
import { buildConsentHtml } from './templates/consent'
import { buildReportHtml } from './templates/report'
import { buildSummaryHtml } from './templates/summary'
import { toothChartSvgString } from '@shared/toothChart'
import { emailPdf } from './email'
import type { User, PatientInput, Language, NoteType, TreatmentItem, Role } from '@shared/types'

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
      if (Users.getRawByUsername(args.username)) {
        return { ok: false, error: 'That username already exists' }
      }
      const id = Users.create(args.username, hashPassword(args.password), args.fullName, args.role)
      Audit.log(u.id, null, 'create_user', `Created ${args.username} (${args.role})`)
      return ok(Users.getById(id))
    }
  )

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
    const patient = Patients.create(input)
    Audit.log(u.id, patient.id, 'create_patient', `Created ${patient.patient_id}`)
    return ok(patient)
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
      images
    }
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
  ipcMain.handle('notes:delete', (_e, id: number) => {
    Notes.delete(id)
    return ok(true)
  })
  ipcMain.handle('notes:listByExam', (_e, examId: number) => Notes.listByExam(examId))

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
        toothChartSvg: toothChartSvgString(exam.tooth_chart_data),
        summaryNote: args.summaryNote,
        approvedAt
      })
      const pdf = await renderHtmlToPdf(html)
      const dirs = patientDirs(patient.patient_id)
      const path = writeFileBuffer(dirs.reports, timestampName('TreatmentReport', 'pdf'), pdf)
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
        toothChartSvg: toothChartSvgString(exam.tooth_chart_data),
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
        subject: `Your Dental Treatment Report — ${clinic.clinic_name}`,
        text: `Dear ${args.patientName},\n\nPlease find attached your dental examination and treatment report from ${clinic.clinic_name}.\n\nKind regards,\n${clinic.clinic_name}\n${clinic.phone}`,
        attachmentPath: args.pdfPath
      })
      Audit.log(u.id, null, 'email_report', `via ${res.method}`)
      return res
    }
  )

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

  ipcMain.handle('app:info', () => ({ dataDir: dataDir(), dbPath: getDbPath() }))

  // ---------------- Kiosk window ----------------
  ipcMain.handle('kiosk:open', () => {
    openKioskWindow()
    return ok(true)
  })
}

let kioskWin: BrowserWindow | null = null
let buildKioskWindow: (() => BrowserWindow) | null = null

export function setKioskFactory(factory: () => BrowserWindow): void {
  buildKioskWindow = factory
}

function openKioskWindow(): void {
  if (kioskWin && !kioskWin.isDestroyed()) {
    kioskWin.focus()
    return
  }
  if (!buildKioskWindow) return
  kioskWin = buildKioskWindow()
  kioskWin.on('closed', () => {
    kioskWin = null
  })
}

import type {
  AuthResult,
  User,
  Patient,
  PatientInput,
  PatientFullRecord,
  Examination,
  ClinicalNote,
  ConsentForm,
  TreatmentReport,
  TreatmentItem,
  ClinicSettings,
  AuditEntry,
  ImageWithUrl,
  Role,
  Language,
  NoteType,
  ToothChartData,
  ClinicEvent,
  ReferralTemplate,
  ReferralRequest,
  KioskServerStatus,
  UpdateStatus
} from '@shared/types'
import type { CheckInBundle, ImportedCheckIn } from '@shared/checkin'

interface Ok<T = undefined> {
  ok: boolean
  error?: string
  data?: T
}

export interface Api {
  license: {
    status(): Promise<{ activated: boolean }>
    activate(code: string): Promise<{ ok: boolean; error?: string }>
  }
  auth: {
    login(username: string, password: string): Promise<AuthResult>
    logout(): Promise<Ok<boolean>>
    current(): Promise<User | null>
    changePassword(oldPw: string, newPw: string): Promise<{ ok: boolean; error?: string }>
  }
  users: {
    list(): Promise<User[]>
    create(args: {
      username: string
      fullName: string
      role: Role
      password: string
    }): Promise<{ ok: boolean; error?: string; data?: User }>
    setPassword(id: number, password: string): Promise<{ ok: boolean; error?: string }>
    deactivate(id: number): Promise<{ ok: boolean; error?: string }>
  }
  patients: {
    create(input: PatientInput): Promise<{ ok: boolean; data: Patient }>
    update(id: number, input: PatientInput): Promise<{ ok: boolean; data: Patient }>
    get(id: number): Promise<Patient | undefined>
    search(term: string): Promise<Patient[]>
    recent(limit?: number): Promise<Patient[]>
    count(): Promise<number>
    fullRecord(id: number): Promise<PatientFullRecord | null>
    printSummary(id: number): Promise<{ ok: boolean; error?: string }>
    delete(id: number): Promise<{ ok: boolean; error?: string }>
    setEvent(id: number, eventId: number | null): Promise<{ ok: boolean; data?: Patient }>
  }
  events: {
    list(): Promise<ClinicEvent[]>
    create(args: {
      name: string
      location: string | null
      event_date: string | null
      notes: string | null
    }): Promise<{ ok: boolean; error?: string; data?: ClinicEvent }>
    update(
      id: number,
      args: { name: string; location: string | null; event_date: string | null; notes: string | null }
    ): Promise<{ ok: boolean; error?: string; data?: ClinicEvent }>
    setStatus(id: number, status: 'open' | 'archived'): Promise<{ ok: boolean; error?: string }>
    delete(id: number): Promise<{ ok: boolean; error?: string; untagged?: number }>
    setActive(id: number | null): Promise<{ ok: boolean; data?: ClinicEvent | null }>
    getActive(): Promise<ClinicEvent | null>
    listPatients(id: number): Promise<Patient[]>
    export(id: number): Promise<{ ok: boolean; error?: string; path?: string; count?: number }>
  }
  reftpl: {
    list(): Promise<ReferralTemplate[]>
    create(
      t: Omit<ReferralTemplate, 'id' | 'created_at' | 'updated_at'>
    ): Promise<{ ok: boolean; error?: string; data?: ReferralTemplate }>
    update(
      id: number,
      t: Omit<ReferralTemplate, 'id' | 'created_at' | 'updated_at'>
    ): Promise<{ ok: boolean; error?: string; data?: ReferralTemplate }>
    delete(id: number): Promise<{ ok: boolean; error?: string }>
  }
  referral: {
    generate(args: ReferralRequest): Promise<{
      ok: boolean
      error?: string
      pdfPath?: string
      referralId?: number
      suggestedEmail?: string
    }>
    print(args: ReferralRequest): Promise<{ ok: boolean; error?: string }>
  }
  kioskServer: {
    start(): Promise<{ ok: boolean; error?: string; status?: KioskServerStatus }>
    stop(): Promise<{ ok: boolean; status?: KioskServerStatus }>
    status(): Promise<KioskServerStatus>
  }
  live: {
    onCheckin(cb: (p: { id: number; name: string; patient_id: string }) => void): () => void
  }
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<UpdateStatus | { ok: boolean; error?: string }>
    install(): Promise<{ ok: boolean; error?: string }>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
  exams: {
    create(patientId: number, examDate: string): Promise<{ ok: boolean; data: Examination }>
    get(id: number): Promise<Examination | undefined>
    listByPatient(patientId: number): Promise<Examination[]>
    treatmentItems(id: number): Promise<TreatmentItem[]>
    saveChart(id: number, data: ToothChartData): Promise<Ok<boolean>>
    saveTreatmentItems(id: number, items: TreatmentItem[]): Promise<Ok<boolean>>
    setStatus(id: number, status: 'in_progress' | 'completed'): Promise<Ok<boolean>>
  }
  notes: {
    create(
      examId: number,
      type: NoteType,
      content: string,
      teeth: number[]
    ): Promise<{ ok: boolean; data: number }>
    update(id: number, content: string, teeth: number[]): Promise<Ok<boolean>>
    delete(id: number): Promise<Ok<boolean>>
    listByExam(examId: number): Promise<ClinicalNote[]>
  }
  consent: {
    generate(args: {
      patientId: number
      language: Language
      signatureDataUrl: string | null
      signedByName: string
      providerName?: string | null
    }): Promise<{ ok: boolean; pdfPath?: string; consentId?: number; error?: string }>
    listByPatient(patientId: number): Promise<ConsentForm[]>
  }
  report: {
    generate(args: {
      examinationId: number
      toothChartSvg: string
      treatmentItems: TreatmentItem[]
      summaryNote?: string
      approve?: boolean
    }): Promise<{ ok: boolean; pdfPath?: string; reportId?: number; error?: string }>
    print(args: {
      examinationId: number
      toothChartSvg: string
      treatmentItems: TreatmentItem[]
      summaryNote?: string
    }): Promise<{ ok: boolean; error?: string }>
    listByPatient(patientId: number): Promise<TreatmentReport[]>
    email(args: {
      pdfPath: string
      to: string
      patientName: string
    }): Promise<{ ok: boolean; method: string; error?: string }>
  }
  doc: {
    open(path: string): Promise<string>
    reveal(path: string): Promise<Ok<boolean>>
    email(args: {
      pdfPath: string
      to: string
      subject: string
      text: string
    }): Promise<{ ok: boolean; method: string; error?: string }>
  }
  images: {
    pick(): Promise<string[]>
    add(args: {
      patientId: number
      sourcePath: string
      imageType: string
      dateTaken: string | null
      notes: string | null
    }): Promise<{ ok: boolean; image?: ImageWithUrl; error?: string }>
    delete(id: number, filePath: string, deleteFile: boolean): Promise<Ok<boolean>>
  }
  settings: {
    get(): Promise<ClinicSettings>
    update(
      partial: Partial<ClinicSettings>
    ): Promise<{ ok: boolean; error?: string; data?: ClinicSettings }>
  }
  audit: {
    recent(limit?: number): Promise<AuditEntry[]>
    export(): Promise<{ ok: boolean; error?: string; path?: string; count?: number }>
    clear(): Promise<{ ok: boolean; error?: string }>
  }
  data: {
    openFolder(): Promise<string>
    backup(): Promise<{ ok: boolean; path?: string; error?: string }>
  }
  app: { info(): Promise<{ dataDir: string; dbPath: string; version: string }> }
  kiosk: { open(mode?: 'online' | 'local' | 'offline'): Promise<Ok<boolean>> }
  checkin: {
    saveBundle(
      bundle: CheckInBundle
    ): Promise<{ ok: boolean; error?: string; path?: string }>
    importFromUsb(): Promise<{
      ok: boolean
      error?: string
      imported?: ImportedCheckIn[]
      failed?: number
    }>
  }
  platform: string
}

export const api: Api = window.api

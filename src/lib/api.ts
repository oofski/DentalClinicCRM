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
  ToothChartData
} from '@shared/types'

interface Ok<T = undefined> {
  ok: boolean
  error?: string
  data?: T
}

export interface Api {
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
  audit: { recent(limit?: number): Promise<AuditEntry[]> }
  data: {
    openFolder(): Promise<string>
    backup(): Promise<{ ok: boolean; path?: string; error?: string }>
  }
  app: { info(): Promise<{ dataDir: string; dbPath: string; version: string }> }
  kiosk: { open(): Promise<Ok<boolean>> }
  platform: string
}

export const api: Api = window.api

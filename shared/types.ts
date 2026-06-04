// Shared TypeScript types used by both the Electron main process and the React renderer.

export type Role = 'admin' | 'doctor' | 'front_desk'

export interface User {
  id: number
  username: string
  full_name: string
  role: Role
  created_at: string
}

export type Language = 'english' | 'spanish' | 'arabic'

export interface Patient {
  id: number
  patient_id: string // human-facing auto-generated id e.g. GS-000123
  first_name: string
  last_name: string
  date_of_birth: string // ISO date (YYYY-MM-DD)
  phone: string | null
  email: string | null
  address: string | null
  emergency_contact: string | null
  emergency_phone: string | null
  allergies: string | null
  medical_conditions: string | null
  medications: string | null
  dental_history: string | null
  insurance_info: string | null
  referring_doctor: string | null
  preferred_language: Language
  created_at: string
  updated_at: string
}

export type PatientInput = Omit<
  Patient,
  'id' | 'patient_id' | 'created_at' | 'updated_at'
>

export type ToothConditionKey =
  | 'unexamined'
  | 'healthy'
  | 'cavity'
  | 'filled'
  | 'missing'
  | 'implant'
  | 'treatment'

export type SurfaceKey = 'occlusal' | 'buccal' | 'lingual' | 'mesial' | 'distal'

export interface ToothState {
  condition: ToothConditionKey
  surfaces: SurfaceKey[]
  note: string
}

// Map of tooth number (1-32) -> tooth state. Stored as JSON in the DB.
export type ToothChartData = Record<number, ToothState>

export interface Examination {
  id: number
  patient_id: number
  doctor_id: number
  doctor_name?: string
  exam_date: string
  tooth_chart_data: ToothChartData
  status: 'in_progress' | 'completed'
  created_at: string
  updated_at: string
}

export type NoteType = 'finding' | 'treatment_plan' | 'follow_up' | 'observation'

export interface ClinicalNote {
  id: number
  examination_id: number
  note_type: NoteType
  content: string
  linked_teeth: number[]
  created_at: string
  updated_at: string
  edited: boolean
}

export type TreatmentPriority = 'urgent' | 'important' | 'routine'

export interface TreatmentItem {
  id: string
  description: string
  tooth?: string
  priority: TreatmentPriority
  estimate: string // estimated timeline e.g. "Within 2 weeks"
  cost?: string
}

export interface ConsentForm {
  id: number
  patient_id: number
  form_type: string
  language: Language
  signed_by_name: string
  signed_at: string
  pdf_path: string | null
  created_at: string
}

export interface TreatmentReport {
  id: number
  examination_id: number
  patient_id: number
  pdf_path: string | null
  approved_by_doctor_id: number | null
  approved_by_name?: string | null
  approved_at: string | null
  created_at: string
}

export interface PatientImage {
  id: number
  patient_id: number
  image_type: string
  file_path: string
  date_taken: string | null
  notes: string | null
  uploaded_at: string
}

export interface ClinicSettings {
  clinic_name: string
  address: string
  phone: string
  license_number: string
  email: string
  default_language: Language
  // Optional SMTP settings for true one-click emailing of reports (offline fallback used when blank).
  smtp_host: string
  smtp_port: string
  smtp_secure: boolean
  smtp_user: string
  smtp_pass: string
  smtp_from: string
}

export interface AuditEntry {
  id: number
  user_id: number
  user_name?: string
  patient_id: number | null
  action: string
  detail: string | null
  timestamp: string
}

export interface AuthResult {
  ok: boolean
  user?: User
  error?: string
}

// Payload the renderer sends to generate a treatment report.
export interface ReportRequest {
  examinationId: number
  toothChartSvg: string
  treatmentItems: TreatmentItem[]
  summaryNote?: string
}

export interface GeneratedDocResult {
  ok: boolean
  pdfPath?: string
  error?: string
}

export type ImageWithUrl = PatientImage & { url: string }

export interface PatientFullRecord {
  patient: Patient
  lastVisit: string | null
  exams: Examination[]
  consents: ConsentForm[]
  reports: TreatmentReport[]
  images: ImageWithUrl[]
}

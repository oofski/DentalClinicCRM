import type { PatientInput, Language } from './types'

// A single patient self-check-in, transferred via USB in OFFLINE mode.
export interface CheckInBundle {
  createdAt: string
  patient: PatientInput
  language: Language
  signedByName: string
  signatureDataUrl: string | null
}

export interface ImportedCheckIn {
  id: number
  patient_id: string
  name: string
}

export type CheckInMode = 'online' | 'offline'

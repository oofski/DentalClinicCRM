// OFFLINE check-in transfer via USB flash drive.
//
// A patient-facing device writes one encrypted file per check-in to the USB drive; the
// doctor's computer imports those files. The file is AES-256-GCM encrypted with a key
// derived from the clinic unlock code, so a lost drive's contents are unreadable without
// it. No network is used at any point.
import { dialog, shell } from 'electron'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { getUnlockCode } from './license'
import { Patients, Consents, Settings, ActiveEvent, Audit } from './repositories'
import { patientDirs, writeFileBuffer, timestampName } from './files'
import { buildConsentHtml } from './templates/consent'
import { renderHtmlToPdf } from './pdf'
import type { CheckInBundle, ImportedCheckIn } from '@shared/checkin'
import type { Language, PatientInput } from '@shared/types'

const FILE_APP = 'giving-smiles'
const FILE_KIND = 'checkin'
const SALT = 'giving-smiles-checkin-v1'

function aesKey(): Buffer {
  // Strength comes from the unlock code; the salt is fixed so both machines derive the same key.
  return crypto.scryptSync(getUnlockCode() || 'giving-smiles', SALT, 32)
}

function encrypt(obj: unknown): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(), iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, data]).toString('base64')
}

function decrypt(b64: string): unknown {
  const buf = Buffer.from(b64, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey(), iv)
  decipher.setAuthTag(tag)
  const out = Buffer.concat([decipher.update(data), decipher.final()])
  return JSON.parse(out.toString('utf8'))
}

/** Patient-side: write one encrypted check-in file (a save dialog lets them pick the USB drive). */
export async function saveCheckInToUsb(
  bundle: CheckInBundle
): Promise<{ ok: boolean; error?: string; path?: string }> {
  const last = bundle.patient?.last_name?.replace(/[^a-z0-9]/gi, '') || 'patient'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const res = await dialog.showSaveDialog({
    title: 'Save check-in to flash drive',
    defaultPath: `GivingSmiles-CheckIn-${last}-${stamp}.gscheckin`,
    filters: [{ name: 'Giving Smiles Check-In', extensions: ['gscheckin'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false, error: 'Cancelled' }
  try {
    const file = { app: FILE_APP, kind: FILE_KIND, v: 1, payload: encrypt(bundle) }
    fs.writeFileSync(res.filePath, JSON.stringify(file))
    return { ok: true, path: res.filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save to the drive' }
  }
}

/** Doctor-side: pick check-in files from the USB drive and import each into this database. */
export async function importCheckInsFromUsb(
  actorId: number,
  providerName: string
): Promise<{ ok: boolean; error?: string; imported?: ImportedCheckIn[]; failed?: number }> {
  const res = await dialog.showOpenDialog({
    title: 'Import check-ins from flash drive',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Giving Smiles Check-In', extensions: ['gscheckin', 'json'] }]
  })
  if (res.canceled || res.filePaths.length === 0) return { ok: false, error: 'Cancelled' }

  const imported: ImportedCheckIn[] = []
  let failed = 0
  for (const filePath of res.filePaths) {
    try {
      const file = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (file.app !== FILE_APP || file.kind !== FILE_KIND || !file.payload) {
        failed++
        continue
      }
      const bundle = decrypt(file.payload) as CheckInBundle
      const input = bundle.patient as PatientInput
      if (!input?.first_name || !input?.last_name || !input?.date_of_birth) {
        failed++
        continue
      }
      const language: Language = (['english', 'spanish', 'arabic'] as Language[]).includes(
        bundle.language
      )
        ? bundle.language
        : 'english'

      const patient = Patients.create(input, ActiveEvent.getId())

      // Re-create the signed consent PDF on this machine and archive it.
      const signedAt = bundle.createdAt || new Date().toISOString()
      const html = buildConsentHtml({
        clinic: Settings.getAll(),
        patient,
        language,
        signatureDataUrl: bundle.signatureDataUrl || null,
        signedByName: bundle.signedByName || `${patient.first_name} ${patient.last_name}`,
        signedAt,
        providerName
      })
      const pdf = await renderHtmlToPdf(html)
      const dirs = patientDirs(patient.patient_id)
      const path = writeFileBuffer(dirs.consents, timestampName(`Consent_${language}`, 'pdf'), pdf)
      Consents.create(
        patient.id,
        'general_consent',
        language,
        bundle.signedByName || `${patient.first_name} ${patient.last_name}`,
        signedAt,
        path
      )

      Audit.log(actorId, patient.id, 'usb_checkin_import', `Imported ${patient.patient_id}`)
      imported.push({
        id: patient.id,
        patient_id: patient.patient_id,
        name: `${patient.first_name} ${patient.last_name}`
      })
    } catch {
      // Most likely a wrong unlock code (decryption fails) or a corrupt/foreign file.
      failed++
    }
  }
  if (imported.length > 0) shell.showItemInFolder(res.filePaths[0])
  return { ok: true, imported, failed }
}

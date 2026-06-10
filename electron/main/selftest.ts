// Development self-test: generates real consent + treatment-report PDFs through the
// production code paths. Triggered with GS_SELFTEST=1. Not used in normal operation.
import fs from 'node:fs'
import { Users, Patients, Examinations, Notes, Settings, ReferralTemplates } from './repositories'
import { buildConsentHtml } from './templates/consent'
import { buildReportHtml } from './templates/report'
import { buildReferralHtml } from './templates/referral'
import { startKioskServer, stopKioskServer } from './kioskServer'
import { renderHtmlToPdf } from './pdf'
import type { ToothChartData, TreatmentItem, Language } from '@shared/types'

export async function runSelfTest(outDir: string): Promise<void> {
  const clinic = Settings.getAll()
  const doctor = Users.list().find((u) => u.role === 'doctor') || Users.list()[0]

  const patient = Patients.create({
    first_name: 'Jane',
    last_name: 'Sample',
    date_of_birth: '1988-05-12',
    phone: '(555) 010-2030',
    email: 'jane@example.com',
    address: '1 Test Street, Your City, ST',
    emergency_contact: 'John Sample',
    emergency_phone: '(555) 111-2222',
    allergies: 'Penicillin',
    medical_conditions: 'Hypertension',
    medications: 'Lisinopril 10mg',
    dental_history: 'Two composite fillings (2019)',
    insurance_info: 'DeltaDental #44219',
    referring_doctor: 'Dr. Ng',
    preferred_language: 'english',
    event_id: null
  })

  const chart: ToothChartData = {
    3: { condition: 'cavity', surfaces: ['occlusal', 'distal'], note: 'Distal decay' },
    14: { condition: 'filled', surfaces: ['mesial'], note: '' },
    18: { condition: 'extraction', surfaces: [], note: 'Non-restorable — extract' },
    19: { condition: 'treatment', surfaces: [], note: 'RCT needed' },
    30: { condition: 'missing', surfaces: [], note: '' },
    8: { condition: 'healthy', surfaces: [], note: '' },
    9: { condition: 'implant', surfaces: [], note: '' },
    24: { condition: 'healthy', surfaces: [], note: '' }
  }

  const examId = Examinations.create(patient.id, doctor.id, '2026-06-04')
  Examinations.saveToothChart(examId, chart)
  Notes.create(examId, 'finding', 'Generalized plaque. Cavity on tooth #3 distal surface.', [3])
  Notes.create(examId, 'treatment_plan', 'Root canal therapy on #19; composite filling on #3.', [19, 3])
  Notes.create(examId, 'follow_up', 'Recall in 6 months for cleaning and review.', [])
  const exam = Examinations.getById(examId)!

  const items: TreatmentItem[] = [
    { id: '1', description: 'Root canal therapy', tooth: '19', priority: 'urgent', estimate: 'Within 1 week', cost: '$900' },
    { id: '2', description: 'Composite filling', tooth: '3', priority: 'important', estimate: '2 weeks', cost: '$220' },
    { id: '3', description: 'Routine cleaning & polish', tooth: '', priority: 'routine', estimate: '6 months', cost: '$120' }
  ]

  for (const lang of ['english', 'spanish', 'arabic'] as Language[]) {
    const reportHtml = buildReportHtml({
      clinic,
      patient,
      exam,
      doctorName: doctor.full_name,
      notes: Notes.listByExam(examId),
      treatmentItems: items,
      language: lang,
      summaryNote: 'Patient advised on oral hygiene and scheduled for treatment.',
      approvedAt: new Date().toISOString()
    })
    const reportPdf = await renderHtmlToPdf(reportHtml)
    fs.writeFileSync(`${outDir}/selftest-report-${lang}.pdf`, reportPdf)
    console.log(`SELFTEST report-${lang} bytes =`, reportPdf.length)
  }

  for (const lang of ['english', 'spanish', 'arabic'] as Language[]) {
    const html = buildConsentHtml({
      clinic,
      patient,
      language: lang,
      signatureDataUrl: null,
      signedByName: 'Jane Sample',
      signedAt: new Date().toISOString(),
      providerName: doctor.full_name
    })
    const pdf = await renderHtmlToPdf(html)
    fs.writeFileSync(`${outDir}/selftest-consent-${lang}.pdf`, pdf)
    console.log(`SELFTEST consent-${lang} bytes =`, pdf.length)
  }

  // Referral letter (uses the seeded default template)
  const tpl = ReferralTemplates.list()[0]
  const referralHtml = buildReferralHtml({
    clinic,
    patient,
    template: { ...tpl, clinic_name: 'City Oral Surgery', specialty: 'Oral Surgery', clinic_email: 'os@example.com' },
    doctorName: doctor.full_name,
    reason: 'Surgical extraction of non-restorable tooth #18 and evaluation of #19 for RCT.',
    urgency: 'urgent',
    extraNotes: 'Patient reports sensitivity to cold. Please coordinate scheduling with our office.',
    includeAlerts: true,
    includeFindings: true,
    includeToothChart: true,
    latestExam: exam,
    findingNotes: Notes.listByExam(examId)
  })
  const refPdf = await renderHtmlToPdf(referralHtml)
  fs.writeFileSync(`${outDir}/selftest-referral.pdf`, refPdf)
  console.log('SELFTEST referral bytes =', refPdf.length)

  // Tablet check-in server: start, serve the page, then stop.
  const ks = await startKioskServer()
  console.log('SELFTEST kiosk server port =', ks.port, 'urls =', ks.urls.length)
  if (ks.urls[0]) {
    try {
      const res = await fetch(ks.urls[0])
      const text = await res.text()
      fs.writeFileSync(`${outDir}/checkin.html`, text)
      console.log('SELFTEST kiosk page served =', res.status === 200 && text.includes('Patient Check-In'))
    } catch (e) {
      console.log('SELFTEST kiosk fetch error =', e instanceof Error ? e.message : String(e))
    }
  }
  stopKioskServer()

  console.log('SELFTEST_DONE')
}

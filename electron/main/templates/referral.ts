import { htmlShell } from './docStyles'
import { esc, nl2br, formatDate, formatDateTime, age } from './util'
import { logoLockupSvg } from '@shared/branding'
import { toothChartSvgString } from '@shared/toothChart'
import { COPYRIGHT } from '@shared/legal'
import type {
  Patient,
  ClinicSettings,
  ReferralTemplate,
  ClinicalNote,
  Examination
} from '@shared/types'

export interface ReferralRenderInput {
  clinic: ClinicSettings
  patient: Patient
  template: ReferralTemplate
  doctorName: string
  reason: string
  urgency: 'routine' | 'urgent'
  extraNotes: string
  includeAlerts: boolean
  includeFindings: boolean
  includeToothChart: boolean
  latestExam: Examination | null
  findingNotes: ClinicalNote[]
}

export function buildReferralHtml(input: ReferralRenderInput): string {
  const { clinic: c, patient: p, template: t } = input

  const header = `
  <div class="doc-header">
    <div class="brand">${logoLockupSvg({ height: 46 })}</div>
    <div class="clinic">
      <div class="name">${esc(c.clinic_name)}</div>
      <div>${esc(c.address)}</div>
      <div>Phone: ${esc(c.phone)} · License #: ${esc(c.license_number)}</div>
    </div>
  </div>`

  const urgencyBadge =
    input.urgency === 'urgent'
      ? '<span class="badge urgent">URGENT</span>'
      : '<span class="badge routine">ROUTINE</span>'

  const toBlock = `
  <section>
    <h2>To</h2>
    <p style="margin:2px 0"><b>${esc(t.clinic_name)}</b>${
      t.specialty && t.specialty.trim() ? ` — ${esc(t.specialty)}` : ''
    }</p>
    ${t.clinic_address ? `<p style="margin:2px 0">${esc(t.clinic_address)}</p>` : ''}
    <p style="margin:2px 0">${[
      t.clinic_phone ? `Phone: ${esc(t.clinic_phone)}` : '',
      t.clinic_email ? `Email: ${esc(t.clinic_email)}` : ''
    ]
      .filter(Boolean)
      .join(' · ')}</p>
  </section>`

  const meta = `
  <div class="meta">
    <div class="row"><span class="k">Patient</span><span class="v">${esc(
      `${p.first_name} ${p.last_name}`
    )}</span></div>
    <div class="row"><span class="k">Patient ID</span><span class="v">${esc(p.patient_id)}</span></div>
    <div class="row"><span class="k">Date of Birth</span><span class="v">${formatDate(
      p.date_of_birth
    )} (Age ${age(p.date_of_birth)})</span></div>
    <div class="row"><span class="k">Phone</span><span class="v">${esc(p.phone || '—')}</span></div>
    <div class="row"><span class="k">Referring Provider</span><span class="v">${esc(
      input.doctorName
    )}</span></div>
    <div class="row"><span class="k">Priority</span><span class="v">${urgencyBadge}</span></div>
  </div>`

  const alerts: string[] = []
  if (p.allergies?.trim()) alerts.push(`Allergies: ${esc(p.allergies)}`)
  if (p.medical_conditions?.trim()) alerts.push(`Conditions: ${esc(p.medical_conditions)}`)
  if (p.medications?.trim()) alerts.push(`Medications: ${esc(p.medications)}`)
  const alertBox =
    input.includeAlerts && alerts.length > 0
      ? `<div class="alert"><b>⚠ Medical Alerts</b> — ${alerts.join(' &nbsp;|&nbsp; ')}</div>`
      : ''

  const reasonSection = `
  <section>
    <h2>Reason for Referral</h2>
    <p>${nl2br(input.reason) || '—'}</p>
  </section>`

  const bodySection = t.body && t.body.trim() ? `<section><p>${nl2br(t.body)}</p></section>` : ''

  const findingsSection =
    input.includeFindings && input.findingNotes.length > 0
      ? `<section>
          <h2>Clinical Findings${
            input.latestExam ? ` (exam of ${formatDate(input.latestExam.exam_date)})` : ''
          }</h2>
          ${input.findingNotes
            .map(
              (n) =>
                `<div class="note-block"><div class="ncontent">${nl2br(n.content)}</div>${
                  n.linked_teeth.length > 0
                    ? `<div class="teeth">Teeth: ${n.linked_teeth.join(', ')}</div>`
                    : ''
                }</div>`
            )
            .join('')}
        </section>`
      : ''

  const chartSection =
    input.includeToothChart && input.latestExam
      ? `<section>
          <h2>Tooth Chart${
            input.latestExam ? ` (${formatDate(input.latestExam.exam_date)})` : ''
          }</h2>
          <div class="chart-wrap">${toothChartSvgString(input.latestExam.tooth_chart_data)}</div>
        </section>`
      : ''

  const notesSection =
    input.extraNotes && input.extraNotes.trim()
      ? `<section><h2>Additional Notes</h2><p>${nl2br(input.extraNotes)}</p></section>`
      : ''

  const signature = `
  <div class="signatures">
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-label">Referring Provider Signature</div>
      <div class="sig-meta">${esc(input.doctorName)}</div>
      <div class="sig-meta">${esc(c.clinic_name)} · ${esc(c.phone)}</div>
    </div>
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-label">Date</div>
      <div class="sig-meta">${formatDate(new Date().toISOString())}</div>
    </div>
  </div>`

  const footer = `<div class="footer">${esc(c.clinic_name)} · ${esc(c.address)} · ${esc(
    c.phone
  )} — Referral generated by Giving Smiles on ${formatDateTime(
    new Date().toISOString()
  )}<br/>${COPYRIGHT}</div>`

  const body = `<div class="doc">
    ${header}
    <div class="doc-title">Referral Letter</div>
    ${toBlock}
    ${meta}
    ${alertBox}
    ${reasonSection}
    ${bodySection}
    ${findingsSection}
    ${chartSection}
    ${notesSection}
    ${signature}
    ${footer}
  </div>`

  return htmlShell({ title: 'Referral Letter', body })
}

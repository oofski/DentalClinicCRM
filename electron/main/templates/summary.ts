import { htmlShell } from './docStyles'
import { esc, formatDate, formatDateTime, age } from './util'
import { logoLockupSvg } from '@shared/branding'
import type {
  Patient,
  ClinicSettings,
  Examination,
  ConsentForm,
  TreatmentReport
} from '@shared/types'

export interface SummaryRenderInput {
  clinic: ClinicSettings
  patient: Patient
  exams: Examination[]
  consents: ConsentForm[]
  reports: TreatmentReport[]
  lastVisit: string | null
}

export function buildSummaryHtml(input: SummaryRenderInput): string {
  const { clinic: c, patient: p } = input

  const header = `
  <div class="doc-header">
    <div class="brand">${logoLockupSvg({ height: 46 })}</div>
    <div class="clinic">
      <div class="name">${esc(c.clinic_name)}</div>
      <div>${esc(c.address)}</div>
      <div>Phone: ${esc(c.phone)} · License #: ${esc(c.license_number)}</div>
    </div>
  </div>`

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
    <div class="row"><span class="k">Email</span><span class="v">${esc(p.email || '—')}</span></div>
    <div class="row"><span class="k">Last Visit</span><span class="v">${formatDate(
      input.lastVisit
    )}</span></div>
  </div>`

  const alerts: string[] = []
  if (p.allergies?.trim()) alerts.push(`Allergies: ${esc(p.allergies)}`)
  if (p.medical_conditions?.trim()) alerts.push(`Conditions: ${esc(p.medical_conditions)}`)
  if (p.medications?.trim()) alerts.push(`Medications: ${esc(p.medications)}`)
  const alertBox = alerts.length
    ? `<div class="alert"><b>⚠ Medical Alerts</b> — ${alerts.join(' &nbsp;|&nbsp; ')}</div>`
    : ''

  const dental = `
  <section>
    <h2>Dental & Insurance</h2>
    <p><b>Dental history:</b> ${esc(p.dental_history || '—')}</p>
    <p><b>Referring doctor:</b> ${esc(p.referring_doctor || '—')} &nbsp; <b>Insurance:</b> ${esc(
      p.insurance_info || '—'
    )}</p>
  </section>`

  const visitRows =
    input.exams.length > 0
      ? input.exams
          .map(
            (e) =>
              `<tr><td>${formatDate(e.exam_date)}</td><td>${esc(
                e.doctor_name || '—'
              )}</td><td>${esc(e.status.replace('_', ' '))}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="3">No examinations recorded.</td></tr>'

  const docRows: string[] = []
  for (const cf of input.consents)
    docRows.push(
      `<tr><td>Consent (${esc(cf.language)})</td><td>${formatDateTime(cf.signed_at)}</td></tr>`
    )
  for (const r of input.reports)
    docRows.push(`<tr><td>Treatment Report</td><td>${formatDateTime(r.created_at)}</td></tr>`)

  const body = `<div class="doc">
    ${header}
    <div class="doc-title">Patient Summary</div>
    ${meta}
    ${alertBox}
    ${dental}
    <section>
      <h2>Visit History</h2>
      <table><thead><tr><th>Date</th><th>Provider</th><th>Status</th></tr></thead>
      <tbody>${visitRows}</tbody></table>
    </section>
    <section>
      <h2>Documents on File</h2>
      <table><thead><tr><th>Document</th><th>Date</th></tr></thead>
      <tbody>${docRows.join('') || '<tr><td colspan="2">No documents on file.</td></tr>'}</tbody></table>
    </section>
    <div class="footer">${esc(c.clinic_name)} — Patient summary generated ${formatDateTime(
      new Date().toISOString()
    )}</div>
  </div>`

  return htmlShell({ title: 'Patient Summary', body })
}

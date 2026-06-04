import { htmlShell } from './docStyles'
import { esc, nl2br, formatDate, formatDateTime, age } from './util'
import { logoLockupSvg } from '@shared/branding'
import { CONDITIONS } from '@shared/dental'
import type {
  Patient,
  ClinicSettings,
  Examination,
  ClinicalNote,
  TreatmentItem,
  ToothConditionKey
} from '@shared/types'

export interface ReportRenderInput {
  clinic: ClinicSettings
  patient: Patient
  exam: Examination
  doctorName: string
  notes: ClinicalNote[]
  treatmentItems: TreatmentItem[]
  toothChartSvg: string
  summaryNote?: string
  approvedAt: string | null
}

const NOTE_TYPE_LABELS: Record<string, string> = {
  finding: 'Examination Findings',
  treatment_plan: 'Treatment Plan Notes',
  follow_up: 'Follow-up',
  observation: 'Special Observations'
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, important: 1, routine: 2 }

export function buildReportHtml(input: ReportRenderInput): string {
  const { clinic: c, patient: p, exam, doctorName } = input

  // ---- Condition counts from the tooth chart ----
  const byCondition = new Map<ToothConditionKey, number[]>()
  for (const [num, state] of Object.entries(exam.tooth_chart_data || {})) {
    if (!state || state.condition === 'unexamined') continue
    const arr = byCondition.get(state.condition) || []
    arr.push(Number(num))
    byCondition.set(state.condition, arr)
  }
  const countChips = CONDITIONS.filter((cd) => cd.key !== 'unexamined')
    .map((cd) => {
      const teeth = byCondition.get(cd.key) || []
      if (teeth.length === 0) return ''
      return `<div class="count-chip"><span class="dot" style="background:${cd.color}"></span>${esc(
        cd.label
      )}: <b>${teeth.length}</b></div>`
    })
    .join('')

  const findingsSummary = CONDITIONS.filter((cd) => cd.key !== 'unexamined' && cd.key !== 'healthy')
    .map((cd) => {
      const teeth = byCondition.get(cd.key) || []
      if (teeth.length === 0) return ''
      return `<li><b>${esc(cd.label)}</b> (${teeth.length}): teeth ${teeth
        .sort((a, b) => a - b)
        .join(', ')}</li>`
    })
    .join('')

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
    <div class="row"><span class="k">Exam Date</span><span class="v">${formatDate(
      exam.exam_date
    )}</span></div>
    <div class="row"><span class="k">Provider</span><span class="v">${esc(doctorName)}</span></div>
    <div class="row"><span class="k">Report Date</span><span class="v">${formatDate(
      new Date().toISOString()
    )}</span></div>
  </div>`

  const alerts: string[] = []
  if (p.allergies && p.allergies.trim()) alerts.push(`Allergies: ${esc(p.allergies)}`)
  if (p.medical_conditions && p.medical_conditions.trim())
    alerts.push(`Conditions: ${esc(p.medical_conditions)}`)
  if (p.medications && p.medications.trim()) alerts.push(`Medications: ${esc(p.medications)}`)
  const alertBox =
    alerts.length > 0
      ? `<div class="alert"><b>⚠ Medical Alerts</b> — ${alerts.join(' &nbsp;|&nbsp; ')}</div>`
      : ''

  const summarySection = `
  <section>
    <h2>Patient Summary</h2>
    <p>${esc(p.first_name)} ${esc(p.last_name)}, age ${age(p.date_of_birth)}.${
      p.dental_history && p.dental_history.trim()
        ? ` Relevant dental history: ${esc(p.dental_history)}`
        : ''
    }</p>
  </section>`

  const findingsSection = `
  <section>
    <h2>Examination Findings</h2>
    <div class="chart-wrap">${input.toothChartSvg}</div>
    <div class="counts">${countChips || '<span style="color:#5A6B7B">No conditions recorded.</span>'}</div>
    ${findingsSummary ? `<ul style="margin:6px 0 0; padding-left:18px">${findingsSummary}</ul>` : ''}
  </section>`

  // Clinical notes grouped by type
  const notesByType = new Map<string, ClinicalNote[]>()
  for (const n of input.notes) {
    const arr = notesByType.get(n.note_type) || []
    arr.push(n)
    notesByType.set(n.note_type, arr)
  }
  const noteGroups = Object.keys(NOTE_TYPE_LABELS)
    .map((type) => {
      const list = notesByType.get(type) || []
      if (list.length === 0) return ''
      const items = list
        .map((n) => {
          const teeth =
            n.linked_teeth.length > 0
              ? `<div class="teeth">Teeth: ${n.linked_teeth.join(', ')}</div>`
              : ''
          return `<div class="note-block"><div class="ncontent">${nl2br(
            n.content
          )}</div>${teeth}</div>`
        })
        .join('')
      return `<div style="margin-bottom:8px"><div class="ntype">${esc(
        NOTE_TYPE_LABELS[type]
      )}</div>${items}</div>`
    })
    .join('')
  const notesSection =
    input.notes.length > 0
      ? `<section><h2>Clinical Notes</h2>${noteGroups}</section>`
      : ''

  // Treatment plan table
  const sortedItems = [...input.treatmentItems].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
  )
  const showCost = sortedItems.some((i) => i.cost && i.cost.trim())
  const planRows = sortedItems
    .map(
      (i) => `<tr>
        <td><span class="badge ${esc(i.priority)}">${esc(i.priority)}</span></td>
        <td>${esc(i.tooth || '—')}</td>
        <td>${esc(i.description)}</td>
        <td>${esc(i.estimate || '—')}</td>
        ${showCost ? `<td>${esc(i.cost || '—')}</td>` : ''}
      </tr>`
    )
    .join('')
  const planSection =
    sortedItems.length > 0
      ? `<section>
          <h2>Treatment Plan</h2>
          <table>
            <thead><tr>
              <th style="width:80px">Priority</th>
              <th style="width:70px">Tooth</th>
              <th>Recommended Treatment</th>
              <th style="width:120px">Estimated Timeline</th>
              ${showCost ? '<th style="width:90px">Est. Cost</th>' : ''}
            </tr></thead>
            <tbody>${planRows}</tbody>
          </table>
        </section>`
      : ''

  const summaryNoteSection =
    input.summaryNote && input.summaryNote.trim()
      ? `<section><h2>Summary</h2><p>${nl2br(input.summaryNote)}</p></section>`
      : ''

  const signature = `
  <div class="signatures">
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-label">Provider Signature / Approval</div>
      <div class="sig-meta">${esc(doctorName)}</div>
      <div class="sig-meta">${
        input.approvedAt
          ? `Approved: ${formatDateTime(input.approvedAt)}`
          : 'Pending approval'
      }</div>
    </div>
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-label">Patient Acknowledgement (optional)</div>
      <div class="sig-meta">Date: ____________________</div>
    </div>
  </div>`

  const footer = `<div class="footer">${esc(
    c.clinic_name
  )} · ${esc(c.address)} · ${esc(c.phone)} — Generated by Giving Smiles on ${formatDateTime(
    new Date().toISOString()
  )}</div>`

  const body = `<div class="doc">
    ${header}
    <div class="doc-title">Dental Examination &amp; Treatment Report</div>
    ${meta}
    ${alertBox}
    ${summarySection}
    ${findingsSection}
    ${notesSection}
    ${planSection}
    ${summaryNoteSection}
    ${signature}
    ${footer}
  </div>`

  return htmlShell({ title: 'Treatment Report', body })
}

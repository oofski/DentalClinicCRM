import { htmlShell } from './docStyles'
import { esc, nl2br, formatDate, formatDateTime, age } from './util'
import { logoLockupSvg } from '@shared/branding'
import { CONDITIONS } from '@shared/dental'
import { toothChartSvgString } from '@shared/toothChart'
import { REPORT_STRINGS } from '@shared/reportStrings'
import { COPYRIGHT } from '@shared/legal'
import type {
  Patient,
  ClinicSettings,
  Examination,
  ClinicalNote,
  TreatmentItem,
  ToothConditionKey,
  Language
} from '@shared/types'

export interface ReportRenderInput {
  clinic: ClinicSettings
  patient: Patient
  exam: Examination
  doctorName: string
  notes: ClinicalNote[]
  treatmentItems: TreatmentItem[]
  language: Language
  summaryNote?: string
  approvedAt: string | null
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, important: 1, routine: 2 }

export function buildReportHtml(input: ReportRenderInput): string {
  const { clinic: c, patient: p, exam, doctorName } = input
  const t = REPORT_STRINGS[input.language] ?? REPORT_STRINGS.english
  const toothChartSvg = toothChartSvgString(exam.tooth_chart_data, { upper: t.upper, lower: t.lower })

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
        t.conditionLabels[cd.key]
      )}: <b>${teeth.length}</b></div>`
    })
    .join('')

  const findingsSummary = CONDITIONS.filter((cd) => cd.key !== 'unexamined' && cd.key !== 'healthy')
    .map((cd) => {
      const teeth = byCondition.get(cd.key) || []
      if (teeth.length === 0) return ''
      return `<li><b>${esc(t.conditionLabels[cd.key])}</b> (${teeth.length}): ${esc(
        t.teethWord
      )} ${teeth.sort((a, b) => a - b).join(', ')}</li>`
    })
    .join('')

  const header = `
  <div class="doc-header">
    <div class="brand">${logoLockupSvg({ height: 46 })}</div>
    <div class="clinic">
      <div class="name">${esc(c.clinic_name)}</div>
      <div>${esc(c.address)}</div>
      <div>${esc(t.phoneWord)}: ${esc(c.phone)} · ${esc(t.licenseWord)}: ${esc(c.license_number)}</div>
    </div>
  </div>`

  const meta = `
  <div class="meta">
    <div class="row"><span class="k">${esc(t.patient)}</span><span class="v">${esc(
      `${p.first_name} ${p.last_name}`
    )}</span></div>
    <div class="row"><span class="k">${esc(t.patientId)}</span><span class="v">${esc(
      p.patient_id
    )}</span></div>
    <div class="row"><span class="k">${esc(t.dob)}</span><span class="v">${formatDate(
      p.date_of_birth
    )} (${esc(t.age)} ${age(p.date_of_birth)})</span></div>
    <div class="row"><span class="k">${esc(t.examDate)}</span><span class="v">${formatDate(
      exam.exam_date
    )}</span></div>
    <div class="row"><span class="k">${esc(t.provider)}</span><span class="v">${esc(
      doctorName
    )}</span></div>
    <div class="row"><span class="k">${esc(t.reportDate)}</span><span class="v">${formatDate(
      new Date().toISOString()
    )}</span></div>
  </div>`

  const alerts: string[] = []
  if (p.allergies && p.allergies.trim()) alerts.push(`${esc(t.allergies)}: ${esc(p.allergies)}`)
  if (p.medical_conditions && p.medical_conditions.trim())
    alerts.push(`${esc(t.conditions)}: ${esc(p.medical_conditions)}`)
  if (p.medications && p.medications.trim())
    alerts.push(`${esc(t.medications)}: ${esc(p.medications)}`)
  const alertBox =
    alerts.length > 0
      ? `<div class="alert"><b>⚠ ${esc(t.medicalAlerts)}</b> — ${alerts.join(' &nbsp;|&nbsp; ')}</div>`
      : ''

  const summarySection = `
  <section>
    <h2>${esc(t.patientSummary)}</h2>
    <p>${esc(p.first_name)} ${esc(p.last_name)}, ${esc(t.ageWord)} ${age(p.date_of_birth)}.${
      p.dental_history && p.dental_history.trim()
        ? ` ${esc(t.relevantDental)} ${esc(p.dental_history)}`
        : ''
    }</p>
  </section>`

  const findingsSection = `
  <section>
    <h2>${esc(t.examFindings)}</h2>
    <div class="chart-wrap">${toothChartSvg}</div>
    <div class="counts">${countChips || `<span style="color:#5A6B7B">${esc(t.noConditions)}</span>`}</div>
    ${findingsSummary ? `<ul style="margin:6px 0 0; padding-left:18px">${findingsSummary}</ul>` : ''}
  </section>`

  // Clinical notes grouped by type
  const notesByType = new Map<string, ClinicalNote[]>()
  for (const n of input.notes) {
    const arr = notesByType.get(n.note_type) || []
    arr.push(n)
    notesByType.set(n.note_type, arr)
  }
  const noteGroups = (['finding', 'treatment_plan', 'follow_up', 'observation'] as const)
    .map((type) => {
      const list = notesByType.get(type) || []
      if (list.length === 0) return ''
      const items = list
        .map((n) => {
          const teeth =
            n.linked_teeth.length > 0
              ? `<div class="teeth">${esc(t.teethLabel)}: ${n.linked_teeth.join(', ')}</div>`
              : ''
          return `<div class="note-block"><div class="ncontent">${nl2br(
            n.content
          )}</div>${teeth}</div>`
        })
        .join('')
      return `<div style="margin-bottom:8px"><div class="ntype">${esc(
        t.noteTypes[type]
      )}</div>${items}</div>`
    })
    .join('')
  const notesSection =
    input.notes.length > 0 ? `<section><h2>${esc(t.clinicalNotes)}</h2>${noteGroups}</section>` : ''

  // Treatment plan table
  const sortedItems = [...input.treatmentItems].sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
  )
  const showCost = sortedItems.some((i) => i.cost && i.cost.trim())
  const planRows = sortedItems
    .map(
      (i) => `<tr>
        <td><span class="badge ${esc(i.priority)}">${esc(t.priority[i.priority])}</span></td>
        <td>${esc(i.tooth || '—')}</td>
        <td>${esc(i.description || '—')}${
          i.details && i.details.trim()
            ? `<div style="font-size:10.5px;color:#667;margin-top:2px">${esc(i.details.trim())}</div>`
            : ''
        }</td>
        <td>${esc(i.estimate || '—')}</td>
        ${showCost ? `<td>${esc(i.cost || '—')}</td>` : ''}
      </tr>`
    )
    .join('')
  const planSection =
    sortedItems.length > 0
      ? `<section>
          <h2>${esc(t.treatmentPlan)}</h2>
          <table>
            <thead><tr>
              <th style="width:84px">${esc(t.thPriority)}</th>
              <th style="width:64px">${esc(t.thTooth)}</th>
              <th>${esc(t.thTreatment)}</th>
              <th style="width:120px">${esc(t.thTimeline)}</th>
              ${showCost ? `<th style="width:90px">${esc(t.thCost)}</th>` : ''}
            </tr></thead>
            <tbody>${planRows}</tbody>
          </table>
        </section>`
      : ''

  const summaryNoteSection =
    input.summaryNote && input.summaryNote.trim()
      ? `<section><h2>${esc(t.summary)}</h2><p>${nl2br(input.summaryNote)}</p></section>`
      : ''

  const signature = `
  <div class="signatures">
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-label">${esc(t.providerApproval)}</div>
      <div class="sig-meta">${esc(doctorName)}</div>
      <div class="sig-meta">${
        input.approvedAt ? `${esc(t.approved)}: ${formatDateTime(input.approvedAt)}` : esc(t.pending)
      }</div>
    </div>
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-label">${esc(t.patientAck)}</div>
      <div class="sig-meta">${esc(t.dateLine)}: ____________________</div>
    </div>
  </div>`

  const footer = `<div class="footer">${esc(c.clinic_name)} · ${esc(c.address)} · ${esc(
    c.phone
  )} — ${esc(t.generatedBy)} ${formatDateTime(new Date().toISOString())}<br/>${COPYRIGHT}</div>`

  const body = `<div class="doc">
    ${header}
    <div class="doc-title">${esc(t.title)}</div>
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

  return htmlShell({ title: t.title, dir: t.dir, body })
}

import { htmlShell } from './docStyles'
import { esc, nl2br, formatDate, formatDateTime, age } from './util'
import {
  buildOdontogramLegend,
  buildOdontogramSvg,
  compareTeeth,
  hasOdontogramContent,
  isChartable
} from './odontogramSvg'
import { Odontogram } from '../odontogramRepo'
import { logoLockupSvg } from '@shared/branding'
import { CONDITIONS } from '@shared/dental'
import { toothChartSvgString } from '@shared/toothChart'
import { REPORT_STRINGS } from '@shared/reportStrings'
import { COPYRIGHT } from '@shared/legal'
import {
  STATUS_LABELS,
  TOOTH_BY_ID,
  isPrimary,
  surfaceShorthand,
  type ClinicalStatus,
  type OdontogramData,
  type Procedure,
  type ToothCondition,
  type ToothId
} from '@shared/odontogram'
// The palette the chart is drawn with, so the table and the drawing name a finding the
// same way. Imported, never restated.
import { CONDITION_STYLE, isProposed } from '../../../src/components/odontogram/conditionStyle'
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
  /**
   * The chart to print. Optional: when the caller does not supply one the exam's odontogram
   * is read here, and an exam that has no odontogram rows still prints the legacy chart.
   * Pass `null` to force the legacy path (the self-test and unit tests do).
   */
  odontogram?: OdontogramData | null
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, important: 1, routine: 2 }

// Labels for the odontogram sections. reportStrings.ts is the shared table for the rest of
// the report; these live here because the odontogram arrived after it, and a patient whose
// record is in Spanish or Arabic must not get an English chart bolted onto it.
interface ChartStrings {
  findingsByTooth: string
  chartKey: string
  tooth: string
  condition: string
  surfaces: string
  status: string
  recorded: string
  provider: string
  procedures: string
  phase: string
  code: string
  procedure: string
  teeth: string
  date: string
  noPlan: string
  accepted: string
  notAccepted: string
  material: string
  note: string
  primaryWord: string
  primaryTag: string
  keyPresent: string
  keyProposed: string
}

const CHART_STRINGS: Record<Language, ChartStrings> = {
  english: {
    findingsByTooth: 'Findings by Tooth',
    chartKey: 'Chart Key',
    tooth: 'Tooth',
    condition: 'Condition',
    surfaces: 'Surfaces',
    status: 'Status',
    recorded: 'Recorded',
    provider: 'Provider',
    procedures: 'Procedures',
    phase: 'Phase',
    code: 'Code',
    procedure: 'Procedure',
    teeth: 'Teeth',
    date: 'Date',
    noPlan: 'Not in a treatment plan',
    accepted: 'accepted',
    notAccepted: 'not accepted',
    material: 'Material',
    note: 'Note',
    primaryWord: 'PRIMARY',
    primaryTag: 'primary',
    keyPresent: 'Solid outline: already in the mouth',
    keyProposed: 'Dashed, hollow: planned, not yet done'
  },
  spanish: {
    findingsByTooth: 'Hallazgos por Diente',
    chartKey: 'Clave del Diagrama',
    tooth: 'Diente',
    condition: 'Condición',
    surfaces: 'Superficies',
    status: 'Estado',
    recorded: 'Registrado',
    provider: 'Proveedor',
    procedures: 'Procedimientos',
    phase: 'Fase',
    code: 'Código',
    procedure: 'Procedimiento',
    teeth: 'Dientes',
    date: 'Fecha',
    noPlan: 'Fuera de un plan de tratamiento',
    accepted: 'aceptado',
    notAccepted: 'no aceptado',
    material: 'Material',
    note: 'Nota',
    primaryWord: 'TEMPORAL',
    primaryTag: 'temporal',
    keyPresent: 'Contorno sólido: ya presente en la boca',
    keyProposed: 'Contorno discontinuo: planificado, aún no realizado'
  },
  arabic: {
    findingsByTooth: 'النتائج حسب السن',
    chartKey: 'مفتاح المخطط',
    tooth: 'السن',
    condition: 'الحالة',
    surfaces: 'الأسطح',
    status: 'الوضع',
    recorded: 'تاريخ التسجيل',
    provider: 'مقدم الخدمة',
    procedures: 'الإجراءات',
    phase: 'المرحلة',
    code: 'الرمز',
    procedure: 'الإجراء',
    teeth: 'الأسنان',
    date: 'التاريخ',
    noPlan: 'خارج خطة علاجية',
    accepted: 'مقبولة',
    notAccepted: 'غير مقبولة',
    material: 'المادة',
    note: 'ملاحظة',
    primaryWord: 'لبني',
    primaryTag: 'لبني',
    keyPresent: 'خط متصل: موجود في الفم',
    keyProposed: 'خط متقطع: مخطط، لم يُنفَّذ بعد'
  }
}

/**
 * The chart to print. An explicit `odontogram` (including `null`) always wins; otherwise the
 * exam's own chart is read. A read that fails falls back to the legacy chart rather than
 * failing the PDF — a report with the old chart beats no report at all in a clinic.
 */
function resolveOdontogram(input: ReportRenderInput): OdontogramData | null {
  if (input.odontogram !== undefined) return input.odontogram
  try {
    return Odontogram.get(input.exam.id)
  } catch (e) {
    console.warn('[report] odontogram unavailable, printing the legacy chart:', e)
    return null
  }
}

/** A status pill that reads in greyscale: the word itself, dashed when the work is proposed. */
function statusPill(status: ClinicalStatus): string {
  const cls = isProposed(status) ? 'og-pill proposed' : 'og-pill present'
  return `<span class="${cls}">${esc(STATUS_LABELS[status] ?? status)}</span>`
}

function conditionCell(c: ToothCondition, s: ChartStrings): string {
  const style = CONDITION_STYLE[c.type]
  const label = style ? style.label : c.type
  const swatch = style
    ? `<span class="og-dot" style="background:${style.color}"></span>`
    : ''
  const extras: string[] = []
  if (c.material && c.material.trim()) extras.push(`${esc(s.material)}: ${esc(c.material.trim())}`)
  if (c.note && c.note.trim()) extras.push(`${esc(s.note)}: ${esc(c.note.trim())}`)
  return (
    `${swatch}${esc(label)}` +
    (extras.length ? `<div class="og-sub">${extras.join(' · ')}</div>` : '')
  )
}

function toothCell(id: ToothId, s: ChartStrings): string {
  const info = TOOTH_BY_ID.get(id)
  return (
    `<b>${esc(id)}</b>` +
    (isPrimary(id) ? ` <span class="og-tag">${esc(s.primaryTag)}</span>` : '') +
    (info ? `<div class="og-sub">${esc(info.label)}</div>` : '')
  )
}

/**
 * Every finding on every tooth, in chart order. This is the table the legacy chart could not
 * produce: it carries several rows for one tooth, primary teeth, and the lifecycle.
 */
function findingsTable(data: OdontogramData, s: ChartStrings): string {
  // Exactly the rows the chart drew: a table listing a finding the drawing cannot show
  // (an unknown tooth, an unknown condition) is a second version of the record.
  const rows = [...data.conditions]
    .filter(isChartable)
    .sort(
      (a, b) =>
        compareTeeth(a.tooth, b.tooth) ||
        (CONDITION_STYLE[a.type]?.z ?? 0) - (CONDITION_STYLE[b.type]?.z ?? 0) ||
        String(a.date_recorded).localeCompare(String(b.date_recorded))
    )
  if (!rows.length) return ''

  const body = rows
    .map(
      (c) => `<tr>
        <td class="og-tooth">${toothCell(c.tooth, s)}</td>
        <td>${conditionCell(c, s)}</td>
        <td>${esc(surfaceShorthand(c.surfaces || []) || '—')}</td>
        <td>${statusPill(c.status)}</td>
        <td>${esc(c.provider_name || '—')}</td>
        <td>${formatDate(c.date_recorded)}</td>
      </tr>`
    )
    .join('')

  return `<section class="og-table-section">
    <h2>${esc(s.findingsByTooth)}</h2>
    <table class="og-table">
      <thead><tr>
        <th style="width:96px">${esc(s.tooth)}</th>
        <th>${esc(s.condition)}</th>
        <th style="width:64px">${esc(s.surfaces)}</th>
        <th style="width:82px">${esc(s.status)}</th>
        <th style="width:112px">${esc(s.provider)}</th>
        <th style="width:104px">${esc(s.recorded)}</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`
}

/**
 * Procedures grouped by treatment plan, then by phase — the sequence the work is done in.
 * MONEY IS OUT OF SCOPE: fee, insurance_estimate and patient_portion are modelled on the
 * Procedure but deliberately never printed here.
 */
function proceduresTable(data: OdontogramData, s: ChartStrings): string {
  const procedures = data.procedures || []
  if (!procedures.length) return ''

  const byPlan = new Map<number | null, Procedure[]>()
  for (const p of procedures) {
    const key = p.tx_plan_id ?? null
    const list = byPlan.get(key)
    if (list) list.push(p)
    else byPlan.set(key, [p])
  }

  // Named plans first, in the order the clinic created them; loose procedures last.
  const planOrder: Array<number | null> = [
    ...(data.plans || []).map((p) => p.id).filter((id) => byPlan.has(id)),
    ...[...byPlan.keys()].filter((k) => k !== null && !(data.plans || []).some((p) => p.id === k)),
    ...(byPlan.has(null) ? [null] : [])
  ]

  const showCode = procedures.some((p) => p.code && p.code.trim())
  const cols = showCode ? 7 : 6

  const groups = planOrder
    .map((planId) => {
      const list = (byPlan.get(planId) || []).slice().sort((a, b) => a.phase - b.phase || a.id - b.id)
      if (!list.length) return ''
      const plan = (data.plans || []).find((p) => p.id === planId)
      const heading = plan
        ? `<div class="og-plan">${esc(plan.name)} <span class="og-tag">${esc(
            plan.accepted ? s.accepted : s.notAccepted
          )}</span></div>`
        : `<div class="og-plan">${esc(s.noPlan)}</div>`

      // A phase divider before each new phase: phase 1 is done before phase 2, and a plan
      // printed without that order is a list, not a sequence.
      const parts: string[] = []
      let phase: number | null = null
      for (const p of list) {
        if (p.phase !== phase) {
          phase = p.phase
          parts.push(
            `<tr class="og-phase"><td colspan="${cols}">${esc(s.phase)} ${esc(String(p.phase))}</td></tr>`
          )
        }
        parts.push(`<tr>
              ${showCode ? `<td>${esc(p.code || '—')}</td>` : ''}
              <td>${esc(p.description || '—')}${
                p.note && p.note.trim() ? `<div class="og-sub">${esc(p.note.trim())}</div>` : ''
              }</td>
              <td>${esc((p.teeth || []).join(', ') || '—')}</td>
              <td>${esc(surfaceShorthand(p.surfaces || []) || '—')}</td>
              <td>${statusPill(p.status)}</td>
              <td>${esc(p.provider_name || '—')}</td>
              <td>${p.date ? formatDate(p.date) : '—'}</td>
            </tr>`)
      }
      const body = parts.join('')

      return `<div class="og-plan-block">${heading}
        <table class="og-table">
          <thead><tr>
            ${showCode ? `<th style="width:64px">${esc(s.code)}</th>` : ''}
            <th>${esc(s.procedure)}</th>
            <th style="width:92px">${esc(s.teeth)}</th>
            <th style="width:60px">${esc(s.surfaces)}</th>
            <th style="width:82px">${esc(s.status)}</th>
            <th style="width:112px">${esc(s.provider)}</th>
            <th style="width:104px">${esc(s.date)}</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table></div>`
    })
    .join('')

  return `<section class="og-table-section">
    <h2>${esc(s.procedures)}</h2>
    ${groups}
  </section>`
}

export function buildReportHtml(input: ReportRenderInput): string {
  const { clinic: c, patient: p, exam, doctorName } = input
  const t = REPORT_STRINGS[input.language] ?? REPORT_STRINGS.english
  const s = CHART_STRINGS[input.language] ?? CHART_STRINGS.english

  const odontogram = resolveOdontogram(input)
  const useOdontogram = hasOdontogramContent(odontogram)

  // ---- Legacy chart: still the record for exams charted before the odontogram ----
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

  // ---- Findings: the odontogram when there is one, the legacy chart when there is not ----
  let findingsSection: string
  let odontogramTables = ''
  if (useOdontogram && odontogram) {
    const chart = buildOdontogramSvg(odontogram, {
      // The chart SVG carries the pattern tiles; the legend borrows nothing and defines its
      // own under a different prefix, so the document never holds a duplicate id.
      idPrefix: 'og-',
      title: t.examFindings,
      labels: { upper: t.upper, lower: t.lower, primary: s.primaryWord }
    })
    const legend = buildOdontogramLegend(odontogram, {
      idPrefix: 'ogl-',
      statusLabels: { present: s.keyPresent, proposed: s.keyProposed }
    })
    findingsSection = `
  <section class="og-block">
    <h2>${esc(t.examFindings)}</h2>
    <div class="og-chart">${chart}</div>
    <div class="og-legend"><div class="og-legend-title">${esc(s.chartKey)}</div>${legend}</div>
  </section>`
    odontogramTables = findingsTable(odontogram, s) + proceduresTable(odontogram, s)
  } else {
    const toothChartSvg = toothChartSvgString(exam.tooth_chart_data, {
      upper: t.upper,
      lower: t.lower
    })
    findingsSection = `
  <section>
    <h2>${esc(t.examFindings)}</h2>
    <div class="chart-wrap">${toothChartSvg}</div>
    <div class="counts">${countChips || `<span style="color:#5A6B7B">${esc(t.noConditions)}</span>`}</div>
    ${findingsSummary ? `<ul style="margin:6px 0 0; padding-left:18px">${findingsSummary}</ul>` : ''}
  </section>`
  }

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
    ${odontogramTables}
    ${notesSection}
    ${planSection}
    ${summaryNoteSection}
    ${signature}
    ${footer}
  </div>`

  return htmlShell({ title: t.title, dir: t.dir, body })
}

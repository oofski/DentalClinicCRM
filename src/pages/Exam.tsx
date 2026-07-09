import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/store/auth'
import type {
  Examination,
  Patient,
  ClinicalNote,
  ToothChartData,
  ToothState,
  TreatmentItem,
  NoteType,
  TreatmentPriority
} from '@shared/types'
import {
  CONDITION_LABELS,
  SURFACES,
  SURFACE_ABBR,
  AUTO_NOTE_IGNORED,
  RECOMMENDED_TREATMENTS,
  TREATMENT_TIMELINES
} from '@shared/dental'
import { ToothChart } from '@/components/ToothChart'
import { toothChartSvgString } from '@/components/toothGeometry'
import { Icon } from '@/components/icons'
import { useToast } from '@/components/ui'
import { DictateButton } from '@/components/Dictate'
import { formatDate } from '@/lib/format'

// ---- Auto-charting → clinical notes (v1.2.9) --------------------------------
// A tagged tooth (anything other than Unexamined/Healthy) gets one auto-generated
// "finding" note. Format: "#14 — Cavity (surfaces: M, O) — <quick note>".
function formatAutoNoteLine(n: number, st: ToothState): string {
  let line = `#${n} — ${CONDITION_LABELS[st.condition]}`
  const abbrs = SURFACES.filter((s) => st.surfaces.includes(s.key)).map((s) => SURFACE_ABBR[s.key])
  if (abbrs.length) line += ` (surfaces: ${abbrs.join(', ')})`
  const note = (st.note || '').trim()
  if (note) line += ` — ${note}`
  return line
}

// A note is tooth n's auto-note iff it's an untouched, single-tooth finding we wrote.
// The moment a doctor edits it (edited=1) it drops out of auto-management forever,
// so their wording is never clobbered. Manual composer notes have linked_teeth=[]
// so they never match.
function isAutoNoteFor(note: ClinicalNote, n: number): boolean {
  return (
    note.note_type === 'finding' &&
    !note.edited &&
    note.linked_teeth.length === 1 &&
    note.linked_teeth[0] === n &&
    note.content.startsWith(`#${n} — `)
  )
}

function normToothState(s: ToothState | undefined): ToothState {
  return s || { condition: 'unexamined', surfaces: [], note: '' }
}

function sameToothState(a: ToothState | undefined, b: ToothState | undefined): boolean {
  const x = normToothState(a)
  const y = normToothState(b)
  return (
    x.condition === y.condition &&
    (x.note || '') === (y.note || '') &&
    [...x.surfaces].sort().join(',') === [...y.surfaces].sort().join(',')
  )
}

const isNotableTooth = (st: ToothState | undefined) =>
  !!st && !AUTO_NOTE_IGNORED.includes(st.condition)

const NOTE_TYPES: { key: NoteType; label: string }[] = [
  { key: 'finding', label: 'Examination Finding' },
  { key: 'treatment_plan', label: 'Treatment Plan' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'observation', label: 'Special Observation' }
]

const TEMPLATES = [
  'Plaque buildup detected.',
  'Cavity on occlusal surface.',
  'Recommend scaling and polishing.',
  'Schedule follow-up in 6 months.'
]

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function Exam() {
  const { examId } = useParams()
  const eid = Number(examId)
  const navigate = useNavigate()
  const role = useAuth((s) => s.user?.role)
  const canClinical = role === 'doctor' || role === 'admin'
  const toast = useToast()

  const [exam, setExam] = useState<Examination | null>(null)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [chart, setChart] = useState<ToothChartData>({})
  const [notes, setNotes] = useState<ClinicalNote[]>([])
  const [items, setItems] = useState<TreatmentItem[]>([])
  const [summary, setSummary] = useState('')
  const [savedTag, setSavedTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastReport, setLastReport] = useState<string | null>(null)
  const [approve, setApprove] = useState(true)

  // Composer
  const [noteType, setNoteType] = useState<NoteType>('finding')
  const [noteText, setNoteText] = useState('')

  // Snapshot of the last-reconciled chart, so auto-notes are diffed (not rebuilt).
  const prevChartRef = useRef<ToothChartData>({})

  useEffect(() => {
    ;(async () => {
      const e = await api.exams.get(eid)
      if (!e) return
      setExam(e)
      const loaded = e.tooth_chart_data || {}
      prevChartRef.current = loaded
      setChart(loaded)
      setPatient((await api.patients.get(e.patient_id)) || null)
      setNotes(await api.notes.listByExam(eid))
      setItems(await api.exams.treatmentItems(eid))
    })()
  }, [eid])

  // Reconcile auto-generated clinical notes against the current tooth chart.
  // Runs inside the debounced chart save so rapid edits don't thrash the notes list.
  const reconcileAutoNotes = async (prev: ToothChartData, next: ToothChartData) => {
    const nums = new Set<number>()
    Object.keys(prev).forEach((k) => nums.add(Number(k)))
    Object.keys(next).forEach((k) => nums.add(Number(k)))
    const changed: number[] = []
    nums.forEach((n) => {
      if (!sameToothState(prev[n], next[n])) changed.push(n)
    })
    if (changed.length === 0) return
    // Bulk op (Mark-all / paint / reset): clean up removed tags but don't spawn a
    // note for every tooth — auto-notes are for individually tagged teeth.
    const bulk = changed.length > 8
    const existing = await api.notes.listByExam(eid)
    let mutated = false
    for (const n of changed) {
      const st = next[n]
      const auto = existing.find((note) => isAutoNoteFor(note, n))
      if (isNotableTooth(st)) {
        const line = formatAutoNoteLine(n, st as ToothState)
        if (auto) {
          if (auto.content !== line) {
            await api.notes.delete(auto.id)
            await api.notes.create(eid, 'finding', line, [n])
            mutated = true
          }
        } else if (!bulk) {
          await api.notes.create(eid, 'finding', line, [n])
          mutated = true
        }
      } else if (auto) {
        // Tooth reverted to Healthy/Unexamined — retire its auto-note.
        await api.notes.delete(auto.id)
        mutated = true
      }
    }
    if (mutated) setNotes(await api.notes.listByExam(eid))
  }

  // Auto-save tooth chart
  const firstChart = useRef(true)
  useEffect(() => {
    if (firstChart.current) {
      firstChart.current = false
      return
    }
    const t = setTimeout(async () => {
      await api.exams.saveChart(eid, chart)
      await reconcileAutoNotes(prevChartRef.current, chart)
      prevChartRef.current = chart
      flagSaved()
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart])

  // Auto-save treatment items
  const firstItems = useRef(true)
  useEffect(() => {
    if (firstItems.current) {
      firstItems.current = false
      return
    }
    const t = setTimeout(async () => {
      await api.exams.saveTreatmentItems(eid, items)
      flagSaved()
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const flagSaved = () => {
    setSavedTag(`Saved ${new Date().toLocaleTimeString()}`)
  }

  const addNote = async () => {
    if (!noteText.trim()) return
    const res = await api.notes.create(eid, noteType, noteText.trim(), [])
    setNotes(await api.notes.listByExam(eid))
    setNoteText('')
    flagSaved()
    void res
  }

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { id: uid(), description: '', tooth: '', priority: 'routine', estimate: '', cost: '' }
    ])

  const updateItem = (id: string, patch: Partial<TreatmentItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))

  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id))

  // Push a clinical note into the Treatment Plan as a new item (doctor then picks
  // a recommended treatment + timeline). De-dupes on the note text.
  const noteToPlan = (note: ClinicalNote) => {
    setItems((prev) => {
      if (prev.some((i) => (i.details || '') === note.content)) return prev
      return [
        ...prev,
        {
          id: uid(),
          description: '',
          tooth: note.linked_teeth.join(', '),
          priority: 'routine',
          estimate: '',
          cost: '',
          details: note.content
        }
      ]
    })
    toast.push('Added to Treatment Plan — choose a recommended treatment', 'success')
  }

  const generate = async () => {
    setBusy(true)
    try {
      const svg = toothChartSvgString(chart)
      const res = await api.report.generate({
        examinationId: eid,
        toothChartSvg: svg,
        treatmentItems: items,
        summaryNote: summary,
        approve
      })
      if (res.ok && res.pdfPath) {
        setLastReport(res.pdfPath)
        toast.push('Additional notes generated', 'success')
        if (approve) setExam((e) => (e ? { ...e, status: 'completed' } : e))
      } else {
        toast.push(res.error || 'Failed to generate report', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const printNow = async () => {
    setBusy(true)
    try {
      const svg = toothChartSvgString(chart)
      const res = await api.report.print({
        examinationId: eid,
        toothChartSvg: svg,
        treatmentItems: items,
        summaryNote: summary
      })
      if (!res.ok) toast.push(res.error || 'Print cancelled', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!exam || !patient) return <div className="empty">Loading examination…</div>

  return (
    <div className="stack">
      <div className="row between wrap">
        <div className="row" style={{ gap: 12 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/patients/${patient.id}`)}>
            <Icon name="back" size={16} /> {patient.first_name} {patient.last_name}
          </button>
          <h1 style={{ margin: 0 }}>Examination — {formatDate(exam.exam_date)}</h1>
          <span className={`pill ${exam.status === 'completed' ? 'routine' : 'important'}`}>
            {exam.status.replace('_', ' ')}
          </span>
        </div>
        {savedTag && <span className="muted" style={{ fontSize: 12 }}>● {savedTag}</span>}
      </div>

      <ToothChart value={chart} onChange={setChart} readOnly={!canClinical} />

      <div className="grid-2" style={{ gap: 16, alignItems: 'start' }}>
        {/* Clinical notes */}
        <div className="card">
          <div className="card-title">Clinical Notes</div>
          {canClinical && (
            <div style={{ marginBottom: 14 }}>
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <select value={noteType} onChange={(e) => setNoteType(e.target.value as NoteType)} style={{ width: 200 }}>
                  {NOTE_TYPES.map((n) => (
                    <option key={n.key} value={n.key}>
                      {n.label}
                    </option>
                  ))}
                </select>
                <button className="btn btn-primary btn-sm" onClick={addNote}>
                  <Icon name="plus" size={14} /> Add Note
                </button>
                <DictateButton />
              </div>
              <textarea
                placeholder="Type your finding…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                {TEMPLATES.map((t) => (
                  <button key={t} className="btn btn-sm btn-ghost" style={{ fontSize: 12 }} onClick={() => setNoteText((s) => (s ? s + ' ' + t : t))}>
                    + {t}
                  </button>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                🎤 Dictate types your speech into the focused box using your computer’s built-in voice
                typing — fully offline.
              </div>
            </div>
          )}

          {notes.length === 0 ? (
            <div className="empty">No notes yet.</div>
          ) : (
            [...notes]
              .reverse()
              .map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  readOnly={!canClinical}
                  onChange={() => flagSaved()}
                  onToPlan={canClinical ? () => noteToPlan(n) : undefined}
                  onDelete={async () => {
                    await api.notes.delete(n.id)
                    setNotes(await api.notes.listByExam(eid))
                  }}
                />
              ))
          )}
        </div>

        {/* Treatment plan */}
        <div className="card">
          <div className="card-title">
            Treatment Plan
            {canClinical && (
              <div className="row" style={{ gap: 8 }}>
                <DictateButton />
                <button className="btn btn-sm" onClick={addItem}>
                  <Icon name="plus" size={14} /> Add Item
                </button>
              </div>
            )}
          </div>
          {items.length === 0 ? (
            <div className="empty">No treatment items. Add recommended treatments here.</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {items.map((it) => (
                <div key={it.id} className="card" style={{ padding: 12, boxShadow: 'none' }}>
                  <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                    <select
                      style={{ flex: 1 }}
                      value={
                        RECOMMENDED_TREATMENTS.includes(it.description)
                          ? it.description
                          : it.description
                          ? '__legacy__'
                          : ''
                      }
                      disabled={!canClinical}
                      onChange={(e) =>
                        updateItem(it.id, {
                          description: e.target.value === '__legacy__' ? it.description : e.target.value
                        })
                      }
                    >
                      <option value="">Recommended treatment…</option>
                      {it.description && !RECOMMENDED_TREATMENTS.includes(it.description) && (
                        <option value="__legacy__">{it.description}</option>
                      )}
                      {RECOMMENDED_TREATMENTS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {canClinical && (
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => removeItem(it.id)}>
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="grid-3" style={{ gap: 8 }}>
                    <input
                      placeholder="Tooth #"
                      value={it.tooth || ''}
                      disabled={!canClinical}
                      onChange={(e) => updateItem(it.id, { tooth: e.target.value })}
                    />
                    <select
                      value={it.priority}
                      disabled={!canClinical}
                      onChange={(e) => updateItem(it.id, { priority: e.target.value as TreatmentPriority })}
                    >
                      <option value="urgent">Urgent</option>
                      <option value="important">Important</option>
                      <option value="routine">Routine</option>
                    </select>
                    <select
                      value={
                        TREATMENT_TIMELINES.includes(it.estimate)
                          ? it.estimate
                          : it.estimate
                          ? '__legacy__'
                          : ''
                      }
                      disabled={!canClinical}
                      onChange={(e) =>
                        updateItem(it.id, {
                          estimate: e.target.value === '__legacy__' ? it.estimate : e.target.value
                        })
                      }
                    >
                      <option value="">Timeline…</option>
                      {it.estimate && !TREATMENT_TIMELINES.includes(it.estimate) && (
                        <option value="__legacy__">{it.estimate}</option>
                      )}
                      {TREATMENT_TIMELINES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    style={{ marginTop: 8 }}
                    placeholder="Details / notes (optional)"
                    value={it.details || ''}
                    disabled={!canClinical}
                    onChange={(e) => updateItem(it.id, { details: e.target.value })}
                  />
                  <input
                    style={{ marginTop: 8 }}
                    placeholder="Estimated cost (optional)"
                    value={it.cost || ''}
                    disabled={!canClinical}
                    onChange={(e) => updateItem(it.id, { cost: e.target.value })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Report */}
      {canClinical && (
        <div className="card">
          <div className="card-title">
            Additional Notes
            <DictateButton />
          </div>
          <div className="field">
            <label>Summary (optional)</label>
            <textarea
              placeholder="Overall summary for the patient report…"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div className="row wrap between" style={{ gap: 12 }}>
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={approve}
                onChange={(e) => setApprove(e.target.checked)}
              />
              Approve &amp; sign report (marks exam complete)
            </label>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn" disabled={busy} onClick={printNow}>
                <Icon name="print" size={16} /> Print
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={generate}>
                <Icon name="doc" size={16} /> {busy ? 'Generating…' : 'Generate PDF'}
              </button>
            </div>
          </div>

          {lastReport && (
            <div className="alert success" style={{ marginTop: 14 }}>
              <div className="row between wrap" style={{ gap: 10 }}>
                <span>✓ Saved to the patient record.</span>
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => api.doc.open(lastReport)}>
                    <Icon name="print" size={14} /> Open / Print
                  </button>
                  <button className="btn btn-sm" onClick={() => api.doc.reveal(lastReport)}>
                    Show in folder
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      const r = await api.report.email({
                        pdfPath: lastReport,
                        to: patient.email || '',
                        patientName: `${patient.first_name} ${patient.last_name}`
                      })
                      toast.push(
                        r.method === 'smtp' ? 'Report emailed to patient' : 'Mail client opened — attach the revealed PDF',
                        'success'
                      )
                    }}
                  >
                    <Icon name="mail" size={14} /> Email to patient
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NoteRow({
  note,
  readOnly,
  onChange,
  onDelete,
  onToPlan
}: {
  note: ClinicalNote
  readOnly: boolean
  onChange: () => void
  onDelete: () => void
  onToPlan?: () => void
}) {
  const [content, setContent] = useState(note.content)
  const [teeth, setTeeth] = useState(note.linked_teeth.join(', '))
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(async () => {
      const parsed = teeth
        .split(',')
        .map((x) => parseInt(x.trim(), 10))
        .filter((x) => !isNaN(x) && x >= 1 && x <= 32)
      await api.notes.update(note.id, content, parsed)
      onChange()
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, teeth])

  const label = NOTE_TYPES.find((n) => n.key === note.note_type)?.label || note.note_type

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
      <div className="row between">
        <span className="pill azure">{label}</span>
        <div className="row" style={{ gap: 4 }}>
          {onToPlan && !readOnly && (
            <button className="btn btn-ghost btn-sm" onClick={onToPlan} title="Add this note to the Treatment Plan">
              <Icon name="plus" size={13} /> To plan
            </button>
          )}
          {!readOnly && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      </div>
      <textarea
        style={{ marginTop: 6, minHeight: 56 }}
        value={content}
        disabled={readOnly}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Linked teeth:
        </span>
        <input
          style={{ maxWidth: 200 }}
          placeholder="e.g. 3, 14, 30"
          value={teeth}
          disabled={readOnly}
          onChange={(e) => setTeeth(e.target.value)}
        />
        {note.edited && <span className="muted" style={{ fontSize: 11 }}>edited</span>}
      </div>
    </div>
  )
}

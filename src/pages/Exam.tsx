import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/store/auth'
import type {
  Examination,
  Patient,
  ClinicalNote,
  ToothChartData,
  TreatmentItem,
  NoteType,
  TreatmentPriority
} from '@shared/types'
import { ToothChart } from '@/components/ToothChart'
import { toothChartSvgString } from '@/components/toothGeometry'
import { Icon } from '@/components/icons'
import { useToast } from '@/components/ui'
import { formatDate } from '@/lib/format'

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

  useEffect(() => {
    ;(async () => {
      const e = await api.exams.get(eid)
      if (!e) return
      setExam(e)
      setChart(e.tooth_chart_data || {})
      setPatient((await api.patients.get(e.patient_id)) || null)
      setNotes(await api.notes.listByExam(eid))
      setItems(await api.exams.treatmentItems(eid))
    })()
  }, [eid])

  // Auto-save tooth chart
  const firstChart = useRef(true)
  useEffect(() => {
    if (firstChart.current) {
      firstChart.current = false
      return
    }
    const t = setTimeout(async () => {
      await api.exams.saveChart(eid, chart)
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
        toast.push('Treatment report generated', 'success')
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
              <button className="btn btn-sm" onClick={addItem}>
                <Icon name="plus" size={14} /> Add Item
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="empty">No treatment items. Add recommended treatments here.</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {items.map((it) => (
                <div key={it.id} className="card" style={{ padding: 12, boxShadow: 'none' }}>
                  <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                    <input
                      placeholder="Recommended treatment"
                      value={it.description}
                      disabled={!canClinical}
                      onChange={(e) => updateItem(it.id, { description: e.target.value })}
                    />
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
                    <input
                      placeholder="Timeline"
                      value={it.estimate}
                      disabled={!canClinical}
                      onChange={(e) => updateItem(it.id, { estimate: e.target.value })}
                    />
                  </div>
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
          <div className="card-title">Treatment Report</div>
          <div className="field">
            <label>Report summary (optional)</label>
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
                <Icon name="doc" size={16} /> {busy ? 'Generating…' : 'Generate Report (PDF)'}
              </button>
            </div>
          </div>

          {lastReport && (
            <div className="alert success" style={{ marginTop: 14 }}>
              <div className="row between wrap" style={{ gap: 10 }}>
                <span>✓ Report saved to the patient record.</span>
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
  onDelete
}: {
  note: ClinicalNote
  readOnly: boolean
  onChange: () => void
  onDelete: () => void
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
        {!readOnly && (
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={onDelete}>
            Delete
          </button>
        )}
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

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import type { PatientInput } from '@shared/types'
import {
  PatientFields,
  emptyPatientInput,
  validatePatient,
  normalizePatient
} from '@/components/PatientFields'
import { useToast } from '@/components/ui'
import { Icon } from '@/components/icons'

const DRAFT_KEY = 'gs-intake-draft'

export default function PatientForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const [value, setValue] = useState<PatientInput>(emptyPatientInput())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(!editing)

  useEffect(() => {
    if (editing && id) {
      api.patients.get(Number(id)).then((p) => {
        if (p) {
          const { id: _id, patient_id, created_at, updated_at, ...rest } = p
          setValue(rest as PatientInput)
        }
        setLoaded(true)
      })
    } else {
      // Restore unsaved draft to prevent data loss.
      const draft = localStorage.getItem(DRAFT_KEY)
      if (draft) {
        try {
          setValue(JSON.parse(draft))
          toast.push('Restored your unsaved intake draft', 'info')
        } catch {
          /* ignore */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Auto-save draft (new patients only) so nothing is lost mid-entry.
  useEffect(() => {
    if (!editing && loaded) localStorage.setItem(DRAFT_KEY, JSON.stringify(value))
  }, [value, editing, loaded])

  const save = async () => {
    const e = validatePatient(value)
    setErrors(e)
    if (Object.keys(e).length > 0) {
      toast.push('Please fix the highlighted fields', 'error')
      return
    }
    setBusy(true)
    const payload = normalizePatient(value)
    try {
      if (editing && id) {
        const res = await api.patients.update(Number(id), payload)
        toast.push('Patient updated', 'success')
        navigate(`/patients/${res.data.id}`)
      } else {
        const res = await api.patients.create(payload)
        localStorage.removeItem(DRAFT_KEY)
        toast.push(`Patient created — ${res.data.patient_id}`, 'success')
        navigate(`/patients/${res.data.id}`)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return <div className="empty">Loading…</div>

  return (
    <div className="stack">
      <div className="row between">
        <div className="row" style={{ gap: 12 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => navigate(-1)}>
            <Icon name="back" size={16} /> Back
          </button>
          <h1 style={{ margin: 0 }}>{editing ? 'Edit Patient' : 'New Patient Intake'}</h1>
        </div>
      </div>

      <PatientFields value={value} onChange={setValue} errors={errors} />

      <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : editing ? 'Save Changes' : 'Create Patient'}
        </button>
      </div>
    </div>
  )
}

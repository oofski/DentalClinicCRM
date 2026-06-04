import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/store/auth'
import type { Patient } from '@shared/types'
import { ConsentCapture } from '@/components/ConsentCapture'
import { Icon } from '@/components/icons'
import { useToast } from '@/components/ui'

export default function Consent() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const providerName = useAuth((s) => s.user?.full_name)
  const [patient, setPatient] = useState<Patient | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    api.patients.get(Number(id)).then((p) => setPatient(p || null))
  }, [id])

  if (!patient) return <div className="empty">Loading…</div>

  return (
    <div className="stack">
      <div className="row" style={{ gap: 12 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/patients/${patient.id}`)}>
          <Icon name="back" size={16} /> {patient.first_name} {patient.last_name}
        </button>
        <h1 style={{ margin: 0 }}>Informed Consent</h1>
      </div>

      {done ? (
        <div className="card">
          <div className="alert success">✓ Consent saved to the patient record.</div>
          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <button className="btn" onClick={() => api.doc.open(done)}>
              <Icon name="print" size={16} /> Open / Print
            </button>
            <button className="btn btn-primary" onClick={() => navigate(`/patients/${patient.id}`)}>
              Back to Patient
            </button>
          </div>
        </div>
      ) : (
        <ConsentCapture
          patient={patient}
          providerName={providerName}
          onComplete={(pdfPath) => {
            setDone(pdfPath || '')
            toast.push('Consent on file', 'success')
          }}
        />
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { Patient } from '@shared/types'
import { formatDate } from '@/lib/format'
import { Icon } from '@/components/icons'

export default function Patients() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [list, setList] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    const t = setTimeout(async () => {
      const r = await api.patients.search(term)
      if (active) {
        setList(r)
        setLoading(false)
      }
    }, 160)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [term])

  return (
    <div className="stack">
      <div className="row between">
        <h1>Patients</h1>
        <button className="btn btn-primary" onClick={() => navigate('/patients/new')}>
          <Icon name="plus" size={16} /> New Patient
        </button>
      </div>

      <div className="card">
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--muted)' }}>
            <Icon name="search" size={18} />
          </span>
          <input
            style={{ paddingLeft: 38 }}
            placeholder="Search by name or patient ID…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : list.length === 0 ? (
          <div className="empty">
            {term ? 'No patients match your search.' : 'No patients yet.'}
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Patient ID</th>
                <th>Date of Birth</th>
                <th>Phone</th>
                <th>Language</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/patients/${p.id}`)}>
                  <td style={{ fontWeight: 600 }}>
                    {p.first_name} {p.last_name}
                  </td>
                  <td>{p.patient_id}</td>
                  <td>{formatDate(p.date_of_birth)}</td>
                  <td>{p.phone || '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{p.preferred_language}</td>
                  <td style={{ textAlign: 'right' }} className="muted">
                    Open ›
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/store/auth'
import type { Patient } from '@shared/types'
import { formatDate } from '@/lib/format'
import { Icon } from '@/components/icons'

export default function Dashboard() {
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const [count, setCount] = useState(0)
  const [recent, setRecent] = useState<Patient[]>([])

  useEffect(() => {
    api.patients.count().then(setCount)
    api.patients.recent(8).then(setRecent)
  }, [])

  return (
    <div className="stack">
      <div>
        <h1>Welcome, {user?.full_name?.split(' ')[0]} 👋</h1>
        <p className="muted" style={{ marginTop: -6 }}>
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          })}
        </p>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{count}</div>
          <div className="l">Total Patients</div>
        </div>
        <div className="stat clickable" onClick={() => navigate('/patients/new')}>
          <div className="n" style={{ color: 'var(--azure)' }}>
            ＋
          </div>
          <div className="l">Register New Patient</div>
        </div>
        <div className="stat clickable" onClick={() => api.kiosk.open()}>
          <div className="n" style={{ color: 'var(--azure)' }}>
            <Icon name="kiosk" size={26} />
          </div>
          <div className="l">Open Patient Check-In</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          Recent Patients
          <button className="btn btn-sm" onClick={() => navigate('/patients')}>
            View all
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="empty">
            No patients yet. Click <b>New Patient</b> to register your first patient.
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Patient ID</th>
                <th>Date of Birth</th>
                <th>Phone</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate(`/patients/${p.id}`)}>
                  <td style={{ fontWeight: 600 }}>
                    {p.first_name} {p.last_name}
                  </td>
                  <td>{p.patient_id}</td>
                  <td>{formatDate(p.date_of_birth)}</td>
                  <td>{p.phone || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="muted">Open ›</span>
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

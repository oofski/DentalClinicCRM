import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { Patient, ClinicEvent } from '@shared/types'
import { formatDate } from '@/lib/format'
import { Icon } from '@/components/icons'

export default function Patients() {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [list, setList] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<ClinicEvent[]>([])
  const [eventFilter, setEventFilter] = useState<number | 'all'>('all')

  useEffect(() => {
    api.events.list().then(setEvents)
  }, [])

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
        <div className="row" style={{ gap: 10, marginBottom: 14 }}>
          <div style={{ position: 'relative', flex: 1 }}>
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
          {events.length > 0 && (
            <select
              style={{ width: 230 }}
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              title="Filter by event"
            >
              <option value="all">All events</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  📍 {ev.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : (
          (() => {
            const filtered =
              eventFilter === 'all' ? list : list.filter((p) => p.event_id === eventFilter)
            if (filtered.length === 0)
              return (
                <div className="empty">
                  {term || eventFilter !== 'all'
                    ? 'No patients match your search/filter.'
                    : 'No patients yet.'}
                </div>
              )
            return (
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Patient ID</th>
                    <th>Date of Birth</th>
                    <th>Phone</th>
                    <th>Event</th>
                    <th>Language</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => navigate(`/patients/${p.id}`)}>
                      <td style={{ fontWeight: 600 }}>
                        {p.first_name} {p.last_name}
                      </td>
                      <td>{p.patient_id}</td>
                      <td>{formatDate(p.date_of_birth)}</td>
                      <td>{p.phone || '—'}</td>
                      <td>{p.event_name ? <span className="pill azure">{p.event_name}</span> : '—'}</td>
                      <td style={{ textTransform: 'capitalize' }}>{p.preferred_language}</td>
                      <td style={{ textAlign: 'right' }} className="muted">
                        Open ›
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()
        )}
      </div>
    </div>
  )
}

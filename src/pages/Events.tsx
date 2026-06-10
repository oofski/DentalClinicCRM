import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/store/auth'
import type { ClinicEvent, Patient } from '@shared/types'
import { formatDate } from '@/lib/format'
import { Field, Modal, useToast } from '@/components/ui'
import { Icon } from '@/components/icons'

interface EventForm {
  name: string
  location: string
  event_date: string
  notes: string
}

const emptyForm: EventForm = { name: '', location: '', event_date: '', notes: '' }

export default function Events() {
  const navigate = useNavigate()
  const toast = useToast()
  const role = useAuth((s) => s.user?.role)
  const isAdmin = role === 'admin'
  const [events, setEvents] = useState<ClinicEvent[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<ClinicEvent | null>(null)
  const [form, setForm] = useState<EventForm>(emptyForm)
  const [viewing, setViewing] = useState<ClinicEvent | null>(null)
  const [viewPatients, setViewPatients] = useState<Patient[]>([])
  const [showArchived, setShowArchived] = useState(false)

  const reload = useCallback(async () => {
    setEvents(await api.events.list())
    const active = await api.events.getActive()
    setActiveId(active?.id ?? null)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setEditOpen(true)
  }
  const openEdit = (ev: ClinicEvent) => {
    setEditing(ev)
    setForm({
      name: ev.name,
      location: ev.location ?? '',
      event_date: ev.event_date ?? '',
      notes: ev.notes ?? ''
    })
    setEditOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) {
      toast.push('Event name is required', 'error')
      return
    }
    const payload = {
      name: form.name.trim(),
      location: form.location.trim() || null,
      event_date: form.event_date || null,
      notes: form.notes.trim() || null
    }
    const res = editing
      ? await api.events.update(editing.id, payload)
      : await api.events.create(payload)
    if (res.ok) {
      toast.push(editing ? 'Event updated' : 'Event created', 'success')
      setEditOpen(false)
      reload()
    } else toast.push(res.error || 'Failed', 'error')
  }

  const setActive = async (ev: ClinicEvent | null) => {
    await api.events.setActive(ev ? ev.id : null)
    toast.push(
      ev
        ? `"${ev.name}" is now active — new patients will be tagged to it`
        : 'Event deactivated — new patients are no longer tagged',
      'success'
    )
    reload()
  }

  const exportFolder = async (ev: ClinicEvent) => {
    const res = await api.events.export(ev.id)
    if (res.ok) toast.push(`Exported ${res.count} patient folder(s) + roster`, 'success')
    else if (res.error !== 'Cancelled') toast.push(res.error || 'Export failed', 'error')
  }

  const openPatients = async (ev: ClinicEvent) => {
    setViewing(ev)
    setViewPatients(await api.events.listPatients(ev.id))
  }

  const deleteEvent = async (ev: ClinicEvent) => {
    const n = ev.patient_count ?? 0
    const msg =
      n > 0
        ? `Delete "${ev.name}"?\n\nIts ${n} patient(s) are kept but untagged from this event — their records and files are not affected.\n\nThis cannot be undone.`
        : `Delete "${ev.name}"? This cannot be undone.`
    if (!window.confirm(msg)) return
    const r = await api.events.delete(ev.id)
    if (r.ok) {
      toast.push(
        r.untagged ? `Event deleted — ${r.untagged} patient(s) untagged` : 'Event deleted',
        'success'
      )
      reload()
    } else toast.push(r.error || 'Failed to delete', 'error')
  }

  const visible = events.filter((e) => showArchived || e.status === 'open')
  const active = events.find((e) => e.id === activeId) || null

  return (
    <div className="stack">
      <div className="row between wrap">
        <h1>Events</h1>
        {isAdmin && (
          <button className="btn btn-primary" onClick={openCreate}>
            <Icon name="plus" size={16} /> New Event
          </button>
        )}
      </div>

      {active ? (
        <div className="alert info">
          <div className="row between wrap" style={{ gap: 10 }}>
            <span>
              📍 <b>{active.name}</b> is the active event — every new patient check-in is being tagged
              to it.
            </span>
            <button className="btn btn-sm" onClick={() => setActive(null)}>
              Deactivate
            </button>
          </div>
        </div>
      ) : (
        <div className="alert info">
          No active event. Activate one below and every new check-in (front desk or tablet) will be
          tagged to it automatically.
        </div>
      )}

      <div className="card">
        <div className="card-title">
          All Events
          <label className="row" style={{ gap: 6, fontSize: 13, fontWeight: 400 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
        {visible.length === 0 ? (
          <div className="empty">
            No events yet.{' '}
            {isAdmin ? 'Create one for your next outreach day or clinic drive.' : 'Ask an administrator to create one.'}
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Event</th>
                <th>Location</th>
                <th>Date</th>
                <th>Patients</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((ev) => (
                <tr key={ev.id}>
                  <td style={{ fontWeight: 600 }}>
                    {ev.name}
                    {ev.id === activeId && (
                      <span className="pill azure" style={{ marginLeft: 8 }}>
                        ACTIVE
                      </span>
                    )}
                  </td>
                  <td>{ev.location || '—'}</td>
                  <td>{ev.event_date ? formatDate(ev.event_date) : '—'}</td>
                  <td>
                    <button className="btn btn-sm btn-ghost" onClick={() => openPatients(ev)}>
                      {ev.patient_count ?? 0} patient{(ev.patient_count ?? 0) === 1 ? '' : 's'} ›
                    </button>
                  </td>
                  <td>
                    <span className={`pill ${ev.status === 'open' ? 'routine' : 'gray'}`}>
                      {ev.status}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {ev.status === 'open' &&
                        (ev.id === activeId ? (
                          <button className="btn btn-sm" onClick={() => setActive(null)}>
                            Deactivate
                          </button>
                        ) : (
                          <button className="btn btn-sm btn-primary" onClick={() => setActive(ev)}>
                            Set Active
                          </button>
                        ))}
                      <button className="btn btn-sm" onClick={() => exportFolder(ev)} title="Copy all tagged patients' files + roster into one folder">
                        Export Folder
                      </button>
                      {isAdmin && (
                        <>
                          <button className="btn btn-sm" onClick={() => openEdit(ev)}>
                            <Icon name="edit" size={14} />
                          </button>
                          {ev.status === 'open' ? (
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={async () => {
                                await api.events.setStatus(ev.id, 'archived')
                                reload()
                              }}
                            >
                              Archive
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={async () => {
                                await api.events.setStatus(ev.id, 'open')
                                reload()
                              }}
                            >
                              Reopen
                            </button>
                          )}
                          <button className="btn btn-sm btn-danger" onClick={() => deleteEvent(ev)}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / edit modal */}
      <Modal
        open={editOpen}
        title={editing ? 'Edit Event' : 'New Event'}
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setEditOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save}>
              {editing ? 'Save Changes' : 'Create Event'}
            </button>
          </>
        }
      >
        <Field label="Event Name" required>
          <input
            autoFocus
            placeholder="e.g. School Outreach — Lincoln Elementary"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <div className="grid-2">
          <Field label="Location">
            <input
              placeholder="e.g. 500 Main St, Springfield"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </Modal>

      {/* Patients-in-event modal */}
      <Modal
        open={!!viewing}
        title={viewing ? `Patients — ${viewing.name}` : ''}
        onClose={() => setViewing(null)}
        wide
      >
        {viewPatients.length === 0 ? (
          <div className="empty">No patients tagged to this event yet.</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Patient ID</th>
                <th>Date of Birth</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {viewPatients.map((p) => (
                <tr
                  key={p.id}
                  className="clickable"
                  onClick={() => {
                    setViewing(null)
                    navigate(`/patients/${p.id}`)
                  }}
                >
                  <td style={{ fontWeight: 600 }}>
                    {p.first_name} {p.last_name}
                  </td>
                  <td>{p.patient_id}</td>
                  <td>{formatDate(p.date_of_birth)}</td>
                  <td style={{ textAlign: 'right' }} className="muted">
                    Open ›
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  )
}

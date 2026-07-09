import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/store/auth'
import type { PatientFullRecord, ImageWithUrl, ClinicEvent } from '@shared/types'
import { formatDate, formatDateTime, age } from '@/lib/format'
import { todayISO } from '@/lib/format'
import { Icon } from '@/components/icons'
import { Modal, useToast } from '@/components/ui'
import { ReferralModal } from '@/components/ReferralModal'

type Tab = 'overview' | 'medical' | 'dental' | 'docs' | 'exams' | 'images'

export default function PatientRecord() {
  const { id } = useParams()
  const pid = Number(id)
  const navigate = useNavigate()
  const role = useAuth((s) => s.user?.role)
  const toast = useToast()
  const [rec, setRec] = useState<PatientFullRecord | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [viewImg, setViewImg] = useState<ImageWithUrl | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [referralOpen, setReferralOpen] = useState(false)
  const [events, setEvents] = useState<ClinicEvent[]>([])

  useEffect(() => {
    api.events.list().then(setEvents)
  }, [])

  const reload = useCallback(() => {
    api.patients.fullRecord(pid).then(setRec)
  }, [pid])

  useEffect(() => {
    reload()
  }, [reload])

  if (!rec) return <div className="empty">Loading patient…</div>
  const p = rec.patient
  const canClinical = role === 'doctor' || role === 'admin'
  const hasAlerts = !!(p.allergies?.trim() || p.medical_conditions?.trim())

  const startExam = async () => {
    const res = await api.exams.create(pid, todayISO())
    if (res.ok) navigate(`/exam/${res.data.id}`)
  }

  const addImages = async () => {
    const paths = await api.images.pick()
    if (!paths.length) return
    for (const sp of paths) {
      await api.images.add({
        patientId: pid,
        sourcePath: sp,
        imageType: 'image',
        dateTaken: todayISO(),
        notes: null
      })
    }
    toast.push(`Added ${paths.length} image(s)`, 'success')
    reload()
  }

  const tabBtn = (key: Tab, label: string) => (
    <div className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
      {label}
    </div>
  )

  return (
    <div className="stack">
      <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/patients')}>
        <Icon name="back" size={16} /> All Patients
      </button>

      {/* Header */}
      <div className="card">
        <div className="row between wrap" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>
              {p.first_name} {p.last_name}
            </h1>
            <div className="row wrap" style={{ gap: 14, color: 'var(--muted)', fontSize: 13.5 }}>
              <span>
                <b style={{ color: 'var(--navy)' }}>{p.patient_id}</b>
              </span>
              <span>DOB {formatDate(p.date_of_birth)} (Age {age(p.date_of_birth)})</span>
              {p.phone && <span>📞 {p.phone}</span>}
              {p.email && <span>✉ {p.email}</span>}
              <span style={{ textTransform: 'capitalize' }}>🗣 {p.preferred_language}</span>
              <span>Last visit: {formatDate(rec.lastVisit)}</span>
              {p.event_name && <span className="pill azure">📍 {p.event_name}</span>}
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={() => navigate(`/patients/${pid}/edit`)}>
              <Icon name="edit" size={15} /> Edit
            </button>
            <button className="btn btn-sm" onClick={() => api.patients.printSummary(pid)}>
              <Icon name="print" size={15} /> Print Summary
            </button>
            <button className="btn btn-sm btn-navy" onClick={() => navigate(`/patients/${pid}/consent`)}>
              <Icon name="doc" size={15} /> Sign Consent
            </button>
            {canClinical && (
              <button className="btn btn-sm btn-navy" onClick={() => setReferralOpen(true)}>
                <Icon name="mail" size={15} /> Referral
              </button>
            )}
            {canClinical && (
              <button className="btn btn-sm btn-primary" onClick={startExam}>
                <Icon name="tooth" size={15} /> New Examination
              </button>
            )}
            {canClinical && (
              <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
          </div>
        </div>
        {hasAlerts && (
          <div className="alert" style={{ marginTop: 14 }}>
            <b>⚠ Medical Alerts:</b>{' '}
            {[p.allergies && `Allergies: ${p.allergies}`, p.medical_conditions && `Conditions: ${p.medical_conditions}`]
              .filter(Boolean)
              .join('  •  ')}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {tabBtn('overview', 'Overview')}
        {tabBtn('medical', 'Medical History')}
        {tabBtn('dental', 'Dental History')}
        {tabBtn('docs', `Forms & Documents (${rec.consents.length + rec.reports.length + rec.referrals.length})`)}
        {tabBtn('exams', `Examinations (${rec.exams.length})`)}
        {tabBtn('images', `Images (${rec.images.length})`)}
      </div>

      {tab === 'overview' && (
        <div className="grid-2" style={{ gap: 16, alignItems: 'start' }}>
          <div className="card">
            <div className="card-title">Contact</div>
            <Detail k="Phone" v={p.phone} />
            <Detail k="Email" v={p.email} />
            <Detail k="Address" v={p.address} />
            <Detail k="Emergency" v={p.emergency_contact} />
            <Detail k="Emergency Phone" v={p.emergency_phone} />
          </div>
          <div className="card">
            <div className="card-title">At a glance</div>
            <Detail k="Examinations" v={String(rec.exams.length)} />
            <Detail k="Signed consents" v={String(rec.consents.length)} />
            <Detail k="Additional notes" v={String(rec.reports.length)} />
            <Detail k="Referrals" v={String(rec.referrals.length)} />
            <Detail k="Images" v={String(rec.images.length)} />
            <div className="row" style={{ alignItems: 'center', padding: '7px 0', gap: 10 }}>
              <div className="muted" style={{ width: 160, flexShrink: 0, fontSize: 13 }}>
                Event
              </div>
              <select
                style={{ maxWidth: 280 }}
                value={p.event_id ?? ''}
                onChange={async (e) => {
                  const v = e.target.value ? Number(e.target.value) : null
                  await api.patients.setEvent(pid, v)
                  toast.push(v ? 'Patient tagged to event' : 'Patient untagged from event', 'success')
                  reload()
                }}
              >
                <option value="">— No event —</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {tab === 'medical' && (
        <div className="card">
          <div className="card-title">Medical History</div>
          <Detail k="Allergies" v={p.allergies} alert />
          <Detail k="Medical Conditions" v={p.medical_conditions} alert />
          <Detail k="Current Medications" v={p.medications} />
        </div>
      )}

      {tab === 'dental' && (
        <div className="card">
          <div className="card-title">Dental History</div>
          <Detail k="Dental History" v={p.dental_history} />
        </div>
      )}

      {tab === 'docs' && (
        <div className="card">
          <div className="card-title">Forms & Documents</div>
          {rec.consents.length + rec.reports.length + rec.referrals.length === 0 ? (
            <div className="empty">No documents yet.</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Detail</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rec.reports.map((r) => (
                  <tr key={`r${r.id}`}>
                    <td>
                      <span className="pill azure">Additional Notes</span>
                    </td>
                    <td>{formatDateTime(r.created_at)}</td>
                    <td>{r.approved_at ? `Approved by ${r.approved_by_name}` : 'Draft'}</td>
                    <td>
                      <DocActions
                        path={r.pdf_path}
                        email={{ to: p.email || '', name: `${p.first_name} ${p.last_name}` }}
                      />
                    </td>
                  </tr>
                ))}
                {rec.referrals.map((r) => (
                  <tr key={`f${r.id}`}>
                    <td>
                      <span className="pill important" style={{ background: '#F3E8FA', color: '#7D3C98' }}>
                        Referral
                      </span>
                    </td>
                    <td>{formatDateTime(r.created_at)}</td>
                    <td>
                      {r.template_name ? `To ${r.template_name}` : 'Referral letter'} · by {r.doctor_name || '—'}
                    </td>
                    <td>
                      <DocActions path={r.pdf_path} />
                    </td>
                  </tr>
                ))}
                {rec.consents.map((c) => (
                  <tr key={`c${c.id}`}>
                    <td>
                      <span className="pill gray">Consent ({c.language})</span>
                    </td>
                    <td>{formatDateTime(c.signed_at)}</td>
                    <td>Signed by {c.signed_by_name}</td>
                    <td>
                      <DocActions path={c.pdf_path} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'exams' && (
        <div className="card">
          <div className="card-title">
            Examinations
            {canClinical && (
              <button className="btn btn-sm btn-primary" onClick={startExam}>
                <Icon name="plus" size={14} /> New
              </button>
            )}
          </div>
          {rec.exams.length === 0 ? (
            <div className="empty">No examinations recorded.</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {rec.exams.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => navigate(`/exam/${e.id}`)}>
                    <td style={{ fontWeight: 600 }}>{formatDate(e.exam_date)}</td>
                    <td>{e.doctor_name}</td>
                    <td>
                      <span className={`pill ${e.status === 'completed' ? 'routine' : 'important'}`}>
                        {e.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }} className="muted">
                      {canClinical ? 'Open ›' : 'View ›'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'images' && (
        <div className="card">
          <div className="card-title">
            Images (X-rays & Photos)
            <button className="btn btn-sm btn-primary" onClick={addImages}>
              <Icon name="image" size={14} /> Add Images
            </button>
          </div>
          {rec.images.length === 0 ? (
            <div className="empty">No images uploaded.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
              {rec.images.map((img) => (
                <div key={img.id} className="card" style={{ padding: 8 }}>
                  <img
                    src={img.url}
                    alt=""
                    style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, cursor: 'pointer' }}
                    onClick={() => setViewImg(img)}
                  />
                  <div className="row between" style={{ marginTop: 6 }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {formatDate(img.date_taken)}
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--danger)', padding: 2 }}
                      onClick={async () => {
                        await api.images.delete(img.id, img.file_path, true)
                        reload()
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal open={!!viewImg} title="Image" onClose={() => setViewImg(null)} wide>
        {viewImg && <img src={viewImg.url} alt="" style={{ width: '100%', borderRadius: 8 }} />}
      </Modal>

      <ReferralModal
        open={referralOpen}
        patient={p}
        onClose={() => setReferralOpen(false)}
        onCreated={reload}
      />

      <Modal
        open={confirmDelete}
        title="Delete this patient?"
        onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                const r = await api.patients.delete(pid)
                if (r.ok) {
                  toast.push('Patient deleted', 'success')
                  navigate('/patients')
                } else {
                  toast.push(r.error || 'Failed to delete', 'error')
                  setConfirmDelete(false)
                }
              }}
            >
              Delete Patient
            </button>
          </>
        }
      >
        <p>
          This removes <b>{p.first_name} {p.last_name}</b> ({p.patient_id}) and their records from the
          app.
        </p>
        <p className="muted">
          Their signed consent and report PDFs stay archived on disk in the patient files folder. This
          action cannot be undone from within the app.
        </p>
      </Modal>
    </div>
  )
}

function Detail({ k, v, alert }: { k: string; v: string | null | undefined; alert?: boolean }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <div className="muted" style={{ width: 160, flexShrink: 0, fontSize: 13 }}>
        {k}
      </div>
      <div style={{ color: alert && v ? 'var(--danger)' : 'var(--text)', fontWeight: alert && v ? 600 : 400, whiteSpace: 'pre-wrap' }}>
        {v?.trim() || '—'}
      </div>
    </div>
  )
}

function DocActions({
  path,
  email
}: {
  path: string | null
  email?: { to: string; name: string }
}) {
  const toast = useToast()
  if (!path) return <span className="muted">—</span>
  return (
    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
      <button className="btn btn-sm" onClick={() => api.doc.open(path)} title="Open / Print">
        <Icon name="print" size={14} /> Open
      </button>
      <button className="btn btn-sm" onClick={() => api.doc.reveal(path)} title="Show in folder">
        Folder
      </button>
      {email && (
        <button
          className="btn btn-sm"
          title="Email to patient"
          onClick={async () => {
            const r = await api.report.email({ pdfPath: path, to: email.to, patientName: email.name })
            toast.push(r.method === 'smtp' ? 'Report emailed' : 'Mail client opened — attach the revealed PDF', 'success')
          }}
        >
          <Icon name="mail" size={14} /> Email
        </button>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '@/lib/api'
import { useAuth } from '@/store/auth'
import type {
  ClinicSettings,
  User,
  AuditEntry,
  Role,
  ReferralTemplate,
  KioskServerStatus,
  UpdateStatus
} from '@shared/types'
import { Field, Modal, useToast } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { Icon } from '@/components/icons'
import { PRODUCT, COMPANY_TM, COPYRIGHT, TRADEMARK } from '@shared/legal'

export default function Settings() {
  const me = useAuth((s) => s.user)
  const toast = useToast()
  const isAdmin = me?.role === 'admin'
  const [s, setS] = useState<ClinicSettings | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [savingClinic, setSavingClinic] = useState(false)
  const [savingSmtp, setSavingSmtp] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [info, setInfo] = useState<{ dataDir: string } | null>(null)

  // change password
  const [pw, setPw] = useState({ old: '', next: '', confirm: '' })

  const reloadUsers = () => api.users.list().then(setUsers)
  const reloadAudit = () => api.audit.recent(100).then(setAudit)

  useEffect(() => {
    api.settings.get().then(setS)
    reloadUsers()
    api.app.info().then((i) => setInfo({ dataDir: i.dataDir }))
    if (isAdmin) reloadAudit()
  }, [isAdmin])

  if (!s) return <div className="empty">Loading…</div>
  const set = (patch: Partial<ClinicSettings>) => setS({ ...s, ...patch })

  const saveClinic = async () => {
    setSavingClinic(true)
    const res = await api.settings.update({
      clinic_name: s.clinic_name,
      address: s.address,
      phone: s.phone,
      license_number: s.license_number,
      email: s.email,
      default_language: s.default_language
    })
    setSavingClinic(false)
    toast.push(res.ok ? 'Clinic information saved' : res.error || 'Failed', res.ok ? 'success' : 'error')
  }

  const saveSmtp = async () => {
    setSavingSmtp(true)
    const res = await api.settings.update({
      smtp_host: s.smtp_host,
      smtp_port: s.smtp_port,
      smtp_secure: s.smtp_secure,
      smtp_user: s.smtp_user,
      smtp_pass: s.smtp_pass,
      smtp_from: s.smtp_from
    })
    setSavingSmtp(false)
    toast.push(res.ok ? 'Email settings saved' : res.error || 'Failed', res.ok ? 'success' : 'error')
  }

  const changePassword = async () => {
    if (pw.next.length < 6) return toast.push('New password must be at least 6 characters', 'error')
    if (pw.next !== pw.confirm) return toast.push('Passwords do not match', 'error')
    const res = await api.auth.changePassword(pw.old, pw.next)
    if (res.ok) {
      toast.push('Password changed', 'success')
      setPw({ old: '', next: '', confirm: '' })
    } else toast.push(res.error || 'Failed', 'error')
  }

  const canRefer = me?.role === 'admin' || me?.role === 'doctor'

  return (
    <div className="stack">
      <h1>Settings</h1>
      {!isAdmin && (
        <div className="alert info">
          {canRefer
            ? 'You can manage referral templates, run the tablet check-in, and change your password here. Clinic configuration requires an administrator.'
            : 'You can run the tablet check-in and change your password here. Clinic configuration requires an administrator.'}
        </div>
      )}

      {/* Clinic info */}
      <div className="card">
        <div className="card-title">Clinic Information</div>
        <div className="grid-2">
          <Field label="Clinic Name">
            <input disabled={!isAdmin} value={s.clinic_name} onChange={(e) => set({ clinic_name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input disabled={!isAdmin} value={s.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Address">
          <input disabled={!isAdmin} value={s.address} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <div className="grid-3">
          <Field label="License / Registration #">
            <input disabled={!isAdmin} value={s.license_number} onChange={(e) => set({ license_number: e.target.value })} />
          </Field>
          <Field label="Clinic Email">
            <input disabled={!isAdmin} value={s.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Default Language">
            <select disabled={!isAdmin} value={s.default_language} onChange={(e) => set({ default_language: e.target.value as ClinicSettings['default_language'] })}>
              <option value="english">English</option>
              <option value="spanish">Spanish</option>
              <option value="arabic">Arabic</option>
            </select>
          </Field>
        </div>
        {isAdmin && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={savingClinic} onClick={saveClinic}>
              {savingClinic ? 'Saving…' : 'Save Clinic Info'}
            </button>
          </div>
        )}
      </div>

      {/* Email / SMTP */}
      {isAdmin && (
        <div className="card">
          <div className="card-title">Email Delivery (optional)</div>
          <p className="muted" style={{ marginTop: -6 }}>
            Leave blank to use the offline default (opens your mail app and reveals the PDF to attach).
            Fill these in to email reports directly with the attachment.
          </p>
          <div className="grid-3">
            <Field label="SMTP Host">
              <input value={s.smtp_host} onChange={(e) => set({ smtp_host: e.target.value })} placeholder="smtp.example.com" />
            </Field>
            <Field label="Port">
              <input value={s.smtp_port} onChange={(e) => set({ smtp_port: e.target.value })} />
            </Field>
            <Field label="Encryption">
              <select value={String(s.smtp_secure)} onChange={(e) => set({ smtp_secure: e.target.value === 'true' })}>
                <option value="false">STARTTLS (587)</option>
                <option value="true">SSL/TLS (465)</option>
              </select>
            </Field>
          </div>
          <div className="grid-3">
            <Field label="Username">
              <input value={s.smtp_user} onChange={(e) => set({ smtp_user: e.target.value })} />
            </Field>
            <Field label="Password">
              <input type="password" value={s.smtp_pass} onChange={(e) => set({ smtp_pass: e.target.value })} />
            </Field>
            <Field label="From Address">
              <input value={s.smtp_from} onChange={(e) => set({ smtp_from: e.target.value })} placeholder="clinic@example.com" />
            </Field>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={savingSmtp} onClick={saveSmtp}>
              {savingSmtp ? 'Saving…' : 'Save Email Settings'}
            </button>
          </div>
        </div>
      )}

      {/* Referral templates (admin + doctor) */}
      {canRefer && <ReferralTemplatesSection />}

      {/* Users */}
      {isAdmin && (
        <div className="card">
          <div className="card-title">
            Provider & Staff Accounts
            <button className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={14} /> Add Account
            </button>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.full_name}</td>
                  <td>{u.username}</td>
                  <td style={{ textTransform: 'capitalize' }}>{u.role.replace('_', ' ')}</td>
                  <td style={{ textAlign: 'right' }}>
                    {u.id !== me?.id && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          const res = await api.users.deactivate(u.id)
                          if (res.ok) {
                            toast.push('Account removed', 'success')
                            reloadUsers()
                          } else toast.push(res.error || 'Failed', 'error')
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* My password */}
      <div className="card">
        <div className="card-title">Change My Password</div>
        <div className="grid-3">
          <Field label="Current Password">
            <input type="password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
          </Field>
          <Field label="New Password">
            <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="Confirm New Password">
            <input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-navy" onClick={changePassword}>
            Update Password
          </button>
        </div>
      </div>

      {/* Data */}
      {isAdmin && (
        <div className="card">
          <div className="card-title">Data & Backup</div>
          <p className="muted" style={{ marginTop: -6 }}>
            All patient data is stored locally on this computer{info ? ` at: ${info.dataDir}` : ''}.
          </p>
          <div className="row" style={{ gap: 10 }}>
            <button
              className="btn btn-primary"
              onClick={async () => {
                const res = await api.data.backup()
                if (res.ok) toast.push('Backup saved', 'success')
              }}
            >
              Back Up Database…
            </button>
            <button className="btn" onClick={() => api.data.openFolder()}>
              Open Data Folder
            </button>
          </div>
        </div>
      )}

      {/* Software updates */}
      {isAdmin && <SoftwareUpdatesSection />}

      {/* Audit */}
      {isAdmin && (
        <div className="card">
          <div className="card-title">
            Activity Log
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  const r = await api.audit.export()
                  if (r.ok) toast.push(`Activity log saved (${r.count} entries)`, 'success')
                  else if (r.error !== 'Cancelled') toast.push(r.error || 'Export failed', 'error')
                }}
              >
                Download CSV
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={async () => {
                  if (
                    !window.confirm(
                      'Clear the entire activity log? This cannot be undone. (A single entry noting that it was cleared, and by whom, will remain.)'
                    )
                  )
                    return
                  const r = await api.audit.clear()
                  if (r.ok) {
                    toast.push('Activity log cleared', 'success')
                    reloadAudit()
                  } else toast.push(r.error || 'Failed', 'error')
                }}
              >
                Clear Log
              </button>
            </div>
          </div>
          {audit.length === 0 ? (
            <div className="empty">No activity recorded yet.</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.timestamp)}</td>
                    <td>{a.user_name || `#${a.user_id}`}</td>
                    <td>{a.action}</td>
                    <td className="muted">{a.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <AboutCard />

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={reloadUsers} />
    </div>
  )
}

// ---------------- About & Legal ----------------
function AboutCard() {
  const [version, setVersion] = useState('')
  useEffect(() => {
    api.app.info().then((i) => setVersion(i.version))
  }, [])
  return (
    <div className="card">
      <div className="card-title">About &amp; Legal</div>
      <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
        {PRODUCT}{version ? ` — v${version}` : ''}
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        {COPYRIGHT}
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
        {TRADEMARK}
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
        Developed and maintained by {COMPANY_TM}.
      </div>
    </div>
  )
}

function AddUserModal({
  open,
  onClose,
  onAdded
}: {
  open: boolean
  onClose: () => void
  onAdded: () => void
}) {
  const toast = useToast()
  const [form, setForm] = useState({ fullName: '', username: '', role: 'doctor' as Role, password: '' })
  const submit = async () => {
    if (!form.fullName.trim() || !form.username.trim() || form.password.length < 6) {
      toast.push('Fill all fields (password ≥ 6 chars)', 'error')
      return
    }
    const res = await api.users.create(form)
    if (res.ok) {
      toast.push('Account created', 'success')
      onAdded()
      onClose()
      setForm({ fullName: '', username: '', role: 'doctor', password: '' })
    } else toast.push(res.error || 'Failed', 'error')
  }
  return (
    <Modal
      open={open}
      title="Add Provider / Staff Account"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Create Account
          </button>
        </>
      }
    >
      <Field label="Full Name">
        <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
      </Field>
      <Field label="Username">
        <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} />
      </Field>
      <div className="grid-2">
        <Field label="Role">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="doctor">Doctor / Hygienist</option>
            <option value="front_desk">Front Desk</option>
            <option value="admin">Administrator</option>
          </select>
        </Field>
        <Field label="Temporary Password">
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

// ---------------- Referral Templates ----------------
const emptyTemplate = {
  name: '',
  specialty: '',
  clinic_name: '',
  clinic_address: '',
  clinic_phone: '',
  clinic_email: '',
  body: ''
}

function ReferralTemplatesSection() {
  const toast = useToast()
  const [list, setList] = useState<ReferralTemplate[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ReferralTemplate | null>(null)
  const [form, setForm] = useState({ ...emptyTemplate })

  const reload = useCallback(() => {
    api.reftpl.list().then(setList)
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  const openNew = () => {
    setEditing(null)
    setForm({ ...emptyTemplate })
    setOpen(true)
  }
  const openEdit = (t: ReferralTemplate) => {
    setEditing(t)
    setForm({
      name: t.name,
      specialty: t.specialty ?? '',
      clinic_name: t.clinic_name,
      clinic_address: t.clinic_address ?? '',
      clinic_phone: t.clinic_phone ?? '',
      clinic_email: t.clinic_email ?? '',
      body: t.body
    })
    setOpen(true)
  }

  const save = async () => {
    if (!form.name.trim() || !form.clinic_name.trim()) {
      toast.push('Template name and receiving clinic name are required', 'error')
      return
    }
    const payload = {
      name: form.name.trim(),
      specialty: form.specialty.trim() || null,
      clinic_name: form.clinic_name.trim(),
      clinic_address: form.clinic_address.trim() || null,
      clinic_phone: form.clinic_phone.trim() || null,
      clinic_email: form.clinic_email.trim() || null,
      body: form.body
    }
    const res = editing
      ? await api.reftpl.update(editing.id, payload)
      : await api.reftpl.create(payload)
    if (res.ok) {
      toast.push(editing ? 'Template updated' : 'Template created', 'success')
      setOpen(false)
      reload()
    } else toast.push(res.error || 'Failed', 'error')
  }

  return (
    <div className="card">
      <div className="card-title">
        Referral Templates
        <button className="btn btn-sm btn-primary" onClick={openNew}>
          <Icon name="plus" size={14} /> New Template
        </button>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>
        Create reusable referral letters for the specialists/clinics you refer to. Use them from any
        patient’s record via the <b>Referral</b> button — print or email alongside the report.
      </p>
      {list.length === 0 ? (
        <div className="empty">No templates yet.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Template</th>
              <th>Receiving Clinic</th>
              <th>Specialty</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 600 }}>{t.name}</td>
                <td>{t.clinic_name}</td>
                <td>{t.specialty || '—'}</td>
                <td>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn btn-sm" onClick={() => openEdit(t)}>
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={async () => {
                        await api.reftpl.delete(t.id)
                        toast.push('Template deleted', 'success')
                        reload()
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal
        open={open}
        title={editing ? 'Edit Referral Template' : 'New Referral Template'}
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save}>
              {editing ? 'Save Changes' : 'Create Template'}
            </button>
          </>
        }
      >
        <div className="grid-2">
          <Field label="Template Name" required>
            <input
              placeholder="e.g. Oral Surgery — Dr. Patel"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Specialty">
            <input
              placeholder="e.g. Endodontics"
              value={form.specialty}
              onChange={(e) => setForm({ ...form, specialty: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Receiving Clinic Name" required>
          <input
            value={form.clinic_name}
            onChange={(e) => setForm({ ...form, clinic_name: e.target.value })}
          />
        </Field>
        <Field label="Receiving Clinic Address">
          <input
            value={form.clinic_address}
            onChange={(e) => setForm({ ...form, clinic_address: e.target.value })}
          />
        </Field>
        <div className="grid-2">
          <Field label="Receiving Clinic Phone">
            <input
              value={form.clinic_phone}
              onChange={(e) => setForm({ ...form, clinic_phone: e.target.value })}
            />
          </Field>
          <Field label="Receiving Clinic Email">
            <input
              placeholder="for one-click emailing"
              value={form.clinic_email}
              onChange={(e) => setForm({ ...form, clinic_email: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Letter Body">
          <textarea
            style={{ minHeight: 140 }}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </Field>
        <p className="muted" style={{ fontSize: 12 }}>
          Patient name/DOB/contact, the reason you type, and any options you tick (medical alerts,
          findings, tooth chart) are added automatically when you create a referral.
        </p>
      </Modal>
    </div>
  )
}

// ---------------- Software Updates ----------------
function SoftwareUpdatesSection() {
  const toast = useToast()
  const [s, setS] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    api.updates.status().then(setS)
    const off = api.updates.onStatus(setS)
    return off
  }, [])

  if (!s) return null
  const busy = s.state === 'checking' || s.state === 'downloading'

  return (
    <div className="card">
      <div className="card-title">
        Software Updates
        <span className="pill gray">v{s.currentVersion}</span>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>
        Updates download from the clinic’s GitHub releases and install in place — no manual
        re-download needed, and <b>patient data is never touched</b>. Requires internet only while
        checking/downloading.
      </p>

      {s.state === 'dev' && (
        <div className="alert info">Running in development mode — updates are disabled.</div>
      )}

      {s.state === 'available' && (
        <div className="alert info">
          ⬆ <b>Version {s.availableVersion}</b> is available (you have v{s.currentVersion}).
        </div>
      )}
      {s.state === 'not-available' && (
        <div className="alert success">✓ You’re up to date — v{s.currentVersion} is the latest version.</div>
      )}
      {s.state === 'error' && (
        <div className="alert">
          Could not check for updates — {s.error || 'no internet connection?'} The app keeps working
          normally.
        </div>
      )}
      {s.state === 'downloading' && (
        <div style={{ margin: '6px 0 10px' }}>
          <div
            style={{
              height: 10,
              borderRadius: 6,
              background: 'var(--azure-soft)',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${s.percent ?? 0}%`,
                height: '100%',
                background: 'var(--azure)',
                transition: 'width .3s ease'
              }}
            />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Downloading v{s.availableVersion}… {s.percent ?? 0}%
          </div>
        </div>
      )}
      {s.state === 'downloaded' && (
        <div className="alert success">
          ✓ Version {s.availableVersion} is downloaded and ready. It will also install automatically
          the next time the app closes.
        </div>
      )}

      <div className="row" style={{ gap: 10 }}>
        {(s.state === 'idle' || s.state === 'not-available' || s.state === 'error') && (
          <button className="btn btn-primary" onClick={() => api.updates.check()}>
            Check for Updates
          </button>
        )}
        {s.state === 'checking' && (
          <button className="btn" disabled>
            Checking…
          </button>
        )}
        {s.state === 'available' && (
          <button
            className="btn btn-primary"
            onClick={async () => {
              const r = (await api.updates.download()) as { ok?: boolean; error?: string }
              if (r && r.ok === false) toast.push(r.error || 'Download failed', 'error')
            }}
          >
            ⬇ Download v{s.availableVersion}
          </button>
        )}
        {s.state === 'downloaded' && (
          <button
            className="btn btn-primary"
            onClick={async () => {
              toast.push('Installing update — the app will restart…', 'info')
              const r = await api.updates.install()
              if (!r.ok) toast.push(r.error || 'Install failed', 'error')
            }}
          >
            🔄 Restart & Install Now
          </button>
        )}
        {busy && s.state === 'downloading' && (
          <button className="btn" disabled>
            Downloading…
          </button>
        )}
      </div>
    </div>
  )
}


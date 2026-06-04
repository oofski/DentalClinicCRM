import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/store/auth'
import type { ClinicSettings, User, AuditEntry, Role } from '@shared/types'
import { Field, Modal, useToast } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { Icon } from '@/components/icons'

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

  useEffect(() => {
    api.settings.get().then(setS)
    reloadUsers()
    api.app.info().then((i) => setInfo({ dataDir: i.dataDir }))
    if (isAdmin) api.audit.recent(100).then(setAudit)
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

  return (
    <div className="stack">
      <h1>Settings</h1>
      {!isAdmin && <div className="alert info">You can change your own password here. Clinic settings and user management require an administrator.</div>}

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

      {/* Audit */}
      {isAdmin && (
        <div className="card">
          <div className="card-title">Activity Log</div>
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

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={reloadUsers} />
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

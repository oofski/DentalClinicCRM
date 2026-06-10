import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Patient, ReferralTemplate, ReferralRequest } from '@shared/types'
import { Field, Modal, useToast } from './ui'
import { Icon } from './icons'

export function ReferralModal({
  open,
  patient,
  onClose,
  onCreated
}: {
  open: boolean
  patient: Patient
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [templates, setTemplates] = useState<ReferralTemplate[]>([])
  const [templateId, setTemplateId] = useState<number>(0)
  const [reason, setReason] = useState('')
  const [urgency, setUrgency] = useState<'routine' | 'urgent'>('routine')
  const [extraNotes, setExtraNotes] = useState('')
  const [includeAlerts, setIncludeAlerts] = useState(true)
  const [includeFindings, setIncludeFindings] = useState(true)
  const [includeToothChart, setIncludeToothChart] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ pdfPath: string; suggestedEmail: string } | null>(null)
  const [emailTo, setEmailTo] = useState('')

  useEffect(() => {
    if (!open) return
    setDone(null)
    setReason('')
    setExtraNotes('')
    setUrgency('routine')
    setIncludeAlerts(true)
    setIncludeFindings(true)
    setIncludeToothChart(false)
    api.reftpl.list().then((list) => {
      setTemplates(list)
      setTemplateId((prev) => (list.some((t) => t.id === prev) ? prev : (list[0]?.id ?? 0)))
    })
  }, [open])

  const buildArgs = (): ReferralRequest => ({
    patientId: patient.id,
    templateId,
    reason,
    urgency,
    extraNotes,
    includeAlerts,
    includeFindings,
    includeToothChart
  })

  const validate = (): boolean => {
    if (!templateId) {
      toast.push('Pick a referral template (create them in Settings)', 'error')
      return false
    }
    if (!reason.trim()) {
      toast.push('Please enter the reason for referral', 'error')
      return false
    }
    return true
  }

  const generate = async () => {
    if (!validate()) return
    setBusy(true)
    try {
      const res = await api.referral.generate(buildArgs())
      if (res.ok && res.pdfPath) {
        setDone({ pdfPath: res.pdfPath, suggestedEmail: res.suggestedEmail || '' })
        setEmailTo(res.suggestedEmail || '')
        toast.push('Referral letter generated and saved to the patient record', 'success')
        onCreated()
      } else toast.push(res.error || 'Failed to generate referral', 'error')
    } finally {
      setBusy(false)
    }
  }

  const printNow = async () => {
    if (!validate()) return
    setBusy(true)
    try {
      const res = await api.referral.print(buildArgs())
      if (!res.ok && res.error) toast.push(res.error, 'error')
    } finally {
      setBusy(false)
    }
  }

  const tpl = templates.find((t) => t.id === templateId)

  return (
    <Modal open={open} title={`Referral — ${patient.first_name} ${patient.last_name}`} onClose={onClose} wide>
      {templates.length === 0 ? (
        <div className="empty">
          No referral templates yet. Create one in <b>Settings → Referral Templates</b> first.
        </div>
      ) : done ? (
        <div>
          <div className="alert success">✓ Referral letter saved to the patient record.</div>
          <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
            <button className="btn" onClick={() => api.doc.open(done.pdfPath)}>
              <Icon name="print" size={15} /> Open / Print
            </button>
            <button className="btn" onClick={() => api.doc.reveal(done.pdfPath)}>
              Show in folder
            </button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <Field label="Email to receiving clinic">
                <input
                  placeholder="clinic@example.com"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                />
              </Field>
            </div>
            <button
              className="btn btn-primary"
              style={{ marginBottom: 14 }}
              onClick={async () => {
                const r = await api.doc.email({
                  pdfPath: done.pdfPath,
                  to: emailTo,
                  subject: `Patient Referral — ${patient.first_name} ${patient.last_name} (${patient.patient_id})`,
                  text: `Dear Colleague,\n\nPlease find attached a referral letter for ${patient.first_name} ${patient.last_name}.\n\nKind regards`
                })
                toast.push(
                  r.method === 'smtp' ? 'Referral emailed' : 'Mail client opened — attach the revealed PDF',
                  'success'
                )
              }}
            >
              <Icon name="mail" size={15} /> Email
            </button>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
            <button className="btn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div>
          <Field label="Refer to (template)">
            <select value={templateId} onChange={(e) => setTemplateId(Number(e.target.value))}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.clinic_name}
                  {t.specialty ? ` (${t.specialty})` : ''}
                </option>
              ))}
            </select>
          </Field>
          {tpl && (
            <p className="muted" style={{ marginTop: -8, fontSize: 12.5 }}>
              {[tpl.clinic_address, tpl.clinic_phone, tpl.clinic_email].filter(Boolean).join(' · ') ||
                'No contact details on this template yet.'}
            </p>
          )}
          <div className="grid-2">
            <Field label="Priority">
              <select value={urgency} onChange={(e) => setUrgency(e.target.value as 'routine' | 'urgent')}>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
            <div />
          </div>
          <Field label="Reason for referral" required>
            <textarea
              placeholder="e.g. Evaluation and root canal therapy of tooth #19…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Field label="Additional notes (optional)">
            <textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} />
          </Field>
          <div className="field">
            <label>Include from the patient record</label>
            <div className="row wrap" style={{ gap: 16 }}>
              <label className="row" style={{ gap: 6, fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={includeAlerts}
                  onChange={(e) => setIncludeAlerts(e.target.checked)}
                />
                Medical alerts
              </label>
              <label className="row" style={{ gap: 6, fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={includeFindings}
                  onChange={(e) => setIncludeFindings(e.target.checked)}
                />
                Latest clinical findings
              </label>
              <label className="row" style={{ gap: 6, fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={includeToothChart}
                  onChange={(e) => setIncludeToothChart(e.target.checked)}
                />
                Tooth chart image
              </label>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button className="btn" disabled={busy} onClick={printNow}>
              <Icon name="print" size={15} /> Print
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={generate}>
              <Icon name="doc" size={15} /> {busy ? 'Generating…' : 'Generate Referral (PDF)'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

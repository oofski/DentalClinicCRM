import { useState } from 'react'
import type { Patient, Language } from '@shared/types'
import { CONSENT_CONTENT } from '@shared/consent'
import { api } from '@/lib/api'
import { SignaturePad } from './SignaturePad'
import { useToast } from './ui'

const LANGS: { key: Language; label: string }[] = [
  { key: 'english', label: 'English' },
  { key: 'spanish', label: 'Español' },
  { key: 'arabic', label: 'العربية' }
]

export function ConsentCapture({
  patient,
  providerName,
  onComplete
}: {
  patient: Patient
  providerName?: string
  onComplete: (pdfPath?: string) => void
}) {
  const toast = useToast()
  const [language, setLanguage] = useState<Language>(patient.preferred_language || 'english')
  const [signature, setSignature] = useState<string | null>(null)
  const [name, setName] = useState(`${patient.first_name} ${patient.last_name}`)
  const [busy, setBusy] = useState(false)

  const content = CONSENT_CONTENT[language]

  const capture = async () => {
    if (!signature) {
      toast.push('Please sign before saving', 'error')
      return
    }
    if (!name.trim()) {
      toast.push('Please enter the signatory name', 'error')
      return
    }
    setBusy(true)
    try {
      const res = await api.consent.generate({
        patientId: patient.id,
        language,
        signatureDataUrl: signature,
        signedByName: name.trim(),
        providerName: providerName ?? null
      })
      if (res.ok) {
        toast.push('Consent captured and saved', 'success')
        onComplete(res.pdfPath)
      } else {
        toast.push(res.error || 'Failed to save consent', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-title">
          Consent Form
          <div className="row" style={{ gap: 6 }}>
            {LANGS.map((l) => (
              <button
                key={l.key}
                className={`btn btn-sm ${language === l.key ? 'btn-primary' : ''}`}
                onClick={() => setLanguage(l.key)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div
          dir={content.dir}
          style={{
            maxHeight: 340,
            overflow: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 18px',
            background: '#fff'
          }}
        >
          <h3 style={{ textAlign: 'center' }}>{content.docTitle}</h3>
          {content.sections.map((s, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{s.heading}</div>
              <div style={{ textAlign: content.dir === 'rtl' ? 'right' : 'justify', fontSize: 13 }}>
                {s.body}
              </div>
            </div>
          ))}
          <p style={{ fontWeight: 700 }}>{content.acknowledgement}</p>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Signature</div>
        <div className="field">
          <label>{content.signatoryNameLabel}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <SignaturePad onChange={setSignature} height={200} />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14, gap: 10 }}>
          <button className="btn btn-primary btn-lg" disabled={busy || !signature} onClick={capture}>
            {busy ? 'Saving…' : 'Accept & Save Consent'}
          </button>
        </div>
      </div>
    </div>
  )
}

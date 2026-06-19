import { useEffect, useRef, useState } from 'react'
import type { Patient, Language } from '@shared/types'
import { CONSENT_CONTENT } from '@shared/consent'
import { INTAKE_STRINGS } from '@shared/intakeStrings'
import { api } from '@/lib/api'
import { SignaturePad } from './SignaturePad'
import { useToast } from './ui'

const LANGS: { key: Language; label: string }[] = [
  { key: 'english', label: 'English' },
  { key: 'spanish', label: 'Español' },
  { key: 'arabic', label: 'العربية' }
]

const SPEECH_LANG: Record<Language, string> = {
  english: 'en-US',
  spanish: 'es-ES',
  arabic: 'ar-SA'
}

export function ConsentCapture({
  patient,
  providerName,
  onComplete,
  saveOverride
}: {
  patient: Pick<Patient, 'id' | 'first_name' | 'last_name' | 'preferred_language'>
  providerName?: string
  onComplete: (pdfPath?: string) => void
  // OFFLINE mode: instead of creating a consent on this machine, hand the captured data
  // back (e.g. to bundle onto a USB drive). When set, api.consent.generate is not called.
  saveOverride?: (payload: {
    language: Language
    signedByName: string
    signatureDataUrl: string | null
  }) => Promise<{ ok: boolean; error?: string }>
}) {
  const toast = useToast()
  const [language, setLanguage] = useState<Language>(patient.preferred_language || 'english')
  const [signature, setSignature] = useState<string | null>(null)
  const [name, setName] = useState(`${patient.first_name} ${patient.last_name}`)
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const content = CONSENT_CONTENT[language]
  const ui = INTAKE_STRINGS[language]
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

  // Stop any narration when the language changes or the component unmounts.
  useEffect(() => {
    return () => {
      if (canSpeak) window.speechSynthesis.cancel()
    }
  }, [canSpeak])

  useEffect(() => {
    if (canSpeak) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
    }
  }, [language, canSpeak])

  const toggleSpeak = () => {
    if (!canSpeak) {
      toast.push('Text-to-speech is not available on this computer', 'error')
      return
    }
    const synth = window.speechSynthesis
    if (speaking) {
      synth.cancel()
      setSpeaking(false)
      return
    }
    const text =
      `${content.docTitle}. ` +
      content.sections.map((s) => `${s.heading}. ${s.body}`).join(' ') +
      ` ${content.acknowledgement}`
    const u = new SpeechSynthesisUtterance(text)
    u.lang = SPEECH_LANG[language]
    const voices = synth.getVoices()
    const match = voices.find((v) => v.lang?.toLowerCase().startsWith(u.lang.slice(0, 2)))
    if (match) u.voice = match
    u.rate = 0.95
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    synth.cancel()
    synth.speak(u)
    setSpeaking(true)
  }

  const capture = async () => {
    if (!signature) {
      toast.push('Please sign before saving', 'error')
      return
    }
    if (!name.trim()) {
      toast.push('Please enter the signatory name', 'error')
      return
    }
    if (canSpeak) window.speechSynthesis.cancel()
    setBusy(true)
    try {
      if (saveOverride) {
        const res = await saveOverride({ language, signedByName: name.trim(), signatureDataUrl: signature })
        if (res.ok) onComplete()
        else toast.push(res.error || 'Failed to save', 'error')
        return
      }
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
    <div className="stack" dir={content.dir}>
      <div className="card">
        <div className="card-title">
          {ui.consentTitle}
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
            maxHeight: 320,
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

        <div className="row" style={{ marginTop: 12, gap: 10 }}>
          <button
            type="button"
            className={`btn ${speaking ? 'btn-danger' : ''}`}
            onClick={toggleSpeak}
          >
            {speaking ? `⏹ ${ui.stopReading}` : `🔊 ${ui.readAloud}`}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            Uses the computer’s built-in voice — no internet needed.
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{ui.signatureTitle}</div>
        <div className="field">
          <label>{content.signatoryNameLabel}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <SignaturePad onChange={setSignature} height={200} />
        <div
          className="row"
          style={{ justifyContent: content.dir === 'rtl' ? 'flex-start' : 'flex-end', marginTop: 14, gap: 10 }}
        >
          <button className="btn btn-primary btn-lg" disabled={busy || !signature} onClick={capture}>
            {busy ? '…' : ui.acceptSave}
          </button>
        </div>
      </div>
    </div>
  )
}

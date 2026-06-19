import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Patient, PatientInput, Language } from '@shared/types'
import { INTAKE_STRINGS } from '@shared/intakeStrings'
import {
  PatientFields,
  emptyPatientInput,
  validatePatient,
  normalizePatient
} from '@/components/PatientFields'
import { ConsentCapture } from '@/components/ConsentCapture'
import { Logo } from '@/components/Logo'
import { api } from '@/lib/api'
import { useToast } from '@/components/ui'

type Step = 'welcome' | 'intake' | 'consent' | 'done'

const LANGS: { key: Language; label: string }[] = [
  { key: 'english', label: 'English' },
  { key: 'spanish', label: 'Español' },
  { key: 'arabic', label: 'العربية' }
]

export default function Kiosk() {
  const toast = useToast()
  const [params] = useSearchParams()
  const offline = params.get('mode') === 'offline'
  const [step, setStep] = useState<Step>('welcome')
  const [value, setValue] = useState<PatientInput>(emptyPatientInput())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [patient, setPatient] = useState<Patient | null>(null)
  const [busy, setBusy] = useState(false)

  const lang = value.preferred_language
  const t = INTAKE_STRINGS[lang]
  const setLang = (l: Language) => setValue((v) => ({ ...v, preferred_language: l }))

  const reset = () => {
    setValue(emptyPatientInput())
    setErrors({})
    setPatient(null)
    setStep('welcome')
  }

  const submitIntake = async () => {
    const e = validatePatient(value)
    setErrors(e)
    if (Object.keys(e).length) {
      toast.push('Please complete the required fields', 'error')
      return
    }
    // OFFLINE mode: don't create the patient on this device — it's bundled to USB at the
    // consent step and imported on the doctor's computer later.
    if (offline) {
      setStep('consent')
      return
    }
    setBusy(true)
    try {
      const res = await api.patients.create(normalizePatient(value))
      if (res.ok) {
        setPatient(res.data)
        setStep('consent')
      }
    } catch {
      toast.push('Please ask the front desk to sign in first.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const LangSwitcher = () => (
    <div className="row" style={{ gap: 6 }}>
      {LANGS.map((l) => (
        <button
          key={l.key}
          className={`btn btn-sm ${lang === l.key ? 'btn-primary' : ''}`}
          onClick={() => setLang(l.key)}
        >
          {l.label}
        </button>
      ))}
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#e8f4fb,#f4f8fb)' }} dir={t.dir}>
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid var(--border)',
          padding: '14px 28px',
          display: 'flex',
          justifyContent: 'center'
        }}
      >
        <Logo height={44} />
      </div>

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px 60px' }}>
        {step === 'welcome' && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 30px' }}>
            <h1 style={{ fontSize: 32 }}>{t.welcomeTitle}</h1>
            <p className="muted" style={{ fontSize: 17, maxWidth: 520, margin: '8px auto 22px' }}>
              {t.welcomeBody}
            </p>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
              {t.chooseLanguage}
            </div>
            <div className="row" style={{ justifyContent: 'center', marginBottom: 26 }}>
              <LangSwitcher />
            </div>
            <button
              className="btn btn-primary btn-lg"
              style={{ fontSize: 18, padding: '15px 40px' }}
              onClick={() => setStep('intake')}
            >
              {t.begin}
            </button>
          </div>
        )}

        {step === 'intake' && (
          <div className="stack">
            <div className="row between wrap" style={{ gap: 10 }}>
              <h1 style={{ margin: 0 }}>{t.yourInfo}</h1>
              <LangSwitcher />
            </div>
            <p className="muted" style={{ marginTop: -8 }}>
              {t.requiredNote}
            </p>
            <PatientFields
              value={value}
              onChange={setValue}
              errors={errors}
              formLang={lang}
              showLanguageSelect={false}
            />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn" onClick={reset}>
                {t.cancel}
              </button>
              <button className="btn btn-primary btn-lg" disabled={busy} onClick={submitIntake}>
                {busy ? '…' : t.continueConsent}
              </button>
            </div>
          </div>
        )}

        {step === 'consent' && (offline || patient) && (
          <div className="stack">
            <h1>{t.consentTitle}</h1>
            <p className="muted" style={{ marginTop: -8 }}>
              {t.consentReview}
            </p>
            <ConsentCapture
              patient={
                offline
                  ? {
                      id: 0,
                      first_name: value.first_name,
                      last_name: value.last_name,
                      preferred_language: value.preferred_language
                    }
                  : patient!
              }
              onComplete={() => setStep('done')}
              saveOverride={
                offline
                  ? async ({ language, signedByName, signatureDataUrl }) =>
                      api.checkin.saveBundle({
                        createdAt: new Date().toISOString(),
                        patient: normalizePatient(value),
                        language,
                        signedByName,
                        signatureDataUrl
                      })
                  : undefined
              }
            />
          </div>
        )}

        {step === 'done' && (
          <div className="card" style={{ textAlign: 'center', padding: '54px 30px' }}>
            <div style={{ fontSize: 56 }}>✅</div>
            <h1>{t.thankYouTitle}</h1>
            <p className="muted" style={{ fontSize: 17, maxWidth: 460, margin: '8px auto 28px' }}>
              {t.thankYouBody}
            </p>
            <button className="btn btn-lg" onClick={reset}>
              {t.newCheckIn}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

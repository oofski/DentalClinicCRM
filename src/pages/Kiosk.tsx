import { useState } from 'react'
import type { Patient, PatientInput } from '@shared/types'
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

export default function Kiosk() {
  const toast = useToast()
  const [step, setStep] = useState<Step>('welcome')
  const [value, setValue] = useState<PatientInput>(emptyPatientInput())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [patient, setPatient] = useState<Patient | null>(null)
  const [busy, setBusy] = useState(false)

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

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#e8f4fb,#f4f8fb)' }}>
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
          <div className="card" style={{ textAlign: 'center', padding: '54px 30px' }}>
            <h1 style={{ fontSize: 32 }}>Welcome to Giving Smiles</h1>
            <p className="muted" style={{ fontSize: 17, maxWidth: 520, margin: '8px auto 28px' }}>
              Please check in for your appointment. It only takes a few minutes — your information stays
              private and secure on the clinic’s computer.
            </p>
            <button className="btn btn-primary btn-lg" style={{ fontSize: 18, padding: '15px 40px' }} onClick={() => setStep('intake')}>
              Begin Check-In
            </button>
          </div>
        )}

        {step === 'intake' && (
          <div className="stack">
            <h1>Your Information</h1>
            <p className="muted" style={{ marginTop: -8 }}>
              Fields marked <span className="req">*</span> are required.
            </p>
            <PatientFields value={value} onChange={setValue} errors={errors} />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button className="btn" onClick={reset}>
                Cancel
              </button>
              <button className="btn btn-primary btn-lg" disabled={busy} onClick={submitIntake}>
                {busy ? 'Saving…' : 'Continue to Consent →'}
              </button>
            </div>
          </div>
        )}

        {step === 'consent' && patient && (
          <div className="stack">
            <h1>Consent Form</h1>
            <p className="muted" style={{ marginTop: -8 }}>
              Please review and sign below.
            </p>
            <ConsentCapture patient={patient} onComplete={() => setStep('done')} />
          </div>
        )}

        {step === 'done' && (
          <div className="card" style={{ textAlign: 'center', padding: '54px 30px' }}>
            <div style={{ fontSize: 56 }}>✅</div>
            <h1>Thank you!</h1>
            <p className="muted" style={{ fontSize: 17, maxWidth: 460, margin: '8px auto 28px' }}>
              You’re all checked in. Please hand the device back to the front desk — your dentist will
              see you shortly.
            </p>
            <button className="btn btn-lg" onClick={reset}>
              Start a New Check-In
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

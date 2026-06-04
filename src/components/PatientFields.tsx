import type { PatientInput } from '@shared/types'
import { Field } from './ui'

export function emptyPatientInput(): PatientInput {
  return {
    first_name: '',
    last_name: '',
    date_of_birth: '',
    phone: '',
    email: '',
    address: '',
    emergency_contact: '',
    emergency_phone: '',
    allergies: '',
    medical_conditions: '',
    medications: '',
    dental_history: '',
    insurance_info: '',
    referring_doctor: '',
    preferred_language: 'english'
  }
}

export function validatePatient(p: PatientInput): Record<string, string> {
  const e: Record<string, string> = {}
  if (!p.first_name.trim()) e.first_name = 'First name is required'
  if (!p.last_name.trim()) e.last_name = 'Last name is required'
  if (!p.date_of_birth) e.date_of_birth = 'Date of birth is required'
  else if (new Date(p.date_of_birth) > new Date()) e.date_of_birth = 'Date cannot be in the future'
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) e.email = 'Enter a valid email'
  return e
}

/** Convert empty optional strings to null before persisting. */
export function normalizePatient(p: PatientInput): PatientInput {
  const opt = (v: string | null) => (v && String(v).trim() ? String(v).trim() : null) as never
  return {
    ...p,
    first_name: p.first_name.trim(),
    last_name: p.last_name.trim(),
    phone: opt(p.phone),
    email: opt(p.email),
    address: opt(p.address),
    emergency_contact: opt(p.emergency_contact),
    emergency_phone: opt(p.emergency_phone),
    allergies: opt(p.allergies),
    medical_conditions: opt(p.medical_conditions),
    medications: opt(p.medications),
    dental_history: opt(p.dental_history),
    insurance_info: opt(p.insurance_info),
    referring_doctor: opt(p.referring_doctor)
  }
}

export function PatientFields({
  value,
  onChange,
  errors
}: {
  value: PatientInput
  onChange: (v: PatientInput) => void
  errors: Record<string, string>
}) {
  const set = (k: keyof PatientInput, v: string) => onChange({ ...value, [k]: v })
  const val = (v: string | null) => v ?? ''

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div className="card-title">Personal</div>
        <div className="grid-2">
          <Field label="First Name" required error={errors.first_name}>
            <input
              className={errors.first_name ? 'field-error' : ''}
              value={value.first_name}
              onChange={(e) => set('first_name', e.target.value)}
            />
          </Field>
          <Field label="Last Name" required error={errors.last_name}>
            <input
              className={errors.last_name ? 'field-error' : ''}
              value={value.last_name}
              onChange={(e) => set('last_name', e.target.value)}
            />
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Date of Birth" required error={errors.date_of_birth}>
            <input
              type="date"
              className={errors.date_of_birth ? 'field-error' : ''}
              value={value.date_of_birth}
              onChange={(e) => set('date_of_birth', e.target.value)}
            />
          </Field>
          <Field label="Preferred Language">
            <select
              value={value.preferred_language}
              onChange={(e) => set('preferred_language', e.target.value)}
            >
              <option value="english">English</option>
              <option value="spanish">Spanish (Español)</option>
              <option value="arabic">Arabic (العربية)</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Contact</div>
        <div className="grid-2">
          <Field label="Phone">
            <input value={val(value.phone)} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email" error={errors.email}>
            <input
              className={errors.email ? 'field-error' : ''}
              value={val(value.email)}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Address">
          <input value={val(value.address)} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Emergency Contact Name">
            <input
              value={val(value.emergency_contact)}
              onChange={(e) => set('emergency_contact', e.target.value)}
            />
          </Field>
          <Field label="Emergency Contact Phone">
            <input
              value={val(value.emergency_phone)}
              onChange={(e) => set('emergency_phone', e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Medical History</div>
        <Field label="Allergies">
          <textarea
            placeholder="e.g. Penicillin, latex"
            value={val(value.allergies)}
            onChange={(e) => set('allergies', e.target.value)}
          />
        </Field>
        <div className="grid-2">
          <Field label="Medical Conditions">
            <textarea
              placeholder="e.g. Diabetes, hypertension"
              value={val(value.medical_conditions)}
              onChange={(e) => set('medical_conditions', e.target.value)}
            />
          </Field>
          <Field label="Current Medications">
            <textarea
              value={val(value.medications)}
              onChange={(e) => set('medications', e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Dental & Insurance</div>
        <Field label="Dental History (previous treatments, implants, etc.)">
          <textarea
            value={val(value.dental_history)}
            onChange={(e) => set('dental_history', e.target.value)}
          />
        </Field>
        <div className="grid-2">
          <Field label="Referring Doctor">
            <input
              value={val(value.referring_doctor)}
              onChange={(e) => set('referring_doctor', e.target.value)}
            />
          </Field>
          <Field label="Insurance Information">
            <input
              value={val(value.insurance_info)}
              onChange={(e) => set('insurance_info', e.target.value)}
            />
          </Field>
        </div>
      </div>
    </div>
  )
}

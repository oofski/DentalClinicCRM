import type { PatientInput, Language } from '@shared/types'
import {
  INTAKE_STRINGS,
  COMMON_ALLERGIES,
  COMMON_CONDITIONS,
  optLabel,
  type PickOption
} from '@shared/intakeStrings'
import { COLORS } from '@shared/branding'
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
    preferred_language: 'english',
    event_id: null
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
    insurance_info: null,
    referring_doctor: null
  }
}

// ---- Quick-pick helpers (store canonical English keys; show translated labels) ----
function parsePicks(value: string | null, options: PickOption[]): { selected: string[]; other: string } {
  const keys = new Set(options.map((o) => o.key))
  const tokens = (value || '').split(',').map((s) => s.trim()).filter(Boolean)
  const selected: string[] = []
  const others: string[] = []
  for (const tok of tokens) {
    if (keys.has(tok)) selected.push(tok)
    else others.push(tok)
  }
  return { selected, other: others.join(', ') }
}

function buildPicks(selected: string[], other: string): string {
  const parts = [...selected]
  if (other.trim()) parts.push(other.trim())
  return parts.join(', ')
}

function PickField({
  label,
  options,
  value,
  lang,
  otherPlaceholder,
  onChange
}: {
  label: string
  options: PickOption[]
  value: string | null
  lang: Language
  otherPlaceholder: string
  onChange: (v: string) => void
}) {
  const { selected, other } = parsePicks(value, options)
  const toggle = (key: string) => {
    let next: string[]
    if (key === 'None') {
      next = selected.includes('None') ? [] : ['None']
    } else {
      const base = selected.filter((k) => k !== 'None')
      next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key]
    }
    onChange(buildPicks(next, key === 'None' && next.length ? '' : other))
  }
  const setOther = (txt: string) => {
    const sel = txt.trim() ? selected.filter((k) => k !== 'None') : selected
    onChange(buildPicks(sel, txt))
  }
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
        {options.map((o) => {
          const on = selected.includes(o.key)
          return (
            <button
              key={o.key}
              type="button"
              className="btn btn-sm"
              onClick={() => toggle(o.key)}
              style={{
                borderColor: on ? COLORS.azure : undefined,
                background: on ? COLORS.azureSoft : undefined,
                color: on ? COLORS.navy : undefined
              }}
            >
              {on ? '✓ ' : ''}
              {optLabel(o, lang)}
            </button>
          )
        })}
      </div>
      <input placeholder={otherPlaceholder} value={other} onChange={(e) => setOther(e.target.value)} />
    </div>
  )
}

export function PatientFields({
  value,
  onChange,
  errors,
  formLang = 'english',
  showLanguageSelect = true
}: {
  value: PatientInput
  onChange: (v: PatientInput) => void
  errors: Record<string, string>
  formLang?: Language
  showLanguageSelect?: boolean
}) {
  const t = INTAKE_STRINGS[formLang]
  const set = (k: keyof PatientInput, v: string) => onChange({ ...value, [k]: v })
  const val = (v: string | null) => v ?? ''

  return (
    <div className="stack" style={{ gap: 20 }} dir={t.dir}>
      <div className="card">
        <div className="card-title">{t.sectionPersonal}</div>
        <div className="grid-2">
          <Field label={t.firstName} required error={errors.first_name}>
            <input
              className={errors.first_name ? 'field-error' : ''}
              value={value.first_name}
              onChange={(e) => set('first_name', e.target.value)}
            />
          </Field>
          <Field label={t.lastName} required error={errors.last_name}>
            <input
              className={errors.last_name ? 'field-error' : ''}
              value={value.last_name}
              onChange={(e) => set('last_name', e.target.value)}
            />
          </Field>
        </div>
        <div className="grid-2">
          <Field label={t.dob} required error={errors.date_of_birth}>
            <input
              type="date"
              className={errors.date_of_birth ? 'field-error' : ''}
              value={value.date_of_birth}
              onChange={(e) => set('date_of_birth', e.target.value)}
            />
          </Field>
          {showLanguageSelect && (
            <Field label={t.language}>
              <select
                value={value.preferred_language}
                onChange={(e) => set('preferred_language', e.target.value)}
              >
                <option value="english">English</option>
                <option value="spanish">Spanish (Español)</option>
                <option value="arabic">Arabic (العربية)</option>
              </select>
            </Field>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t.sectionContact}</div>
        <div className="grid-2">
          <Field label={t.phone}>
            <input value={val(value.phone)} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label={t.email} error={errors.email}>
            <input
              className={errors.email ? 'field-error' : ''}
              value={val(value.email)}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
        </div>
        <Field label={t.address}>
          <input value={val(value.address)} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label={t.emergencyName}>
            <input
              value={val(value.emergency_contact)}
              onChange={(e) => set('emergency_contact', e.target.value)}
            />
          </Field>
          <Field label={t.emergencyPhone}>
            <input
              value={val(value.emergency_phone)}
              onChange={(e) => set('emergency_phone', e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t.sectionMedical}</div>
        <PickField
          label={t.allergies}
          options={COMMON_ALLERGIES}
          value={value.allergies}
          lang={formLang}
          otherPlaceholder={t.otherPlaceholder}
          onChange={(v) => set('allergies', v)}
        />
        <PickField
          label={t.conditions}
          options={COMMON_CONDITIONS}
          value={value.medical_conditions}
          lang={formLang}
          otherPlaceholder={t.otherPlaceholder}
          onChange={(v) => set('medical_conditions', v)}
        />
        <Field label={t.medications}>
          <textarea
            value={val(value.medications)}
            onChange={(e) => set('medications', e.target.value)}
          />
        </Field>
      </div>

      <div className="card">
        <div className="card-title">{t.sectionDental}</div>
        <Field label={t.dentalHistory}>
          <textarea
            value={val(value.dental_history)}
            onChange={(e) => set('dental_history', e.target.value)}
          />
        </Field>
      </div>
    </div>
  )
}

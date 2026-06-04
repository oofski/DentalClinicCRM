import { CONSENT_CONTENT } from './consentContent'
import { htmlShell } from './docStyles'
import { esc, formatDate, formatDateTime } from './util'
import { logoLockupSvg } from '@shared/branding'
import type { Patient, ClinicSettings, Language } from '@shared/types'

export interface ConsentRenderInput {
  clinic: ClinicSettings
  patient: Patient
  language: Language
  signatureDataUrl: string | null
  signedByName: string
  signedAt: string
  providerName?: string | null
}

export function buildConsentHtml(input: ConsentRenderInput): string {
  const t = CONSENT_CONTENT[input.language] ?? CONSENT_CONTENT.english
  const c = input.clinic
  const p = input.patient

  const header = `
  <div class="doc-header">
    <div class="brand">${logoLockupSvg({ height: 46 })}</div>
    <div class="clinic">
      <div class="name">${esc(c.clinic_name)}</div>
      <div>${esc(c.address)}</div>
      <div>${esc(t.labels.phone)}: ${esc(c.phone)}</div>
      <div>${esc(t.labels.license)}: ${esc(c.license_number)}</div>
    </div>
  </div>`

  const meta = `
  <div class="meta">
    <div class="row"><span class="k">${esc(t.labels.patient)}</span><span class="v">${esc(
      `${p.first_name} ${p.last_name}`
    )}</span></div>
    <div class="row"><span class="k">${esc(t.labels.patientId)}</span><span class="v">${esc(
      p.patient_id
    )}</span></div>
    <div class="row"><span class="k">${esc(t.labels.dob)}</span><span class="v">${formatDate(
      p.date_of_birth
    )}</span></div>
    <div class="row"><span class="k">${esc(t.labels.date)}</span><span class="v">${formatDate(
      input.signedAt
    )}</span></div>
  </div>`

  const sections = t.sections
    .map(
      (s) => `<div class="consent-section"><h3>${s.heading}</h3><p>${s.body}</p></div>`
    )
    .join('')

  const acknowledgement = `<div class="consent-section" style="margin-top:10px"><p><strong>${t.acknowledgement}</strong></p></div>`

  const patientSig = input.signatureDataUrl
    ? `<div class="sig-img"><img src="${input.signatureDataUrl}" alt="signature"/></div>`
    : `<div class="sig-line"></div>`

  const providerBox = `
    <div class="sig-box">
      <div class="sig-line"></div>
      <div class="sig-label">${esc(t.providerSignatureLabel)}</div>
      <div class="sig-meta">${esc(t.providerLabel)}: ${esc(input.providerName || '')}</div>
    </div>`

  const signatures = `
  <div class="signatures">
    <div class="sig-box">
      ${patientSig}
      <div class="sig-label">${esc(t.signatureLabel)}</div>
      <div class="sig-meta">${esc(t.signatoryNameLabel)}: ${esc(input.signedByName)}</div>
      <div class="sig-meta">${esc(t.signedDateLabel)}: ${formatDate(input.signedAt)}</div>
    </div>
    ${providerBox}
  </div>`

  const footer = `<div class="footer">${esc(
    c.clinic_name
  )} — Electronically signed via Giving Smiles on ${formatDateTime(input.signedAt)}</div>`

  const body = `<div class="doc">
    ${header}
    <div class="doc-title">${t.docTitle}</div>
    ${meta}
    ${sections}
    ${acknowledgement}
    ${signatures}
    ${footer}
  </div>`

  return htmlShell({ title: t.docTitle, dir: t.dir, body })
}

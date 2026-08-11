// Keeping the old chart and the odontogram from becoming two different medical records.
//
// v1.5 stored the chart as ONE condition per tooth in examinations.tooth_chart_data. The
// odontogram stores a list of findings per tooth in real tables. Both now exist, and the
// dangerous state is not "the new one is empty" — it is TWO WRITEABLE COPIES that drift,
// where the chart on screen and the chart in the PDF disagree about whether a tooth is
// still in the patient's mouth.
//
// So there is exactly one rule here:
//
//     The odontogram is the record. The legacy blob is a DERIVED CACHE of it.
//
// Nothing writes the legacy blob except projectToLegacy(), and the odontogram is imported
// from the blob exactly once, when an exam charted before the upgrade is first opened.
// That makes the direction of truth one-way and unambiguous, which is the only property
// worth having here.

import {
  primaryCondition, isPrimary,
  type ClinicalStatus, type ConditionType, type OdontogramData, type SurfaceKey, type ToothId
} from '@shared/odontogram'
import type { SurfaceKey as LegacySurface, ToothChartData, ToothConditionKey } from '@shared/types'

/**
 * Which legacy bucket a finding falls into. The legacy chart has seven conditions and the
 * odontogram has twenty-two, so this is deliberately lossy — it exists to keep the PDF and
 * the old report code working, NOT to round-trip. Nothing reads it back into the record.
 */
const TO_LEGACY: Record<ConditionType, ToothConditionKey> = {
  healthy: 'healthy',
  caries: 'cavity',
  restoration: 'filled',
  crown: 'filled',
  veneer: 'filled',
  sealant: 'filled',
  root_canal: 'treatment',
  post_core: 'treatment',
  apicoectomy: 'treatment',
  implant: 'implant',
  bridge_abutment: 'filled',
  bridge_pontic: 'filled',
  denture: 'filled',
  extraction: 'extraction',
  missing: 'missing',
  impacted: 'treatment',
  unerupted: 'treatment',
  fracture: 'treatment',
  abscess: 'treatment',
  mobility: 'treatment',
  recession: 'treatment',
  watch: 'treatment'
}

/** The legacy chart has no incisal surface; an incisor's biting edge was called occlusal. */
function toLegacySurface(s: SurfaceKey): LegacySurface | null {
  if (s === 'incisal') return 'occlusal'
  if (s === 'occlusal' || s === 'buccal' || s === 'lingual' || s === 'mesial' || s === 'distal') return s
  return null
}

/**
 * Project the odontogram down onto the legacy shape, so the patient PDF, the report
 * template and anything else still reading tooth_chart_data keep working unchanged.
 *
 * Primary teeth are dropped: the legacy chart is keyed 1-32 and has nowhere to put them.
 * That is a real limitation of the OLD format, not of the record — the odontogram still
 * holds them, and it is why the report needs updating to read the odontogram directly.
 */
export function projectToLegacy(data: OdontogramData): ToothChartData {
  const out: ToothChartData = {}
  for (let n = 1; n <= 32; n++) {
    const id = String(n)
    const top = primaryCondition(data, id)
    if (!top) continue
    const surfaces: LegacySurface[] = []
    for (const c of data.conditions) {
      if (c.tooth !== id) continue
      for (const s of c.surfaces) {
        const l = toLegacySurface(s)
        if (l && !surfaces.includes(l)) surfaces.push(l)
      }
    }
    const note = data.conditions.find((c) => c.tooth === id && c.note)?.note || ''
    out[n] = { condition: TO_LEGACY[top.type] ?? 'treatment', surfaces, note }
  }
  return out
}

/** Teeth the legacy format cannot represent, so the caller can say so rather than lose them. */
export function droppedByLegacy(data: OdontogramData): ToothId[] {
  const seen = new Set<ToothId>()
  for (const c of data.conditions) if (isPrimary(c.tooth)) seen.add(c.tooth)
  return [...seen].sort()
}

/**
 * Should this exam be imported from its legacy blob?
 *
 * ONLY when the odontogram holds nothing at all. If it holds even one finding it is the
 * record and importing again could resurrect a tooth the dentist deleted — the failure
 * mode being a chart that quietly regrows an extracted tooth.
 */
export function needsLegacyImport(
  data: OdontogramData | null | undefined,
  legacy: ToothChartData | null | undefined
): boolean {
  if (!data || data.conditions.length > 0) return false
  if (!legacy) return false
  return Object.values(legacy).some((t) => t && t.condition && t.condition !== 'unexamined')
}

/** Statuses that mean a tooth is charted as present-and-done rather than proposed. */
export const PRESENT: ClinicalStatus[] = ['existing', 'completed', 'condition']

/**
 * The reverse mapping, used ONLY when something still speaks the old vocabulary — the
 * Dental Scribe, and the one-time import of a pre-upgrade exam. Deliberately the same
 * mapping the server-side migration uses, so a finding means the same thing whichever
 * door it came through.
 */
export function fromLegacyCondition(
  key: ToothConditionKey
): { type: ConditionType; status: ClinicalStatus } | null {
  switch (key) {
    case 'healthy': return { type: 'healthy', status: 'existing' }
    case 'cavity': return { type: 'caries', status: 'condition' }
    case 'filled': return { type: 'restoration', status: 'existing' }
    case 'missing': return { type: 'missing', status: 'existing' }
    case 'implant': return { type: 'implant', status: 'existing' }
    case 'treatment': return { type: 'watch', status: 'condition' }
    case 'extraction': return { type: 'extraction', status: 'planned' }
    default: return null // 'unexamined' is the absence of a finding, not a finding
  }
}

// The odontogram data model.
//
// This replaces `ToothChartData` (Record<toothNumber, { condition, surfaces, note }>) — one
// condition per tooth, no lifecycle, no procedures, no history. A real chart needs a tooth
// to carry SEVERAL findings at once: a bridge abutment that also has a distal filling and
// is flagged for review is three facts about one tooth, not a choice between them.
//
// This file is the contract every other layer builds against — schema, renderer, ledger —
// so it is deliberately the only place these shapes are defined.
//
// NOTE ON CODES: CDT procedure codes are copyrighted by the ADA and licensed per practice,
// so none are bundled. `code` is blank until the clinic enters or imports their own.

// ---------------------------------------------------------------------------
// Teeth
// ---------------------------------------------------------------------------

/** Universal notation: '1'–'32' permanent, 'A'–'T' primary. String, so both fit one key. */
export type ToothId = string

export type Dentition = 'permanent' | 'primary'
export type ToothType = 'incisor' | 'canine' | 'premolar' | 'molar'
export type Arch = 'upper' | 'lower'
export type Side = 'left' | 'right'

export interface ToothInfo {
  id: ToothId
  dentition: Dentition
  type: ToothType
  arch: Arch
  side: Side
  /** Position out from the midline, 1 = central incisor. Drives artwork selection. */
  position: number
  label: string
  /** The permanent tooth a primary tooth is succeeded by, for mixed-dentition charts. */
  successor?: ToothId
}

const PERMANENT_TYPES: ToothType[] = [
  'molar', 'molar', 'molar', 'premolar', 'premolar', 'canine', 'incisor', 'incisor',
  'incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar', 'molar'
]
// Primary arches have no premolars: 2nd molar, 1st molar, canine, lateral, central.
const PRIMARY_TYPES: ToothType[] = [
  'molar', 'molar', 'canine', 'incisor', 'incisor',
  'incisor', 'incisor', 'canine', 'molar', 'molar'
]
const TYPE_NAMES: Record<ToothType, string> = {
  incisor: 'Incisor', canine: 'Canine', premolar: 'Premolar', molar: 'Molar'
}

function buildPermanent(): ToothInfo[] {
  const out: ToothInfo[] = []
  for (let n = 1; n <= 32; n++) {
    const upper = n <= 16
    const idx = upper ? n - 1 : 32 - n // 0..15 outward-in from the patient's right
    const type = PERMANENT_TYPES[idx]
    const side: Side = idx <= 7 ? 'right' : 'left'
    const position = idx <= 7 ? 8 - idx : idx - 7
    out.push({
      id: String(n),
      dentition: 'permanent',
      type,
      arch: upper ? 'upper' : 'lower',
      side,
      position,
      label: `${upper ? 'Upper' : 'Lower'} ${side === 'right' ? 'Right' : 'Left'} ${TYPE_NAMES[type]}`
    })
  }
  return out
}

const PRIMARY_LETTERS = 'ABCDEFGHIJKLMNOPQRST'.split('')

// Which permanent tooth replaces each primary tooth. Written out rather than derived,
// because the two molars are the trap: a primary FIRST molar is succeeded by the first
// PREMOLAR and a primary second molar by the second premolar — the permanent molars
// erupt behind the primary teeth and replace nothing.
const SUCCESSOR: Record<string, string> = {
  A: '4',  B: '5',  C: '6',  D: '7',  E: '8',   // upper right
  F: '9',  G: '10', H: '11', I: '12', J: '13',  // upper left
  K: '20', L: '21', M: '22', N: '23', O: '24',  // lower left
  P: '25', Q: '26', R: '27', S: '28', T: '29'   // lower right
}

function buildPrimary(): ToothInfo[] {
  const out: ToothInfo[] = []
  PRIMARY_LETTERS.forEach((letter, i) => {
    const upper = i < 10
    const idx = upper ? i : 19 - i // 0..9 outward-in from the patient's right
    const type = PRIMARY_TYPES[idx]
    const side: Side = idx <= 4 ? 'right' : 'left'
    const position = idx <= 4 ? 5 - idx : idx - 4
    // The permanent tooth that replaces it, so a mixed-dentition chart can slot the
    // primary tooth into its successor's column instead of drawing a separate arch.
    const successor = SUCCESSOR[letter]
    out.push({
      id: letter,
      dentition: 'primary',
      type,
      arch: upper ? 'upper' : 'lower',
      side,
      position,
      label: `${upper ? 'Upper' : 'Lower'} ${side === 'right' ? 'Right' : 'Left'} Primary ${TYPE_NAMES[type]}`,
      successor
    })
  })
  return out
}

export const PERMANENT_TEETH: ToothInfo[] = buildPermanent()
export const PRIMARY_TEETH: ToothInfo[] = buildPrimary()
export const ALL_TEETH: ToothInfo[] = [...PERMANENT_TEETH, ...PRIMARY_TEETH]
export const TOOTH_BY_ID = new Map<ToothId, ToothInfo>(ALL_TEETH.map((t) => [t.id, t]))

export function isPrimary(id: ToothId): boolean {
  return /^[A-T]$/i.test(id)
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * Anterior teeth have an incisal edge where posteriors have an occlusal table. Charting
 * both as "occlusal" is the kind of small inaccuracy that makes a chart untrustworthy.
 */
export type SurfaceKey = 'occlusal' | 'incisal' | 'buccal' | 'lingual' | 'mesial' | 'distal'

export const SURFACE_LETTER: Record<SurfaceKey, string> = {
  mesial: 'M', occlusal: 'O', incisal: 'I', distal: 'D', buccal: 'B', lingual: 'L'
}
/** Conventional write-up order, e.g. MOD. */
export const SURFACE_ORDER: SurfaceKey[] = [
  'mesial', 'occlusal', 'incisal', 'distal', 'buccal', 'lingual'
]

export function surfacesFor(id: ToothId): SurfaceKey[] {
  const t = TOOTH_BY_ID.get(id)
  const biting: SurfaceKey = t && (t.type === 'incisor' || t.type === 'canine') ? 'incisal' : 'occlusal'
  return ['mesial', biting, 'distal', 'buccal', 'lingual']
}

export function surfaceShorthand(surfaces: SurfaceKey[]): string {
  return SURFACE_ORDER.filter((s) => surfaces.includes(s)).map((s) => SURFACE_LETTER[s]).join('')
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** Which part of the tooth a finding belongs to — drives the crown row vs the root row. */
export type ToothZone = 'crown' | 'root' | 'whole'

export type ConditionType =
  | 'healthy'
  | 'caries'
  | 'restoration'
  | 'crown'
  | 'veneer'
  | 'sealant'
  | 'root_canal'
  | 'post_core'
  | 'apicoectomy'
  | 'implant'
  | 'bridge_abutment'
  | 'bridge_pontic'
  | 'denture'
  | 'extraction'
  | 'missing'
  | 'impacted'
  | 'unerupted'
  | 'fracture'
  | 'abscess'
  | 'mobility'
  | 'recession'
  | 'watch'

/**
 * Lifecycle. `condition` is pathology the dentist found; `existing` is work already in the
 * mouth when the patient arrived. Both are facts about today, which is why neither is a
 * "planned" state — the ledger filters treat them as separate tabs for exactly that reason.
 */
export type ClinicalStatus =
  | 'condition'
  | 'existing'
  | 'planned'
  | 'to_start'
  | 'today'
  | 'in_progress'
  | 'to_complete'
  | 'completed'
  | 'to_review'
  | 'referred'
  | 'declined'

export const STATUS_LABELS: Record<ClinicalStatus, string> = {
  condition: 'Condition',
  existing: 'Existing',
  planned: 'Planned',
  to_start: 'To Start',
  today: 'Today',
  in_progress: 'In Progress',
  to_complete: 'To Complete',
  completed: 'Completed',
  to_review: 'To Review',
  referred: 'Referred',
  declined: 'Declined'
}

/**
 * Allowed transitions. A chart is a legal record, so status moves through a state machine
 * rather than being set to anything at any time — that is what makes the history defensible.
 */
export const STATUS_TRANSITIONS: Record<ClinicalStatus, ClinicalStatus[]> = {
  condition: ['planned', 'to_start', 'today', 'referred', 'declined', 'to_review'],
  existing: ['to_review', 'condition', 'planned'],
  planned: ['to_start', 'today', 'declined', 'referred', 'condition'],
  to_start: ['today', 'in_progress', 'planned', 'declined'],
  today: ['in_progress', 'completed', 'to_complete', 'planned'],
  in_progress: ['to_complete', 'completed', 'to_review'],
  to_complete: ['completed', 'in_progress', 'to_review'],
  completed: ['to_review', 'existing'],
  to_review: ['completed', 'condition', 'planned'],
  referred: ['completed', 'to_review', 'declined'],
  declined: ['planned', 'condition']
}

export function canTransition(from: ClinicalStatus, to: ClinicalStatus): boolean {
  return from === to || (STATUS_TRANSITIONS[from] || []).includes(to)
}

/** One finding on one tooth. A tooth may carry many of these at once. */
export interface ToothCondition {
  id: number
  examination_id: number
  tooth: ToothId
  type: ConditionType
  status: ClinicalStatus
  zone: ToothZone
  surfaces: SurfaceKey[]
  /** Amalgam, composite, gold, zirconia … free text; drives the fill pattern. */
  material?: string
  /** Free letter/number badge drawn beside the tooth, independent of condition colour. */
  badge?: string
  bridge_group_id?: number | null
  procedure_id?: number | null
  provider_id?: number | null
  provider_name?: string
  date_recorded: string
  note?: string
}

export type NewToothCondition = Omit<ToothCondition, 'id'>

// ---------------------------------------------------------------------------
// Grouping: bridges, dentures, splints
// ---------------------------------------------------------------------------

export type ApplianceType = 'bridge' | 'denture' | 'partial' | 'splint' | 'retainer'

/** Spans two or more teeth and is drawn as one connected unit across tooth boundaries. */
export interface BridgeGroup {
  id: number
  examination_id: number
  type: ApplianceType
  teeth: ToothId[]
  status: ClinicalStatus
  label?: string
  note?: string
}

// ---------------------------------------------------------------------------
// Procedures — what gets done, billed and reported on
// ---------------------------------------------------------------------------

export interface TxPlan {
  id: number
  examination_id: number
  name: string
  /** Presented / accepted / declined — what the patient agreed to. */
  accepted: boolean
  created_at: string
}

export interface Procedure {
  id: number
  examination_id: number
  tx_plan_id?: number | null
  /** Sequencing within a plan: phase 1 is done before phase 2. */
  phase: number
  /** CDT/ADA code. Blank until the clinic enters or imports their own — see file header. */
  code: string
  description: string
  teeth: ToothId[]
  surfaces: SurfaceKey[]
  status: ClinicalStatus
  provider_id?: number | null
  provider_name?: string
  location?: string
  date?: string
  /** Money is modelled but not surfaced in this release; see the release scope. */
  fee?: number | null
  insurance_estimate?: number | null
  patient_portion?: number | null
  note?: string
  created_at: string
}

export type NewProcedure = Omit<Procedure, 'id' | 'created_at'>

/** Clinic-maintained code list. Ships with descriptions only; codes are entered locally. */
export interface ProcedureCode {
  id: number
  code: string
  description: string
  category: string
  default_fee?: number | null
  active: boolean
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/**
 * Every change to a tooth, kept forever. Insurance disputes and malpractice defence both
 * turn on who recorded what and when, so entries are append-only and never edited.
 */
export interface ToothHistoryEntry {
  id: number
  examination_id: number
  tooth?: ToothId | null
  entity: 'condition' | 'procedure' | 'bridge' | 'chart'
  entity_id?: number | null
  action: 'created' | 'updated' | 'deleted' | 'status_changed'
  field?: string
  before?: string
  after?: string
  user_id?: number | null
  user_name?: string
  at: string
}

// ---------------------------------------------------------------------------
// The chart as the renderer receives it
// ---------------------------------------------------------------------------

export interface OdontogramData {
  examination_id: number
  dentition: Dentition | 'mixed'
  conditions: ToothCondition[]
  bridges: BridgeGroup[]
  procedures: Procedure[]
  plans: TxPlan[]
}

export const EMPTY_ODONTOGRAM: OdontogramData = {
  examination_id: 0,
  dentition: 'permanent',
  conditions: [],
  bridges: [],
  procedures: [],
  plans: []
}

/** Every finding on one tooth, most recent last. */
export function conditionsFor(data: OdontogramData, tooth: ToothId): ToothCondition[] {
  return data.conditions
    .filter((c) => c.tooth === tooth)
    .sort((a, b) => a.date_recorded.localeCompare(b.date_recorded))
}

/**
 * The single condition that decides a tooth's base colour when the chart is collapsed to
 * one colour per tooth (legend counts, printed summaries, the old-style view). Ordered by
 * clinical seriousness, NOT by recency: a tooth that is missing is missing whatever else
 * was recorded afterwards.
 */
const SEVERITY: ConditionType[] = [
  'missing', 'extraction', 'implant', 'bridge_pontic', 'bridge_abutment', 'denture',
  'abscess', 'fracture', 'caries', 'root_canal', 'post_core', 'apicoectomy', 'crown',
  'veneer', 'restoration', 'sealant', 'impacted', 'unerupted', 'mobility', 'recession',
  'watch', 'healthy'
]

export function primaryCondition(data: OdontogramData, tooth: ToothId): ToothCondition | null {
  const list = conditionsFor(data, tooth)
  if (!list.length) return null
  for (const type of SEVERITY) {
    const hit = list.find((c) => c.type === type)
    if (hit) return hit
  }
  return list[list.length - 1]
}

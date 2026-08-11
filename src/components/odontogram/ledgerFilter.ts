// Ledger logic: counting, filtering, sorting and labelling procedures.
//
// Everything the procedure table does to its data lives here, deliberately free of React
// and of the DOM, so the behaviour a clinic actually depends on — "does the Planned pill
// show the right number", "does searching 14 find the crown on 14" — is testable by
// running a file, not by driving a browser. See ledgerFilter.test.mjs.
//
// The shapes come from shared/odontogram.ts and are never redefined here.

import {
  STATUS_LABELS,
  STATUS_TRANSITIONS,
  surfaceShorthand,
  type ClinicalStatus,
  type Procedure,
  type ToothId,
  type TxPlan
} from '@shared/odontogram'

// ---------------------------------------------------------------------------
// Filter keys
// ---------------------------------------------------------------------------

/**
 * The pill row is mostly statuses, plus one tab that is not a status at all: Notes means
 * "this procedure carries a note", which can be true of a procedure in any status. Keeping
 * it in the same key space lets one union filter serve the whole row.
 */
export const NOTES_KEY = 'notes'
export type LedgerFilterKey = ClinicalStatus | typeof NOTES_KEY

/** Pill row, in the order the chart hands them to the front desk. */
export const LEDGER_FILTER_KEYS: LedgerFilterKey[] = [
  'condition',
  'existing',
  'planned',
  'today',
  'completed',
  'to_start',
  'to_complete',
  'to_review',
  NOTES_KEY
]

export function filterLabel(key: LedgerFilterKey): string {
  return key === NOTES_KEY ? 'Notes' : STATUS_LABELS[key]
}

export type LedgerCounts = Record<ClinicalStatus, number> & { notes: number }

export interface LedgerFilter {
  /** Selected pills. Empty means "no status filter", not "match nothing". */
  statuses?: LedgerFilterKey[]
  search?: string
  toothId?: ToothId
  /** `null` filters to procedures with no treatment plan; omit for no plan filter. */
  planId?: number | null
  phase?: number
}

export const EMPTY_FILTER: LedgerFilter = { statuses: [], search: '' }

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

function hasNote(p: Procedure): boolean {
  return !!p.note && p.note.trim().length > 0
}

/**
 * One count per procedure, per status — a bridge recorded across teeth 3, 4 and 5 is ONE
 * planned procedure, not three. The pills count rows of the ledger, which is what the
 * number beside them promises.
 */
export function statusCounts(procedures: Procedure[]): LedgerCounts {
  const counts = { notes: 0 } as LedgerCounts
  for (const status of Object.keys(STATUS_LABELS) as ClinicalStatus[]) counts[status] = 0
  for (const p of procedures || []) {
    // A status outside the contract can only come from corrupt data; count it rather
    // than turning the whole column into NaN.
    counts[p.status] = (counts[p.status] || 0) + 1
    if (hasNote(p)) counts.notes += 1
  }
  return counts
}

/** How many of these rows sit on one tooth — drives the "N on tooth #14" hint. */
export function countOnTooth(procedures: Procedure[], tooth: ToothId | undefined | null): number {
  if (!tooth) return 0
  return (procedures || []).filter((p) => (p.teeth || []).includes(tooth)).length
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function normalizeSearch(search: string | undefined | null): string {
  return (search || '').trim().toLowerCase().replace(/^#+/, '')
}

/**
 * Code and description match on substring; a tooth matches only exactly. Typing "3" should
 * not drag in every procedure on 13, 23, 30, 31, 32 — a tooth number is an identifier, not
 * a word. A leading '#' is stripped so "#14" works too.
 */
function matchesSearch(p: Procedure, term: string): boolean {
  if (!term) return true
  if ((p.code || '').toLowerCase().includes(term)) return true
  if ((p.description || '').toLowerCase().includes(term)) return true
  return (p.teeth || []).some((tooth) => String(tooth).toLowerCase() === term)
}

export function filterProcedures(procedures: Procedure[], filter: LedgerFilter = {}): Procedure[] {
  const list = procedures || []
  const statuses = filter.statuses || []
  const term = normalizeSearch(filter.search)

  return list.filter((p) => {
    // Pills are a UNION: selecting Planned and Today means "show me either", the way a
    // person reads two highlighted tabs. An intersection would always be empty, because a
    // procedure only ever holds one status.
    if (statuses.length) {
      const hit = statuses.some((key) => (key === NOTES_KEY ? hasNote(p) : p.status === key))
      if (!hit) return false
    }
    if (term && !matchesSearch(p, term)) return false
    if (filter.toothId !== undefined && !(p.teeth || []).includes(filter.toothId)) return false
    if (filter.planId !== undefined && (p.tx_plan_id ?? null) !== filter.planId) return false
    if (filter.phase !== undefined && p.phase !== filter.phase) return false
    return true
  })
}

export function isFilterActive(filter: LedgerFilter): boolean {
  return (
    (filter.statuses || []).length > 0 ||
    normalizeSearch(filter.search).length > 0 ||
    filter.toothId !== undefined ||
    filter.planId !== undefined ||
    filter.phase !== undefined
  )
}

/**
 * Human-readable list of what is currently filtering the table, so the empty state can say
 * WHY nothing is showing instead of leaving the user to guess.
 */
export function describeActiveFilters(filter: LedgerFilter, plans: TxPlan[] = []): string[] {
  const out: string[] = []
  const statuses = filter.statuses || []
  if (statuses.length) out.push(`Status: ${statuses.map(filterLabel).join(', ')}`)
  const term = (filter.search || '').trim()
  if (term) out.push(`Search: “${term}”`)
  if (filter.toothId !== undefined) out.push(`Tooth: #${filter.toothId}`)
  if (filter.planId !== undefined) {
    out.push(`Plan: ${filter.planId === null ? 'Unassigned' : planLabel(plans, filter.planId)}`)
  }
  if (filter.phase !== undefined) out.push(`Phase: ${filter.phase}`)
  return out
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortColumn =
  | 'date'
  | 'code'
  | 'description'
  | 'tooth'
  | 'surface'
  | 'provider'
  | 'location'
  | 'plan'
  | 'phase'
  | 'status'

export type SortDirection = 'asc' | 'desc'

export const SORT_COLUMNS: SortColumn[] = [
  'date',
  'code',
  'description',
  'tooth',
  'surface',
  'provider',
  'location',
  'plan',
  'phase',
  'status'
]

/** Dates read newest-first; everything else reads A→Z on the first click. */
export function defaultDirection(column: SortColumn): SortDirection {
  return column === 'date' ? 'desc' : 'asc'
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/**
 * A blank cell is missing data, not a value that sorts before 'A'. Blanks go to the bottom
 * ascending (and the top when reversed), so the rows with something to say come first.
 */
function cmpText(a: string, b: string): number {
  const x = (a || '').trim()
  const y = (b || '').trim()
  if (!x && !y) return 0
  if (!x) return 1
  if (!y) return -1
  return collator.compare(x, y)
}

/** ISO dates compare lexicographically; blanks last, as above. */
function cmpDate(a: string | undefined, b: string | undefined): number {
  const x = (a || '').trim()
  const y = (b || '').trim()
  if (!x && !y) return 0
  if (!x) return 1
  if (!y) return -1
  return x < y ? -1 : x > y ? 1 : 0
}

const NO_TOOTH = 999

/** 1–32 keep their numbers; primary A–T follow the permanents; whole-mouth codes last. */
export function toothRank(teeth: ToothId[] | undefined): number {
  let best = NO_TOOTH
  for (const raw of teeth || []) {
    const id = String(raw).trim()
    if (!id) continue
    let rank = NO_TOOTH
    if (/^\d+$/.test(id)) rank = Number(id)
    else if (/^[A-Ta-t]$/.test(id)) rank = 100 + (id.toUpperCase().charCodeAt(0) - 65)
    // A procedure spanning several teeth sorts by the earliest tooth it touches, so a
    // 3-4-5 bridge sits with tooth 3 instead of wherever its teeth happen to be listed.
    if (rank < best) best = rank
  }
  return best
}

/** Lifecycle order, not alphabetical — a status column is only useful in clinical order. */
const STATUS_RANK: ClinicalStatus[] = [
  'condition',
  'existing',
  'planned',
  'to_start',
  'today',
  'in_progress',
  'to_complete',
  'completed',
  'to_review',
  'referred',
  'declined'
]

export function statusRank(status: ClinicalStatus): number {
  const i = STATUS_RANK.indexOf(status)
  return i === -1 ? STATUS_RANK.length : i
}

export function planName(plans: TxPlan[] | undefined, id: number | null | undefined): string {
  if (id === null || id === undefined) return ''
  const plan = (plans || []).find((p) => p.id === id)
  return plan ? plan.name : `Plan ${id}`
}

/** Display form of the plan cell — em dash when the procedure belongs to no plan. */
export function planLabel(plans: TxPlan[] | undefined, id: number | null | undefined): string {
  return planName(plans, id) || '—'
}

function comparatorFor(
  column: SortColumn,
  plans: TxPlan[] | undefined
): (a: Procedure, b: Procedure) => number {
  switch (column) {
    case 'date':
      return (a, b) => cmpDate(a.date, b.date)
    case 'code':
      return (a, b) => cmpText(a.code, b.code)
    case 'description':
      return (a, b) => cmpText(a.description, b.description)
    case 'tooth':
      return (a, b) => toothRank(a.teeth) - toothRank(b.teeth)
    case 'surface':
      return (a, b) => cmpText(surfaceShorthand(a.surfaces || []), surfaceShorthand(b.surfaces || []))
    case 'provider':
      return (a, b) => cmpText(a.provider_name || '', b.provider_name || '')
    case 'location':
      return (a, b) => cmpText(a.location || '', b.location || '')
    case 'plan':
      return (a, b) => cmpText(planName(plans, a.tx_plan_id), planName(plans, b.tx_plan_id))
    case 'phase':
      return (a, b) => (Number.isFinite(a.phase) ? a.phase : 0) - (Number.isFinite(b.phase) ? b.phase : 0)
    case 'status':
      return (a, b) => statusRank(a.status) - statusRank(b.status)
    default:
      return () => 0
  }
}

/**
 * Returns a new array; the caller's list is never reordered in place.
 *
 * Stability is decorated in rather than assumed: Array#sort is stable, but multiplying a
 * comparator by -1 to reverse it is not — it would flip tied rows too, so a table would
 * shuffle equal rows every time the user reversed a column. Ties always fall back to the
 * incoming order, in both directions.
 */
export function sortProcedures(
  procedures: Procedure[],
  column: SortColumn,
  direction: SortDirection = 'asc',
  plans?: TxPlan[]
): Procedure[] {
  const cmp = comparatorFor(column, plans)
  const sign = direction === 'desc' ? -1 : 1
  return (procedures || [])
    .map((p, index) => ({ p, index }))
    .sort((a, b) => {
      const base = cmp(a.p, b.p)
      return base !== 0 ? base * sign : a.index - b.index
    })
    .map((entry) => entry.p)
}

/** Header click: same column reverses, a new column starts from its natural direction. */
export function nextSort(
  current: { column: SortColumn; direction: SortDirection },
  column: SortColumn
): { column: SortColumn; direction: SortDirection } {
  if (current.column === column) {
    return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { column, direction: defaultDirection(column) }
}

// ---------------------------------------------------------------------------
// Cell formatting
// ---------------------------------------------------------------------------

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/**
 * Billing is out of scope for this release, so most of these are null today. The column
 * still renders — an em dash reads as "not priced yet", and the layout is already right
 * for the day the numbers arrive.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return money.format(value)
}

/** '3, 4, 5' for a bridge, '—' when the procedure is not tooth-specific. */
export function toothSummary(teeth: ToothId[] | undefined): string {
  const list = (teeth || []).map((t) => String(t).trim()).filter(Boolean)
  return list.length ? list.join(', ') : '—'
}

/** MOD, not 'mesial, occlusal, distal'. */
export function surfaceSummary(p: Procedure): string {
  return surfaceShorthand(p.surfaces || []) || '—'
}

export function dash(value: string | null | undefined): string {
  const v = (value || '').trim()
  return v || '—'
}

/**
 * The statuses this procedure may legally move to, current one first. A chart is a legal
 * record, so the dropdown offers the state machine's transitions rather than every status.
 */
export function statusOptions(status: ClinicalStatus): ClinicalStatus[] {
  const allowed = STATUS_TRANSITIONS[status] || []
  return [status, ...allowed.filter((s) => s !== status)]
}

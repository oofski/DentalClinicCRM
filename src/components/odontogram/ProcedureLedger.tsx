// The procedure ledger — the filterable table that sits under the odontogram and lists
// everything recorded for the visit: findings, existing work, plan, today's work, history.
//
// The chart shows a tooth; the ledger shows the story. It is the view the front desk and
// the insurance appeal both read from, so it stays a real <table> — sortable, searchable,
// keyboard-operable, and printable — rather than a grid of divs.
//
// All of the counting, filtering, sorting and cell formatting lives in ./ledgerFilter, so
// this file is layout and interaction only.

import { useLayoutEffect, useMemo, useState } from 'react'
import {
  STATUS_LABELS,
  type ClinicalStatus,
  type Procedure,
  type ToothId,
  type TxPlan
} from '@shared/odontogram'
import { formatDate } from '@/lib/format'
import { Icon } from '@/components/icons'
import {
  LEDGER_FILTER_KEYS,
  countOnTooth,
  dash,
  describeActiveFilters,
  filterLabel,
  filterProcedures,
  formatMoney,
  isFilterActive,
  nextSort,
  planLabel,
  sortProcedures,
  statusCounts,
  statusOptions,
  surfaceSummary,
  toothSummary,
  type LedgerFilter,
  type LedgerFilterKey,
  type SortColumn,
  type SortDirection
} from './ledgerFilter'

export interface ProcedureLedgerProps {
  procedures: Procedure[]
  plans: TxPlan[]
  /** Open the procedure for editing. Without it, the ledger is read-only. */
  onEdit?: (procedure: Procedure) => void
  /** Move a procedure along the lifecycle. Only legal transitions are ever offered. */
  onStatusChange?: (procedure: Procedure, next: ClinicalStatus) => void
  /** The tooth selected on the chart above: its rows are highlighted, never isolated. */
  selectedTooth?: ToothId | null
}

interface Column {
  key: SortColumn
  label: string
  className?: string
}

// Th/Area, Surface and Tx Plan are the abbreviations charting software has used for
// decades; spelling them out would make the header row twice as wide for no gain.
const COLUMNS: Column[] = [
  { key: 'date', label: 'Date' },
  { key: 'code', label: 'Code' },
  { key: 'description', label: 'Description', className: 'ledger-desc' },
  { key: 'tooth', label: 'Th/Area' },
  { key: 'surface', label: 'Surface' },
  { key: 'provider', label: 'Provider' },
  { key: 'location', label: 'Location' },
  { key: 'plan', label: 'Tx Plan' },
  { key: 'phase', label: 'Phase', className: 'ledger-num' },
  { key: 'status', label: 'Status' }
]

/** Money columns are rendered but not sortable — there is nothing to sort until billing. */
const MONEY_COLUMNS = ['Fee', 'Insurance', 'Patient']

/** Reuses the app's five pill tints rather than inventing a colour per status. */
const STATUS_TINT: Record<ClinicalStatus, string> = {
  condition: 'urgent',
  existing: 'gray',
  planned: 'azure',
  to_start: 'azure',
  today: 'important',
  in_progress: 'important',
  to_complete: 'important',
  completed: 'routine',
  to_review: 'important',
  referred: 'gray',
  declined: 'gray'
}

export function ProcedureLedger({
  procedures,
  plans,
  onEdit,
  onStatusChange,
  selectedTooth
}: ProcedureLedgerProps) {
  useLedgerStyles()

  const [statuses, setStatuses] = useState<LedgerFilterKey[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: 'date',
    direction: 'desc'
  })

  const filter: LedgerFilter = { statuses, search }
  const counts = useMemo(() => statusCounts(procedures), [procedures])
  // selectedTooth deliberately does NOT filter: the chart is a lens on the ledger, not a
  // gate on it. Losing the rest of the mouth is how a second finding gets missed.
  const rows = useMemo(
    () => sortProcedures(filterProcedures(procedures, filter), sort.column, sort.direction, plans),
    [procedures, plans, statuses, search, sort.column, sort.direction]
  )
  const highlighted = countOnTooth(rows, selectedTooth)
  const active = describeActiveFilters(filter, plans)
  const filtering = isFilterActive(filter)

  const togglePill = (key: LedgerFilterKey) =>
    setStatuses((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  const clearFilters = () => {
    setStatuses([])
    setSearch('')
  }

  const ariaSort = (column: SortColumn): 'ascending' | 'descending' | 'none' =>
    sort.column !== column ? 'none' : sort.direction === 'asc' ? 'ascending' : 'descending'

  return (
    <div className="card ledger-card">
      <div className="card-title">
        <span>Procedure Ledger</span>
        <div className="ledger-tools">
          <input
            type="search"
            className="ledger-search"
            placeholder="Search description, code or tooth…"
            aria-label="Search procedures by description, code or tooth"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {filtering && (
            <button className="btn btn-sm btn-ghost" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="ledger-filters" role="group" aria-label="Filter procedures by status">
        {LEDGER_FILTER_KEYS.map((key) => {
          const count = key === 'notes' ? counts.notes : counts[key]
          const on = statuses.includes(key)
          return (
            <button
              key={key}
              type="button"
              className={`ledger-pill${count === 0 ? ' is-empty' : ''}`}
              aria-pressed={on}
              onClick={() => togglePill(key)}
            >
              {filterLabel(key)}
              <span className="n">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="ledger-summary muted">
        Showing {rows.length} of {procedures.length}
        {selectedTooth && highlighted > 0 ? ` · ${highlighted} on tooth #${selectedTooth} highlighted` : ''}
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {procedures.length === 0 ? (
            'Nothing charted yet. Procedures recorded on the chart above appear here.'
          ) : (
            <>
              <div>No procedures match {active.join(' · ')}.</div>
              <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={clearFilters}>
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : (
        // The table scrolls sideways inside this box so the page itself never does.
        <div className="ledger-scroll" tabIndex={0} role="region" aria-label="Procedures">
          <table className="data ledger-table">
            <caption className="ledger-sr">
              Procedures — {rows.length} of {procedures.length} shown
              {active.length ? `, filtered by ${active.join('; ')}` : ''}
            </caption>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} scope="col" className={col.className} aria-sort={ariaSort(col.key)}>
                    <button
                      type="button"
                      className="ledger-sort"
                      onClick={() => setSort((s) => nextSort(s, col.key))}
                      title={`Sort by ${col.label}`}
                    >
                      {col.label}
                      <span className="ledger-caret" aria-hidden="true">
                        {sort.column !== col.key ? '↕' : sort.direction === 'asc' ? '▲' : '▼'}
                      </span>
                    </button>
                  </th>
                ))}
                {MONEY_COLUMNS.map((label) => (
                  <th key={label} scope="col" className="ledger-num">
                    {label}
                  </th>
                ))}
                {onEdit && (
                  <th scope="col">
                    <span className="ledger-sr">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const onSelected = !!selectedTooth && p.teeth.includes(selectedTooth)
                return (
                  <tr key={p.id} className={onSelected ? 'is-selected' : undefined}>
                    <td>{formatDate(p.date)}</td>
                    <td>{dash(p.code)}</td>
                    <td className="ledger-desc">
                      {dash(p.description)}
                      {p.note && p.note.trim() && (
                        <span className="ledger-note" title={p.note}>
                          {p.note}
                        </span>
                      )}
                    </td>
                    <td>
                      <TeethCell teeth={p.teeth} selected={selectedTooth} />
                    </td>
                    <td>{surfaceSummary(p)}</td>
                    <td>{dash(p.provider_name)}</td>
                    <td>{dash(p.location)}</td>
                    <td>{planLabel(plans, p.tx_plan_id)}</td>
                    <td className="ledger-num">{p.phase}</td>
                    <td>
                      {onStatusChange ? (
                        <select
                          className="ledger-status-select"
                          value={p.status}
                          aria-label={`Status — ${p.description || p.code || `procedure ${p.id}`}`}
                          onChange={(e) => onStatusChange(p, e.target.value as ClinicalStatus)}
                        >
                          {statusOptions(p.status).map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`pill ${STATUS_TINT[p.status] || 'gray'}`}>
                          {STATUS_LABELS[p.status] || p.status}
                        </span>
                      )}
                    </td>
                    <td className="ledger-num">{formatMoney(p.fee)}</td>
                    <td className="ledger-num">{formatMoney(p.insurance_estimate)}</td>
                    <td className="ledger-num">{formatMoney(p.patient_portion)}</td>
                    {onEdit && (
                      <td>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => onEdit(p)}
                          aria-label={`Edit ${p.description || p.code || `procedure ${p.id}`}`}
                        >
                          <Icon name="edit" size={14} /> Edit
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="muted ledger-foot">
        Fee, Insurance and Patient are shown for layout only — amounts arrive with billing.
      </div>
    </div>
  )
}

/** Marks the charted tooth inside a multi-tooth row, so a bridge shows WHICH unit matched. */
function TeethCell({ teeth, selected }: { teeth: ToothId[]; selected?: ToothId | null }) {
  if (!selected || !teeth.includes(selected)) return <>{toothSummary(teeth)}</>
  return (
    <>
      {teeth.map((t, i) => (
        <span key={`${t}-${i}`} className={t === selected ? 'ledger-tooth is-selected' : undefined}>
          {t}
          {i < teeth.length - 1 ? ', ' : ''}
        </span>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Styles
//
// The ledger is the only consumer of these rules, so they ship with the component instead
// of growing the global sheet — but they are written in the app's variables and classes
// (.card, .btn, .pill, .muted, table.data) so it reads as the same product.
// ---------------------------------------------------------------------------

const STYLE_ID = 'procedure-ledger-css'

const LEDGER_CSS = `
.ledger-card .card-title { flex-wrap: wrap; row-gap: 10px; }
.ledger-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ledger-search { width: 268px; max-width: 100%; padding: 7px 11px; font-size: 13px; border-radius: 8px; }

.ledger-filters { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
.ledger-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 11px; border: 1px solid var(--border); border-radius: 999px;
  background: var(--surface); color: var(--muted);
  font-family: inherit; font-size: 12.5px; font-weight: 700; line-height: 1.5;
  cursor: pointer; transition: all 0.12s ease;
}
.ledger-pill:hover { border-color: var(--azure); color: var(--navy); }
.ledger-pill:focus-visible { outline: 2px solid var(--azure); outline-offset: 2px; }
.ledger-pill[aria-pressed='true'] { background: var(--navy); border-color: var(--navy); color: #fff; }
.ledger-pill.is-empty { opacity: 0.55; }
.ledger-pill .n {
  min-width: 17px; padding: 0 5px; border-radius: 999px; text-align: center;
  background: #eef2f6; color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums;
}
.ledger-pill[aria-pressed='true'] .n { background: rgba(255, 255, 255, 0.22); color: #fff; }

.ledger-summary { font-size: 12.5px; margin-bottom: 10px; }

.ledger-scroll { overflow-x: auto; padding-bottom: 2px; }
.ledger-scroll:focus-visible { outline: 2px solid var(--azure); outline-offset: 2px; }
.ledger-table { min-width: 1180px; }
.ledger-table th, .ledger-table td { white-space: nowrap; vertical-align: top; }
.ledger-table th.ledger-desc, .ledger-table td.ledger-desc { white-space: normal; min-width: 240px; }
.ledger-table th.ledger-num, .ledger-table td.ledger-num { text-align: right; font-variant-numeric: tabular-nums; }

.ledger-sort {
  display: inline-flex; align-items: center; gap: 5px;
  font: inherit; font-weight: 700; color: inherit; letter-spacing: inherit; text-transform: inherit;
  background: none; border: 0; padding: 0; margin: 0; cursor: pointer;
}
.ledger-sort:hover { color: var(--navy); }
.ledger-sort:focus-visible { outline: 2px solid var(--azure); outline-offset: 3px; }
.ledger-caret { font-size: 9px; opacity: 0.35; }
.ledger-table th[aria-sort='ascending'], .ledger-table th[aria-sort='descending'] { color: var(--navy); }
.ledger-table th[aria-sort='ascending'] .ledger-caret,
.ledger-table th[aria-sort='descending'] .ledger-caret { opacity: 1; color: var(--azure); }

.ledger-table tr.is-selected td { background: rgba(47, 168, 223, 0.15); }
.ledger-table tr.is-selected td:first-child { box-shadow: inset 3px 0 0 var(--azure); }
.ledger-table tr.is-selected:hover td { background: rgba(47, 168, 223, 0.22); }
.ledger-tooth.is-selected { font-weight: 800; color: var(--navy); }

.ledger-note { display: block; margin-top: 3px; color: var(--muted); font-size: 12px; max-width: 320px; }
.ledger-status-select { width: auto; min-width: 126px; padding: 4px 8px; font-size: 12.5px; border-radius: 7px; }
.ledger-foot { margin-top: 12px; font-size: 12px; }

.ledger-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
`

/**
 * One stylesheet for every ledger on the page, added before first paint. It is never
 * removed: the rules are shared, so tearing them down on unmount would strip the styling
 * off any other ledger still mounted.
 */
function useLedgerStyles() {
  useLayoutEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = LEDGER_CSS
    document.head.appendChild(el)
  }, [])
}

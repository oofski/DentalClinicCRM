// The odontogram as it appears on the examination screen: toolbar, chart, tabs, ledger.
//
// This owns the ONE thing that must not go wrong — which copy of the chart is the record.
// See legacyBridge.ts. On open, an exam charted before the upgrade is imported from its old
// blob exactly once; from then on the odontogram is the record and the blob is written only
// as a projection of it, so the two can never disagree.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/ui'
import {
  EMPTY_ODONTOGRAM, STATUS_LABELS, TOOTH_BY_ID, conditionsFor, surfaceShorthand,
  type ClinicalStatus, type ConditionType, type Dentition, type OdontogramData,
  type SurfaceKey, type ToothId
} from '@shared/odontogram'
import type { ToothChartData } from '@shared/types'
import { Odontogram } from './Odontogram'
import { ProcedureLedger } from './ProcedureLedger'
import { CONDITION_STYLE, LEGEND_ORDER, isProposed } from './conditionStyle'
import { needsLegacyImport, projectToLegacy, droppedByLegacy } from './legacyBridge'

type Tab = 'chart' | 'plans' | 'imaging'

/** Conditions offered on the quick-add bar, in the order a dentist reaches for them. */
const QUICK: ConditionType[] = [
  'healthy', 'caries', 'restoration', 'crown', 'root_canal', 'implant',
  'bridge_abutment', 'extraction', 'missing', 'watch'
]

export interface OdontogramPanelProps {
  examinationId: number
  /** The exam's legacy chart, used once to import a pre-upgrade exam. */
  legacyChart?: ToothChartData | null
  readOnly?: boolean
  /** Called with the projection whenever the record changes, so the PDF stays in step. */
  onProjectLegacy?: (chart: ToothChartData) => void
  /** Bump to reload after something outside the panel writes findings (the Scribe). */
  refreshKey?: number
}

export function OdontogramPanel({
  examinationId,
  legacyChart,
  readOnly = false,
  onProjectLegacy,
  refreshKey = 0
}: OdontogramPanelProps) {
  const toast = useToast()
  const [data, setData] = useState<OdontogramData>(EMPTY_ODONTOGRAM)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('chart')
  const [tooth, setTooth] = useState<ToothId | null>(null)
  const [surface, setSurface] = useState<SurfaceKey | null>(null)
  const [showRoots, setShowRoots] = useState(true)
  const [dentition, setDentition] = useState<Dentition | 'mixed'>('permanent')
  const [imported, setImported] = useState(false)

  // ---- load, importing a pre-upgrade exam exactly once ---------------------
  const load = useCallback(async () => {
    const fresh = await api.odontogram.get(examinationId)
    setData(fresh)
    return fresh
  }, [examinationId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        let fresh = await api.odontogram.get(examinationId)
        // Only ever when the odontogram holds NOTHING — see legacyBridge.needsLegacyImport.
        if (needsLegacyImport(fresh, legacyChart)) {
          const r = await api.odontogram.importLegacy(examinationId)
          if (r?.ok) {
            fresh = await api.odontogram.get(examinationId)
            if (alive) setImported(true)
          }
        }
        if (!alive) return
        setData(fresh)
        if (fresh.dentition) setDentition(fresh.dentition)
      } catch {
        if (alive) toast.push('Could not load the tooth chart', 'error')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
    // legacyChart is read once on open by design; re-importing on every change is exactly
    // the behaviour that would overwrite a chart the dentist is editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examinationId, refreshKey])

  // Keep the derived blob in step with the record, one-way, never the reverse.
  //
  // GUARD: never project an EMPTY odontogram over a legacy blob that still holds findings.
  // If the one-time import failed, the blob is the only surviving copy of that chart, and
  // the exam screen's autosave would write this projection straight over it. An empty
  // projection is only safe once we know there is nothing to lose.
  useEffect(() => {
    if (loading || !onProjectLegacy) return
    if (data.conditions.length === 0 && needsLegacyImport(data, legacyChart)) {
      toast.push(
        'The tooth chart could not be brought across from the previous version. It has been left untouched — please reopen this examination.',
        'error'
      )
      return
    }
    onProjectLegacy(projectToLegacy(data))
    // legacyChart is intentionally not a dependency: it is the projection's own output,
    // and depending on it would make this effect feed itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading, onProjectLegacy])

  const dropped = useMemo(() => droppedByLegacy(data), [data])
  const selected = tooth ? conditionsFor(data, tooth) : []

  // ---- editing -------------------------------------------------------------
  const addCondition = async (type: ConditionType) => {
    if (!tooth || readOnly) return
    const st = CONDITION_STYLE[type]
    const r = await api.odontogram.addCondition(examinationId, {
      tooth,
      type,
      status: type === 'extraction' ? 'planned' : type === 'caries' ? 'condition' : 'existing',
      zone: st.defaultZone,
      surfaces: surface ? [surface] : []
    })
    if (!r?.ok) return toast.push(r?.error || 'Could not add that finding', 'error')
    setSurface(null)
    await load()
  }

  const removeCondition = async (id: number) => {
    if (readOnly) return
    const r = await api.odontogram.deleteCondition(id)
    if (!r?.ok) return toast.push(r?.error || 'Could not remove that finding', 'error')
    await load()
  }

  const changeStatus = async (id: number, status: ClinicalStatus) => {
    if (readOnly) return
    const r = await api.odontogram.setStatus('condition', id, status)
    // The contract's state machine refuses illegal moves; say so instead of failing quietly.
    if (!r?.ok) return toast.push(r?.error || 'That status change is not allowed', 'error')
    await load()
  }

  const present = useMemo(() => {
    const set = new Set<ConditionType>()
    for (const c of data.conditions) set.add(c.type)
    return LEGEND_ORDER.filter((t) => set.has(t))
  }, [data.conditions])

  if (loading) return <div className="card"><span className="muted">Loading the tooth chart…</span></div>

  return (
    <div className="card odontogram-panel">
      {/* ---- toolbar ---- */}
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="card-title" style={{ fontSize: 14, margin: 0 }}>Tooth Chart</div>
        <span className="muted" style={{ fontSize: 12 }}>
          Universal notation · {new Set(data.conditions.map((c) => c.tooth)).size} charted
        </span>
        <div style={{ flex: 1 }} />
        <select
          value={dentition}
          onChange={(e) => setDentition(e.target.value as Dentition | 'mixed')}
          style={{ fontSize: 12, padding: '2px 6px', width: 'auto', flex: '0 0 auto' }}
          title="Which dentition to chart"
        >
          <option value="permanent">Permanent (1–32)</option>
          <option value="primary">Primary (A–T)</option>
          <option value="mixed">Mixed</option>
        </select>
        <button type="button" className="btn btn-sm btn-ghost" style={{ flex: '0 0 auto' }}
          onClick={() => setShowRoots((v) => !v)}
          title="Show or hide the root band. Implants, root canals and abscesses are root findings.">
          {showRoots ? 'Crowns only' : 'Show roots'}
        </button>
      </div>

      {imported && (
        <div className="alert" style={{ fontSize: 12.5, marginBottom: 8 }}>
          This examination was charted before the upgrade, so its findings were brought
          across into the new chart. The original chart was left untouched.
        </div>
      )}
      {dropped.length > 0 && (
        <div className="alert" style={{ fontSize: 12.5, marginBottom: 8 }}>
          <b>{dropped.length} primary tooth finding{dropped.length === 1 ? '' : 's'}</b>{' '}
          ({dropped.join(', ')}) cannot appear in the older printed report, which only has
          places for teeth 1–32. They are kept in full on this chart.
        </div>
      )}

      <Odontogram
        data={data}
        dentition={dentition}
        selectedTooth={tooth}
        selectedSurface={surface}
        onSelectTooth={(t) => { setTooth(t); setSurface(null) }}
        onSelectSurface={(t, s) => { setTooth(t); setSurface(s) }}
        showRoots={showRoots}
      />

      {/* ---- legend: colour AND pattern, only what is actually on this chart ---- */}
      {present.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {present.map((t) => (
            <span key={t} className="row" style={{ gap: 5, alignItems: 'center', fontSize: 11.5 }}>
              <svg width="14" height="14" aria-hidden>
                <rect width="14" height="14" rx="3" fill={CONDITION_STYLE[t].color} opacity={0.35} />
                <rect width="14" height="14" rx="3" fill="none" stroke={CONDITION_STYLE[t].color} strokeWidth="1.5" />
              </svg>
              {CONDITION_STYLE[t].label}
              <b>{data.conditions.filter((c) => c.type === t).length}</b>
            </span>
          ))}
        </div>
      )}

      {/* ---- tabs ---- */}
      <div className="row" style={{ gap: 4, marginTop: 12, borderBottom: '1px solid var(--border)' }}>
        {([['chart', 'Chart Details'], ['plans', 'Tx. Plans'], ['imaging', 'Imaging']] as [Tab, string][]).map(
          ([k, label]) => (
            <button key={k} type="button" className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(k)} aria-current={tab === k}>
              {label}
            </button>
          )
        )}
      </div>

      {tab === 'chart' && (
        <div style={{ paddingTop: 10 }}>
          {!tooth ? (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Select a tooth to record a finding. Click a surface to record it on that surface.
            </span>
          ) : (
            <>
              <div className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b>#{tooth}</b>
                <span className="muted" style={{ fontSize: 12 }}>{TOOTH_BY_ID.get(tooth)?.label}</span>
                {surface && <span className="pill">{surfaceShorthand([surface])} surface</span>}
              </div>

              {!readOnly && (
                <div className="row" style={{ gap: 5, flexWrap: 'wrap', margin: '8px 0' }}>
                  {QUICK.map((t) => (
                    <button key={t} type="button" className="btn btn-sm btn-ghost"
                      onClick={() => addCondition(t)}
                      style={{ borderLeft: `3px solid ${CONDITION_STYLE[t].color}` }}>
                      + {CONDITION_STYLE[t].label}
                    </button>
                  ))}
                </div>
              )}

              {selected.length === 0 ? (
                <span className="muted" style={{ fontSize: 12.5 }}>No findings on this tooth yet.</span>
              ) : (
                <table style={{ width: '100%', fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ textAlign: 'left' }}>Finding</th>
                      <th scope="col" style={{ textAlign: 'left' }}>Surfaces</th>
                      <th scope="col" style={{ textAlign: 'left' }}>Status</th>
                      <th scope="col" style={{ textAlign: 'left' }}>Recorded</th>
                      {!readOnly && <th scope="col" />}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <span style={{
                            display: 'inline-block', width: 9, height: 9, borderRadius: 2,
                            background: CONDITION_STYLE[c.type].color, marginRight: 6
                          }} />
                          {CONDITION_STYLE[c.type].label}
                          {isProposed(c.status) && <span className="muted"> (proposed)</span>}
                        </td>
                        <td>{c.surfaces.length ? surfaceShorthand(c.surfaces) : '—'}</td>
                        <td>
                          {readOnly ? (
                            STATUS_LABELS[c.status]
                          ) : (
                            <select value={c.status} style={{ fontSize: 12 }}
                              onChange={(e) => changeStatus(c.id, e.target.value as ClinicalStatus)}>
                              {(Object.keys(STATUS_LABELS) as ClinicalStatus[]).map((s) => (
                                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="muted">{(c.date_recorded || '').slice(0, 10)}</td>
                        {!readOnly && (
                          <td style={{ textAlign: 'right' }}>
                            <button type="button" className="btn btn-sm btn-ghost"
                              style={{ color: 'var(--danger)' }} onClick={() => removeCondition(c.id)}>
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'plans' && (
        <div style={{ paddingTop: 10 }}>
          <ProcedureLedger
            procedures={data.procedures}
            plans={data.plans}
            selectedTooth={tooth ?? undefined}
            onStatusChange={readOnly ? undefined : async (proc, status) => {
              const r = await api.odontogram.setStatus('procedure', proc.id, status)
              if (!r?.ok) return toast.push(r?.error || 'That status change is not allowed', 'error')
              await load()
            }}
          />
        </div>
      )}

      {tab === 'imaging' && (
        <div style={{ paddingTop: 10 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Images are attached to the patient record. Linking an individual x-ray to a tooth
            is not built yet — nothing here is hidden, there is simply nothing stored against
            a tooth to show.
          </span>
        </div>
      )}
    </div>
  )
}

export default OdontogramPanel

import { useState } from 'react'
import { CONDITIONS, SURFACES, CONDITION_LABELS, emptyToothState, TEETH } from '@shared/dental'
import type { ToothChartData, ToothConditionKey, SurfaceKey, ToothState } from '@shared/types'
import { COLORS } from '@shared/branding'
import {
  VIEW,
  computeLayout,
  archGuides,
  SHAPE_PATHS,
  decorFor,
  colorFor
} from './toothGeometry'

const LAYOUT = computeLayout()
const GUIDES = archGuides()
const labelByNumber = new Map(TEETH.map((t) => [t.number, t.label]))

export function ToothChart({
  value,
  onChange,
  readOnly = false
}: {
  value: ToothChartData
  onChange: (data: ToothChartData) => void
  readOnly?: boolean
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [brush, setBrush] = useState<ToothConditionKey | null>(null)

  const stateOf = (n: number): ToothState => value[n] ?? emptyToothState()

  const update = (n: number, partial: Partial<ToothState>) => {
    if (readOnly) return
    const next: ToothChartData = { ...value, [n]: { ...stateOf(n), ...partial } }
    onChange(next)
  }

  const clickTooth = (n: number) => {
    setSelected(n)
    if (brush) update(n, { condition: brush })
  }

  const counts = CONDITIONS.filter((c) => c.key !== 'unexamined').map((c) => ({
    ...c,
    count: Object.values(value).filter((s) => s?.condition === c.key).length
  }))
  const examined = Object.values(value).filter((s) => s && s.condition !== 'unexamined').length

  const sel = selected != null ? stateOf(selected) : null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 18, alignItems: 'start' }}>
      <div className="card" style={{ padding: 16 }}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>
            Tooth Chart
            <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
              Universal Numbering (1–32) · {examined}/32 examined
            </span>
          </div>
          <div className="muted" style={{ fontSize: 13, minHeight: 18 }}>
            {hovered ? `#${hovered} · ${labelByNumber.get(hovered)}` : 'Hover a tooth'}
          </div>
        </div>

        <div style={{ width: '100%' }}>
          <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} style={{ width: '100%', height: 'auto' }}>
            <text x={450} y={18} fontSize={13} fontWeight={700} fill={COLORS.muted} textAnchor="middle">
              UPPER
            </text>
            <text x={450} y={VIEW.h - 6} fontSize={13} fontWeight={700} fill={COLORS.muted} textAnchor="middle">
              LOWER
            </text>
            <path d={GUIDES.upper} fill="none" stroke={COLORS.azureSoft} strokeWidth={26} strokeLinecap="round" />
            <path d={GUIDES.lower} fill="none" stroke={COLORS.azureSoft} strokeWidth={26} strokeLinecap="round" />

            {LAYOUT.map((t) => {
              const isSel = selected === t.number
              const isHov = hovered === t.number
              return (
                <g key={t.number}>
                  <g
                    transform={`translate(${t.x} ${t.y}) rotate(${t.rot})`}
                    style={{ cursor: readOnly ? 'default' : 'pointer' }}
                    onClick={() => clickTooth(t.number)}
                    onMouseEnter={() => setHovered(t.number)}
                    onMouseLeave={() => setHovered((h) => (h === t.number ? null : h))}
                  >
                    {isSel && (
                      <path
                        d={SHAPE_PATHS[t.type]}
                        transform="scale(1.28)"
                        fill="none"
                        stroke={COLORS.azure}
                        strokeWidth={3}
                      />
                    )}
                    <path
                      d={SHAPE_PATHS[t.type]}
                      fill={colorFor(value, t.number)}
                      stroke={isHov ? COLORS.azure : COLORS.navy}
                      strokeWidth={isHov ? 2.2 : 1.4}
                    />
                    {decorFor(t.type).map((d, i) => (
                      <path key={i} d={d} fill="none" stroke={COLORS.navy} strokeWidth={1} opacity={0.3} />
                    ))}
                  </g>
                  <text
                    x={t.labelX}
                    y={t.labelY}
                    fontSize={12}
                    fontWeight={700}
                    fill={isSel ? COLORS.azure : COLORS.navy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ pointerEvents: 'none' }}
                  >
                    {t.number}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Legend / quick-paint brushes */}
        <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
          {!readOnly && (
            <button
              className="btn btn-sm"
              style={{ borderColor: brush === null ? COLORS.azure : undefined }}
              onClick={() => setBrush(null)}
            >
              ↖ Inspect
            </button>
          )}
          {CONDITIONS.filter((c) => c.key !== 'unexamined').map((c) => (
            <button
              key={c.key}
              className="btn btn-sm"
              title={c.description}
              onClick={() => !readOnly && setBrush(brush === c.key ? null : c.key)}
              style={{
                gap: 6,
                borderColor: brush === c.key ? COLORS.azure : undefined,
                boxShadow: brush === c.key ? '0 0 0 2px rgba(47,168,223,0.25)' : undefined
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 3,
                  background: c.color,
                  border: '1px solid rgba(0,0,0,0.2)',
                  display: 'inline-block'
                }}
              />
              {c.label}
              <b style={{ marginLeft: 2 }}>{counts.find((x) => x.key === c.key)?.count || 0}</b>
            </button>
          ))}
        </div>
        {!readOnly && brush && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Paint mode: click teeth to mark them <b>{CONDITION_LABELS[brush]}</b>. Click “Inspect” to stop.
          </div>
        )}
      </div>

      {/* Side panel */}
      <div className="card">
        {selected == null || !sel ? (
          <div className="empty" style={{ padding: '30px 6px' }}>
            <div style={{ fontSize: 30 }}>🦷</div>
            <p>Select a tooth to record its condition, surfaces, and notes.</p>
          </div>
        ) : (
          <div>
            <div className="card-title">
              Tooth #{selected}
              <span className="pill azure">{labelByNumber.get(selected)}</span>
            </div>

            <div className="field">
              <label>Condition</label>
              <div className="row wrap" style={{ gap: 6 }}>
                {CONDITIONS.map((c) => (
                  <button
                    key={c.key}
                    className="btn btn-sm"
                    disabled={readOnly}
                    onClick={() => update(selected, { condition: c.key })}
                    style={{
                      gap: 6,
                      borderColor: sel.condition === c.key ? COLORS.azure : undefined,
                      background: sel.condition === c.key ? COLORS.azureSoft : undefined
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: c.color,
                        border: '1px solid rgba(0,0,0,0.2)',
                        display: 'inline-block'
                      }}
                    />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Surfaces affected</label>
              <div className="row wrap" style={{ gap: 6 }}>
                {SURFACES.map((s) => {
                  const on = sel.surfaces.includes(s.key)
                  return (
                    <button
                      key={s.key}
                      className="btn btn-sm"
                      disabled={readOnly}
                      title={s.hint}
                      onClick={() => {
                        const surfaces = on
                          ? sel.surfaces.filter((x) => x !== s.key)
                          : [...sel.surfaces, s.key as SurfaceKey]
                        update(selected, { surfaces })
                      }}
                      style={{
                        borderColor: on ? COLORS.azure : undefined,
                        background: on ? COLORS.azureSoft : undefined
                      }}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="field">
              <label>Quick note</label>
              <textarea
                value={sel.note}
                disabled={readOnly}
                placeholder="e.g. Small cavity on distal surface"
                onChange={(e) => update(selected, { note: e.target.value })}
                style={{ minHeight: 70 }}
              />
            </div>

            {!readOnly && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => update(selected, { condition: 'unexamined', surfaces: [], note: '' })}
              >
                Clear this tooth
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

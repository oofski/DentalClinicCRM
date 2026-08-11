// The odontogram: one SVG figure per arch, every tooth a stack of layers.
//
// The chart it replaces stored ONE condition per tooth, so a bridge abutment that also had
// a distal filling and was flagged for review had to be charted as whichever of those three
// the dentist picked. Here each finding is its own layer, painted in clinical order, so a
// tooth shows everything that is true about it at once.
//
// Crowns and roots are drawn as separate bands per arch because several findings — implants,
// root canals, abscesses, apicoectomies — are root findings and are invisible on a chart
// that only draws crowns.

import { useMemo } from 'react'
import {
  ALL_TEETH, TOOTH_BY_ID, surfacesFor,
  type BridgeGroup, type Dentition, type OdontogramData, type SurfaceKey,
  type ToothCondition, type ToothId
} from '@shared/odontogram'
import { toothArt, ART_WIDTH, ART_HEIGHT, CERVICAL_Y } from './toothArt'
import { CONDITION_STYLE, patternDefs, paint, renderStyle, isProposed } from './conditionStyle'

// Slot geometry. Teeth are drawn in their own 100x160 frame and scaled into a slot.
const SLOT_W = 46
const SLOT_GAP = 3
const LABEL_H = 18
// Derived from the artwork's own frame, never guessed. Tooth and BridgeBars previously
// each computed this and disagreed, which put the connector bar at the wrong height for
// the teeth it was supposed to be joining.
const SCALE = SLOT_W / ART_WIDTH
const drawnHeight = (showRoots: boolean): number => (showRoots ? ART_HEIGHT : CERVICAL_Y) * SCALE

type RowKey = 'permanent-upper' | 'primary-upper' | 'primary-lower' | 'permanent-lower'

const ROW_TEETH: Record<RowKey, ToothId[]> = {
  // Viewer's left is the patient's right, which is how every dental chart is read.
  'permanent-upper': Array.from({ length: 16 }, (_, i) => String(i + 1)),
  'permanent-lower': Array.from({ length: 16 }, (_, i) => String(32 - i)),
  'primary-upper': 'ABCDEFGHIJ'.split(''),
  'primary-lower': 'TSRQPONMLK'.split('')
}

function rowsFor(dentition: Dentition | 'mixed'): RowKey[] {
  if (dentition === 'primary') return ['primary-upper', 'primary-lower']
  if (dentition === 'mixed') {
    return ['permanent-upper', 'primary-upper', 'primary-lower', 'permanent-lower']
  }
  return ['permanent-upper', 'permanent-lower']
}

const IS_UPPER: Record<RowKey, boolean> = {
  'permanent-upper': true, 'primary-upper': true, 'primary-lower': false, 'permanent-lower': false
}

export interface OdontogramProps {
  data: OdontogramData
  dentition?: Dentition | 'mixed'
  selectedTooth?: ToothId | null
  selectedSurface?: SurfaceKey | null
  onSelectTooth?: (tooth: ToothId) => void
  onSelectSurface?: (tooth: ToothId, surface: SurfaceKey) => void
  /** Hide the root band to get a compact crown-only chart. */
  showRoots?: boolean
  /** Draw the tooth number under each tooth. */
  showNumbers?: boolean
}

export function Odontogram({
  data,
  dentition,
  selectedTooth,
  selectedSurface,
  onSelectTooth,
  onSelectSurface,
  showRoots = true,
  showNumbers = true
}: OdontogramProps) {
  const dent = dentition ?? data.dentition ?? 'permanent'
  const rows = rowsFor(dent)

  // Findings grouped once, so a 32-tooth redraw is not 32 passes over the whole list.
  const byTooth = useMemo(() => {
    const m = new Map<ToothId, ToothCondition[]>()
    for (const c of data.conditions) {
      const list = m.get(c.tooth)
      if (list) list.push(c)
      else m.set(c.tooth, [c])
    }
    for (const list of m.values()) list.sort((a, b) => CONDITION_STYLE[a.type].z - CONDITION_STYLE[b.type].z)
    return m
  }, [data.conditions])

  const bridgesByTooth = useMemo(() => {
    const m = new Map<ToothId, BridgeGroup>()
    for (const b of data.bridges) for (const t of b.teeth) m.set(t, b)
    return m
  }, [data.bridges])

  const width = 16 * (SLOT_W + SLOT_GAP)
  const rowH = drawnHeight(showRoots) + LABEL_H

  return (
    <div className="odontogram" style={{ overflowX: 'auto' }}>
      <svg
        role="img"
        aria-label="Tooth chart"
        viewBox={`0 0 ${width} ${rows.length * rowH + 8}`}
        style={{ width: '100%', minWidth: 620, display: 'block' }}
      >
        <defs dangerouslySetInnerHTML={{ __html: patternDefs() }} />
        {rows.map((row, ri) => (
          <ArchRow
            key={row}
            row={row}
            y={ri * rowH}
            rowH={rowH}
            byTooth={byTooth}
            bridgesByTooth={bridgesByTooth}
            selectedTooth={selectedTooth}
            selectedSurface={selectedSurface}
            onSelectTooth={onSelectTooth}
            onSelectSurface={onSelectSurface}
            showRoots={showRoots}
            showNumbers={showNumbers}
          />
        ))}
      </svg>
    </div>
  )
}

interface RowProps {
  row: RowKey
  y: number
  rowH: number
  byTooth: Map<ToothId, ToothCondition[]>
  bridgesByTooth: Map<ToothId, BridgeGroup>
  selectedTooth?: ToothId | null
  selectedSurface?: SurfaceKey | null
  onSelectTooth?: (t: ToothId) => void
  onSelectSurface?: (t: ToothId, s: SurfaceKey) => void
  showRoots: boolean
  showNumbers: boolean
}

function ArchRow(p: RowProps) {
  const teeth = ROW_TEETH[p.row]
  const upper = IS_UPPER[p.row]
  // Primary rows have 10 teeth against the permanent 16, so they are centred rather than
  // stretched — a primary canine must not be drawn wider than a permanent one.
  const offset = ((16 - teeth.length) * (SLOT_W + SLOT_GAP)) / 2

  return (
    <g transform={`translate(0 ${p.y})`}>
      {teeth.map((id, i) => (
        <Tooth
          key={id}
          id={id}
          x={offset + i * (SLOT_W + SLOT_GAP)}
          upper={upper}
          conditions={p.byTooth.get(id) || []}
          selected={p.selectedTooth === id}
          selectedSurface={p.selectedTooth === id ? p.selectedSurface ?? null : null}
          onSelectTooth={p.onSelectTooth}
          onSelectSurface={p.onSelectSurface}
          showRoots={p.showRoots}
          showNumbers={p.showNumbers}
          rowH={p.rowH}
        />
      ))}
      <BridgeBars
        teeth={teeth}
        offset={offset}
        upper={upper}
        bridgesByTooth={p.bridgesByTooth}
        showRoots={p.showRoots}
        rowH={p.rowH}
      />
    </g>
  )
}

interface ToothProps {
  id: ToothId
  x: number
  upper: boolean
  conditions: ToothCondition[]
  selected: boolean
  selectedSurface: SurfaceKey | null
  onSelectTooth?: (t: ToothId) => void
  onSelectSurface?: (t: ToothId, s: SurfaceKey) => void
  showRoots: boolean
  showNumbers: boolean
  rowH: number
}

function Tooth(p: ToothProps) {
  const art = toothArt(p.id)
  const info = TOOTH_BY_ID.get(p.id)
  const scale = SCALE
  const drawnH = drawnHeight(p.showRoots)

  // Upper teeth hang root-up: flip vertically about the tooth's own centre so the crown
  // meets the occlusal plane in the middle of the chart, as in the mouth.
  const flip = p.upper ? `translate(0 ${drawnH}) scale(1 -1)` : ''
  const labelY = p.upper ? drawnH + LABEL_H - 5 : drawnH + LABEL_H - 5

  const surfaces = surfacesFor(p.id)
  const missing = p.conditions.some((c) => c.type === 'missing' && !isProposed(c.status))

  return (
    <g
      transform={`translate(${p.x} 2)`}
      className={`tooth${p.selected ? ' is-selected' : ''}`}
      onClick={() => p.onSelectTooth?.(p.id)}
      style={{ cursor: p.onSelectTooth ? 'pointer' : 'default' }}
    >
      <title>{`${p.id} — ${info?.label ?? ''}${p.conditions.length ? ': ' + p.conditions.map((c) => CONDITION_STYLE[c.type].label).join(', ') : ''}`}</title>

      {p.selected && (
        <rect x={-2} y={-2} width={SLOT_W + 4} height={drawnH + LABEL_H} rx={5}
          fill="rgba(44,155,214,0.10)" stroke="#2C9BD6" strokeWidth={1.5} />
      )}

      <g transform={`${flip} scale(${scale})`} opacity={missing ? 0.28 : 1}>
        {/* 1 — the tooth itself */}
        {p.showRoots && (
          <path d={art.root} fill="#F3E7D6" stroke="#8A7A63" strokeWidth={1.6} />
        )}
        <path d={art.crown} fill="#FDFCF8" stroke="#33415580" strokeWidth={1.8} />

        {/* 2 — root findings */}
        {p.showRoots &&
          p.conditions
            .filter((c) => (c.zone === 'root' || CONDITION_STYLE[c.type].defaultZone === 'root'))
            .map((c) => {
              const rs = renderStyle(c.type, c.status)
              return (
                <path key={`r${c.id}`} d={art.root} fill={paint(rs)} stroke={rs.stroke}
                  strokeWidth={rs.strokeWidth} strokeDasharray={rs.dash} opacity={rs.opacity} />
              )
            })}

        {/* 3 — findings on named surfaces */}
        {p.conditions
          .filter((c) => c.surfaces.length > 0)
          .map((c) => {
            const rs = renderStyle(c.type, c.status)
            return c.surfaces
              .filter((s) => art.surfaces[s])
              .map((s) => (
                <path key={`s${c.id}-${s}`} d={art.surfaces[s]} fill={paint(rs)} stroke={rs.stroke}
                  strokeWidth={rs.strokeWidth * 0.7} strokeDasharray={rs.dash} opacity={rs.opacity} />
              ))
          })}

        {/* 4 — whole-crown findings */}
        {p.conditions
          .filter((c) => c.surfaces.length === 0 &&
            (c.zone === 'crown' || (c.zone === 'whole' && CONDITION_STYLE[c.type].defaultZone !== 'root')))
          .map((c) => {
            const rs = renderStyle(c.type, c.status)
            return (
              <path key={`c${c.id}`} d={art.crown} fill={paint(rs)} stroke={rs.stroke}
                strokeWidth={rs.strokeWidth} strokeDasharray={rs.dash} opacity={rs.opacity} />
            )
          })}

        {/* 5 — anatomy detail, over the fills so it stays readable */}
        {!missing && art.cusps?.map((d, i) => (
          <path key={`k${i}`} d={d} fill="none" stroke="#64748B" strokeWidth={1} opacity={0.65} />
        ))}

        {/* 6 — clickable surface targets, invisible, always on top of the fills */}
        {p.onSelectSurface && !missing &&
          surfaces.filter((s) => art.surfaces[s]).map((s) => (
            <path
              key={`h${s}`}
              d={art.surfaces[s]}
              fill="transparent"
              stroke={p.selectedSurface === s ? '#2C9BD6' : 'transparent'}
              strokeWidth={2.5}
              style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); p.onSelectSurface?.(p.id, s) }}
            >
              <title>{`${p.id} ${s}`}</title>
            </path>
          ))}
      </g>

      {/* 7 — symbols, drawn unflipped so an X is never upside down */}
      <Symbols conditions={p.conditions} w={SLOT_W} h={drawnH} upper={p.upper} />

      {/* 8 — badges */}
      <Badges conditions={p.conditions} w={SLOT_W} upper={p.upper} h={drawnH} />

      {p.showNumbers && (
        <text x={SLOT_W / 2} y={labelY} textAnchor="middle" fontSize={11}
          fontWeight={p.selected ? 700 : 500} fill={p.selected ? '#1B6FA8' : '#475569'}>
          {p.id}
        </text>
      )}
    </g>
  )
}

function Symbols(
  { conditions, w, h, upper }: { conditions: ToothCondition[]; w: number; h: number; upper: boolean }
) {
  const cx = w / 2
  const cy = h / 2
  // Symbols are drawn outside the arch flip so text and arrowheads stay upright, which
  // means they have to be anchored by hand: on the upper arch the crown is at the BOTTOM
  // of the slot and the root at the top. Without this a crown cap is drawn over the root,
  // which on a chart reads as a post, not a crown.
  const crownY = upper ? h * 0.76 : h * 0.24
  const rootY = upper ? h * 0.22 : h * 0.72
  return (
    <>
      {conditions.map((c) => {
        const st = CONDITION_STYLE[c.type]
        if (!st.symbol) return null
        const rs = renderStyle(c.type, c.status)
        const k = `y${c.id}`
        if (st.symbol === 'x') {
          const r = w * 0.34
          return (
            <path key={k} d={`M${cx - r} ${cy - r} L${cx + r} ${cy + r} M${cx + r} ${cy - r} L${cx - r} ${cy + r}`}
              stroke={st.color} strokeWidth={3} strokeLinecap="round" fill="none" opacity={rs.opacity}
              strokeDasharray={rs.dash} />
          )
        }
        if (st.symbol === 'screw') {
          return (
            <g key={k} stroke={st.color} strokeWidth={1.6} fill="none" opacity={rs.opacity}>
              {[0, 1, 2, 3].map((i) => (
                <path key={i} d={`M${cx - 7} ${rootY - 9 + i * 6} L${cx + 7} ${rootY - 7 + i * 6}`} />
              ))}
            </g>
          )
        }
        if (st.symbol === 'cap') {
          return (
            <path key={k} d={`M${cx - w * 0.32} ${crownY} Q${cx} ${crownY + (upper ? 14 : -14)} ${cx + w * 0.32} ${crownY}`}
              stroke={st.color} strokeWidth={2.2} fill="none" opacity={rs.opacity} strokeDasharray={rs.dash} />
          )
        }
        if (st.symbol === 'flag') {
          return (
            <g key={k} opacity={rs.opacity}>
              <path d={`M${w - 9} 4 L${w - 9} 17`} stroke={st.color} strokeWidth={1.6} />
              <path d={`M${w - 9} 4 L${w - 2} 7 L${w - 9} 10 Z`} fill={st.color} />
            </g>
          )
        }
        if (st.symbol === 'arrow') {
          return (
            <path key={k} d={`M${cx} ${cy + 12} L${cx} ${cy - 10} M${cx - 5} ${cy - 5} L${cx} ${cy - 11} L${cx + 5} ${cy - 5}`}
              stroke={st.color} strokeWidth={2} fill="none" opacity={rs.opacity} />
          )
        }
        if (st.symbol === 'chevron') {
          return (
            <path key={k} d={`M${cx - 7} ${cy + 4} L${cx} ${cy - 3} L${cx + 7} ${cy + 4}`}
              stroke={st.color} strokeWidth={2.2} fill="none" opacity={rs.opacity} />
          )
        }
        return null
      })}
    </>
  )
}

/** Free text the clinic writes beside a tooth, independent of any condition colour. */
function Badges({ conditions, w, upper, h }: { conditions: ToothCondition[]; w: number; upper: boolean; h: number }) {
  const badges = conditions.filter((c) => c.badge)
  if (!badges.length) return null
  return (
    <>
      {badges.slice(0, 2).map((c, i) => {
        const y = upper ? 8 + i * 14 : h - 6 - i * 14
        return (
          <g key={`b${c.id}`}>
            <rect x={2} y={y - 8} width={15} height={13} rx={3} fill="#1E3A5F" />
            <text x={9.5} y={y + 1.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">
              {String(c.badge).slice(0, 2)}
            </text>
          </g>
        )
      })}
    </>
  )
}

/**
 * Bridges, dentures and splints span teeth, so they are drawn once across the arch rather
 * than per tooth — a bridge charted as three unrelated crowns is three separate pieces of
 * work, which is not what was fitted.
 */
function BridgeBars({
  teeth, offset, upper, bridgesByTooth, showRoots, rowH
}: {
  teeth: ToothId[]; offset: number; upper: boolean
  bridgesByTooth: Map<ToothId, BridgeGroup>; showRoots: boolean; rowH: number
}) {
  const seen = new Set<number>()
  const bars: JSX.Element[] = []
  const drawnH = drawnHeight(showRoots)

  for (const b of bridgesByTooth.values()) {
    if (seen.has(b.id)) continue
    seen.add(b.id)
    const idx = b.teeth.map((t) => teeth.indexOf(t)).filter((i) => i >= 0)
    if (idx.length < 2) continue
    const lo = Math.min(...idx)
    const hi = Math.max(...idx)
    const x1 = offset + lo * (SLOT_W + SLOT_GAP) + 4
    const x2 = offset + hi * (SLOT_W + SLOT_GAP) + SLOT_W - 4
    // Sit the bar on the cervical line — where a real connector runs — not across the
    // biting surface the dentist needs to read, and not down among the tooth numbers.
    const y = upper ? drawnH * 0.52 : drawnH * 0.48
    const proposed = isProposed(b.status)
    bars.push(
      <g key={`bg${b.id}`}>
        <path d={`M${x1} ${y} L${x2} ${y}`} stroke="#5B7FB4" strokeWidth={5} strokeLinecap="round"
          strokeDasharray={proposed ? '6 4' : ''} opacity={proposed ? 0.85 : 1} />
        <path d={`M${x1} ${y - 5} L${x1} ${y + 5} M${x2} ${y - 5} L${x2} ${y + 5}`}
          stroke="#5B7FB4" strokeWidth={3} strokeLinecap="round" />
        {b.label && (
          <text x={(x1 + x2) / 2} y={upper ? y - 9 : y + 15} textAnchor="middle" fontSize={9} fontWeight={700} fill="#5B7FB4">
            {b.label}
          </text>
        )}
      </g>
    )
  }
  return <>{bars}</>
}

export default Odontogram

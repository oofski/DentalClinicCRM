// How each finding is drawn: colour, pattern, and what the status does to it.
//
// ACCESSIBILITY IS THE REASON PATTERNS EXIST. The old chart said "healthy" with green and
// "needs treatment" with red — the single worst pairing for the ~8% of men with a red-green
// colour vision deficiency, on a screen where the difference decides whether a tooth gets
// drilled. Every condition here carries a distinct FILL PATTERN as well as a colour, so the
// chart is readable in greyscale, on a bad projector, and by a colour-blind dentist.
//
// Status is encoded by TREATMENT of the shape, not by another colour:
//   already in the mouth (existing/completed) -> solid fill, solid outline
//   found today, untreated (condition)        -> solid fill, heavier outline
//   proposed (planned/to_start/today)         -> hollow fill, DASHED outline
//   needs checking (to_review)                -> a flag badge on top
// so "is this done or proposed" is legible without reading a legend.

import type { ClinicalStatus, ConditionType } from '@shared/odontogram'

export type PatternKey =
  | 'none'
  | 'dots'
  | 'hatch'
  | 'crosshatch'
  | 'stipple'
  | 'vertical'
  | 'horizontal'
  | 'threads'
  | 'solid'

export interface ConditionStyle {
  label: string
  color: string
  pattern: PatternKey
  /** Where it draws: the crown zones, the root, or the whole tooth. */
  defaultZone: 'crown' | 'root' | 'whole'
  /** Drawn as a symbol over the tooth rather than a fill. */
  symbol?: 'x' | 'screw' | 'cap' | 'flag' | 'arrow' | 'dot' | 'chevron'
  /** Order within the layer stack; higher paints later, i.e. on top. */
  z: number
}

export const CONDITION_STYLE: Record<ConditionType, ConditionStyle> = {
  healthy:         { label: 'Healthy',            color: '#46B26A', pattern: 'none',       defaultZone: 'whole', z: 0 },
  caries:          { label: 'Caries',             color: '#F2C53D', pattern: 'dots',       defaultZone: 'crown', z: 30, symbol: 'dot' },
  restoration:     { label: 'Restoration',        color: '#3B82C4', pattern: 'hatch',      defaultZone: 'crown', z: 20 },
  crown:           { label: 'Crown',              color: '#7C8AA0', pattern: 'stipple',    defaultZone: 'crown', z: 40, symbol: 'cap' },
  veneer:          { label: 'Veneer',             color: '#8FB8DE', pattern: 'horizontal', defaultZone: 'crown', z: 35 },
  sealant:         { label: 'Sealant',            color: '#6FC2B0', pattern: 'horizontal', defaultZone: 'crown', z: 15 },
  root_canal:      { label: 'Root canal',         color: '#D9534F', pattern: 'vertical',   defaultZone: 'root',  z: 25 },
  post_core:       { label: 'Post & core',        color: '#B5651D', pattern: 'vertical',   defaultZone: 'root',  z: 26 },
  apicoectomy:     { label: 'Apicoectomy',        color: '#A0522D', pattern: 'crosshatch', defaultZone: 'root',  z: 27 },
  implant:         { label: 'Implant',            color: '#E8893B', pattern: 'threads',    defaultZone: 'root',  z: 45, symbol: 'screw' },
  bridge_abutment: { label: 'Bridge abutment',    color: '#5B7FB4', pattern: 'crosshatch', defaultZone: 'whole', z: 42 },
  bridge_pontic:   { label: 'Bridge pontic',      color: '#5B7FB4', pattern: 'hatch',      defaultZone: 'whole', z: 42 },
  denture:         { label: 'Denture',            color: '#9C7FC0', pattern: 'crosshatch', defaultZone: 'whole', z: 41 },
  extraction:      { label: 'Extraction',         color: '#9B59B6', pattern: 'solid',      defaultZone: 'whole', z: 60, symbol: 'x' },
  missing:         { label: 'Missing',            color: '#9AA7B2', pattern: 'none',       defaultZone: 'whole', z: 70, symbol: 'x' },
  impacted:        { label: 'Impacted',           color: '#C7913B', pattern: 'crosshatch', defaultZone: 'whole', z: 50, symbol: 'arrow' },
  unerupted:       { label: 'Unerupted',          color: '#B9C2CC', pattern: 'crosshatch', defaultZone: 'whole', z: 50 },
  fracture:        { label: 'Fracture',           color: '#E0524A', pattern: 'none',       defaultZone: 'whole', z: 55, symbol: 'chevron' },
  abscess:         { label: 'Abscess',            color: '#C0392B', pattern: 'dots',       defaultZone: 'root',  z: 52 },
  mobility:        { label: 'Mobility',           color: '#D68910', pattern: 'none',       defaultZone: 'root',  z: 48, symbol: 'chevron' },
  recession:       { label: 'Recession',          color: '#CD6155', pattern: 'horizontal', defaultZone: 'root',  z: 18 },
  watch:           { label: 'Watch',              color: '#E67E22', pattern: 'none',       defaultZone: 'whole', z: 58, symbol: 'flag' }
}

/** Statuses that mean the work is proposed rather than present in the mouth. */
const PROPOSED: ClinicalStatus[] = ['planned', 'to_start', 'today', 'in_progress', 'to_complete']

export function isProposed(status: ClinicalStatus): boolean {
  return PROPOSED.includes(status)
}

export interface RenderStyle {
  fill: string
  /** '' when the fill should be flat. */
  patternId: string
  stroke: string
  strokeWidth: number
  dash: string
  opacity: number
}

/**
 * Resolve a finding to concrete paint. Proposed work is deliberately hollow and dashed:
 * a chart where a planned crown looks the same as a fitted one is a chart that will
 * eventually get someone treated twice.
 */
export function renderStyle(type: ConditionType, status: ClinicalStatus): RenderStyle {
  const s = CONDITION_STYLE[type]
  const proposed = isProposed(status)
  const declined = status === 'declined'
  const patternId = s.pattern === 'none' || s.pattern === 'solid' ? '' : `pat-${s.pattern}-${type}`
  return {
    fill: proposed ? 'transparent' : s.color,
    patternId: proposed ? '' : patternId,
    stroke: s.color,
    strokeWidth: status === 'condition' ? 2.6 : proposed ? 2 : 1.4,
    dash: proposed ? '5 3' : declined ? '1 4' : '',
    opacity: declined ? 0.45 : 1
  }
}

// ---------------------------------------------------------------------------
// Pattern tiles
// ---------------------------------------------------------------------------

/** The <defs> geometry for one pattern tile, in a 6x6 user-space box. */
export const PATTERN_TILE: Record<Exclude<PatternKey, 'none' | 'solid'>, string> = {
  dots: '<circle cx="1.5" cy="1.5" r="1.1"/><circle cx="4.5" cy="4.5" r="1.1"/>',
  hatch: '<path d="M-1 1 L1 -1 M0 6 L6 0 M5 7 L7 5" stroke-width="1.4" fill="none"/>',
  crosshatch:
    '<path d="M0 6 L6 0 M-1 1 L1 -1 M5 7 L7 5 M0 0 L6 6 M-1 5 L1 7 M5 -1 L7 1" stroke-width="1.1" fill="none"/>',
  stipple: '<circle cx="1" cy="1" r="0.6"/><circle cx="4" cy="2" r="0.6"/><circle cx="2" cy="4.5" r="0.6"/><circle cx="5" cy="5" r="0.6"/>',
  vertical: '<path d="M1.5 0 L1.5 6 M4.5 0 L4.5 6" stroke-width="1.3" fill="none"/>',
  horizontal: '<path d="M0 1.5 L6 1.5 M0 4.5 L6 4.5" stroke-width="1.3" fill="none"/>',
  threads: '<path d="M0 1 L6 2 M0 4 L6 5" stroke-width="1.2" fill="none"/>'
}

/** Every pattern the chart could need, as <pattern> elements for a single <defs>. */
export function patternDefs(): string {
  const out: string[] = []
  for (const [type, style] of Object.entries(CONDITION_STYLE)) {
    if (style.pattern === 'none' || style.pattern === 'solid') continue
    const tile = PATTERN_TILE[style.pattern as Exclude<PatternKey, 'none' | 'solid'>]
    out.push(
      `<pattern id="pat-${style.pattern}-${type}" width="6" height="6" patternUnits="userSpaceOnUse">` +
        `<rect width="6" height="6" fill="${style.color}" fill-opacity="0.28"/>` +
        `<g fill="${style.color}" stroke="${style.color}">${tile}</g>` +
        `</pattern>`
    )
  }
  return out.join('')
}

/** Paint value for a shape: a pattern reference when there is one, else the flat colour. */
export function paint(rs: RenderStyle): string {
  return rs.patternId ? `url(#${rs.patternId})` : rs.fill
}

/** Legend rows, in the order a dentist scans them. */
export const LEGEND_ORDER: ConditionType[] = [
  'healthy', 'caries', 'restoration', 'crown', 'veneer', 'sealant',
  'root_canal', 'post_core', 'implant', 'bridge_abutment', 'bridge_pontic', 'denture',
  'extraction', 'missing', 'impacted', 'unerupted', 'fracture', 'abscess',
  'mobility', 'recession', 'apicoectomy', 'watch'
]

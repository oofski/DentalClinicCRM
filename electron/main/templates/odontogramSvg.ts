// The odontogram, drawn server-side as a plain SVG string for the printed record.
//
// WHY THIS FILE EXISTS
//
// The patient PDF used to render `examinations.tooth_chart_data`: one condition per tooth,
// keyed 1-32. That format cannot say "primary tooth K" at all, cannot say "crowned AND
// carious", and cannot tell a planned extraction from one already done. A printed record
// that silently drops findings is the failure this file removes.
//
// THE ONE RULE HERE: NOTHING IS REDRAWN OR RECOLOURED LOCALLY.
//
// The artwork comes from toothArt() and the palette from CONDITION_STYLE / renderStyle(),
// the same modules the on-screen chart uses. A copy of either would be a second medical
// drawing that drifts from the first, and the drift would only ever be discovered on paper.
// Only the *layout* (slot size, row order, gutter) lives here, mirroring Odontogram.tsx.
//
// PATTERNS ARE NOT DECORATION. Every condition carries a fill pattern as well as a colour
// because printed charts get photocopied, faxed and read in greyscale, and because a
// red-green deficient reader gets no information from colour at all. A flat-colour chart
// is unreadable exactly where it matters most.
//
// Pure string output: no React, no DOM, no database. Safe to call from the main process,
// from a test, or from a script.

import {
  ALL_TEETH,
  TOOTH_BY_ID,
  isPrimary,
  type BridgeGroup,
  type ClinicalStatus,
  type ConditionType,
  type Dentition,
  type OdontogramData,
  type ToothCondition,
  type ToothId
} from '@shared/odontogram'
// The screen's geometry and palette. Imported, never reimplemented — see the note above.
import {
  ART_HEIGHT,
  ART_WIDTH,
  CERVICAL_Y,
  toothArt
} from '../../../src/components/odontogram/toothArt'
import {
  CONDITION_STYLE,
  LEGEND_ORDER,
  isProposed,
  paint,
  patternDefs,
  renderStyle,
  type RenderStyle
} from '../../../src/components/odontogram/conditionStyle'
import { esc } from './util'

// ---------------------------------------------------------------------------
// Layout — mirrors src/components/odontogram/Odontogram.tsx
// ---------------------------------------------------------------------------

const SLOT_W = 46
const SLOT_GAP = 3
const LABEL_H = 18
/** Room on the left for the arch caption, so it never sits on top of tooth 1. */
const GUTTER = 58
const SCALE = SLOT_W / ART_WIDTH

const drawnHeight = (showRoots: boolean): number => (showRoots ? ART_HEIGHT : CERVICAL_Y) * SCALE

/** Total viewBox width: the gutter plus sixteen slots, whatever the row actually holds. */
export const CHART_WIDTH = GUTTER + 16 * (SLOT_W + SLOT_GAP)

type RowKey = 'permanent-upper' | 'primary-upper' | 'primary-lower' | 'permanent-lower'

const ROW_TEETH: Record<RowKey, ToothId[]> = {
  // Viewer's left is the patient's right, which is how every dental chart is read.
  'permanent-upper': Array.from({ length: 16 }, (_, i) => String(i + 1)),
  'permanent-lower': Array.from({ length: 16 }, (_, i) => String(32 - i)),
  'primary-upper': 'ABCDEFGHIJ'.split(''),
  'primary-lower': 'TSRQPONMLK'.split('')
}

const IS_UPPER: Record<RowKey, boolean> = {
  'permanent-upper': true,
  'primary-upper': true,
  'primary-lower': false,
  'permanent-lower': false
}

function rowsFor(dentition: Dentition | 'mixed'): RowKey[] {
  if (dentition === 'primary') return ['primary-upper', 'primary-lower']
  if (dentition === 'mixed') {
    return ['permanent-upper', 'primary-upper', 'primary-lower', 'permanent-lower']
  }
  return ['permanent-upper', 'permanent-lower']
}

// ---------------------------------------------------------------------------
// Small emitters
// ---------------------------------------------------------------------------

function fmt(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`odontogramSvg: non-finite coordinate ${String(v)}`)
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

/** An attribute, or nothing at all when the value is empty — never `dash=""` noise. */
function attr(name: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return ''
  return ` ${name}="${typeof value === 'number' ? fmt(value) : esc(value)}"`
}

/**
 * Pattern ids are namespaced per SVG so a document holding both the chart and the legend
 * has no duplicate ids. The tiles themselves still come from patternDefs().
 */
function scopedDefs(prefix: string): string {
  return patternDefs().replace(/id="pat-/g, `id="${prefix}pat-`)
}

/** The paint for a finding: its pattern when it has one, else the flat colour from paint(). */
function fillOf(rs: RenderStyle, prefix: string): string {
  return rs.patternId ? `url(#${prefix}${rs.patternId})` : paint(rs)
}

function shapeAttrs(rs: RenderStyle, prefix: string, strokeScale = 1): string {
  return (
    attr('fill', fillOf(rs, prefix)) +
    attr('stroke', rs.stroke) +
    attr('stroke-width', rs.strokeWidth * strokeScale) +
    attr('stroke-dasharray', rs.dash) +
    (rs.opacity === 1 ? '' : attr('opacity', rs.opacity))
  )
}

// ---------------------------------------------------------------------------
// Symbols
//
// Drawn outside the arch flip so an X or an arrow is never upside down, and shared with the
// legend by parameterising the box: the chart passes a tooth slot, the legend a 24x24 swatch.
// ---------------------------------------------------------------------------

function symbolMarkup(
  type: ConditionType,
  status: ClinicalStatus,
  w: number,
  h: number,
  upper: boolean
): string {
  const st = CONDITION_STYLE[type]
  if (!st.symbol) return ''
  const rs = renderStyle(type, status)
  const cx = w / 2
  const cy = h / 2
  // On the upper arch the crown sits at the BOTTOM of the slot and the root at the top.
  // Without this a crown cap lands over the root, which on a chart reads as a post.
  const crownY = upper ? h * 0.76 : h * 0.24
  const rootY = upper ? h * 0.22 : h * 0.72
  const common = (rs.opacity === 1 ? '' : attr('opacity', rs.opacity))

  if (st.symbol === 'x') {
    const r = w * 0.34
    return (
      `<path d="M${fmt(cx - r)} ${fmt(cy - r)} L${fmt(cx + r)} ${fmt(cy + r)} ` +
      `M${fmt(cx + r)} ${fmt(cy - r)} L${fmt(cx - r)} ${fmt(cy + r)}"` +
      attr('stroke', st.color) +
      ' stroke-width="3" stroke-linecap="round" fill="none"' +
      attr('stroke-dasharray', rs.dash) +
      common +
      '/>'
    )
  }
  if (st.symbol === 'screw') {
    const lines = [0, 1, 2, 3]
      .map(
        (i) =>
          `<path d="M${fmt(cx - 7)} ${fmt(rootY - 9 + i * 6)} L${fmt(cx + 7)} ${fmt(rootY - 7 + i * 6)}"/>`
      )
      .join('')
    return `<g${attr('stroke', st.color)} stroke-width="1.6" fill="none"${common}>${lines}</g>`
  }
  if (st.symbol === 'cap') {
    return (
      `<path d="M${fmt(cx - w * 0.32)} ${fmt(crownY)} Q${fmt(cx)} ${fmt(crownY + (upper ? 14 : -14))} ${fmt(cx + w * 0.32)} ${fmt(crownY)}"` +
      attr('stroke', st.color) +
      ' stroke-width="2.2" fill="none"' +
      attr('stroke-dasharray', rs.dash) +
      common +
      '/>'
    )
  }
  if (st.symbol === 'flag') {
    return (
      `<g${common}>` +
      `<path d="M${fmt(w - 9)} 4 L${fmt(w - 9)} 17"${attr('stroke', st.color)} stroke-width="1.6"/>` +
      `<path d="M${fmt(w - 9)} 4 L${fmt(w - 2)} 7 L${fmt(w - 9)} 10 Z"${attr('fill', st.color)}/>` +
      `</g>`
    )
  }
  if (st.symbol === 'arrow') {
    return (
      `<path d="M${fmt(cx)} ${fmt(cy + 12)} L${fmt(cx)} ${fmt(cy - 10)} ` +
      `M${fmt(cx - 5)} ${fmt(cy - 5)} L${fmt(cx)} ${fmt(cy - 11)} L${fmt(cx + 5)} ${fmt(cy - 5)}"` +
      attr('stroke', st.color) +
      ' stroke-width="2" fill="none"' +
      common +
      '/>'
    )
  }
  if (st.symbol === 'chevron') {
    return (
      `<path d="M${fmt(cx - 7)} ${fmt(cy + 4)} L${fmt(cx)} ${fmt(cy - 3)} L${fmt(cx + 7)} ${fmt(cy + 4)}"` +
      attr('stroke', st.color) +
      ' stroke-width="2.2" fill="none"' +
      common +
      '/>'
    )
  }
  // 'dot' has no drawn glyph on the chart: caries is read from its fill and its pattern.
  return ''
}

// ---------------------------------------------------------------------------
// Input hygiene
//
// A report must render even if one row in the database is junk. Anything the artwork or the
// palette cannot describe is dropped here rather than thrown at toothArt(), which would
// abort the whole PDF over a single bad tooth id.
// ---------------------------------------------------------------------------

export function isChartable(c: ToothCondition): boolean {
  return !!c && TOOTH_BY_ID.has(c.tooth) && !!CONDITION_STYLE[c.type]
}

/** Findings per tooth, painted bottom-up in the palette's own z order. */
function groupByTooth(conditions: ToothCondition[]): Map<ToothId, ToothCondition[]> {
  const m = new Map<ToothId, ToothCondition[]>()
  for (const c of conditions) {
    if (!isChartable(c)) continue
    const list = m.get(c.tooth)
    if (list) list.push(c)
    else m.set(c.tooth, [c])
  }
  for (const [id, list] of m) {
    m.set(
      id,
      [...list].sort((a, b) => CONDITION_STYLE[a.type].z - CONDITION_STYLE[b.type].z)
    )
  }
  return m
}

/** Every condition type that actually appears on this chart, in the legend's reading order. */
export function conditionsPresent(data: OdontogramData): ConditionType[] {
  const seen = new Set<ConditionType>()
  for (const c of data.conditions || []) if (isChartable(c)) seen.add(c.type)
  return LEGEND_ORDER.filter((t) => seen.has(t))
}

/** How many teeth carry each condition — the count a dentist reads off the legend. */
export function conditionCounts(data: OdontogramData): Map<ConditionType, number> {
  const teeth = new Map<ConditionType, Set<ToothId>>()
  for (const c of data.conditions || []) {
    if (!isChartable(c)) continue
    const set = teeth.get(c.type) ?? new Set<ToothId>()
    set.add(c.tooth)
    teeth.set(c.type, set)
  }
  const out = new Map<ConditionType, number>()
  for (const [type, set] of teeth) out.set(type, set.size)
  return out
}

/** True when this exam has a real odontogram, i.e. the legacy chart is not the record. */
export function hasOdontogramContent(data: OdontogramData | null | undefined): boolean {
  if (!data) return false
  return (
    (data.conditions || []).some(isChartable) ||
    (data.bridges || []).length > 0 ||
    (data.procedures || []).length > 0
  )
}

/** Teeth in chart order (1-32, then A-T) — the order the findings table is read in. */
const TOOTH_ORDER = new Map<ToothId, number>(ALL_TEETH.map((t, i) => [t.id, i]))
export function compareTeeth(a: ToothId, b: ToothId): number {
  return (TOOTH_ORDER.get(a) ?? 999) - (TOOTH_ORDER.get(b) ?? 999)
}

// ---------------------------------------------------------------------------
// One tooth
// ---------------------------------------------------------------------------

function toothMarkup(
  id: ToothId,
  x: number,
  upper: boolean,
  conditions: ToothCondition[],
  showRoots: boolean,
  showNumbers: boolean,
  prefix: string
): string {
  const art = toothArt(id)
  const info = TOOTH_BY_ID.get(id)
  const drawnH = drawnHeight(showRoots)
  // Upper teeth hang root-up: flip about the tooth's own centre so the crown meets the
  // occlusal plane in the middle of the chart, as in the mouth.
  const flip = upper ? `translate(0 ${fmt(drawnH)}) scale(1 -1) ` : ''
  const missing = conditions.some((c) => c.type === 'missing' && !isProposed(c.status))

  const out: string[] = []
  const title = `${id} — ${info?.label ?? ''}${
    conditions.length ? ': ' + conditions.map((c) => CONDITION_STYLE[c.type].label).join(', ') : ''
  }`
  out.push(`<title>${esc(title)}</title>`)

  const art_: string[] = []

  // 1 — the tooth itself
  if (showRoots) {
    art_.push(`<path d="${art.root}" fill="#F3E7D6" stroke="#8A7A63" stroke-width="1.6"/>`)
  }
  art_.push(`<path d="${art.crown}" fill="#FDFCF8" stroke="#33415580" stroke-width="1.8"/>`)

  // 2 — root findings (implants, root canals, abscesses: invisible on a crown-only chart)
  if (showRoots) {
    for (const c of conditions) {
      if (!(c.zone === 'root' || CONDITION_STYLE[c.type].defaultZone === 'root')) continue
      const rs = renderStyle(c.type, c.status)
      art_.push(
        `<path d="${art.root}"${shapeAttrs(rs, prefix)}` +
          attr('data-condition', c.type) +
          attr('data-status', c.status) +
          ' data-layer="root"/>'
      )
    }
  }

  // 3 — findings on named surfaces (an MO filling shades exactly two zones)
  for (const c of conditions) {
    if (!c.surfaces || c.surfaces.length === 0) continue
    const rs = renderStyle(c.type, c.status)
    for (const s of c.surfaces) {
      const d = art.surfaces[s]
      if (!d) continue
      art_.push(
        `<path d="${d}"${shapeAttrs(rs, prefix, 0.7)}` +
          attr('data-condition', c.type) +
          attr('data-status', c.status) +
          attr('data-surface', s) +
          ' data-layer="surface"/>'
      )
    }
  }

  // 4 — whole-crown findings
  for (const c of conditions) {
    if (c.surfaces && c.surfaces.length > 0) continue
    const crownish =
      c.zone === 'crown' ||
      (c.zone === 'whole' && CONDITION_STYLE[c.type].defaultZone !== 'root')
    if (!crownish) continue
    const rs = renderStyle(c.type, c.status)
    art_.push(
      `<path d="${art.crown}"${shapeAttrs(rs, prefix)}` +
        attr('data-condition', c.type) +
        attr('data-status', c.status) +
        ' data-layer="crown"/>'
    )
  }

  // 5 — anatomy detail, over the fills so it stays readable
  if (!missing) {
    for (const d of art.cusps ?? []) {
      art_.push(`<path d="${d}" fill="none" stroke="#64748B" stroke-width="1" opacity="0.65"/>`)
    }
  }

  out.push(
    `<g transform="${flip}scale(${fmt(SCALE)})"${missing ? ' opacity="0.28"' : ''}>${art_.join('')}</g>`
  )

  // 6 — symbols, drawn unflipped so an X is never upside down
  for (const c of conditions) {
    const sym = symbolMarkup(c.type, c.status, SLOT_W, drawnH, upper)
    if (sym) {
      out.push(
        `<g${attr('data-symbol', c.type)}${attr('data-status', c.status)}>${sym}</g>`
      )
    }
  }

  // 7 — badges: free text the clinic writes beside a tooth, independent of condition colour
  const badges = conditions.filter((c) => c.badge)
  badges.slice(0, 2).forEach((c, i) => {
    const y = upper ? 8 + i * 14 : drawnH - 6 - i * 14
    out.push(
      `<g data-badge="1"><rect x="2" y="${fmt(y - 8)}" width="15" height="13" rx="3" fill="#1E3A5F"/>` +
        `<text x="9.5" y="${fmt(y + 1.5)}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">` +
        `${esc(String(c.badge).slice(0, 2))}</text></g>`
    )
  })

  if (showNumbers) {
    out.push(
      `<text x="${fmt(SLOT_W / 2)}" y="${fmt(drawnH + LABEL_H - 5)}" text-anchor="middle" ` +
        `font-size="11" font-weight="600" fill="#475569">${esc(id)}</text>`
    )
  }

  return `<g transform="translate(${fmt(x)} 2)" class="tooth" data-tooth="${esc(id)}">${out.join('')}</g>`
}

// ---------------------------------------------------------------------------
// Bridges, dentures, splints
//
// Drawn once across the arch rather than per tooth: a bridge charted as three unrelated
// crowns is three separate pieces of work, which is not what was fitted.
// ---------------------------------------------------------------------------

function bridgeMarkup(
  bridges: BridgeGroup[],
  teeth: ToothId[],
  offset: number,
  upper: boolean,
  drawnH: number
): string {
  const out: string[] = []
  for (const b of bridges) {
    const idx = (b.teeth || []).map((t) => teeth.indexOf(t)).filter((i) => i >= 0)
    if (idx.length < 2) continue
    const lo = Math.min(...idx)
    const hi = Math.max(...idx)
    const x1 = offset + lo * (SLOT_W + SLOT_GAP) + 4
    const x2 = offset + hi * (SLOT_W + SLOT_GAP) + SLOT_W - 4
    // On the cervical line, where a real connector runs — not across the biting surface
    // the dentist needs to read, and not down among the tooth numbers.
    const y = upper ? drawnH * 0.52 : drawnH * 0.48
    const proposed = isProposed(b.status)
    out.push(
      `<g data-bridge="${esc(String(b.id))}"${attr('data-status', b.status)}>` +
        `<path d="M${fmt(x1)} ${fmt(y)} L${fmt(x2)} ${fmt(y)}" stroke="#5B7FB4" stroke-width="5" ` +
        `stroke-linecap="round"${attr('stroke-dasharray', proposed ? '6 4' : '')}` +
        `${proposed ? ' opacity="0.85"' : ''} fill="none"/>` +
        `<path d="M${fmt(x1)} ${fmt(y - 5)} L${fmt(x1)} ${fmt(y + 5)} M${fmt(x2)} ${fmt(y - 5)} L${fmt(x2)} ${fmt(y + 5)}" ` +
        `stroke="#5B7FB4" stroke-width="3" stroke-linecap="round" fill="none"/>` +
        (b.label
          ? `<text x="${fmt((x1 + x2) / 2)}" y="${fmt(upper ? y - 9 : y + 15)}" text-anchor="middle" ` +
            `font-size="9" font-weight="700" fill="#5B7FB4">${esc(b.label)}</text>`
          : '') +
        `</g>`
    )
  }
  return out.join('')
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

export interface OdontogramSvgOptions {
  /** Override the dentition the data reports; 'mixed' draws permanent AND primary rows. */
  dentition?: Dentition | 'mixed'
  /** Draw the root band. Root canals, implants and abscesses are invisible without it. */
  showRoots?: boolean
  showNumbers?: boolean
  /** Namespace for the pattern ids, so several charts can share one HTML document. */
  idPrefix?: string
  /** Set false when another SVG in the same document already emitted the pattern tiles. */
  includeDefs?: boolean
  /** Arch captions. Translated by the caller; English is only the standalone default. */
  labels?: { upper?: string; lower?: string; primary?: string }
  /** Accessible name for the figure. */
  title?: string
}

/**
 * The whole chart as one standalone `<svg>` string: colour and pattern per finding, several
 * findings per tooth, primary teeth included, planned work dashed and hollow.
 */
export function buildOdontogramSvg(data: OdontogramData, opts: OdontogramSvgOptions = {}): string {
  const showRoots = opts.showRoots !== false
  const showNumbers = opts.showNumbers !== false
  const prefix = opts.idPrefix ?? 'og-'
  const labels = {
    upper: opts.labels?.upper ?? 'UPPER',
    lower: opts.labels?.lower ?? 'LOWER',
    primary: opts.labels?.primary ?? 'PRIMARY'
  }

  const dentition = opts.dentition ?? data.dentition ?? 'permanent'
  const rows = rowsFor(dentition)
  const byTooth = groupByTooth(data.conditions || [])
  const bridges = (data.bridges || []).filter((b) => (b.teeth || []).length >= 2)

  const drawnH = drawnHeight(showRoots)
  const rowH = drawnH + LABEL_H
  const height = rows.length * rowH + 8

  const body: string[] = []
  rows.forEach((row, ri) => {
    const teeth = ROW_TEETH[row]
    const upper = IS_UPPER[row]
    // Primary rows hold ten teeth against the permanent sixteen, so they are centred rather
    // than stretched: a primary canine must never be drawn wider than a permanent one.
    const offset = GUTTER + ((16 - teeth.length) * (SLOT_W + SLOT_GAP)) / 2
    const primary = isPrimary(teeth[0])

    const caption =
      `<text x="${fmt(GUTTER - 10)}" y="${fmt(drawnH / 2 + (primary ? -2 : 4))}" text-anchor="end" ` +
      `font-size="9.5" font-weight="700" fill="#5A6B7B" letter-spacing="0.4">` +
      `${esc(upper ? labels.upper : labels.lower)}</text>` +
      (primary
        ? `<text x="${fmt(GUTTER - 10)}" y="${fmt(drawnH / 2 + 10)}" text-anchor="end" ` +
          `font-size="8.5" font-weight="700" fill="#8A98A6" letter-spacing="0.4">${esc(labels.primary)}</text>`
        : '')

    const drawn = teeth
      .map((id, i) =>
        toothMarkup(
          id,
          offset + i * (SLOT_W + SLOT_GAP),
          upper,
          byTooth.get(id) || [],
          showRoots,
          showNumbers,
          prefix
        )
      )
      .join('')

    body.push(
      `<g transform="translate(0 ${fmt(ri * rowH)})" data-row="${row}">` +
        caption +
        drawn +
        bridgeMarkup(bridges, teeth, offset, upper, drawnH) +
        `</g>`
    )
  })

  const defs = opts.includeDefs === false ? '' : `<defs>${scopedDefs(prefix)}</defs>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(opts.title ?? 'Tooth chart')}" ` +
    `viewBox="0 0 ${fmt(CHART_WIDTH)} ${fmt(height)}" width="${fmt(CHART_WIDTH)}" height="${fmt(height)}">` +
    defs +
    `<title>${esc(opts.title ?? 'Tooth chart')}</title>` +
    body.join('') +
    `</svg>`
  )
}

// ---------------------------------------------------------------------------
// The legend
// ---------------------------------------------------------------------------

export interface OdontogramLegendOptions {
  idPrefix?: string
  includeDefs?: boolean
  /** Show "(3)" after each condition — how many teeth carry it. */
  showCounts?: boolean
  /** The two status keys under the conditions; the printed chart is unreadable without them. */
  statusLabels?: { present?: string; proposed?: string }
  columns?: number
}

/**
 * A key for exactly the conditions this chart uses — nothing else. A legend listing all
 * twenty-two conditions on a chart that shows three is a legend nobody reads.
 */
export function buildOdontogramLegend(
  data: OdontogramData,
  opts: OdontogramLegendOptions = {}
): string {
  const prefix = opts.idPrefix ?? 'ogl-'
  const present = conditionsPresent(data)
  const counts = conditionCounts(data)
  const cols = Math.max(1, opts.columns ?? 4)
  const showCounts = opts.showCounts !== false
  const statusPresent = opts.statusLabels?.present ?? 'Solid outline: already in the mouth'
  const statusProposed = opts.statusLabels?.proposed ?? 'Dashed, hollow: planned, not yet done'

  const colW = CHART_WIDTH / cols
  const rowH = 20
  const rows = Math.ceil(present.length / cols) || 0
  const statusY = rows * rowH + 6
  const height = statusY + 20

  const items = present.map((type, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * colW + 2
    const y = row * rowH + 2
    // The swatch is drawn as work already present so the pattern reads at full strength;
    // the dashed/hollow treatment of proposed work is spelled out in the status keys below.
    const rs = renderStyle(type, 'existing')
    const label = CONDITION_STYLE[type].label + (showCounts ? ` (${counts.get(type) ?? 0})` : '')
    const s = 0.66
    const sym = symbolMarkup(type, 'existing', 24, 24, false)
    // A symbol is drawn in the condition's own colour, so on a solid swatch of that same
    // colour it disappears — an X key that shows no X. Lighten the swatch under a symbol.
    const wash = sym ? ' fill-opacity="0.4"' : ''
    return (
      `<g data-legend="${esc(type)}">` +
      `<rect x="${fmt(x)}" y="${fmt(y)}" width="22" height="15" rx="2"${shapeAttrs(rs, prefix)}${wash}/>` +
      (sym
        ? `<g transform="translate(${fmt(x + 11 - 12 * s)} ${fmt(y + 7.5 - 12 * s)}) scale(${s})">${sym}</g>`
        : '') +
      `<text x="${fmt(x + 29)}" y="${fmt(y + 11.5)}" font-size="10.5" fill="#1B2B40">${esc(label)}</text>` +
      `</g>`
    )
  })

  const keyX = 2
  const key2X = CHART_WIDTH / 2
  const statusKeys =
    `<g data-legend-status="present">` +
    `<rect x="${fmt(keyX)}" y="${fmt(statusY)}" width="22" height="15" rx="2" fill="#CBD5E1" stroke="#475569" stroke-width="1.6"/>` +
    `<text x="${fmt(keyX + 29)}" y="${fmt(statusY + 11.5)}" font-size="10.5" fill="#1B2B40">${esc(statusPresent)}</text>` +
    `</g>` +
    `<g data-legend-status="proposed">` +
    `<rect x="${fmt(key2X)}" y="${fmt(statusY)}" width="22" height="15" rx="2" fill="none" stroke="#475569" stroke-width="2" stroke-dasharray="5 3"/>` +
    `<text x="${fmt(key2X + 29)}" y="${fmt(statusY + 11.5)}" font-size="10.5" fill="#1B2B40">${esc(statusProposed)}</text>` +
    `</g>`

  const defs = opts.includeDefs === false ? '' : `<defs>${scopedDefs(prefix)}</defs>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Chart key" ` +
    `viewBox="0 0 ${fmt(CHART_WIDTH)} ${fmt(height)}" width="${fmt(CHART_WIDTH)}" height="${fmt(height)}">` +
    defs +
    items.join('') +
    statusKeys +
    `</svg>`
  )
}

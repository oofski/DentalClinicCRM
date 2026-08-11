// Hand-authored tooth artwork: one layered, anatomically-shaped drawing per tooth.
//
// Pure data — no React, no DOM, no dependencies beyond the odontogram contract. Every
// export is a plain SVG path 'd' string in a fixed local frame, so the chart, the printed
// report and any future canvas renderer can all draw the same teeth.
//
// THE LOCAL FRAME  (0 0 100 160, origin top-left)
//
//        0                50               100
//     0  ┌─────────────────────────────────┐
//        │            crown                │  biting edge at the top
//    72  ├────────────── CERVICAL_Y ───────┤  gum line — same y for EVERY tooth, so a
//        │                                 │  chart can draw a crown row and a root row
//        │            root(s)              │  that line up across the whole arch
//   160  └─────────────────────────────────┘  apex of the longest root ≈ 154
//
// The art is ALWAYS drawn crown-up / root-down. A chart that wants the lower arch with its
// roots pointing down flips the group (`scale(1,-1)`); nothing here changes per arch except
// the anatomy itself.
//
// MESIAL AND DISTAL
//
// Artwork is authored with mesial (toward the midline) on the LEFT and mirrored about the
// vertical centre line for the patient's right teeth — which is what a chart drawn facing
// the patient needs, since the midline then sits to the right of every upper/lower-right
// tooth. Callers do not mirror anything: `toothArt(id)` already returns side-correct paths.
//
// SURFACE ZONES
//
// `surfaces` tiles the crown into the five zones of the classic surface map — buccal band
// across the top, lingual band across the bottom, mesial and distal down the sides, and the
// biting surface (occlusal on posteriors, incisal on anteriors) in the centre:
//
//        ┌───────────────┐
//        │    buccal     │      Zones share their boundaries exactly: the proximal zones are
//        ├────┬─────┬────┤      bounded by literal sub-curves of the crown outline (split with
//        │ M  │  O  │  D │      de Casteljau), and the horizontal/vertical cuts are the same
//        ├────┴─────┴────┤      line segments in both neighbours. So the five paths tile the
//        │   lingual     │      crown with no gaps and no overlaps and can be filled
//        └───────────────┘      independently — an MO filling shades exactly two of them.
//
// Which zones exist is decided by the contract (`surfacesFor`), never guessed here.

import { surfacesFor, TOOTH_BY_ID } from '@shared/odontogram'
import type { SurfaceKey, ToothId, ToothInfo } from '@shared/odontogram'

export interface ToothArt {
  /** SVG path 'd' for the crown outline. */
  crown: string
  /** SVG path 'd' for the root(s) — one closed outline, multi-rooted teeth included. */
  root: string
  /** Detail strokes drawn inside the crown: cusp ridges, grooves, mamelons, cingulum. */
  cusps?: string[]
  /**
   * A path per surface zone, each independently fillable. Keyed by SurfaceKey, but only the
   * keys `surfacesFor(id)` returns are present — an anterior carries `incisal` and no
   * `occlusal`, a posterior the reverse. Iterate `surfacesFor(id)` rather than the six.
   */
  surfaces: Record<SurfaceKey, string>
  width: number
  height: number
}

/** Local viewBox width. Every path returned by `toothArt` lives in 0..ART_WIDTH. */
export const ART_WIDTH = 100
/** Local viewBox height. Every path returned by `toothArt` lives in 0..ART_HEIGHT. */
export const ART_HEIGHT = 160
/** The gum line: where the crown path ends and the root path begins, for every tooth. */
export const CERVICAL_Y = 72

const W = ART_WIDTH
const MID = W / 2
const CERVIX = CERVICAL_Y

// ---------------------------------------------------------------------------
// Geometry primitives
//
// Every outline is built from cubics whose *parameter axis* is linear in t: side edges have
// evenly spaced control-point y values, biting/cervical edges evenly spaced x values. That
// costs nothing in expressiveness (the other coordinate is still free) and buys the one
// thing the surface zones need — splitting a curve at an exact x or y is just de Casteljau
// at t = (v - v0) / (v1 - v0), with no root finding and no approximation.
// ---------------------------------------------------------------------------

interface Pt {
  x: number
  y: number
}
interface Seg {
  p0: Pt
  c1: Pt
  c2: Pt
  p1: Pt
}
type Edge = Seg[]
type Axis = 'x' | 'y'

/** A control node of an outline. `k` is the tangent at the node: 0 = flat (a rounded */
/** extremum), LINE = collinear with the next node (a straight run / sharp corner). */
interface Node extends Pt {
  k?: number
}
const LINE = 1 / 3

/** Smooth outline through nodes, monotone along `axis`. */
function spline(nodes: Node[], axis: Axis): Edge {
  const out: Edge = []
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]
    const b = nodes[i + 1]
    const ka = a.k ?? 0
    const kb = b.k ?? 0
    if (axis === 'x') {
      const step = (b.x - a.x) / 3
      const dy = b.y - a.y
      out.push({
        p0: { x: a.x, y: a.y },
        c1: { x: a.x + step, y: a.y + dy * ka },
        c2: { x: b.x - step, y: b.y - dy * kb },
        p1: { x: b.x, y: b.y }
      })
    } else {
      const step = (b.y - a.y) / 3
      const dx = b.x - a.x
      out.push({
        p0: { x: a.x, y: a.y },
        c1: { x: a.x + dx * ka, y: a.y + step },
        c2: { x: b.x - dx * kb, y: b.y - step },
        p1: { x: b.x, y: b.y }
      })
    }
  }
  return out
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function splitSeg(s: Seg, t: number): [Seg, Seg] {
  const p01 = lerp(s.p0, s.c1, t)
  const p12 = lerp(s.c1, s.c2, t)
  const p23 = lerp(s.c2, s.p1, t)
  const p012 = lerp(p01, p12, t)
  const p123 = lerp(p12, p23, t)
  const mid = lerp(p012, p123, t)
  return [
    { p0: s.p0, c1: p01, c2: p012, p1: mid },
    { p0: mid, c1: p123, c2: p23, p1: s.p1 }
  ]
}

function subSeg(s: Seg, t0: number, t1: number): Seg {
  const head = t1 >= 1 ? s : splitSeg(s, t1)[0]
  if (t0 <= 0) return head
  return splitSeg(head, t0 / t1)[1]
}

function at(p: Pt, axis: Axis): number {
  return axis === 'x' ? p.x : p.y
}

/** The run of `edge` between two axis values — the exact curve, not a re-fit. */
function subEdge(edge: Edge, axis: Axis, from: number, to: number): Edge {
  const out: Edge = []
  for (const s of edge) {
    const s0 = at(s.p0, axis)
    const s1 = at(s.p1, axis)
    const lo = Math.max(from, s0)
    const hi = Math.min(to, s1)
    if (hi - lo <= 1e-9) continue
    out.push(subSeg(s, (lo - s0) / (s1 - s0), (hi - s0) / (s1 - s0)))
  }
  if (!out.length) throw new Error(`toothArt: empty sub-edge ${from}..${to} on ${axis}`)
  return out
}

function evalSeg(s: Seg, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p1.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p1.y
  }
}

/** The point where `edge` crosses an axis value. */
function pointOn(edge: Edge, axis: Axis, v: number): Pt {
  for (const s of edge) {
    const s0 = at(s.p0, axis)
    const s1 = at(s.p1, axis)
    if (v >= s0 - 1e-9 && v <= s1 + 1e-9) {
      return evalSeg(s, Math.min(1, Math.max(0, (v - s0) / (s1 - s0))))
    }
  }
  throw new Error(`toothArt: ${axis}=${v} is off the end of the edge`)
}

function reverseEdge(e: Edge): Edge {
  return e
    .slice()
    .reverse()
    .map((s) => ({ p0: s.p1, c1: s.c2, c2: s.c1, p1: s.p0 }))
}

// ---------------------------------------------------------------------------
// Path assembly. Commands are kept as data until the very end so the whole drawing can be
// mirrored in one place, at emit time.
// ---------------------------------------------------------------------------

type Cmd =
  | { k: 'M' | 'L'; p: Pt }
  | { k: 'Q'; c: Pt; p: Pt }
  | { k: 'C'; c1: Pt; c2: Pt; p: Pt }
  | { k: 'Z' }

class Draw {
  readonly cmds: Cmd[] = []
  move(p: Pt): this {
    this.cmds.push({ k: 'M', p })
    return this
  }
  line(p: Pt): this {
    this.cmds.push({ k: 'L', p })
    return this
  }
  quad(c: Pt, p: Pt): this {
    this.cmds.push({ k: 'Q', c, p })
    return this
  }
  cubic(c1: Pt, c2: Pt, p: Pt): this {
    this.cmds.push({ k: 'C', c1, c2, p })
    return this
  }
  /** Append an edge, assuming the pen already sits on its first point. */
  edge(e: Edge): this {
    for (const s of e) this.cubic(s.c1, s.c2, s.p1)
    return this
  }
  /** Move to an edge's start, then append it. */
  from(e: Edge): this {
    return this.move(e[0].p0).edge(e)
  }
  close(): this {
    this.cmds.push({ k: 'Z' })
    return this
  }
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`toothArt: non-finite coordinate ${v}`)
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

function emit(cmds: Cmd[], mirror: boolean): string {
  const pt = (p: Pt): string => `${fmt(mirror ? W - p.x : p.x)} ${fmt(p.y)}`
  const out: string[] = []
  for (const c of cmds) {
    if (c.k === 'Z') out.push('Z')
    else if (c.k === 'Q') out.push(`Q ${pt(c.c)} ${pt(c.p)}`)
    else if (c.k === 'C') out.push(`C ${pt(c.c1)} ${pt(c.c2)} ${pt(c.p)}`)
    else out.push(`${c.k} ${pt(c.p)}`)
  }
  return out.join(' ')
}

// ---------------------------------------------------------------------------
// Crown dimensions, tooth by tooth.
//
//   shoulderY  y of the mesio-incisal / mesio-occlusal corner — the top of the silhouette
//   topHalf    half width across the biting edge
//   halfW      half width at the height of contour (the widest point, where teeth touch)
//   neckHalf   half width at the gum line
//   contourY   y of that widest point
//   cuspH      how far the cusp tips rise above the corners (0 = a flat incisal edge)
//
// Read down a column and the arch is there: upper centrals wide, lower centrals the
// narrowest teeth in the mouth, canines the tallest crowns, lower molars wider and shorter
// than uppers, primary crowns short (their gum line is shared, so they lose height at the
// top) and narrow.
// ---------------------------------------------------------------------------

type CrownRow = [
  shoulderY: number,
  topHalf: number,
  halfW: number,
  neckHalf: number,
  contourY: number,
  cuspH: number
]

const CROWN: Record<string, CrownRow> = {
  // permanent upper
  'permanent-upper-incisor-1': [11, 23, 24.5, 17, 27, 0],
  'permanent-upper-incisor-2': [14, 18, 19.5, 13.5, 29, 0],
  'permanent-upper-canine-3': [23, 19, 22, 15.5, 31, 13],
  'permanent-upper-premolar-4': [25, 17.5, 20.5, 15, 34, 10],
  'permanent-upper-premolar-5': [26, 17, 20, 14.5, 34, 9],
  'permanent-upper-molar-6': [22, 25, 28, 21, 33, 7],
  'permanent-upper-molar-7': [23, 23.5, 26.5, 20, 33, 6.5],
  'permanent-upper-molar-8': [26, 21, 24, 18.5, 35, 6],
  // permanent lower
  'permanent-lower-incisor-1': [14, 13.5, 15, 10.5, 29, 0],
  'permanent-lower-incisor-2': [13.5, 15, 16.5, 11.5, 29, 0],
  'permanent-lower-canine-3': [24, 16.5, 19, 13.5, 32, 13],
  'permanent-lower-premolar-4': [25, 16.5, 19, 14, 34, 11],
  'permanent-lower-premolar-5': [25.5, 17.5, 20, 14.5, 34, 9],
  'permanent-lower-molar-6': [24, 27.5, 31, 23, 35, 6.5],
  'permanent-lower-molar-7': [25, 26, 29, 21.5, 35, 6],
  'permanent-lower-molar-8': [27, 24, 27, 20, 36, 5.5],
  // primary upper
  'primary-upper-incisor-1': [31, 16, 17.5, 12.5, 41, 0],
  'primary-upper-incisor-2': [33, 13, 14.5, 10, 43, 0],
  'primary-upper-canine-3': [37, 13.5, 15.5, 10.5, 45, 9],
  'primary-upper-molar-4': [34, 16, 18, 13.5, 46, 6],
  'primary-upper-molar-5': [34, 17, 19, 14.5, 46, 6.5],
  // primary lower
  'primary-lower-incisor-1': [34, 11.5, 12.5, 8.5, 44, 0],
  'primary-lower-incisor-2': [33, 12.5, 13.5, 9.5, 43, 0],
  'primary-lower-canine-3': [38, 12, 13.5, 9.5, 46, 9],
  'primary-lower-molar-4': [34, 16, 18, 13, 46, 5.5],
  'primary-lower-molar-5': [34, 18, 19, 14.5, 46, 6]
}

// ---------------------------------------------------------------------------
// Root dimensions.
//
//   count    prongs in the root: 1, 2 (lower molars, upper 1st premolar) or 3 (upper molars)
//   furcY    where the trunk divides — permanent molars keep a real trunk, primary molars
//            split almost at the gum line, which is what makes them look splayed
//   apexY    y of the outer apexes (the tip rounds a little past it)
//   spread   half-distance between the outermost apexes
//   half     prong half width at the furcation
//   tip      prong half width at the apex
//   drift    distal drift of a single root's apex — roots lean distally
//   longMid  extra length of the middle prong (the palatal root of an upper molar)
// ---------------------------------------------------------------------------

type RootRow = [
  count: number,
  furcY: number,
  apexY: number,
  spread: number,
  half: number,
  tip: number,
  drift: number,
  longMid: number
]

const ROOT: Record<string, RootRow> = {
  // permanent upper
  'permanent-upper-incisor-1': [1, 78, 138, 0, 0, 4.5, 3, 0],
  'permanent-upper-incisor-2': [1, 78, 136, 0, 0, 4, 4, 0],
  'permanent-upper-canine-3': [1, 78, 150, 0, 0, 4.5, 3, 0], // the longest root in the mouth
  'permanent-upper-premolar-4': [2, 108, 140, 11, 5.5, 3.5, 0, 0], // buccal + palatal
  'permanent-upper-premolar-5': [1, 78, 142, 0, 0, 4, 3, 0],
  'permanent-upper-molar-6': [3, 92, 136, 25, 6.5, 4.5, 0, 8],
  'permanent-upper-molar-7': [3, 93, 134, 23, 6.5, 4.5, 0, 7],
  'permanent-upper-molar-8': [2, 95, 130, 16, 7, 5, 0, 0], // often fused, short, conical
  // permanent lower
  'permanent-lower-incisor-1': [1, 78, 134, 0, 0, 3.5, 3, 0],
  'permanent-lower-incisor-2': [1, 78, 136, 0, 0, 3.5, 3.5, 0],
  'permanent-lower-canine-3': [1, 78, 148, 0, 0, 4.5, 3, 0],
  'permanent-lower-premolar-4': [1, 78, 140, 0, 0, 4, 3, 0],
  'permanent-lower-premolar-5': [1, 78, 142, 0, 0, 4, 3, 0],
  'permanent-lower-molar-6': [2, 88, 140, 20, 9, 5.5, 0, 0],
  'permanent-lower-molar-7': [2, 89, 138, 18, 9, 5.5, 0, 0],
  'permanent-lower-molar-8': [2, 92, 132, 14, 8, 5, 0, 0],
  // primary upper — slender prongs, flaring straight off the gum line
  'primary-upper-incisor-1': [1, 76, 126, 0, 0, 3, 6, 0],
  'primary-upper-incisor-2': [1, 76, 124, 0, 0, 2.8, 7, 0],
  'primary-upper-canine-3': [1, 76, 134, 0, 0, 3.2, 6, 0],
  'primary-upper-molar-4': [3, 78, 126, 32, 4.5, 3, 0, 6],
  'primary-upper-molar-5': [3, 78, 128, 34, 4.5, 3, 0, 6],
  // primary lower
  'primary-lower-incisor-1': [1, 76, 122, 0, 0, 2.6, 6, 0],
  'primary-lower-incisor-2': [1, 76, 124, 0, 0, 2.8, 6, 0],
  'primary-lower-canine-3': [1, 76, 132, 0, 0, 3, 6, 0],
  'primary-lower-molar-4': [2, 77, 126, 30, 5, 3, 0, 0],
  'primary-lower-molar-5': [2, 77, 128, 32, 5, 3, 0, 0]
}

function key(t: ToothInfo): string {
  return `${t.dentition}-${t.arch}-${t.type}-${t.position}`
}

interface Dim {
  shoulderY: number
  topHalf: number
  halfW: number
  neckHalf: number
  contourY: number
  cuspH: number
  cusps: number
  cervBulge: number
}

/** Cusps on the biting edge: 0 an incisal edge, 1 a canine, 2 a premolar, 4–5 a molar. */
function cuspCount(t: ToothInfo): number {
  if (t.type === 'incisor') return 0
  if (t.type === 'canine') return 1
  if (t.type === 'premolar') return 2
  if (t.dentition === 'primary') {
    // The primary 1st molars are the odd ones; the 2nd molars foreshadow the permanent 1sts.
    if (t.arch === 'upper') return t.position === 4 ? 3 : 4
    return t.position === 4 ? 4 : 5
  }
  return t.arch === 'lower' && t.position === 6 ? 5 : 4
}

function dimsOf(t: ToothInfo): Dim {
  const row = CROWN[key(t)]
  if (!row) throw new Error(`toothArt: no crown geometry for ${key(t)}`)
  const [shoulderY, topHalf, halfW, neckHalf, contourY, cuspH] = row
  const anterior = t.type === 'incisor' || t.type === 'canine'
  return {
    shoulderY,
    topHalf,
    halfW,
    neckHalf,
    contourY,
    cuspH,
    cusps: cuspCount(t),
    // The cemento-enamel junction arcs hardest on the anteriors.
    cervBulge: anterior ? 4 : 2.4
  }
}

// ---------------------------------------------------------------------------
// The crown
// ---------------------------------------------------------------------------

interface Biting {
  nodes: Node[]
  /** x of each cusp tip, mesial → distal. */
  peaks: number[]
  /** x and y of each developmental groove between two cusps. */
  valleys: Pt[]
}

function bitingEdge(t: ToothInfo, d: Dim): Biting {
  const left = MID - d.topHalf
  const right = MID + d.topHalf
  const cuspY = d.shoulderY - d.cuspH

  if (t.type === 'incisor') {
    // A chisel: near-straight edge, a sharp mesio-incisal angle and a rounded distal one.
    return {
      nodes: [
        { x: left, y: d.shoulderY, k: LINE },
        { x: MID, y: d.shoulderY - 0.8, k: 0 },
        { x: right, y: d.shoulderY + 2.2, k: LINE }
      ],
      peaks: [],
      valleys: []
    }
  }

  if (t.type === 'canine') {
    // One tall cusp, set a little mesial, with a short mesial slope and a long distal one.
    const tip = MID - d.topHalf * 0.16
    return {
      nodes: [
        { x: left, y: d.shoulderY, k: LINE },
        { x: tip, y: cuspY, k: 0.24 },
        { x: right, y: d.shoulderY + 2.4, k: LINE }
      ],
      peaks: [tip],
      valleys: []
    }
  }

  // Premolars and molars: n rounded cusps with a groove sunk between each pair.
  const n = d.cusps
  const lift = cuspDrop(t, n)
  const peaks: number[] = []
  const nodes: Node[] = [{ x: left, y: d.shoulderY, k: LINE }]
  const valleys: Pt[] = []
  for (let i = 0; i < n; i++) {
    const x = left + (right - left) * ((i + 0.5) / n)
    const y = cuspY + lift[i]
    if (i > 0) {
      const prev = nodes[nodes.length - 1]
      const vx = (prev.x + x) / 2
      // The groove floor sits between the taller neighbour and the crown's shoulder, so a
      // valley can never dip below the corners — which keeps the buccal zone well formed.
      const vy = Math.max(prev.y, y) + (d.shoulderY - Math.max(prev.y, y)) * 0.55
      nodes.push({ x: vx, y: vy, k: 0 })
      valleys.push({ x: vx, y: vy })
    }
    nodes.push({ x, y, k: 0.08 })
    peaks.push(x)
  }
  nodes.push({ x: right, y: d.shoulderY + 1.6, k: LINE })
  return { nodes, peaks, valleys }
}

/** How far each cusp falls short of the tallest one, mesial → distal. */
function cuspDrop(t: ToothInfo, n: number): number[] {
  if (t.type === 'premolar') {
    // The lower first premolar's lingual cusp is a vestige, barely more than a bump.
    if (t.arch === 'lower') return [0, t.position === 4 ? 7.5 : 3.5]
    return [0, 1.6]
  }
  // Mesiobuccal tallest, then mesiolingual, distobuccal, distolingual, distal.
  return [0, 1.4, 0.7, 2.2, 4].slice(0, n)
}

interface CrownGeom {
  top: Edge
  right: Edge
  bottom: Edge
  left: Edge
  /** Buccal band / centre boundary, and centre / lingual band boundary. */
  yB: number
  yL: number
  /** Mesial band / centre boundary, and centre / distal band boundary. */
  xM: number
  xD: number
  detail: Cmd[][]
}

function buildCrown(t: ToothInfo, d: Dim): CrownGeom {
  const b = bitingEdge(t, d)
  const top = spline(b.nodes, 'x')
  const first = b.nodes[0]
  const last = b.nodes[b.nodes.length - 1]

  const left = spline(
    [
      { x: first.x, y: first.y, k: LINE },
      { x: MID - d.halfW, y: d.contourY, k: 0 },
      { x: MID - d.neckHalf, y: CERVIX, k: LINE * 0.8 }
    ],
    'y'
  )
  // The distal contact sits a touch more cervical than the mesial one on every tooth.
  const right = spline(
    [
      { x: last.x, y: last.y, k: LINE },
      { x: MID + d.halfW - 0.6, y: d.contourY + 2.5, k: 0 },
      { x: MID + d.neckHalf, y: CERVIX, k: LINE * 0.8 }
    ],
    'y'
  )
  const bottom = spline(
    [
      { x: MID - d.neckHalf, y: CERVIX, k: LINE },
      { x: MID, y: CERVIX + d.cervBulge, k: 0 },
      { x: MID + d.neckHalf, y: CERVIX, k: LINE }
    ],
    'x'
  )

  // Zone cuts. The horizontal ones clear the biting edge and the cervical arc; the vertical
  // ones are placed off the real outline, so the centre zone is inside the crown at every
  // height in the band no matter how much the silhouette bulges.
  const yTop = Math.max(...b.nodes.map((n) => n.y))
  const yB = yTop + (CERVIX - yTop) * 0.3
  const yL = CERVIX - (CERVIX - yTop) * 0.2
  const safeL = Math.max(pointOn(left, 'y', yB).x, pointOn(left, 'y', yL).x)
  const safeR = Math.min(pointOn(right, 'y', yB).x, pointOn(right, 'y', yL).x)
  const xM = safeL + (safeR - safeL) * 0.3
  const xD = safeL + (safeR - safeL) * 0.7

  return { top, right, bottom, left, yB, yL, xM, xD, detail: crownDetail(t, d, b, yTop, yB, yL) }
}

function crownPath(c: CrownGeom): Cmd[] {
  return new Draw()
    .from(c.top)
    .edge(c.right)
    .edge(reverseEdge(c.bottom))
    .edge(reverseEdge(c.left))
    .close().cmds
}

/**
 * The five zones. Shared boundaries are the *same* geometry on both sides — identical line
 * segments, or exact splits of one outline curve — so the zones tile the crown.
 */
function zonePaths(c: CrownGeom): {
  buccal: Cmd[]
  lingual: Cmd[]
  mesial: Cmd[]
  distal: Cmd[]
  centre: Cmd[]
} {
  const topL = c.left[0].p0
  const topR = c.right[0].p0
  const leftB = pointOn(c.left, 'y', c.yB)
  const leftL = pointOn(c.left, 'y', c.yL)
  const rightB = pointOn(c.right, 'y', c.yB)
  const rightL = pointOn(c.right, 'y', c.yL)

  const buccal = new Draw()
    .from(c.top)
    .edge(subEdge(c.right, 'y', topR.y, c.yB))
    .line(leftB)
    .edge(reverseEdge(subEdge(c.left, 'y', topL.y, c.yB)))
    .close().cmds

  const lingual = new Draw()
    .move(leftL)
    .line(rightL)
    .edge(subEdge(c.right, 'y', c.yL, CERVIX))
    .edge(reverseEdge(c.bottom))
    .edge(reverseEdge(subEdge(c.left, 'y', c.yL, CERVIX)))
    .close().cmds

  const mesial = new Draw()
    .move(leftB)
    .line({ x: c.xM, y: c.yB })
    .line({ x: c.xM, y: c.yL })
    .line(leftL)
    .edge(reverseEdge(subEdge(c.left, 'y', c.yB, c.yL)))
    .close().cmds

  const distal = new Draw()
    .move({ x: c.xD, y: c.yB })
    .line(rightB)
    .edge(subEdge(c.right, 'y', c.yB, c.yL))
    .line({ x: c.xD, y: c.yL })
    .close().cmds

  const centre = new Draw()
    .move({ x: c.xM, y: c.yB })
    .line({ x: c.xD, y: c.yB })
    .line({ x: c.xD, y: c.yL })
    .line({ x: c.xM, y: c.yL })
    .close().cmds

  return { buccal, lingual, mesial, distal, centre }
}

/** Cusp ridges, developmental grooves, mamelons, cingulum — drawn inside the crown. */
function crownDetail(t: ToothInfo, d: Dim, b: Biting, yTop: number, yB: number, yL: number): Cmd[][] {
  const out: Cmd[][] = []

  // The cingulum: the bulge every anterior carries on its cervical third.
  const cingulum = (): Cmd[] => {
    const w = d.neckHalf * 0.55
    const y = yL - (CERVIX - yL) * 0.15
    return new Draw()
      .move({ x: MID - w, y })
      .quad({ x: MID, y: y + (CERVIX - y) * 0.9 }, { x: MID + w, y }).cmds
  }

  if (t.type === 'incisor') {
    // Two mamelon grooves separating the three lobes of a young incisal edge.
    const y0 = d.shoulderY + 1.4
    const y1 = y0 + (yB - y0) * 0.5
    for (const dx of [-d.topHalf * 0.33, d.topHalf * 0.33]) {
      out.push(new Draw().move({ x: MID + dx, y: y0 }).line({ x: MID + dx, y: y1 }).cmds)
    }
    out.push(cingulum())
    return out
  }

  if (t.type === 'canine') {
    // The two cusp ridges running off the tip.
    const tip = { x: b.peaks[0], y: d.shoulderY - d.cuspH + 2 }
    out.push(new Draw().move(tip).line({ x: MID - d.topHalf * 0.58, y: yB }).cmds)
    out.push(new Draw().move(tip).line({ x: MID + d.topHalf * 0.62, y: yB }).cmds)
    out.push(cingulum())
    return out
  }

  // Posteriors: the central groove running mesio-distally, with each cusp groove dropping
  // into it. `yTop` is the lowest point of the biting edge, so this all sits below the cusps.
  const grooveY = yTop + (yB - yTop) * 0.45
  const nodes: Node[] = [{ x: MID - d.topHalf * 0.62, y: grooveY + 1.6, k: LINE }]
  for (const v of b.valleys) nodes.push({ x: v.x, y: grooveY - 1, k: 0 })
  nodes.push({ x: MID + d.topHalf * 0.62, y: grooveY + 1.6, k: LINE })
  out.push(new Draw().from(spline(nodes, 'x')).cmds)
  for (const v of b.valleys) {
    out.push(new Draw().move({ x: v.x, y: v.y + 1 }).line({ x: v.x, y: grooveY }).cmds)
  }
  return out
}

// ---------------------------------------------------------------------------
// The root
// ---------------------------------------------------------------------------

interface Prong {
  /** x where the prong leaves the furcation, and its half width there. */
  xTop: number
  top: number
  /** x of the apex, its half width, and how far down it reaches. */
  xApex: number
  tip: number
  yApex: number
}

function prongsOf(neckHalf: number, r: RootRow): Prong[] {
  const [count, , apexY, spread, half, tip, drift, longMid] = r
  if (count === 1) {
    return [
      { xTop: MID, top: Math.max(neckHalf - 1.5, 3), xApex: MID + drift, tip, yApex: apexY }
    ]
  }
  if (count === 2) {
    const gap = half + 2.5
    return [
      { xTop: MID - gap, top: half, xApex: MID - spread, tip, yApex: apexY },
      // The distal root of a two-rooted tooth is the shorter of the pair.
      { xTop: MID + gap, top: half, xApex: MID + spread, tip, yApex: apexY - 2.5 }
    ]
  }
  const gap = 2 * half + 4
  return [
    { xTop: MID - gap, top: half, xApex: MID - spread, tip, yApex: apexY },
    // The palatal root: nearly vertical, and the longest of the three.
    { xTop: MID, top: half, xApex: MID + 1.5, tip: tip * 0.95, yApex: apexY + longMid },
    { xTop: MID + gap, top: half, xApex: MID + spread, tip, yApex: apexY - 2.5 }
  ]
}

function buildRoot(t: ToothInfo, neckHalf: number, r: RootRow): Cmd[] {
  const furcY = r[1]
  const ps = prongsOf(neckHalf, r)
  // Permanent roots run down before they part; primary roots throw themselves outward from
  // the moment they leave the crown, which is the shape a developing successor needs.
  const flare = t.dentition === 'primary' ? 0.45 : 0.18
  const trunk = furcY - CERVIX
  const notch = Math.min(6, trunk * 0.5)
  const g = new Draw()
  const first = ps[0]
  const last = ps[ps.length - 1]

  g.move({ x: MID - neckHalf, y: CERVIX })
  g.cubic(
    { x: MID - neckHalf - 0.4, y: CERVIX + trunk * 0.45 },
    { x: first.xTop - first.top - 0.4, y: CERVIX + trunk * 0.72 },
    { x: first.xTop - first.top, y: furcY }
  )

  ps.forEach((p, i) => {
    const dy = p.yApex - furcY
    const outer = p.xApex - p.tip
    const inner = p.xApex + p.tip
    const shoulderL = p.xTop - p.top
    const shoulderR = p.xTop + p.top
    g.cubic(
      { x: shoulderL + (outer - shoulderL) * flare, y: furcY + dy * 0.34 },
      { x: outer + (shoulderL - outer) * 0.1, y: furcY + dy * 0.76 },
      { x: outer, y: p.yApex }
    )
    // The apex itself — the only Q in a root path, one per prong.
    g.quad({ x: p.xApex, y: p.yApex + p.tip * 1.7 }, { x: inner, y: p.yApex })
    g.cubic(
      { x: inner + (shoulderR - inner) * 0.1, y: furcY + dy * 0.76 },
      { x: shoulderR + (inner - shoulderR) * flare, y: furcY + dy * 0.34 },
      { x: shoulderR, y: furcY }
    )
    if (i < ps.length - 1) {
      const next = ps[i + 1]
      // The furcation notch cutting up between two prongs.
      g.cubic(
        { x: shoulderR + 0.6, y: furcY - notch },
        { x: next.xTop - next.top - 0.6, y: furcY - notch },
        { x: next.xTop - next.top, y: furcY }
      )
    }
  })

  g.cubic(
    { x: last.xTop + last.top + 0.4, y: CERVIX + trunk * 0.72 },
    { x: MID + neckHalf + 0.4, y: CERVIX + trunk * 0.45 },
    { x: MID + neckHalf, y: CERVIX }
  )
  return g.close().cmds
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const CACHE = new Map<ToothId, ToothArt>()

/**
 * The artwork for one tooth, already oriented for its side of the chart.
 * Pure and deterministic: the same id always yields the same (frozen, cached) paths.
 */
export function toothArt(id: ToothId): ToothArt {
  const hit = CACHE.get(id)
  if (hit) return hit

  const t = TOOTH_BY_ID.get(id)
  if (!t) throw new Error(`toothArt: unknown tooth id "${id}"`)

  const d = dimsOf(t)
  const rootRow = ROOT[key(t)]
  if (!rootRow) throw new Error(`toothArt: no root geometry for ${key(t)}`)

  // Authored mesial-left; the patient's right teeth mirror so mesial faces the midline.
  const mirror = t.side === 'right'
  const geom = buildCrown(t, d)
  const zones = zonePaths(geom)

  const surfaces = {} as Record<SurfaceKey, string>
  for (const s of surfacesFor(id)) {
    const cmds =
      s === 'occlusal' || s === 'incisal'
        ? zones.centre
        : s === 'mesial'
          ? zones.mesial
          : s === 'distal'
            ? zones.distal
            : s === 'buccal'
              ? zones.buccal
              : zones.lingual
    surfaces[s] = emit(cmds, mirror)
  }

  const art: ToothArt = {
    crown: emit(crownPath(geom), mirror),
    root: emit(buildRoot(t, d.neckHalf, rootRow), mirror),
    cusps: Object.freeze(geom.detail.map((c) => emit(c, mirror))) as string[],
    surfaces: Object.freeze(surfaces),
    width: ART_WIDTH,
    height: ART_HEIGHT
  }
  Object.freeze(art)
  CACHE.set(id, art)
  return art
}

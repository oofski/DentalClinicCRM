// Tests for the hand-authored tooth artwork.
//
//   node src/components/odontogram/toothArt.test.mjs
//
// toothArt.ts is TypeScript and reaches the contract through the '@shared' alias, so the
// test bundles it with esbuild first (into a temp dir, never into the repo) and imports the
// bundle. No DOM, no React, no test framework — the assertions are geometric, because that
// is the only way to know the drawings are actually well formed: paths are parsed, curves
// are flattened to polygons, and areas/coverage are measured.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tooth-art-'))
const entry = path.join(outDir, 'entry.ts')
const outFile = path.join(outDir, 'toothArt.mjs')

// One entry so the test can reach both the artwork and the contract it is measured against.
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(here, 'toothArt.ts'))}\n` +
    `export { ALL_TEETH, TOOTH_BY_ID, surfacesFor, isPrimary } from ${JSON.stringify(
      path.join(root, 'shared/odontogram.ts')
    )}\n`
)

const localEsbuild = path.join(root, 'node_modules', '.bin', 'esbuild')
const [cmd, argv] = fs.existsSync(localEsbuild) ? [localEsbuild, []] : ['npx', ['esbuild']]
execFileSync(
  cmd,
  [
    ...argv,
    entry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--tsconfig=${path.join(root, 'tsconfig.web.json')}`,
    `--outfile=${outFile}`
  ],
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] }
)

const A = await import(pathToFileURL(outFile).href)
const { toothArt, ALL_TEETH, TOOTH_BY_ID, surfacesFor, ART_WIDTH, ART_HEIGHT, CERVICAL_Y } = A

// ---------------------------------------------------------------------------
// A small SVG path reader. Deliberately strict: anything it cannot account for is a
// failure, so a check can never pass by quietly ignoring part of a path.
// ---------------------------------------------------------------------------

const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
const ALLOWED = new Set(['M', 'L', 'C', 'Q', 'A', 'Z', 'H', 'V'])

function parsePath(d) {
  if (typeof d !== 'string' || !d.length) throw new Error('path is empty')
  if (/nan|undefined|null|infinity/i.test(d)) throw new Error(`path contains a bad number: ${d}`)
  if (!/^[MLCQAZHV0-9eE+\-.,\s]*$/.test(d)) throw new Error(`path has stray characters: ${d}`)
  if (d.trim()[0] !== 'M') throw new Error(`path does not start with M: ${d.slice(0, 24)}…`)

  const toks = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []
  const out = []
  let i = 0
  let cmd = null
  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++]
    if (!cmd) throw new Error('path does not start with a command')
    if (!ALLOWED.has(cmd)) throw new Error(`disallowed command "${cmd}"`)
    const n = ARITY[cmd]
    const args = []
    for (let k = 0; k < n; k++) {
      const v = toks[i++]
      if (v === undefined || /^[A-Za-z]$/.test(v)) throw new Error(`"${cmd}" is missing arguments`)
      if (!Number.isFinite(Number(v))) throw new Error(`"${cmd}" has a non-numeric argument "${v}"`)
      args.push(Number(v))
    }
    out.push({ cmd, args })
    if (n === 0 && i < toks.length && !/^[A-Za-z]$/.test(toks[i])) {
      throw new Error('numbers follow a Z command')
    }
  }
  if (!out.length) throw new Error('path has no commands')
  return out
}

/** Every (x, y) a command names, control points included. */
function pointsOf({ cmd, args }, pen) {
  if (cmd === 'Z') return []
  if (cmd === 'H') return [{ x: args[0], y: pen.y }]
  if (cmd === 'V') return [{ x: pen.x, y: args[0] }]
  if (cmd === 'A') return [{ x: args[5], y: args[6] }]
  const pts = []
  for (let i = 0; i < args.length; i += 2) pts.push({ x: args[i], y: args[i + 1] })
  return pts
}

function allPoints(d) {
  const pts = []
  let pen = { x: 0, y: 0 }
  for (const c of parsePath(d)) {
    const p = pointsOf(c, pen)
    for (const q of p) pts.push(q)
    if (p.length) pen = p[p.length - 1]
  }
  return pts
}

/** Closed subpaths as polygons. Only M/L/C/Q/Z appear in this artwork. */
function flatten(d, steps = 16) {
  const subs = []
  let cur = null
  let pen = { x: 0, y: 0 }
  let start = { x: 0, y: 0 }
  const bez = (pts) => {
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const u = 1 - t
      let p
      if (pts.length === 4) {
        p = {
          x: u ** 3 * pts[0].x + 3 * u * u * t * pts[1].x + 3 * u * t * t * pts[2].x + t ** 3 * pts[3].x,
          y: u ** 3 * pts[0].y + 3 * u * u * t * pts[1].y + 3 * u * t * t * pts[2].y + t ** 3 * pts[3].y
        }
      } else {
        p = {
          x: u * u * pts[0].x + 2 * u * t * pts[1].x + t * t * pts[2].x,
          y: u * u * pts[0].y + 2 * u * t * pts[1].y + t * t * pts[2].y
        }
      }
      cur.push(p)
      pen = p
    }
  }
  for (const { cmd, args } of parsePath(d)) {
    if (cmd === 'M') {
      cur = [{ x: args[0], y: args[1] }]
      subs.push(cur)
      pen = { x: args[0], y: args[1] }
      start = pen
    } else if (cmd === 'L') {
      pen = { x: args[0], y: args[1] }
      cur.push(pen)
    } else if (cmd === 'C') {
      bez([pen, { x: args[0], y: args[1] }, { x: args[2], y: args[3] }, { x: args[4], y: args[5] }])
    } else if (cmd === 'Q') {
      bez([pen, { x: args[0], y: args[1] }, { x: args[2], y: args[3] }])
    } else if (cmd === 'Z') {
      cur.push(start)
      pen = start
    } else {
      throw new Error(`flatten: unexpected command "${cmd}"`)
    }
  }
  return subs
}

function area(poly) {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y
  }
  return Math.abs(a) / 2
}

function bbox(pts) {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
    get w() {
      return this.x1 - this.x0
    },
    get h() {
      return this.y1 - this.y0
    }
  }
}

function inside(poly, p) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

function distToEdges(poly, p) {
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]
    const b = poly[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
  }
  return best
}

const outline = (d) => {
  const subs = flatten(d)
  if (subs.length !== 1) throw new Error(`expected one closed outline, got ${subs.length}`)
  return subs[0]
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0
function check(name, fn) {
  try {
    const note = fn()
    passed++
    console.log(`ok    ${name}${note ? ` — ${note}` : ''}`)
  } catch (e) {
    failed++
    console.log(`FAIL  ${name}\n        ${e.message}`)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const IDS = ALL_TEETH.map((t) => t.id)
const ART = new Map(IDS.map((id) => [id, toothArt(id)]))
const CROWN_POLY = new Map(IDS.map((id) => [id, outline(ART.get(id).crown)]))
const ROOT_POLY = new Map(IDS.map((id) => [id, outline(ART.get(id).root)]))
const ANTERIOR = new Set(['incisor', 'canine'])

console.log(`\ntoothArt — ${IDS.length} teeth\n`)

// ---------------------------------------------------------------------------

check('every tooth in the contract has artwork (32 permanent + 20 primary)', () => {
  assert(IDS.length === 52, `contract lists ${IDS.length} teeth`)
  const perm = IDS.filter((id) => TOOTH_BY_ID.get(id).dentition === 'permanent')
  const prim = IDS.filter((id) => TOOTH_BY_ID.get(id).dentition === 'primary')
  assert(perm.length === 32 && prim.length === 20, `${perm.length} permanent / ${prim.length} primary`)
  for (const id of IDS) assert(ART.get(id), `no art for ${id}`)
  return `${perm.length} + ${prim.length}`
})

check('crown and root are non-empty, separate paths', () => {
  for (const id of IDS) {
    const a = ART.get(id)
    assert(typeof a.crown === 'string' && a.crown.length > 20, `${id}: crown is not a path`)
    assert(typeof a.root === 'string' && a.root.length > 20, `${id}: root is not a path`)
    assert(a.crown !== a.root, `${id}: crown and root are the same path`)
    assert(a.width === ART_WIDTH && a.height === ART_HEIGHT, `${id}: wrong declared size`)
  }
})

check('every path string is valid SVG path data', () => {
  let n = 0
  for (const id of IDS) {
    const a = ART.get(id)
    for (const [what, d] of [
      ['crown', a.crown],
      ['root', a.root],
      ...a.cusps.map((c, i) => [`cusp ${i}`, c]),
      ...Object.entries(a.surfaces)
    ]) {
      try {
        const cmds = parsePath(d)
        assert(cmds[0].cmd === 'M', 'first command is not M')
        for (const { cmd } of cmds) assert(ALLOWED.has(cmd), `command "${cmd}" not allowed`)
        n++
      } catch (e) {
        throw new Error(`${id} ${what}: ${e.message}`)
      }
    }
  }
  return `${n} paths parsed`
})

check('every coordinate — control points included — is inside the declared box', () => {
  let n = 0
  for (const id of IDS) {
    const a = ART.get(id)
    for (const [what, d] of [
      ['crown', a.crown],
      ['root', a.root],
      ...a.cusps.map((c, i) => [`cusp ${i}`, c]),
      ...Object.entries(a.surfaces)
    ]) {
      for (const p of allPoints(d)) {
        assert(
          p.x >= 0 && p.x <= a.width && p.y >= 0 && p.y <= a.height,
          `${id} ${what}: (${p.x}, ${p.y}) escapes 0..${a.width} × 0..${a.height}`
        )
        n++
      }
    }
  }
  return `${n} coordinates`
})

check('surfaces are exactly the zones the contract declares', () => {
  for (const id of IDS) {
    const want = [...surfacesFor(id)].sort()
    const got = Object.keys(ART.get(id).surfaces).sort()
    assert(
      want.length === got.length && want.every((k, i) => k === got[i]),
      `${id}: expected [${want}], got [${got}]`
    )
  }
  return '5 zones per tooth, no more, no fewer'
})

check('anteriors carry incisal and no occlusal; posteriors the reverse', () => {
  let ant = 0
  let post = 0
  for (const id of IDS) {
    const t = TOOTH_BY_ID.get(id)
    const s = ART.get(id).surfaces
    if (ANTERIOR.has(t.type)) {
      assert(typeof s.incisal === 'string' && s.incisal, `${id} (${t.type}) has no incisal zone`)
      assert(!('occlusal' in s), `${id} (${t.type}) has an occlusal zone`)
      ant++
    } else {
      assert(typeof s.occlusal === 'string' && s.occlusal, `${id} (${t.type}) has no occlusal zone`)
      assert(!('incisal' in s), `${id} (${t.type}) has an incisal zone`)
      post++
    }
  }
  return `${ant} anterior / ${post} posterior`
})

check('the five zones tile the crown: areas add up to the crown', () => {
  let worst = 0
  let worstId = ''
  for (const id of IDS) {
    const a = ART.get(id)
    const crown = area(CROWN_POLY.get(id))
    const sum = Object.values(a.surfaces).reduce((acc, d) => acc + area(outline(d)), 0)
    const err = Math.abs(sum - crown) / crown
    if (err > worst) {
      worst = err
      worstId = id
    }
    assert(err < 0.005, `${id}: zones sum to ${sum.toFixed(2)} but the crown is ${crown.toFixed(2)}`)
  }
  return `worst mismatch ${(worst * 100).toFixed(3)}% (tooth ${worstId})`
})

check('the five zones tile the crown: no gaps, no overlaps, nothing outside', () => {
  const TOL = 0.05 // ignore samples this close to a boundary — flattening noise, not a hole
  let sampled = 0
  for (const id of IDS) {
    const a = ART.get(id)
    const crown = CROWN_POLY.get(id)
    const zones = Object.entries(a.surfaces).map(([k, d]) => {
      const poly = outline(d)
      return { k, poly, box: bbox(poly) }
    })
    const box = bbox(crown)
    for (let x = box.x0 + 0.37; x < box.x1; x += 0.9) {
      for (let y = box.y0 + 0.23; y < box.y1; y += 0.9) {
        const p = { x, y }
        sampled++
        const hits = zones.filter(
          (z) => p.x >= z.box.x0 && p.x <= z.box.x1 && p.y >= z.box.y0 && p.y <= z.box.y1 && inside(z.poly, p)
        )
        const inCrown = inside(crown, p)
        if (hits.length > 1) {
          const d = Math.min(...hits.map((z) => distToEdges(z.poly, p)))
          assert(d < TOL, `${id}: (${x.toFixed(1)}, ${y.toFixed(1)}) is inside ${hits.map((h) => h.k)}`)
        }
        if (inCrown && hits.length === 0) {
          assert(
            distToEdges(crown, p) < TOL || Math.min(...zones.map((z) => distToEdges(z.poly, p))) < TOL,
            `${id}: (${x.toFixed(1)}, ${y.toFixed(1)}) is in the crown but in no zone`
          )
        }
        if (!inCrown && hits.length > 0) {
          assert(
            distToEdges(crown, p) < TOL,
            `${id}: (${x.toFixed(1)}, ${y.toFixed(1)}) is in ${hits.map((h) => h.k)} but outside the crown`
          )
        }
      }
    }
  }
  return `${sampled.toLocaleString('en-US')} points sampled across 52 crowns`
})

check('crown sits in the upper part of the box, root in the lower, and they meet', () => {
  for (const id of IDS) {
    const c = bbox(CROWN_POLY.get(id))
    const r = bbox(ROOT_POLY.get(id))
    assert(c.y0 >= 0 && c.y1 <= ART_HEIGHT * 0.52, `${id}: crown spans ${c.y0}..${c.y1}`)
    assert(r.y0 >= ART_HEIGHT * 0.42 && r.y1 <= ART_HEIGHT, `${id}: root spans ${r.y0}..${r.y1}`)
    assert(r.y1 > ART_HEIGHT * 0.7, `${id}: root only reaches ${r.y1}`)
    // The two paths must share the gum line, or the chart's two rows will not join up.
    assert(Math.abs(r.y0 - CERVICAL_Y) < 0.01, `${id}: root starts at ${r.y0}, not ${CERVICAL_Y}`)
    const cervical = (poly) => poly.filter((p) => Math.abs(p.y - CERVICAL_Y) < 0.01).map((p) => p.x)
    const cc = cervical(CROWN_POLY.get(id))
    const rr = cervical(ROOT_POLY.get(id))
    assert(cc.length && rr.length, `${id}: no shared points on the gum line`)
    assert(
      Math.abs(Math.min(...cc) - Math.min(...rr)) < 0.02 && Math.abs(Math.max(...cc) - Math.max(...rr)) < 0.02,
      `${id}: crown neck ${Math.min(...cc)}..${Math.max(...cc)} ≠ root top ${Math.min(...rr)}..${Math.max(...rr)}`
    )
  }
})

check('silhouettes are distinct per tooth type, arch and side', () => {
  const crowns = new Set(IDS.map((id) => ART.get(id).crown))
  assert(crowns.size === 52, `only ${crowns.size} distinct crown outlines for 52 teeth`)
  const roots = new Set(IDS.map((id) => ART.get(id).root))
  assert(roots.size === 52, `only ${roots.size} distinct root outlines for 52 teeth`)
  // Upper vs lower must really differ, not just shift: lower molars are wider and shorter.
  const up = bbox(CROWN_POLY.get('3')) // upper right first molar
  const lo = bbox(CROWN_POLY.get('30')) // lower right first molar
  assert(lo.w > up.w, `lower first molar crown ${lo.w.toFixed(1)} is not wider than upper ${up.w.toFixed(1)}`)
  assert(lo.h < up.h, `lower first molar crown ${lo.h.toFixed(1)} is not shorter than upper ${up.h.toFixed(1)}`)
  return `lower 1st molar crown ${lo.w.toFixed(1)}×${lo.h.toFixed(1)} vs upper ${up.w.toFixed(1)}×${up.h.toFixed(1)}`
})

// Each prong's apex is the one Q in a root path, so counting them counts the roots.
const prongs = (id) => (ART.get(id).root.match(/Q/g) || []).length

check('root counts follow the arch: 3 on upper molars, 2 on lower, 1 elsewhere', () => {
  const expect = (id) => {
    const t = TOOTH_BY_ID.get(id)
    if (t.type === 'molar' && t.dentition === 'permanent') {
      if (t.position === 8) return 2 // third molars: short, often fused
      return t.arch === 'upper' ? 3 : 2
    }
    if (t.type === 'molar') return t.arch === 'upper' ? 3 : 2 // primary molars
    if (t.type === 'premolar' && t.arch === 'upper' && t.position === 4) return 2
    return 1
  }
  for (const id of IDS) {
    assert(prongs(id) === expect(id), `${id} (${TOOTH_BY_ID.get(id).label}): ${prongs(id)} roots, expected ${expect(id)}`)
  }
  return 'upper 1st premolars bifurcated, 3rd molars fused'
})

check('the canine has the longest root in the mouth', () => {
  const reach = (id) => bbox(ROOT_POLY.get(id)).y1
  const perm = IDS.filter((id) => TOOTH_BY_ID.get(id).dentition === 'permanent')
  const canines = perm.filter((id) => TOOTH_BY_ID.get(id).type === 'canine')
  const others = perm.filter((id) => TOOTH_BY_ID.get(id).type !== 'canine')
  const shortestCanine = Math.min(...canines.map(reach))
  const longestOther = Math.max(...others.map(reach))
  assert(canines.length === 4, `${canines.length} canines`)
  assert(
    shortestCanine > longestOther,
    `canine reaches ${shortestCanine.toFixed(1)}, but another root reaches ${longestOther.toFixed(1)}`
  )
  return `canine apex ${shortestCanine.toFixed(1)} vs next longest ${longestOther.toFixed(1)}`
})

check('primary crowns follow the real succession, not a blanket "smaller"', () => {
  // Anterior primary teeth ARE narrower than their successors — that shortfall is the
  // incisor liability. Primary MOLARS are WIDER than the premolars that replace them, and
  // that surplus is the leeway space. A chart that draws every primary tooth smaller gets
  // the mixed dentition backwards exactly where an orthodontist reads it.
  const notes = []
  for (const id of IDS) {
    const t = TOOTH_BY_ID.get(id)
    if (t.dentition !== 'primary') continue
    assert(t.successor, `${id} has no successor in the contract`)
    const kid = bbox(CROWN_POLY.get(id))
    const adult = bbox(CROWN_POLY.get(t.successor))
    if (t.type === 'molar') {
      assert(
        kid.w > adult.w,
        `${id} crown ${kid.w.toFixed(1)} must be WIDER than #${t.successor} ${adult.w.toFixed(1)} (leeway space)`
      )
      if (t.position === 5) notes.push(`${id} ${(kid.w / adult.w * 100).toFixed(0)}%`)
    } else {
      assert(
        kid.w < adult.w,
        `${id} crown ${kid.w.toFixed(1)} must be narrower than #${t.successor} ${adult.w.toFixed(1)}`
      )
    }
    // Every primary crown is SHORTER, whatever its width does.
    assert(
      kid.h < adult.h,
      `${id} crown height ${kid.h.toFixed(1)} is not shorter than #${t.successor} ${adult.h.toFixed(1)}`
    )
  }
  return `second primary molars vs their premolars: ${notes.join(', ')}`
})

check('primary roots are splayed and slender, not a scaled-down copy', () => {
  const notes = []
  for (const id of IDS) {
    const t = TOOTH_BY_ID.get(id)
    if (t.dentition !== 'primary' || t.type !== 'molar') continue
    const kidRoot = bbox(ROOT_POLY.get(id))
    const adultRoot = bbox(ROOT_POLY.get(t.successor))
    const kidCrown = bbox(CROWN_POLY.get(id))
    const adultCrown = bbox(CROWN_POLY.get(t.successor))
    // Shorter crown but a far wider, splayed root: the art cannot be a uniform scale of
    // the successor. Width is deliberately NOT compared here — a primary molar crown is
    // wider than its premolar successor, which the succession check above covers.
    assert(kidCrown.h < adultCrown.h, `${id}: crown ${kidCrown.h.toFixed(1)} not shorter than its successor`)
    assert(
      kidRoot.w > adultRoot.w * 1.4,
      `${id}: root ${kidRoot.w.toFixed(1)} is not splayed past its successor's ${adultRoot.w.toFixed(1)}`
    )
    // Slender: the splayed prongs fill much less of their bounding box than one fat root.
    const fill = (i) => area(ROOT_POLY.get(i)) / (bbox(ROOT_POLY.get(i)).w * bbox(ROOT_POLY.get(i)).h)
    assert(fill(id) < fill(t.successor), `${id}: roots are not more slender than its successor's`)
    notes.push(kidRoot.w / adultRoot.w)
  }
  assert(notes.length === 8, `checked ${notes.length} primary molars`)
  return `primary molar roots ${Math.min(...notes).toFixed(1)}–${Math.max(...notes).toFixed(1)}× the width of the successor's`
})

check('cusp detail matches the tooth type', () => {
  for (const id of IDS) {
    const t = TOOTH_BY_ID.get(id)
    const cusps = ART.get(id).cusps
    assert(Array.isArray(cusps) && cusps.length > 0, `${id}: no detail strokes`)
    // A groove per cusp valley, plus the central groove joining them.
    const want =
      t.type === 'incisor' || t.type === 'canine'
        ? 3
        : 1 +
          (t.type === 'premolar'
            ? 1
            : (t.dentition === 'primary'
                ? t.arch === 'upper'
                  ? t.position === 4
                    ? 3
                    : 4
                  : t.position === 4
                    ? 4
                    : 5
                : t.arch === 'lower' && t.position === 6
                  ? 5
                  : 4) - 1)
    assert(cusps.length === want, `${id} (${t.label}): ${cusps.length} strokes, expected ${want}`)
    for (const d of cusps) {
      for (const p of allPoints(d)) {
        assert(
          p.y > 0 && p.y < CERVICAL_Y,
          `${id}: detail stroke at y=${p.y} is not inside the crown`
        )
      }
    }
  }
  return 'mamelons + cingulum on anteriors, central groove + cusp grooves on posteriors'
})

check('mesial and distal sit on the correct side for each half of the arch', () => {
  for (const id of IDS) {
    const t = TOOTH_BY_ID.get(id)
    const s = ART.get(id).surfaces
    const m = bbox(outline(s.mesial))
    const d = bbox(outline(s.distal))
    // Chart drawn facing the patient: the midline is to the right of every right-side tooth.
    if (t.side === 'right') assert(m.x0 > d.x1, `${id}: mesial is not on the midline side`)
    else assert(m.x1 < d.x0, `${id}: mesial is not on the midline side`)
    const b = bbox(outline(s.buccal))
    const l = bbox(outline(s.lingual))
    assert(b.y1 <= l.y0 + 0.01, `${id}: buccal and lingual bands overlap`)
  }
  return 'buccal band above, lingual below, mesial toward the midline'
})

check('output is deterministic and frozen', () => {
  for (const id of IDS) {
    const a = toothArt(id)
    const b = toothArt(id)
    assert(JSON.stringify(a) === JSON.stringify(ART.get(id)), `${id}: art changed between calls`)
    assert(a.crown === b.crown && a.root === b.root, `${id}: two calls differ`)
    assert(Object.isFrozen(a) && Object.isFrozen(a.surfaces), `${id}: art is mutable`)
  }
})

check('an unknown tooth id is rejected', () => {
  let threw = false
  try {
    toothArt('99')
  } catch {
    threw = true
  }
  assert(threw, 'toothArt("99") did not throw')
})

fs.rmSync(outDir, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)

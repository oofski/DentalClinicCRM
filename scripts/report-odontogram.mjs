// Does the printed record actually show what the dentist charted?
//
//   node scripts/report-odontogram.mjs
//
// The PDF used to be rendered from `examinations.tooth_chart_data`: one condition per tooth,
// keyed 1-32. That format cannot hold a primary tooth, cannot say "crowned AND carious", and
// cannot tell a planned extraction from one already done — so a patient's printed record
// silently dropped findings. This suite builds a realistic chart with exactly those cases and
// asserts they survive into the generated SVG and HTML.
//
// No test framework: the report is a string, so the assertions are string and structure
// assertions, plus a strict tag-balance parser that refuses to let a malformed document pass.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-odontogram-'))
const entry = path.join(outDir, 'entry.ts')
const outFile = path.join(outDir, 'bundle.mjs')

fs.writeFileSync(
  entry,
  [
    `export { buildReportHtml } from ${JSON.stringify(path.join(ROOT, 'electron/main/templates/report.ts'))}`,
    `export * from ${JSON.stringify(path.join(ROOT, 'electron/main/templates/odontogramSvg.ts'))}`,
    `export { projectToLegacy, droppedByLegacy } from ${JSON.stringify(
      path.join(ROOT, 'src/components/odontogram/legacyBridge.ts')
    )}`,
    `export { CONDITION_STYLE, LEGEND_ORDER } from ${JSON.stringify(
      path.join(ROOT, 'src/components/odontogram/conditionStyle.ts')
    )}`,
    `export { STATUS_LABELS, surfaceShorthand } from ${JSON.stringify(
      path.join(ROOT, 'shared/odontogram.ts')
    )}`,
    ''
  ].join('\n')
)

const localEsbuild = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
const [cmd, argv] = fs.existsSync(localEsbuild) ? [localEsbuild, []] : ['npx', ['esbuild']]
execFileSync(
  cmd,
  [
    ...argv,
    entry,
    '--bundle',
    '--format=esm',
    '--platform=node',
    '--log-level=error',
    `--alias:@shared=${path.join(ROOT, 'shared')}`,
    `--outfile=${outFile}`
  ],
  { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] }
)

const M = await import(pathToFileURL(outFile).href)
const {
  buildReportHtml,
  buildOdontogramSvg,
  buildOdontogramLegend,
  conditionsPresent,
  projectToLegacy,
  droppedByLegacy,
  CONDITION_STYLE,
  STATUS_LABELS
} = M

// ---------------------------------------------------------------------------
// A strict markup reader. Anything it cannot account for is a failure, so a document can
// never pass by being quietly ignored.
// ---------------------------------------------------------------------------

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
  'source', 'track', 'wbr'
])
const RAW_TEXT = new Set(['style', 'script'])

/** Every tag in document order: { name, attrs, selfClosing, closing, start, end }. */
function tokenize(doc) {
  const tags = []
  let i = 0
  while (i < doc.length) {
    const lt = doc.indexOf('<', i)
    if (lt < 0) break
    if (doc.startsWith('<!--', lt)) {
      const end = doc.indexOf('-->', lt)
      if (end < 0) throw new Error('unterminated comment')
      i = end + 3
      continue
    }
    if (doc.startsWith('<!', lt)) {
      const end = doc.indexOf('>', lt)
      if (end < 0) throw new Error('unterminated doctype')
      i = end + 1
      continue
    }
    const closing = doc[lt + 1] === '/'
    const nameStart = lt + (closing ? 2 : 1)
    const m = /^[A-Za-z][A-Za-z0-9:-]*/.exec(doc.slice(nameStart))
    if (!m) throw new Error(`stray "<" at ${lt}: ${JSON.stringify(doc.slice(lt, lt + 24))}`)
    const name = m[0].toLowerCase()
    // Walk the attributes honouring quotes, so a ">" inside a value cannot end the tag early.
    let j = nameStart + m[0].length
    const attrs = {}
    let selfClosing = false
    for (;;) {
      while (j < doc.length && /\s/.test(doc[j])) j++
      if (j >= doc.length) throw new Error(`unterminated <${name}>`)
      if (doc[j] === '>') { j++; break }
      if (doc[j] === '/' && doc[j + 1] === '>') { selfClosing = true; j += 2; break }
      const am = /^[^\s=/>]+/.exec(doc.slice(j))
      if (!am) throw new Error(`bad attribute in <${name}> near ${JSON.stringify(doc.slice(j, j + 24))}`)
      const attrName = am[0]
      j += am[0].length
      let value = ''
      while (j < doc.length && /\s/.test(doc[j])) j++
      if (doc[j] === '=') {
        j++
        while (j < doc.length && /\s/.test(doc[j])) j++
        const q = doc[j]
        if (q === '"' || q === "'") {
          const end = doc.indexOf(q, j + 1)
          if (end < 0) throw new Error(`unterminated attribute value in <${name}>`)
          value = doc.slice(j + 1, end)
          j = end + 1
        } else {
          const vm = /^[^\s>]*/.exec(doc.slice(j))
          value = vm[0]
          j += vm[0].length
        }
      }
      attrs[attrName] = value
    }
    tags.push({ name, attrs, selfClosing, closing, start: lt, end: j })
    if (!closing && !selfClosing && RAW_TEXT.has(name)) {
      const close = doc.toLowerCase().indexOf(`</${name}`, j)
      if (close < 0) throw new Error(`unterminated <${name}>`)
      i = close
      continue
    }
    i = j
  }
  return tags
}

/** Fails unless every element opened is closed, in order. */
function assertBalanced(doc, what) {
  const stack = []
  for (const tag of tokenize(doc)) {
    if (tag.closing) {
      const open = stack.pop()
      if (!open) throw new Error(`${what}: </${tag.name}> with nothing open`)
      if (open !== tag.name) throw new Error(`${what}: </${tag.name}> closes <${open}>`)
      continue
    }
    if (tag.selfClosing || VOID.has(tag.name)) continue
    stack.push(tag.name)
  }
  if (stack.length) throw new Error(`${what}: never closed <${stack.join('>, <')}>`)
  return true
}

/** The subtree of the element whose opening tag starts at `from`, as a string. */
function subtree(doc, from) {
  const tags = tokenize(doc.slice(from)).map((t) => ({ ...t, start: t.start + from, end: t.end + from }))
  const root = tags[0]
  if (root.selfClosing) return doc.slice(root.start, root.end)
  let depth = 0
  for (const tag of tags) {
    if (tag.name !== root.name) continue
    if (tag.closing) {
      depth--
      if (depth === 0) return doc.slice(root.start, tag.end)
    } else if (!tag.selfClosing) depth++
  }
  throw new Error(`unterminated <${root.name}>`)
}

/** The markup drawn for one tooth, found by its data-tooth marker. */
function toothGroup(svg, id) {
  const marker = `data-tooth="${id}"`
  const at = svg.indexOf(marker)
  if (at < 0) throw new Error(`tooth ${id} is not on the chart at all`)
  const open = svg.lastIndexOf('<g', at)
  return subtree(svg, open)
}

const tagsWith = (doc, attrName) =>
  tokenize(doc).filter((t) => !t.closing && t.attrs[attrName] !== undefined)

// ---------------------------------------------------------------------------
// The fixture: a chart the legacy format demonstrably cannot hold
// ---------------------------------------------------------------------------

let cid = 0
const C = (tooth, type, status, extra = {}) => ({
  id: ++cid,
  examination_id: 1,
  tooth,
  type,
  status,
  zone: extra.zone ?? CONDITION_STYLE[type]?.defaultZone ?? 'whole',
  surfaces: extra.surfaces ?? [],
  provider_name: extra.provider_name ?? 'Dr. Amara Osei',
  date_recorded: extra.date_recorded ?? '2026-08-04',
  ...extra
})

// Fees are modelled on a Procedure but must never reach the page. Distinctive values, so
// the "no money" check cannot pass by accident.
const FEES = [1234.56, 987.65, 4321, 5678.9, 42.42]

const conditions = [
  // A surface-level carious lesion: two named surfaces, not a whole-tooth flag.
  C('3', 'caries', 'condition', { surfaces: ['occlusal', 'distal'], note: 'Distal shadow on bitewing' }),
  // The case the old chart had to choose between: this tooth is crowned AND decayed.
  C('30', 'crown', 'existing', { material: 'porcelain fused to metal' }),
  C('30', 'caries', 'condition', { surfaces: ['distal'], note: 'Recurrent decay at the crown margin' }),
  // A three-unit bridge: two abutments and a pontic where 19 used to be.
  C('18', 'bridge_abutment', 'existing'),
  C('19', 'missing', 'existing'),
  C('19', 'bridge_pontic', 'existing'),
  C('20', 'bridge_abutment', 'existing'),
  // Planned work, which must not look like work already done.
  C('14', 'extraction', 'planned', { note: 'Non-restorable' }),
  // Root findings — invisible on any chart that only draws crowns.
  C('9', 'root_canal', 'completed', { date_recorded: '2026-07-30' }),
  C('8', 'restoration', 'existing', { surfaces: ['mesial', 'incisal'], material: 'composite' }),
  // PRIMARY TEETH. The legacy blob is keyed 1-32 and drops these entirely.
  C('K', 'caries', 'condition', { surfaces: ['occlusal'], badge: 'PF' }),
  C('K', 'restoration', 'planned', { surfaces: ['occlusal'] }),
  C('A', 'missing', 'existing', { note: 'Exfoliated' }),
  // Junk the renderer must survive: a tooth that does not exist and a condition that does not.
  C('99', 'caries', 'condition'),
  C('2', 'not_a_condition', 'condition')
]

const data = {
  examination_id: 1,
  dentition: 'mixed',
  conditions,
  bridges: [
    {
      id: 1,
      examination_id: 1,
      type: 'bridge',
      teeth: ['18', '19', '20'],
      status: 'existing',
      label: '18-20'
    }
  ],
  plans: [
    { id: 1, examination_id: 1, name: 'Phase treatment', accepted: true, created_at: '2026-08-04' },
    { id: 2, examination_id: 1, name: 'Alternative (implant)', accepted: false, created_at: '2026-08-04' }
  ],
  procedures: [
    {
      id: 1, examination_id: 1, tx_plan_id: 1, phase: 1, code: '',
      description: 'Composite restoration, two surfaces, posterior',
      teeth: ['3'], surfaces: ['occlusal', 'distal'], status: 'planned',
      provider_name: 'Dr. Amara Osei', date: '2026-08-20', fee: FEES[0],
      insurance_estimate: FEES[1], patient_portion: FEES[2], created_at: '2026-08-04'
    },
    {
      id: 2, examination_id: 1, tx_plan_id: 1, phase: 1, code: '',
      description: 'Extraction, erupted tooth', teeth: ['14'], surfaces: [],
      status: 'planned', provider_name: 'Dr. Amara Osei', date: '2026-08-20',
      fee: FEES[3], created_at: '2026-08-04'
    },
    {
      id: 3, examination_id: 1, tx_plan_id: 1, phase: 2, code: '',
      description: 'Porcelain fused to metal crown', teeth: ['30'], surfaces: [],
      status: 'to_start', provider_name: 'Dr. Amara Osei', date: '2026-09-15',
      fee: FEES[4], created_at: '2026-08-04'
    },
    {
      id: 4, examination_id: 1, tx_plan_id: 2, phase: 1, code: '',
      description: 'Implant placement, endosteal', teeth: ['19'], surfaces: [],
      status: 'declined', provider_name: 'Dr. Amara Osei', created_at: '2026-08-04'
    },
    {
      id: 5, examination_id: 1, tx_plan_id: null, phase: 1, code: '',
      description: 'Prophylaxis, child', teeth: ['K'], surfaces: [],
      status: 'completed', provider_name: 'S. Patel, RDH', date: '2026-08-04',
      created_at: '2026-08-04'
    }
  ]
}

/** Teeth and types the chart is expected to draw — the junk rows deliberately excluded. */
const CHARTABLE = conditions.filter((c) => c.tooth !== '99' && c.type !== 'not_a_condition')
const TEETH_WITH_FINDINGS = [...new Set(CHARTABLE.map((c) => c.tooth))]
const TYPES_PRESENT = [...new Set(CHARTABLE.map((c) => c.type))]

const patient = {
  id: 1, patient_id: 'GS-000123', first_name: 'Rosa', last_name: 'Individual-Test',
  date_of_birth: '2018-03-09', phone: null, email: null, address: null,
  emergency_contact: null, emergency_phone: null, allergies: 'Penicillin',
  medical_conditions: null, medications: null, dental_history: 'Mixed dentition, high caries risk',
  insurance_info: null, referring_doctor: null, preferred_language: 'english',
  event_id: null, created_at: '2026-08-04', updated_at: '2026-08-04'
}
const clinic = {
  clinic_name: 'Giving Smiles Dental', address: '1 Test Street', phone: '(555) 010-2030',
  license_number: 'DL-4471', email: 'clinic@example.com', default_language: 'english',
  smtp_host: '', smtp_port: '', smtp_secure: false, smtp_user: '', smtp_pass: '', smtp_from: ''
}
const exam = {
  id: 1, patient_id: 1, doctor_id: 1, doctor_name: 'Dr. Amara Osei', exam_date: '2026-08-04',
  // The legacy blob still exists on the row; the odontogram must be preferred over it.
  tooth_chart_data: { 3: { condition: 'cavity', surfaces: ['occlusal'], note: '' } },
  status: 'completed', created_at: '2026-08-04', updated_at: '2026-08-04'
}
const reportInput = (over = {}) => ({
  clinic, patient, exam, doctorName: 'Dr. Amara Osei', notes: [], treatmentItems: [],
  language: 'english', approvedAt: null, odontogram: data, ...over
})

const svg = buildOdontogramSvg(data, {
  title: 'Tooth chart',
  labels: { upper: 'UPPER', lower: 'LOWER', primary: 'PRIMARY' }
})
const legend = buildOdontogramLegend(data, { idPrefix: 'ogl-' })
const html = buildReportHtml(reportInput())

// ---------------------------------------------------------------------------

let pass = 0
const failures = []
const check = (name, fn) => {
  try {
    const note = fn()
    pass++
    console.log(`  ok    ${name}${note ? ' — ' + note : ''}`)
  } catch (e) {
    failures.push(name)
    console.log(`  FAIL  ${name}\n        ${e.message}`)
  }
}
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
const eq = (a, b, msg) => {
  const A = JSON.stringify(a)
  const B = JSON.stringify(b)
  if (A !== B) throw new Error(`${msg}: got ${A}, want ${B}`)
}

console.log('\nreport-odontogram — the printed record shows what was charted\n')
console.log('  the document is well formed\n')

check('the chart SVG is balanced, with no undefined or NaN', () => {
  assertBalanced(svg, 'chart')
  ok(!/undefined/i.test(svg), 'the word "undefined" reached the chart')
  ok(!/NaN/.test(svg), 'NaN reached the chart')
  ok(!/\[object Object\]/.test(svg), 'an object was stringified into the chart')
  return `${svg.length} chars, ${tokenize(svg).length} tags`
})

check('the legend SVG is balanced, with no undefined or NaN', () => {
  assertBalanced(legend, 'legend')
  ok(!/undefined/i.test(legend) && !/NaN/.test(legend), 'undefined or NaN in the legend')
})

check('the whole report HTML is balanced, with no undefined or NaN', () => {
  assertBalanced(html, 'report')
  ok(!/undefined/i.test(html), 'the word "undefined" reached the report')
  ok(!/NaN/.test(html), 'NaN reached the report')
  ok(!/\[object Object\]/.test(html), 'an object was stringified into the report')
  return `${html.length} chars`
})

check('every id in the document is unique, chart and legend included', () => {
  const ids = tokenize(html)
    .filter((t) => !t.closing && t.attrs.id !== undefined)
    .map((t) => t.attrs.id)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  eq([...new Set(dupes)], [], 'duplicate ids')
  return `${ids.length} ids`
})

check('every url(#…) reference resolves inside its own SVG', () => {
  for (const [what, doc] of [['chart', svg], ['legend', legend]]) {
    const ids = new Set(
      tokenize(doc).filter((t) => !t.closing && t.attrs.id).map((t) => t.attrs.id)
    )
    const refs = [...doc.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
    ok(refs.length > 0, `${what} references no paint server at all`)
    for (const r of refs) ok(ids.has(r), `${what} references #${r}, which is not defined in it`)
  }
})

console.log('\n  the findings the legacy format loses\n')

check('every tooth with a finding is drawn', () => {
  for (const tooth of TEETH_WITH_FINDINGS) {
    const g = toothGroup(svg, tooth)
    const drawn = tagsWith(g, 'data-condition')
    ok(drawn.length > 0, `tooth ${tooth} is on the chart but carries no finding`)
  }
  return `${TEETH_WITH_FINDINGS.length} teeth: ${TEETH_WITH_FINDINGS.join(', ')}`
})

check('the PRIMARY teeth are drawn — the case the legacy chart loses entirely', () => {
  const legacy = projectToLegacy(data)
  eq(droppedByLegacy(data), ['A', 'K'], 'teeth the legacy format cannot hold')
  ok(!('K' in legacy) && !('A' in legacy), 'the legacy blob somehow kept a primary tooth')
  for (const tooth of ['K', 'A']) {
    const g = toothGroup(svg, tooth)
    ok(tagsWith(g, 'data-condition').length > 0, `primary tooth ${tooth} is drawn empty`)
  }
  ok(svg.includes('data-row="primary-lower"'), 'the primary lower arch was not drawn')
  ok(svg.includes('data-row="primary-upper"'), 'the primary upper arch was not drawn')
  ok(html.includes('>K</b>') || /<b>K<\/b>/.test(html), 'tooth K is missing from the findings table')
  return 'K and A are charted and tabled; the old blob drops both'
})

check('a tooth with two findings renders BOTH', () => {
  const g = toothGroup(svg, '30')
  const types = new Set(tagsWith(g, 'data-condition').map((t) => t.attrs['data-condition']))
  ok(types.has('crown'), 'the crown on tooth 30 is not drawn')
  ok(types.has('caries'), 'the caries on tooth 30 is not drawn')
  const k = new Set(tagsWith(toothGroup(svg, 'K'), 'data-condition').map((t) => t.attrs['data-condition']))
  ok(k.has('caries') && k.has('restoration'), 'primary tooth K lost one of its two findings')
  // The legacy projection has to pick ONE, which is exactly the information loss: the blob
  // records the cavity and the crown on that same tooth simply disappears.
  eq(projectToLegacy(data)[30].condition, 'cavity', 'legacy projection of tooth 30')
  return 'crown + caries on 30 (the blob keeps only the cavity), caries + planned restoration on K'
})

check('the same tooth carries two rows in the findings table', () => {
  const rows = [...html.matchAll(/<tr>\s*<td class="og-tooth"><b>([A-T]|\d+)<\/b>/g)].map((m) => m[1])
  const thirty = rows.filter((r) => r === '30').length
  ok(thirty === 2, `tooth 30 has ${thirty} rows in the findings table, want 2`)
  ok(rows.filter((r) => r === 'K').length === 2, 'tooth K lost a row in the findings table')
  return `${rows.length} finding rows`
})

check('a surface-level lesion shades only its own surfaces', () => {
  const g = toothGroup(svg, '3')
  const surfaces = tagsWith(g, 'data-surface')
    .filter((t) => t.attrs['data-condition'] === 'caries')
    .map((t) => t.attrs['data-surface'])
  eq(surfaces.sort(), ['distal', 'occlusal'], 'shaded surfaces on tooth 3')
  ok(html.includes('<td>OD</td>'), 'the OD shorthand is missing from the findings table')
  return 'OD, and the table says so'
})

check('the three-unit bridge is drawn as one connected unit', () => {
  const bars = tagsWith(svg, 'data-bridge')
  ok(bars.length === 1, `expected one bridge connector, got ${bars.length}`)
  const bar = subtree(svg, bars[0].start)
  const [x1, x2] = [...bar.matchAll(/M([\d.]+) [\d.]+ L([\d.]+)/g)][0].slice(1).map(Number)
  ok(x2 - x1 > 2 * 46, `the connector spans ${x2 - x1}px, too short for three units`)
  ok(bar.includes('18-20'), 'the bridge label is missing')
  return `spans ${Math.round(x2 - x1)}px across 18-19-20`
})

console.log('\n  planned work cannot be mistaken for finished work\n')

check('proposed findings are hollow and DASHED, present ones solid', () => {
  const PROPOSED = ['planned', 'to_start', 'today', 'in_progress', 'to_complete']
  const shapes = tagsWith(svg, 'data-condition')
  ok(shapes.length > 0, 'nothing was drawn at all')
  let dashed = 0
  let solid = 0
  for (const t of shapes) {
    const status = t.attrs['data-status']
    const dash = t.attrs['stroke-dasharray']
    if (PROPOSED.includes(status)) {
      ok(dash === '5 3', `${t.attrs['data-condition']} (${status}) is drawn with dash="${dash}"`)
      ok(t.attrs.fill === 'transparent', `proposed ${t.attrs['data-condition']} is filled in solid`)
      dashed++
    } else if (status === 'declined') {
      ok(dash === '1 4', 'declined work should be drawn faintly dashed')
    } else {
      ok(dash === undefined, `${t.attrs['data-condition']} (${status}) is dashed like a plan`)
      ok(t.attrs.fill !== 'transparent', `${status} work is drawn hollow like a plan`)
      solid++
    }
  }
  ok(dashed >= 2 && solid >= 2, `only ${dashed} proposed and ${solid} present shapes`)
  return `${dashed} dashed, ${solid} solid`
})

check('the planned extraction on 14 is dashed, the finished root canal on 9 is not', () => {
  const ext = tagsWith(toothGroup(svg, '14'), 'data-condition').find(
    (t) => t.attrs['data-condition'] === 'extraction'
  )
  ok(ext, 'the planned extraction is not drawn')
  ok(ext.attrs['stroke-dasharray'] === '5 3', 'the planned extraction looks like a done one')
  const rct = tagsWith(toothGroup(svg, '9'), 'data-condition').find(
    (t) => t.attrs['data-condition'] === 'root_canal'
  )
  ok(rct && rct.attrs['data-layer'] === 'root', 'the root canal is not drawn on the root')
  ok(rct.attrs['stroke-dasharray'] === undefined, 'a completed root canal is drawn as a plan')
})

check('the tables mark proposed work dashed too', () => {
  ok(html.includes('og-pill proposed'), 'no proposed pill in the tables')
  ok(html.includes('og-pill present'), 'no present pill in the tables')
  for (const s of ['Planned', 'Existing', 'Completed', 'To Start', 'Declined']) {
    ok(html.includes(`>${s}</span>`), `status "${s}" never appears in the tables`)
  }
  return Object.values(STATUS_LABELS).length + ' statuses available, 5 asserted'
})

console.log('\n  greyscale: patterns, not colour alone\n')

check('findings are filled with PATTERNS, not flat colour', () => {
  const shapes = tagsWith(svg, 'data-condition').filter(
    (t) => t.attrs['data-status'] !== 'planned' && t.attrs['data-status'] !== 'to_start'
  )
  const patterned = shapes.filter((t) => /^url\(#og-pat-/.test(t.attrs.fill || ''))
  ok(patterned.length > 0, 'not one finding is pattern filled — the chart is colour only')
  const kinds = new Set(patterned.map((t) => t.attrs.fill))
  ok(kinds.size >= 4, `only ${kinds.size} distinct pattern fills in use`)
  // Every pattern referenced must actually be defined, or it silently renders as nothing.
  const defined = new Set(
    tokenize(svg).filter((t) => t.name === 'pattern').map((t) => `url(#${t.attrs.id})`)
  )
  for (const k of kinds) ok(defined.has(k), `${k} is referenced but never defined`)
  return `${kinds.size} distinct patterns: ${[...kinds]
    .map((k) => k.replace(/^url\(#og-pat-/, '').replace(/\)$/, ''))
    .join(', ')}`
})

check('the legend swatches are patterned as well', () => {
  const swatches = tokenize(legend).filter((t) => t.name === 'rect' && /^url\(#/.test(t.attrs.fill || ''))
  ok(swatches.length >= 4, `only ${swatches.length} patterned legend swatches`)
})

console.log('\n  the legend says exactly what is on the chart\n')

check('the legend lists the conditions present, and nothing else', () => {
  const listed = tagsWith(legend, 'data-legend').map((t) => t.attrs['data-legend'])
  eq([...listed].sort(), [...conditionsPresent(data)].sort(), 'legend entries')
  eq([...listed].sort(), [...TYPES_PRESENT].sort(), 'legend vs the chart data')
  for (const type of listed) {
    ok(legend.includes(CONDITION_STYLE[type].label), `${type} has no readable label`)
  }
  return `${listed.length}: ${listed.join(', ')}`
})

check('conditions that are NOT on this chart stay off the legend', () => {
  const absent = Object.keys(CONDITION_STYLE).filter((t) => !TYPES_PRESENT.includes(t))
  ok(absent.length > 0, 'the fixture uses every condition, so this proves nothing')
  for (const type of absent) {
    ok(!legend.includes(`data-legend="${type}"`), `${type} is listed but never charted`)
    ok(!legend.includes(CONDITION_STYLE[type].label), `the label "${CONDITION_STYLE[type].label}" leaked into the legend`)
  }
  return `${absent.length} unused conditions, none listed`
})

check('the legend explains solid vs dashed, which is what makes it greyscale-safe', () => {
  ok(legend.includes('data-legend-status="present"'), 'no key for work already in the mouth')
  ok(legend.includes('data-legend-status="proposed"'), 'no key for proposed work')
  ok(/stroke-dasharray="5 3"/.test(legend), 'the proposed key is not drawn dashed')
})

check('the legend counts the teeth carrying each condition', () => {
  ok(legend.includes('Caries (3)'), 'caries is on 3, 30 and K — the legend should say 3')
  ok(legend.includes('Missing (2)'), 'missing is on 19 and A')
})

console.log('\n  the report as a whole\n')

check('the report renders the odontogram, not the legacy chart', () => {
  ok(html.includes('data-tooth="K"'), 'the odontogram is not in the report')
  ok(!html.includes('viewBox="0 0 900 540"'), 'the legacy chart was printed as well')
  ok(html.includes('Findings by Tooth'), 'no per-tooth findings table')
  ok(html.includes('Procedures'), 'no procedures table')
})

check('an exam with NO odontogram still prints the legacy chart', () => {
  const legacyHtml = buildReportHtml(reportInput({ odontogram: null }))
  assertBalanced(legacyHtml, 'legacy report')
  ok(legacyHtml.includes('viewBox="0 0 900 540"'), 'the legacy chart fallback is gone')
  ok(!legacyHtml.includes('data-tooth='), 'an empty odontogram was drawn anyway')
  ok(legacyHtml.includes('Cavity'), 'the legacy condition chips are gone')
  const empty = buildReportHtml(
    reportInput({ odontogram: { examination_id: 1, dentition: 'permanent', conditions: [], bridges: [], procedures: [], plans: [] } })
  )
  ok(empty.includes('viewBox="0 0 900 540"'), 'an odontogram with no rows should fall back')
  return 'fallback intact for pre-upgrade exams'
})

check('procedures are grouped by treatment plan and by phase', () => {
  const plan1 = html.indexOf('Phase treatment')
  const plan2 = html.indexOf('Alternative (implant)')
  const loose = html.indexOf('Not in a treatment plan')
  ok(plan1 > 0 && plan2 > plan1 && loose > plan2, 'plans are not in order, or one is missing')
  const phases = [...html.matchAll(/class="og-phase"><td colspan="\d+">Phase (\d)</g)].map((m) => m[1])
  eq(phases, ['1', '2', '1', '1'], 'phase dividers, in plan order')
  ok(html.indexOf('Composite restoration') < html.indexOf('Porcelain fused to metal crown'),
    'phase 2 work is printed before phase 1')
  return `${phases.length} phase groups across 3 plan blocks`
})

check('MONEY IS OUT OF SCOPE: no fee reaches the page', () => {
  for (const fee of FEES) {
    ok(!html.includes(String(fee)), `fee ${fee} was printed`)
    ok(!html.includes(String(fee).replace('.', ',')), `fee ${fee} was printed`)
  }
  ok(!/\$\s?\d/.test(html), 'a currency amount reached the report')
  return `${FEES.length} fees on the procedures, none printed`
})

check('a corrupt row is dropped, not crashed on, and not half-printed', () => {
  ok(!html.includes('not_a_condition'), 'an unknown condition type was printed')
  ok(!svg.includes('data-tooth="99"'), 'a tooth that does not exist was drawn')
  ok(!/<b>99<\/b>/.test(html), 'a tooth that does not exist reached the findings table')
  return 'one bad tooth id and one bad type, neither drawn nor tabled'
})

check('the provider, surfaces and dates are in the findings table', () => {
  ok(html.includes('Dr. Amara Osei'), 'the recording provider is missing')
  ok(html.includes('S. Patel, RDH'), 'the hygienist on the child prophy is missing')
  ok(html.includes('August 4, 2026'), 'the recorded date is missing')
  ok(html.includes('July 30, 2026'), "the root canal's own date is missing")
  ok(html.includes('<td>MI</td>'), 'the MI shorthand for tooth 8 is missing')
})

check('the report still renders in Spanish and Arabic', () => {
  for (const language of ['spanish', 'arabic']) {
    const doc = buildReportHtml(reportInput({ language }))
    assertBalanced(doc, `${language} report`)
    ok(!/undefined/i.test(doc) && !/NaN/.test(doc), `undefined or NaN in the ${language} report`)
    ok(doc.includes('data-tooth="K"'), `the odontogram is missing from the ${language} report`)
  }
  ok(buildReportHtml(reportInput({ language: 'spanish' })).includes('Hallazgos por Diente'), 'untranslated heading')
  ok(buildReportHtml(reportInput({ language: 'arabic' })).includes('dir="rtl"'), 'the Arabic report lost its direction')
})

check('a permanent-only chart draws two arches, a mixed chart four', () => {
  const permanent = buildOdontogramSvg({ ...data, dentition: 'permanent' })
  eq([...permanent.matchAll(/data-row="([a-z-]+)"/g)].map((m) => m[1]),
    ['permanent-upper', 'permanent-lower'], 'permanent rows')
  eq([...svg.matchAll(/data-row="([a-z-]+)"/g)].map((m) => m[1]),
    ['permanent-upper', 'primary-upper', 'primary-lower', 'permanent-lower'], 'mixed rows')
  const primaryOnly = buildOdontogramSvg({ ...data, dentition: 'primary' })
  eq([...primaryOnly.matchAll(/data-row="([a-z-]+)"/g)].map((m) => m[1]),
    ['primary-upper', 'primary-lower'], 'primary rows')
})

check('an empty chart is still a valid, drawable chart', () => {
  const blank = { examination_id: 9, dentition: 'permanent', conditions: [], bridges: [], procedures: [], plans: [] }
  const doc = buildOdontogramSvg(blank)
  assertBalanced(doc, 'empty chart')
  ok(!/undefined|NaN/i.test(doc), 'undefined or NaN in an empty chart')
  eq(tagsWith(doc, 'data-condition').length, 0, 'findings on an empty chart')
  eq(tagsWith(buildOdontogramLegend(blank), 'data-legend').length, 0, 'legend entries with nothing charted')
  ok(tokenize(doc).filter((t) => t.attrs && t.attrs['data-tooth']).length === 32, 'a blank chart should still draw 32 teeth')
})

check('building the report does not mutate the chart it was given', () => {
  const before = JSON.stringify(data)
  buildReportHtml(reportInput())
  buildOdontogramSvg(data)
  buildOdontogramLegend(data)
  eq(JSON.stringify(data), before, 'the record was changed by printing it')
})

console.log(`\n${pass} passed, ${failures.length} failed\n`)
if (failures.length) console.log(`failed: ${failures.join(', ')}\n`)
process.exit(failures.length ? 1 : 0)

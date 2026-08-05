// Offline "Dental Scribe" — turns free dictation into corrected clinical text plus
// structured findings (condition + surfaces per tooth) and treatment suggestions.
//
// Adapted from the ideas in DentaScribe (https://github.com/Victor-lyhan/dentascribe,
// MIT license): a dental-domain lexicon correction pass, tooth-notation conversion
// (Universal / FDI / Palmer), and review flags for ambiguous terms. This is a pure
// rule + lexicon reimplementation in TypeScript — NO ML model, NO Ollama, NO network —
// so it runs entirely inside the offline app.
//
// PIPELINE:  correct → segment into clauses → extract tooth refs (with a veto layer)
//            → read clinical intent per clause → bind teeth to the intent nearest them
//            → apply retractions → aggregate.
//
// Design rule throughout: a WRONG chart entry is worse than a missing one. Anything
// ambiguous is dropped and flagged for the doctor rather than guessed at.
//
// Regression suite: scripts/scribe-corpus.json (`node scripts/scribe-corpus.mjs`).

import type { ToothConditionKey, SurfaceKey } from './types'

export interface ScribeCorrection {
  from: string
  to: string
}
export interface ScribeFlag {
  term: string
  note: string
}
export interface ScribeToothFinding {
  tooth: number // Universal 1–32
  condition?: ToothConditionKey
  surfaces: SurfaceKey[]
  text: string // the clause this was extracted from
}
export interface ScribeTreatment {
  tooth: number | null
  treatment: string // one of RECOMMENDED_TREATMENTS
  text: string
}
export interface ScribeNote {
  text: string
}
export interface ScribeResult {
  corrected: string
  corrections: ScribeCorrection[]
  teeth: ScribeToothFinding[]
  treatments: ScribeTreatment[]
  notes: ScribeNote[]
  flags: ScribeFlag[]
  markOthersHealthy: boolean
}

// ---------------------------------------------------------------------------
// 1) Lexicon correction
// ---------------------------------------------------------------------------

// Frequent dictation/ASR confusions in dental speech → canonical term (lower-case).
const CONFUSIONS: Record<string, string> = {
  buckle: 'buccal',
  buckal: 'buccal',
  buccle: 'buccal',
  buchal: 'buccal',
  mesal: 'mesial',
  mezial: 'mesial',
  mesical: 'mesial',
  distil: 'distal',
  distill: 'distal',
  distdal: 'distal',
  occlusial: 'occlusal',
  occlusel: 'occlusal',
  oclusal: 'occlusal',
  occulsal: 'occlusal',
  aclusal: 'occlusal',
  lingural: 'lingual',
  lingular: 'lingual',
  lingal: 'lingual',
  carries: 'caries',
  karies: 'caries',
  caverty: 'cavity',
  gingervitis: 'gingivitis',
  pariodontal: 'periodontal',
  periodntal: 'periodontal',
  pulpitus: 'pulpitis',
  polpitis: 'pulpitis',
  abcess: 'abscess',
  absess: 'abscess',
  amalgum: 'amalgam',
  amalgom: 'amalgam',
  extration: 'extraction',
  extracton: 'extraction',
  inciser: 'incisor',
  incissor: 'incisor',
  premoler: 'premolar',
  moler: 'molar',
  restauration: 'restoration',
  restorition: 'restoration',
  prophilaxis: 'prophylaxis',
  endodontik: 'endodontic',
  periapicle: 'periapical',
  periapicial: 'periapical',
  edentelous: 'edentulous',
  maxilary: 'maxillary',
  mandibuler: 'mandibular',
  mandiblular: 'mandibular'
}

// Canonical dental vocabulary used for conservative fuzzy correction of near-miss
// tokens (edit distance 1, multi-syllable only) so ordinary English isn't mangled.
const VOCAB: string[] = [
  'buccal', 'lingual', 'mesial', 'distal', 'occlusal', 'incisal', 'facial', 'palatal',
  'cavity', 'caries', 'carious', 'filling', 'composite', 'amalgam', 'restoration',
  'crown', 'bridge', 'implant', 'veneer', 'inlay', 'onlay', 'denture',
  'extraction', 'endodontic', 'endodontics', 'canal', 'pulpitis', 'pulpal',
  'periapical', 'abscess', 'periodontal', 'periodontitis', 'gingivitis', 'gingival',
  'plaque', 'calculus', 'scaling', 'prophylaxis', 'fluoride', 'sealant',
  'molar', 'premolar', 'bicuspid', 'incisor', 'canine', 'cuspid',
  'mobility', 'recession', 'fracture', 'fractured', 'attrition', 'abrasion', 'erosion',
  'edentulous', 'impacted', 'malocclusion', 'occlusion', 'bruxism', 'bitewing',
  'anesthetic', 'lidocaine', 'articaine', 'restorative', 'prophylactic',
  'maxillary', 'mandibular', 'distolingual', 'mesiobuccal', 'distobuccal', 'mesiolingual'
]
const VOCAB_SET = new Set(VOCAB)

function editDistance1(a: string, b: string): boolean {
  if (a === b) return false
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (la > lb) i++
    else if (lb > la) j++
    else {
      i++
      j++
    }
  }
  if (i < la || j < lb) edits++
  return edits === 1
}

function correctToken(lower: string): string | null {
  if (CONFUSIONS[lower]) return CONFUSIONS[lower]
  if (VOCAB_SET.has(lower)) return null
  if (lower.length >= 6) {
    for (const term of VOCAB) {
      if (Math.abs(term.length - lower.length) <= 1 && editDistance1(lower, term)) return term
    }
  }
  return null
}

function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source.length > 1) return replacement.toUpperCase()
  if (source[0] === source[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1)
  return replacement
}

function applyCorrections(text: string): {
  corrected: string
  corrections: ScribeCorrection[]
  words: number
  changed: number
} {
  const corrections: ScribeCorrection[] = []
  const seen = new Set<string>()
  let words = 0
  let changed = 0
  const corrected = text.replace(/[A-Za-z][A-Za-z'-]*/g, (word) => {
    words++
    const fixed = correctToken(word.toLowerCase())
    if (!fixed) return word
    const out = matchCase(word, fixed)
    if (out === word) return word
    changed++
    const key = `${word.toLowerCase()}→${fixed}`
    if (!seen.has(key)) {
      seen.add(key)
      corrections.push({ from: word, to: out })
    }
    return out
  })
  return { corrected, corrections, words, changed }
}

// ---------------------------------------------------------------------------
// 2) Number words
// ---------------------------------------------------------------------------

const ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9
}
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30 }

// ---------------------------------------------------------------------------
// 3) Tooth-notation math (Universal 1–32)
// ---------------------------------------------------------------------------

// Quadrant (1=UR, 2=UL, 3=LL, 4=LR per FDI/Palmer) + position 1–8 → Universal.
function quadrantToUniversal(quadrant: number, pos: number): number | null {
  if (pos < 1 || pos > 8) return null
  switch (quadrant) {
    case 1: return 9 - pos   // upper right: FDI 11→8 … 18→1
    case 2: return 8 + pos   // upper left:  FDI 21→9 … 28→16
    case 3: return 25 - pos  // lower left:  FDI 31→24 … 38→17
    case 4: return 24 + pos  // lower right: FDI 41→25 … 48→32
    default: return null
  }
}

function fdiToUniversal(fdi: number): number | null {
  const q = Math.floor(fdi / 10)
  const p = fdi % 10
  if (q < 1 || q > 4) return null
  return quadrantToUniversal(q, p)
}

const QUADRANT_CODES: Record<string, number> = { ur: 1, ul: 2, ll: 3, lr: 4 }
const TOOTH_NAME_POS: Record<string, number> = {
  'central incisor': 1,
  'lateral incisor': 2,
  canine: 3,
  cuspid: 3,
  'first premolar': 4,
  'first bicuspid': 4,
  'second premolar': 5,
  'second bicuspid': 5,
  'first molar': 6,
  'second molar': 7,
  'third molar': 8
}

// ---------------------------------------------------------------------------
// 4) Clinical vocabulary
// ---------------------------------------------------------------------------

// Something the doctor says the tooth NEEDS. Charts as "treatment" (the tooth is
// still present and requires work) and is the ONLY source of plan suggestions.
const NEEDS_WORK =
  /\b(?:needs?|needing|going to need|gonna need|will need|requires?|indicated for|due for|prep|prepping|recommend|recommended|recommending|replace|replacing|redo)\b/

// Present-state conditions, consulted only when the clause is NOT a "needs work" clause.
const PRESENT_STATE: { re: RegExp; key: ToothConditionKey }[] = [
  { re: /\b(?:is|are|has|have|with)\s+(?:an?\s+)?implants?\b/, key: 'implant' },
  { re: /\b(?:missing|absent|edentulous|extracted|taken out|had .{0,20}\bout\b|\bout\b\s+years ago)\b/, key: 'missing' },
  { re: /\b(?:cavit(?:y|ies)|caries|carious|decay(?:ed)?)\b/, key: 'cavity' },
  { re: /\b(?:filled|filling|restored|restoration|composite|amalgam|inlay|onlay)\b/, key: 'filled' },
  { re: /\b(?:fractur(?:e|ed)|abscess|periapical|pulpitis|lesion|defective|leaking|cracked|broken)\b/, key: 'treatment' },
  { re: /\b(?:healthy|sound|intact|wnl|within normal limits|unremarkable|no abnormalit|looks? (?:good|fine)|is fine|are fine)\b/, key: 'healthy' }
]

const SURFACE_KEYWORDS: { re: RegExp; key: SurfaceKey }[] = [
  { re: /\bocclusal\b/, key: 'occlusal' },
  { re: /\b(?:buccal|facial|distobuccal|mesiobuccal)\b/, key: 'buccal' },
  { re: /\b(?:lingual|palatal|distolingual|mesiolingual)\b/, key: 'lingual' },
  { re: /\b(?:mesial|mesio)\b/, key: 'mesial' },
  { re: /\b(?:distal|disto)\b/, key: 'distal' }
]
const SURFACE_LETTER: Record<string, SurfaceKey> = {
  m: 'mesial', o: 'occlusal', d: 'distal', b: 'buccal', l: 'lingual'
}
// Upper-case letter runs that are NOT surface shorthand.
const NOT_SURFACES = new Set(['DOB', 'BMD', 'LDL', 'OD', 'BM', 'MD'])

// Procedure → plan item. Only consulted inside a "needs work" clause, so a tooth is
// never given a plan item because a procedure noun was merely mentioned in passing
// ("tooth 30 is an implant with a crown on it" must not book a crown).
const PROCEDURES: { re: RegExp; treatment: string }[] = [
  { re: /\b(?:root canal|rct|endodontic|endo)\b/, treatment: 'Root Canal' },
  { re: /\b(?:crown|cap)\b/, treatment: 'Crown' },
  { re: /\b(?:extraction|extract|extracted|extracting|removal|taken out|pulled)\b/, treatment: 'Extraction' },
  { re: /\bimplants?\b/, treatment: 'Implant' },
  { re: /\b(?:scaling|scale|polish|polishing|prophylaxis|prophy)\b/, treatment: 'Scaling & Polishing' },
  { re: /\bcleaning\b/, treatment: 'Cleaning' },
  { re: /\bnight ?guard\b/, treatment: 'Night Guard' },
  { re: /\b(?:referral|refer|referred|specialist)\b/, treatment: 'Referral' },
  { re: /\b(?:follow[- ]?up|recall|re-?evaluate|monitor|watch)\b/, treatment: 'Follow-up' },
  { re: /\b(?:filling|composite|amalgam|restore|restoration|restorative)\b/, treatment: 'Filling' }
]

// ---------------------------------------------------------------------------
// 5) Veto layer — reasons a number is NOT a tooth
// ---------------------------------------------------------------------------

// Unit / noise words that, when they follow a number, prove it isn't a tooth.
const UNIT_AFTER =
  /^[\s-]*(?:%|mm\b|cm\b|millimet|centimet|years?\b|yrs?\b|y\/o\b|months?\b|weeks?\b|days?\b|hours?\b|minutes?\b|mins?\b|seconds?\b|x-?rays?\b|films?\b|images?\b|bitewings?\b|carpules?\b|cartridges?\b|units?\b|cc\b|ml\b|mg\b|degrees?\b|times?\b|over\b|per\b|hundred\b|thousand\b|percent\b|out of\b)/i

// Clause contexts where numbers are measurements or admin, never teeth.
const MEASUREMENT_CONTEXT =
  /\b(?:probing|pocket|depths?|recession|bleeding on probing|blood pressure|\bbp\b|pulse|temperature|furcation)\b/i
const ADMIN_CONTEXT =
  /\b(?:front desk|reception|book|booking|schedule|appointment|insurance|billing|come back|next visit)\b/i
// Uncertainty — the doctor is thinking aloud, not charting.
const HEDGE_CONTEXT =
  /\b(?:not sure|unsure|hard to tell|can'?t tell|maybe|might be|possibly|could be|shadow|difficult to say)\b/i
// Asides that belong in the notes, not on the chart.
const ASIDE_CONTEXT =
  /\b(?:for (?:the )?(?:patient|chart) notes?|just noting|note for|make a note|tell the front desk|let the front desk)\b/i

// ---------------------------------------------------------------------------
// 6) Segmentation
// ---------------------------------------------------------------------------

// Discourse markers that start a new thought even with no punctuation — Windows
// voice typing routinely emits 100+ words without a single full stop.
const DISCOURSE =
  /\s+(?=(?:other than that|outside of|apart from|aside from|and then also|and then|along with|moving on|next up)\b)/gi

function splitSegments(text: string): string[] {
  let t = text
  // ASR sentence boundary: a lower-case word followed by a capitalised word.
  t = t.replace(/([a-z,;)])\s+(?=[A-Z][a-z])/g, '$1 ||| ')
  t = t.replace(DISCOURSE, ' ||| ')
  // A fresh tooth reference mid-clause starts a new statement: "...both have cavities
  // to 19 is going to need a root canal" is two findings, not one. ("to"/"too" are here
  // because ASR writes them for "tooth".) Never splits a leading "Tooth number 32".
  t = t.replace(
    /(\S)\s+(?=(?:tooth|teeth|to|too)\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty)\b)/gi,
    '$1 ||| '
  )
  const rough = t.split(/(?<=[.;!?])\s+|\n+|\s*\|\|\|\s*/)
  const out: string[] = []
  for (const s of rough) {
    // Clause split — commas and contrastive conjunctions separate one tooth's
    // story from the next.
    for (const part of s.split(/,\s*|\s+\bbut\b\s+|\s+\bwhereas\b\s+|:\s*/i)) {
      const v = part.trim()
      if (v) out.push(v)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 7) Tooth extraction
// ---------------------------------------------------------------------------

interface ToothRef {
  tooth: number
  anchored: boolean
}

function pushTooth(list: ToothRef[], n: number | null, anchored: boolean): void {
  if (n == null || n < 1 || n > 32) return
  const existing = list.find((x) => x.tooth === n)
  if (!existing) list.push({ tooth: n, anchored })
  else if (anchored) existing.anchored = true
}

/**
 * Extract the teeth referred to in one clause.
 * `allowBare` permits unanchored numbers ("15 and 16 both have cavities") and is only
 * enabled when the clause actually carries a clinical statement.
 */
function parseTeeth(clause: string, allowBare: boolean): { refs: ToothRef[]; flags: ScribeFlag[] } {
  const refs: ToothRef[] = []
  const flags: ScribeFlag[] = []
  const lower = clause.toLowerCase()
  // Notation already consumed (FDI / Palmer / named) is blanked out so the generic
  // number scan below can't re-read "UR6" as tooth 6 or "lower left seven" as tooth 7.
  let masked = lower
  const consume = (start: number, len: number) => {
    masked = masked.slice(0, start) + ' '.repeat(len) + masked.slice(start + len)
  }

  // Numbers here are measurements or admin, never teeth.
  if (MEASUREMENT_CONTEXT.test(lower) || ADMIN_CONTEXT.test(lower)) return { refs, flags }

  // -- named groups ---------------------------------------------------------
  if (/\bwisdom (?:teeth|tooth)\b/.test(lower)) {
    for (const n of [1, 16, 17, 32]) pushTooth(refs, n, true)
    return { refs, flags }
  }

  // -- explicit FDI ---------------------------------------------------------
  for (const m of lower.matchAll(/\bfdi\s*(?:notation[, ]*)?(?:tooth\s*)?#?\s*(\d{2})\b/g)) {
    const u = fdiToUniversal(parseInt(m[1], 10))
    if (u) pushTooth(refs, u, true)
    else flags.push({ term: m[0], note: `Couldn't read FDI tooth "${m[1]}"` })
    consume(m.index ?? 0, m[0].length)
  }

  // -- Palmer / quadrant codes: UR6 -----------------------------------------
  for (const m of lower.matchAll(/\b(ur|ul|lr|ll)\s*([1-8])\b/g)) {
    pushTooth(refs, quadrantToUniversal(QUADRANT_CODES[m[1]], parseInt(m[2], 10)), true)
    consume(m.index ?? 0, m[0].length)
  }

  // -- named teeth: "upper right first molar" -------------------------------
  for (const m of lower.matchAll(
    /\b(?:upper|maxillary|lower|mandibular)\s+(right|left)\s+((?:first|second|third)\s+(?:molar|premolar|bicuspid)|(?:central|lateral)\s+incisor|canine|cuspid)/g
  )) {
    const arch = /upper|maxillary/.test(m[0]) ? 'u' : 'l'
    const pos = TOOTH_NAME_POS[m[2].trim()]
    if (pos) {
      const quadrant = arch === 'u' ? (m[1] === 'right' ? 1 : 2) : m[1] === 'right' ? 4 : 3
      pushTooth(refs, quadrantToUniversal(quadrant, pos), true)
      consume(m.index ?? 0, m[0].length)
    }
  }

  // -- spoken quadrant + position: "lower left seven" -----------------------
  for (const m of masked.matchAll(/\b(upper|maxillary|lower|mandibular)\s+(right|left)\s+([a-z]+|\d)\b/g)) {
    const arch = /upper|maxillary/.test(m[1]) ? 'u' : 'l'
    const quadrant = arch === 'u' ? (m[2] === 'right' ? 1 : 2) : m[2] === 'right' ? 4 : 3
    const raw = m[3]
    const val = ONES[raw] ?? (/^\d$/.test(raw) ? parseInt(raw, 10) : undefined)
    if (val != null && val >= 1 && val <= 8) {
      pushTooth(refs, quadrantToUniversal(quadrant, val), true)
      consume(m.index ?? 0, m[0].length)
    }
  }

  // -- numeric + number-word scanning ---------------------------------------
  const tokens: { text: string; value: number | null; index: number; end: number }[] = []
  for (const m of masked.matchAll(/[a-z]+|\d{1,3}/g)) {
    const t = m[0]
    let value: number | null = null
    if (/^\d+$/.test(t)) value = parseInt(t, 10)
    else if (t in TEENS) value = TEENS[t]
    else if (t in TENS) value = TENS[t]
    else if (t in ONES) value = ONES[t]
    tokens.push({ text: t, value, index: m.index ?? 0, end: (m.index ?? 0) + t.length })
  }

  // "to"/"too" are included because ASR routinely writes them for "tooth";
  // "from" covers "apart from 30".
  const ANCHOR = /^(?:tooth|teeth|number|no|num|to|too|on|from)$/
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.value == null) continue
    if (UNIT_AFTER.test(masked.slice(tok.end))) continue

    const prev = i > 0 ? tokens[i - 1] : null
    const prevChar = masked.slice(Math.max(0, tok.index - 1), tok.index)
    const anchored = !!(prev && ANCHOR.test(prev.text)) || prevChar === '#'

    let value = tok.value
    let consumed = i
    let isPair = false
    if (tok.text in TENS && tokens[i + 1] && tokens[i + 1].text in ONES) {
      // "thirty two"
      value = tok.value + ONES[tokens[i + 1].text]
      consumed = i + 1
      isPair = true
    } else if (tok.text in ONES && tokens[i + 1] && tokens[i + 1].text in ONES) {
      // Spoken digit pair: "two four" = 24. Word forms only, and only when the pair
      // lands in tooth range and isn't followed by a unit.
      const pair = tok.value * 10 + ONES[tokens[i + 1].text]
      if (pair >= 1 && pair <= 32 && !UNIT_AFTER.test(masked.slice(tokens[i + 1].end))) {
        value = pair
        consumed = i + 1
        isPair = true
      }
    }

    // A lone single-digit WORD is nearly always a quantity ("the top two", "one
    // carpule"), not a tooth. Accept it only when anchored or part of a pair.
    if (!isPair && tok.text in ONES && !anchored) {
      i = consumed
      continue
    }

    // Out of Universal range → maybe FDI (11–48).
    let universal: number | null = null
    if (value >= 1 && value <= 32) universal = value
    else if (value >= 33 && value <= 48) universal = fdiToUniversal(value)

    i = consumed
    if (universal == null) continue
    if (!anchored && !allowBare) continue
    pushTooth(refs, universal, anchored)
  }

  return { refs, flags }
}

function extractSurfaces(clause: string): SurfaceKey[] {
  const lower = clause.toLowerCase()
  const found = new Set<SurfaceKey>()
  for (const s of SURFACE_KEYWORDS) if (s.re.test(lower)) found.add(s.key)
  for (const m of clause.matchAll(/\b([MODBL]{2,3})\b/g)) {
    const tok = m[1]
    if (NOT_SURFACES.has(tok)) continue
    if (new Set(tok).size !== tok.length) continue // repeated letters aren't a surface code
    for (const ch of tok) {
      const k = SURFACE_LETTER[ch.toLowerCase()]
      if (k) found.add(k)
    }
  }
  const order: SurfaceKey[] = ['occlusal', 'buccal', 'lingual', 'mesial', 'distal']
  return order.filter((s) => found.has(s))
}

// ---------------------------------------------------------------------------
// 8) Blanket "everything else is healthy", retraction
// ---------------------------------------------------------------------------

const BLANKET =
  /\b(?:all (?:the )?other (?:teeth|ones)|all other teeth|the rest(?: of (?:them|that \w+))?|everything else|all teeth|remaining teeth)\b[^.;!?]{0,40}?\b(?:healthy|fine|good|normal|wnl|within normal limits|unremarkable)\b/i
// Same idea but limited to one quadrant/arch — must NOT sweep the whole mouth.
const BLANKET_SCOPED = /\b(?:that|this|the)\s+(?:quadrant|arch|side|sextant)\b/i

const RETRACTION =
  /\b(?:scratch that|strike that|disregard that|ignore that|forget that|actually,? no|sorry,? i meant|i meant)\b/i

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function analyzeDictation(input: string): ScribeResult {
  const flags: ScribeFlag[] = []
  const notes: ScribeNote[] = []
  const { corrected, corrections, words, changed } = applyCorrections(input || '')

  // Review guard (in the spirit of DentaScribe's <25% rewrite cap).
  if (words >= 8 && changed / words > 0.25) {
    flags.push({ term: 'transcript', note: 'Many words were auto-corrected — please read the transcript closely.' })
  }

  let markOthersHealthy = false
  // Findings are grouped per clause so a retraction can drop exactly one group.
  const groups: { teeth: ScribeToothFinding[]; treatments: ScribeTreatment[] }[] = []
  let pending: ToothRef[] | null = null
  // Only the clause IMMEDIATELY before a retraction is undone. "Scratch that" after a
  // run of filler ("um, wait, actually, no") retracts the filler, not the finding the
  // doctor dictated a sentence earlier.
  let prevClauseProducedFindings = false
  let lastNeedsWork = false

  for (const rawClause of splitSegments(corrected)) {
    const clause = rawClause.trim()
    if (!clause) continue
    const lower = clause.toLowerCase()

    // -- retraction: drop the immediately preceding group ----------------------
    if (RETRACTION.test(lower)) {
      if (prevClauseProducedFindings) {
        groups.pop()
        flags.push({ term: 'scratch that', note: 'A previous finding was retracted, as dictated.' })
      }
      prevClauseProducedFindings = false
      pending = null
      // Fall through: the same clause often carries the correction
      // ("scratch that, tooth 15 needs the crown").
    }

    // -- blanket "everything else is healthy" ---------------------------------
    if (BLANKET.test(lower)) {
      if (BLANKET_SCOPED.test(lower)) {
        flags.push({
          term: clause.slice(0, 48),
          note: 'Heard "the rest of that area is fine" — limited to one area, so other teeth were left unmarked.'
        })
      } else {
        markOthersHealthy = true
      }
      // IMPORTANT: only the blanket clause is consumed, never the whole sentence — a
      // doctor routinely states the blanket in the same breath as real findings.
      continue
    }

    // -- asides go to the notes, never to the chart ----------------------------
    if (ASIDE_CONTEXT.test(lower)) {
      notes.push({ text: clause })
      pending = null
      continue
    }

    // -- uncertainty: the doctor is thinking aloud -----------------------------
    if (HEDGE_CONTEXT.test(lower) || /\?\s*$/.test(clause)) {
      if (/\b(?:cavit|caries|decay|crown|fractur)\b/i.test(lower)) {
        flags.push({
          term: clause.slice(0, 48),
          note: 'Heard an uncertain finding — not charted. Add it manually if you want it recorded.'
        })
      }
      pending = null
      continue
    }

    const ownNeedsWork = NEEDS_WORK.test(lower)
    const presentState = PRESENT_STATE.find((c) => c.re.test(lower))?.key
    // "She needs a scaling and polishing, and a night guard" — the second clause
    // continues the same "needs" list. Only carry the intent when the clause states
    // no condition of its own, so "and 12 has an occlusal cavity" stays a cavity.
    const continuation: boolean =
      !ownNeedsWork && !presentState && lastNeedsWork && /^(?:and|plus|also)\b/.test(lower)
    const needsWork: boolean = ownNeedsWork || continuation
    lastNeedsWork = needsWork
    const condition: ToothConditionKey | undefined = needsWork ? 'treatment' : presentState
    const hasIntent = !!condition
    const surfaces = extractSurfaces(clause)

    const { refs, flags: toothFlags } = parseTeeth(clause, hasIntent || surfaces.length > 0)
    flags.push(...toothFlags)

    const procedures = needsWork ? PROCEDURES.filter((p) => p.re.test(lower)).map((p) => p.treatment) : []

    // Teeth named here with no clinical intent — the intent may follow
    // ("apart from 30, which needs a crown"). Hold them for the next clause.
    if (refs.length && !hasIntent && !surfaces.length) {
      pending = refs
      continue
    }

    // Intent stated here with no tooth — bind to the teeth held from the previous clause.
    let bound = refs
    if (!bound.length && pending && hasIntent) {
      bound = pending
      pending = null
    }

    const group = { teeth: [] as ScribeToothFinding[], treatments: [] as ScribeTreatment[] }
    if (bound.length && condition) {
      for (const r of bound) group.teeth.push({ tooth: r.tooth, condition, surfaces, text: clause })
      for (const t of procedures) {
        for (const r of bound) group.treatments.push({ tooth: r.tooth, treatment: t, text: clause })
      }
    } else if (procedures.length && !bound.length) {
      // Arch-level treatment with no tooth ("she needs a scaling and polishing").
      for (const t of procedures) group.treatments.push({ tooth: null, treatment: t, text: clause })
    } else if (hasIntent && !bound.length && condition !== 'healthy') {
      flags.push({
        term: clause.slice(0, 48),
        note: 'Heard a finding with no tooth number — not applied to the chart.'
      })
    }

    if (refs.length) pending = null
    const produced = group.teeth.length > 0 || group.treatments.length > 0
    if (produced) groups.push(group)
    prevClauseProducedFindings = produced
  }

  const teeth = groups.flatMap((g) => g.teeth)
  const treatments = groups.flatMap((g) => g.treatments)

  // Safety interlock: a blanket "all others healthy" together with ZERO parsed findings,
  // in a dictation that clearly described problems, means the parse failed. Charting the
  // whole mouth healthy would be the worst possible error, so refuse and say so.
  if (
    markOthersHealthy &&
    teeth.length === 0 &&
    /\b(?:cavit|caries|decay|crown|root canal|extract|implant|filling|missing)\b/i.test(corrected)
  ) {
    markOthersHealthy = false
    flags.push({
      term: 'all others healthy',
      note: 'Heard "all other teeth are healthy" but no individual findings could be read — not marking the whole mouth healthy. Please chart manually.'
    })
  }

  // Collapse duplicate findings per tooth; a later, more specific statement wins.
  const byTooth = new Map<number, ScribeToothFinding>()
  for (const f of teeth) {
    const cur = byTooth.get(f.tooth)
    if (!cur) {
      byTooth.set(f.tooth, { ...f, surfaces: [...f.surfaces] })
    } else {
      if (f.condition && f.condition !== 'healthy') cur.condition = f.condition
      for (const s of f.surfaces) if (!cur.surfaces.includes(s)) cur.surfaces.push(s)
    }
  }

  const seenTx = new Set<string>()
  const dedupTx = treatments.filter((t) => {
    const k = `${t.tooth ?? '-'}:${t.treatment}`
    if (seenTx.has(k)) return false
    seenTx.add(k)
    return true
  })

  return {
    corrected,
    corrections,
    teeth: [...byTooth.values()].sort((a, b) => a.tooth - b.tooth),
    treatments: dedupTx,
    notes,
    flags,
    markOthersHealthy
  }
}

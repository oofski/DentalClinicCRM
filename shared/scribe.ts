// Offline "Dental Scribe" — turns free dictation into corrected clinical text plus
// structured findings (condition + surfaces per tooth) and treatment suggestions.
//
// Adapted from the ideas in DentaScribe (https://github.com/Victor-lyhan/dentascribe,
// MIT license): a dental-domain lexicon correction pass, tooth-notation conversion
// (Universal / FDI / Palmer), and review flags for ambiguous terms. This is a pure
// rule + lexicon reimplementation in TypeScript — NO ML model, NO Ollama, NO network —
// so it runs entirely inside the offline app. The raw speech-to-text still comes from
// the OS (Windows voice typing); this layer cleans it up and structures it.

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
  text: string // the sentence this was extracted from
}
export interface ScribeTreatment {
  tooth: number | null
  treatment: string // one of RECOMMENDED_TREATMENTS
  text: string
}
export interface ScribeResult {
  corrected: string
  corrections: ScribeCorrection[]
  teeth: ScribeToothFinding[]
  treatments: ScribeTreatment[]
  flags: ScribeFlag[]
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
  medial: 'mesial',
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
  prophylactic: 'prophylactic',
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

// Correct a single lowercase alphabetic token; returns the canonical form or null.
function correctToken(lower: string): string | null {
  if (CONFUSIONS[lower]) return CONFUSIONS[lower] === lower ? null : CONFUSIONS[lower]
  if (VOCAB_SET.has(lower)) return null
  if (lower.length >= 6) {
    for (const term of VOCAB) {
      if (Math.abs(term.length - lower.length) <= 1 && editDistance1(lower, term)) return term
    }
  }
  return null
}

// Preserve the original casing pattern (Title-case / UPPER) when substituting.
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
// 2) Tooth-notation normalization → Universal 1–32
// ---------------------------------------------------------------------------

// Quadrant (1=UR, 2=UL, 3=LL, 4=LR per FDI/Palmer) + tooth position 1–8 → Universal.
function quadrantToUniversal(quadrant: number, pos: number): number | null {
  if (pos < 1 || pos > 8) return null
  switch (quadrant) {
    case 1:
      return 9 - pos // upper right: FDI 11→8 … 18→1
    case 2:
      return 8 + pos // upper left:  FDI 21→9 … 28→16
    case 3:
      return 25 - pos // lower left:  FDI 31→24 … 38→17
    case 4:
      return 24 + pos // lower right: FDI 41→25 … 48→32
    default:
      return null
  }
}

function fdiToUniversal(fdi: number): number | null {
  const q = Math.floor(fdi / 10)
  const p = fdi % 10
  if (q < 1 || q > 4) return null
  return quadrantToUniversal(q, p)
}

const QUADRANT_WORDS: Record<string, number> = { ur: 1, ul: 2, ll: 3, lr: 4 }
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
  'third molar': 8,
  'wisdom tooth': 8,
  wisdom: 8
}

// Extract Universal tooth numbers referenced anywhere in a sentence.
function parseTeeth(sentence: string): { teeth: number[]; flags: ScribeFlag[] } {
  const teeth = new Set<number>()
  const flags: ScribeFlag[] = []
  const lower = sentence.toLowerCase()

  // Explicit FDI, e.g. "FDI 26"
  for (const m of lower.matchAll(/\bfdi\s*#?\s*(\d{2})\b/g)) {
    const u = fdiToUniversal(parseInt(m[1], 10))
    if (u) teeth.add(u)
    else flags.push({ term: m[0], note: `Couldn't read FDI tooth "${m[1]}"` })
  }

  // Palmer / quadrant shorthand, e.g. "UR6", "LL 8"
  for (const m of lower.matchAll(/\b(ur|ul|lr|ll)\s*(\d)\b/g)) {
    const u = quadrantToUniversal(QUADRANT_WORDS[m[1]], parseInt(m[2], 10))
    if (u) teeth.add(u)
  }

  // Named teeth, e.g. "upper right first molar"
  for (const m of lower.matchAll(
    /\b(?:upper|maxillary|lower|mandibular)\s+(right|left)\s+([a-z]+(?:\s+[a-z]+)?)/g
  )) {
    const arch = /upper|maxillary/.test(m[0]) ? 'u' : 'l'
    const side = m[1]
    const pos = TOOTH_NAME_POS[m[2].trim()]
    if (pos) {
      const quadrant =
        arch === 'u' ? (side === 'right' ? 1 : 2) : side === 'right' ? 4 : 3
      const u = quadrantToUniversal(quadrant, pos)
      if (u) teeth.add(u)
    }
  }

  // Universal numbers: "#14", "tooth 14", "teeth 3 and 14", "tooth number 30"
  for (const m of lower.matchAll(
    /(?:#|\bteeth\b|\btooth\b|\bnumber\b|\bno\.?\b|\band\b|,)\s*(\d{1,2})/g
  )) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= 32) teeth.add(n)
    else if (n >= 33 && n <= 48) {
      const u = fdiToUniversal(n)
      if (u) teeth.add(u)
    } else if (n !== 0) {
      flags.push({ term: `tooth ${n}`, note: `"${n}" isn't a valid tooth number (1–32)` })
    }
  }

  return { teeth: [...teeth], flags }
}

// ---------------------------------------------------------------------------
// 3) Condition / surface / treatment extraction
// ---------------------------------------------------------------------------

// keyword → tooth-chart condition. Order matters (more specific first).
const CONDITION_KEYWORDS: { re: RegExp; key: ToothConditionKey }[] = [
  { re: /\bimplants?\b/, key: 'implant' },
  { re: /\b(extract(?:ed|ion)?|for removal|to be removed)\b/, key: 'extraction' },
  { re: /\b(missing|absent|edentulous|no tooth present)\b/, key: 'missing' },
  { re: /\b(cavit(?:y|ies)|caries|carious|decay(?:ed)?)\b/, key: 'cavity' },
  { re: /\b(filled|filling|restored|restoration|composite|amalgam|inlay|onlay)\b/, key: 'filled' },
  {
    re: /\b(crown|cap|root canal|rct|endo(?:dontic)?|fractur(?:e|ed)|abscess|periapical|pulpitis|needs? treatment|requires? treatment|lesion|defective)\b/,
    key: 'treatment'
  },
  { re: /\b(healthy|normal|sound|intact|wnl|within normal limits|no abnormalit)\b/, key: 'healthy' }
]

const SURFACE_KEYWORDS: { re: RegExp; key: SurfaceKey }[] = [
  { re: /\bocclusal\b/, key: 'occlusal' },
  { re: /\b(buccal|facial)\b/, key: 'buccal' },
  { re: /\b(lingual|palatal)\b/, key: 'lingual' },
  { re: /\bmesial\b/, key: 'mesial' },
  { re: /\bdistal\b/, key: 'distal' }
]

// Compound surface abbreviations, e.g. MOD, MO, DO, MOB.
const SURFACE_LETTER: Record<string, SurfaceKey> = {
  m: 'mesial',
  o: 'occlusal',
  d: 'distal',
  b: 'buccal',
  l: 'lingual'
}

// keyword → RECOMMENDED_TREATMENTS value (from shared/dental).
const TREATMENT_KEYWORDS: { re: RegExp; treatment: string }[] = [
  { re: /\b(root canal|rct|endo(?:dontic)?)\b/, treatment: 'Root Canal' },
  { re: /\b(crown|cap)\b/, treatment: 'Crown' },
  { re: /\b(fill(?:ing)?|composite|amalgam|restor)\b/, treatment: 'Filling' },
  { re: /\b(extract(?:ion)?|removal)\b/, treatment: 'Extraction' },
  { re: /\bimplant\b/, treatment: 'Implant' },
  { re: /\b(scal(?:e|ing)|prophylaxis|prophy|cleaning|polish)\b/, treatment: 'Scaling & Polishing' },
  { re: /\b(refer(?:ral)?|specialist)\b/, treatment: 'Referral' },
  { re: /\bnight ?guard\b/, treatment: 'Night Guard' },
  { re: /\b(follow[- ]?up|recall|re-?evaluate|monitor)\b/, treatment: 'Follow-up' }
]

function extractSurfaces(sentence: string): SurfaceKey[] {
  const lower = sentence.toLowerCase()
  const found = new Set<SurfaceKey>()
  for (const s of SURFACE_KEYWORDS) if (s.re.test(lower)) found.add(s.key)
  // Compound abbreviations like "MOD", "MO", "DO" (2–3 surface letters, upper-case).
  for (const m of sentence.matchAll(/\b([MODBL]{2,3})\b/g)) {
    for (const ch of m[1]) {
      const k = SURFACE_LETTER[ch.toLowerCase()]
      if (k) found.add(k)
    }
  }
  // Keep canonical surface order.
  const order: SurfaceKey[] = ['occlusal', 'buccal', 'lingual', 'mesial', 'distal']
  return order.filter((s) => found.has(s))
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function analyzeDictation(input: string): ScribeResult {
  const flags: ScribeFlag[] = []
  const { corrected, corrections, words, changed } = applyCorrections(input || '')

  // Review guard (in the spirit of DentaScribe's <25% rewrite cap): if a lot of the
  // transcript was auto-corrected, tell the doctor to read it closely.
  if (words >= 8 && changed / words > 0.25) {
    flags.push({ term: 'transcript', note: 'Many words were auto-corrected — please read the transcript closely.' })
  }

  const teeth: ScribeToothFinding[] = []
  const treatments: ScribeTreatment[] = []

  // Work sentence by sentence so findings attach to the tooth mentioned nearby.
  const sentences = corrected.split(/(?<=[.;!?\n])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    const { teeth: toothNums, flags: toothFlags } = parseTeeth(sentence)
    flags.push(...toothFlags)

    const condition = CONDITION_KEYWORDS.find((c) => c.re.test(lower))?.key
    const surfaces = extractSurfaces(sentence)
    const treatment = TREATMENT_KEYWORDS.find((t) => t.re.test(lower))?.treatment

    // Ambiguity flags (in the spirit of DentaScribe's review flags).
    if (/\bpulpitis\b/.test(lower) && !/(ir)?reversible/.test(lower)) {
      flags.push({ term: 'pulpitis', note: 'Specify reversible vs. irreversible pulpitis.' })
    }
    if ((condition || surfaces.length) && toothNums.length === 0) {
      flags.push({
        term: sentence.slice(0, 48),
        note: 'Finding mentioned with no tooth number — not applied to the chart.'
      })
    }

    for (const tooth of toothNums) {
      if (condition || surfaces.length) {
        teeth.push({ tooth, condition, surfaces, text: sentence })
      }
      if (treatment) treatments.push({ tooth, treatment, text: sentence })
    }
    // A treatment with no tooth still gets suggested (e.g. "recommend a cleaning").
    if (treatment && toothNums.length === 0) treatments.push({ tooth: null, treatment, text: sentence })
  }

  // Collapse duplicate tooth findings (same tooth) into one, merging surfaces.
  const byTooth = new Map<number, ScribeToothFinding>()
  for (const f of teeth) {
    const cur = byTooth.get(f.tooth)
    if (!cur) {
      byTooth.set(f.tooth, { ...f, surfaces: [...f.surfaces] })
    } else {
      cur.condition = cur.condition ?? f.condition
      for (const s of f.surfaces) if (!cur.surfaces.includes(s)) cur.surfaces.push(s)
    }
  }

  // De-dupe treatment suggestions on tooth+treatment.
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
    flags
  }
}

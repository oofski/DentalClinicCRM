// Turns a dictation into a written clinical note.
//
// Recording the raw transcript is not a clinical note. "Yeah, so I think, you know, tooth
// number 32, we'll need treatment plus an extraction" is a record of speech; a note is a
// record of findings. This composes the second from the first.
//
// SAFETY: nothing here is generated or paraphrased by a model. A clinical record must not
// contain a sentence nobody said, so every line comes from exactly one of two places:
//   1. The findings the doctor reviewed and accepted on the review screen.
//   2. The doctor's own remaining sentences, with speech filler removed and nothing added.
// The verbatim dictation can be kept underneath, so the original wording is never lost.

import { CONDITION_LABELS, TEETH } from './dental'
import type { ScribeNote, ScribeToothFinding, ScribeTreatment } from './scribe'
import type { SurfaceKey } from './types'

// Surface shorthand, in the order dentists write it: MODBL.
const SURFACE_ORDER: SurfaceKey[] = ['mesial', 'occlusal', 'distal', 'buccal', 'lingual']
const SURFACE_LETTERS: Record<SurfaceKey, string> = {
  mesial: 'M',
  occlusal: 'O',
  distal: 'D',
  buccal: 'B',
  lingual: 'L'
}

export function surfaceShorthand(surfaces: SurfaceKey[]): string {
  return SURFACE_ORDER.filter((s) => surfaces.includes(s))
    .map((s) => SURFACE_LETTERS[s])
    .join('')
}

// Speech that carries no clinical meaning. Stripped from the front of a sentence, and
// removed inside it, so "Yeah, so I think, you know, the rest look healthy" reads as
// "I think the rest look healthy" — the hedge is kept, because certainty is clinical.
// Longest alternatives first: regex alternation takes the first match, so "and" listed
// before "and then" would leave "then," stranded at the front of the sentence.
const LEAD_FILLER =
  /^(?:(?:and then also|and then|so yeah|and yet|i mean|you know|for me|yeah|yep|yes|okay|ok|so|and|but|well|um+|uh+|er+|like|anyway|alright|right|now)\b[\s,]*)+/i
const INNER_FILLER = /(?:,\s*)?\b(?:you know|i mean|kind of|kinda|sort of|sorta|um+|uh+|er+)\b(?:\s*,)?/gi
const FILLER_ONLY =
  /^(?:yeah|yep|yes|ok|okay|so|and|but|well|um+|uh+|er+|like|i mean|you know|for me|so yeah|and yet|right|sure|mm+|hmm+|uh huh|anyway|alright|now|that's it|thats it)[\s,.!?]*$/i

/** Strip speech filler from one sentence. Returns '' if nothing clinical is left. */
export function tidySentence(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return ''
  s = s.replace(LEAD_FILLER, '')
  s = s.replace(INNER_FILLER, ' ')
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,;:]+/, '').trim()
  if (!s || FILLER_ONLY.test(s)) return ''
  // A sentence reduced to a couple of stray words is filler that slipped the net.
  if (s.replace(/[^a-z0-9]/gi, '').length < 3) return ''
  s = s.charAt(0).toUpperCase() + s.slice(1)
  if (!/[.!?]$/.test(s)) s += '.'
  return s
}

function splitSentences(text: string): string[] {
  return (text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Does this sentence talk about a tooth that is already written up under FINDINGS? */
function mentionsChartedTooth(sentence: string, charted: Set<number>): boolean {
  const digits = sentence.match(/\b\d{1,2}\b/g) || []
  for (const d of digits) if (charted.has(parseInt(d, 10))) return true
  return false
}

// A clinical note is not a transcript of the appointment. "You should be happy about
// that" and "do you have any questions?" were really said, and they still do not belong
// in a patient's record. A remark is only written up when it carries clinical
// information — anatomy, symptoms, history, advice given — and the verbatim dictation is
// kept underneath regardless, so being selective here never loses anything.
// NOTE: these are prefixes and deliberately carry no closing \b — "sensitiv\b" does not
// match "sensitivity", and a clinical remark silently missing from the note is exactly
// the failure this section exists to avoid.
const CLINICAL_CONTEXT =
  /\b(?:wisdom|third molar|gum|gingiv|periodont|perio|occlusion|occlusal|bite|enamel|root|nerve|sinus|jaw|tmj|tongue|palate|hygien|brush|floss|sensitiv|pain|ache|swell|bleed|x-?ray|radiograph|refer|follow.?up|monitor|recall|anaesthe|anesthe|sedat|medication|antibiotic|allerg|medical history|smok|diabet|pregnan|grind|clench|bruxis|whiten|orthodont|braces|denture|retainer|discuss|advis|explain|consent|declin|option)/i

// Vocabulary that the chart and the plan already record properly. Repeating it in looser
// words underneath a structured finding makes the note longer and less trustworthy.
// Conditions are always charted, so repeating them in prose underneath the chart makes
// the note longer and less trustworthy. Prefixes, closing \b omitted for the same reason
// as above — "cavit\b" never matches "cavity".
const STRUCTURED_CONDITION =
  /\b(?:cavit|caries|decay|missing|healthy|treatment)/i

// Procedures are different: one is only recorded when the doctor asked for it. "Discussed
// a night guard" is a real part of the visit that no plan item captures, so a procedure
// is only treated as already-written-up when it actually reached the treatment plan.
const PROCEDURE_WORDS: { re: RegExp; plan: string }[] = [
  { re: /\bcrown/i, plan: 'crown' },
  { re: /\broot canal/i, plan: 'root canal' },
  { re: /\bextract|\bremoval/i, plan: 'extraction' },
  { re: /\bfilling/i, plan: 'filling' },
  { re: /\bnight ?guard/i, plan: 'night guard' },
  { re: /\bscaling|\bpolish/i, plan: 'scaling' },
  { re: /\bimplant/i, plan: 'implant' },
  { re: /\bclean/i, plan: 'cleaning' }
]

function alreadyWrittenUp(remark: string, planned: string): boolean {
  if (STRUCTURED_CONDITION.test(remark)) return true
  for (const p of PROCEDURE_WORDS) {
    if (p.re.test(remark) && planned.includes(p.plan)) return true
  }
  return false
}

/**
 * Candidate remarks from one sentence. A sentence that writes up charted teeth can still
 * carry a separate remark in a trailing clause ("...and 17, some of those are your wisdom
 * teeth"), so those clauses are considered on their own.
 */
function remarkCandidates(sentence: string): string[] {
  const parts = sentence.split(/,\s*/)
  return parts.length > 1 ? [sentence, ...parts] : [sentence]
}

function formatDate(d: Date): string {
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export interface ClinicalNoteInput {
  /** Findings the doctor accepted on the review screen. */
  teeth: ScribeToothFinding[]
  /** Plan items the doctor accepted. */
  treatments: ScribeTreatment[]
  markOthersHealthy: boolean
  /** How many teeth "all others healthy" will actually fill in. */
  othersCount: number
  /** Remarks the parser deliberately kept out of the chart. */
  asides?: ScribeNote[]
  /** The corrected transcript. */
  transcript: string
  /** Keep the raw dictation at the foot of the note. Defaults to true. */
  includeTranscript?: boolean
  date?: Date
}

/**
 * Compose the written note. Sections that have no content are omitted rather than left
 * as empty headings, so a two-line dictation does not produce a form with four blanks.
 */
export function composeClinicalNote(input: ClinicalNoteInput): string {
  const {
    teeth,
    treatments,
    markOthersHealthy,
    othersCount,
    asides = [],
    transcript,
    includeTranscript = true,
    date = new Date()
  } = input

  const out: string[] = [`EXAMINATION — ${formatDate(date)}`]

  // -- Findings, straight from what the doctor accepted ----------------------
  const sorted = [...teeth].sort((a, b) => a.tooth - b.tooth)
  if (sorted.length || (markOthersHealthy && othersCount)) {
    out.push('', 'FINDINGS')
    for (const t of sorted) {
      const meta = TEETH[t.tooth - 1]
      const label = t.condition ? CONDITION_LABELS[t.condition] : 'Noted'
      const sh = surfaceShorthand(t.surfaces)
      out.push(
        `  #${String(t.tooth).padEnd(2)} ${(meta?.label || '').padEnd(20)} ${label}${sh ? ` (${sh})` : ''}`
      )
    }
    if (markOthersHealthy && othersCount) {
      out.push(`  All remaining teeth examined and charted healthy (${othersCount} teeth).`)
    }
  }

  // -- Plan ------------------------------------------------------------------
  if (treatments.length) {
    out.push('', 'TREATMENT PLAN')
    // By tooth, so the plan reads in the same order as the findings above it rather than
    // in the order the doctor happened to speak. Arch-level items sit at the end.
    const plan = [...treatments].sort((a, b) => (a.tooth ?? 99) - (b.tooth ?? 99))
    for (const t of plan) {
      const who = t.tooth != null ? `#${String(t.tooth).padEnd(2)}` : 'Arch'
      const when = t.timeline ? ` — ${t.timeline}` : ''
      const pri = t.priority && t.priority !== 'routine' ? ` [${t.priority}]` : ''
      out.push(`  ${who} ${t.treatment}${when}${pri}`)
    }
  }

  // -- What else the doctor said, in the doctor's own words ------------------
  const charted = new Set(sorted.map((t) => t.tooth))
  const planned = treatments.map((t) => t.treatment.toLowerCase()).join(' | ')
  const discussion: string[] = []
  const seen = new Set<string>()
  const consider = [...splitSentences(transcript), ...asides.map((a) => a.text)]
  for (const sentence of consider) {
    for (const raw of remarkCandidates(sentence)) {
      // Already written up above, either as a charted tooth or as a finding the chart
      // and plan record properly. The structured entry is the better record.
      if (mentionsChartedTooth(raw, charted)) continue
      if (alreadyWrittenUp(raw, planned)) continue
      if (!CLINICAL_CONTEXT.test(raw)) continue
      const s = tidySentence(raw)
      if (!s) continue
      const key = s.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (seen.has(key)) continue
      // Skip a clause already covered by a longer remark kept from the same sentence.
      let covered = false
      for (const prev of seen) if (prev.includes(key) || key.includes(prev)) covered = true
      if (covered) continue
      seen.add(key)
      discussion.push(s)
    }
  }
  if (discussion.length) {
    out.push('', 'NOTES & DISCUSSION')
    for (const s of discussion) out.push(`  ${s}`)
  }

  // -- The original, kept ----------------------------------------------------
  const raw = (transcript || '').trim()
  if (includeTranscript && raw) {
    out.push('', 'DICTATION (verbatim)', `  ${raw}`)
  }

  return out.join('\n')
}

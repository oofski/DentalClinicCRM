// Learned examples for the Dental Scribe.
//
// The bundled language model is fixed — we cannot retrain its weights on a clinic PC.
// What we CAN do is teach it in context: every time a doctor reviews a dictation and
// applies the result, that (what I said → what I actually meant) pair is stored and
// replayed to the model as a worked example on future dictations.
//
// This is real, compounding improvement on THIS clinic's phrasing, it happens offline,
// and it is fully inspectable — the doctor can see, export and clear everything the
// Scribe has learned. Nothing is uploaded anywhere.

import type { ScribeToothFinding, ScribeTreatment } from '@shared/scribe'

const KEY = 'gs-scribe-examples'
/** Kept small on purpose: every example costs prompt tokens, and tokens cost time. */
const MAX_EXAMPLES = 12

export interface ScribeExample {
  /** What the doctor dictated. */
  input: string
  /** The corrected result, encoded in the model's own line format. */
  output: string
  at: string
}

export function loadExamples(): ScribeExample[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? (list as ScribeExample[]) : []
  } catch {
    return []
  }
}

function save(list: ScribeExample[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_EXAMPLES)))
  } catch {
    /* storage unavailable or full */
  }
}

export function exampleCount(): number {
  return loadExamples().length
}

export function clearExamples(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}

/** Encode an applied result back into the exact line format the model is asked for. */
export function encodeResult(
  teeth: ScribeToothFinding[],
  treatments: ScribeTreatment[],
  markOthersHealthy: boolean
): string {
  const lines: string[] = []
  for (const t of [...teeth].sort((a, b) => a.tooth - b.tooth)) {
    const tx = treatments.find((x) => x.tooth === t.tooth)
    lines.push(
      [
        `T${t.tooth}`,
        t.condition ?? 'treatment',
        t.surfaces.length ? t.surfaces.join(',') : '-',
        tx?.treatment || '-',
        tx?.timeline || '-'
      ].join('|')
    )
  }
  for (const tx of treatments.filter((x) => x.tooth == null)) {
    lines.push(['T-', 'treatment', '-', tx.treatment, tx.timeline || '-'].join('|'))
  }
  if (markOthersHealthy) lines.push('OTHERS|healthy')
  return lines.join('\n')
}

/**
 * Record what the doctor actually applied for a dictation. Only stored when it is a
 * useful lesson: there must be a real result, and a near-duplicate of an existing
 * example is replaced rather than piling up.
 */
export function rememberExample(
  input: string,
  teeth: ScribeToothFinding[],
  treatments: ScribeTreatment[],
  markOthersHealthy: boolean
): void {
  const text = (input || '').trim()
  const output = encodeResult(teeth, treatments, markOthersHealthy)
  if (text.length < 12 || !output) return

  const list = loadExamples().filter((e) => e.input.trim() !== text)
  list.push({ input: text, output, at: new Date().toISOString() })
  save(list)
}

/**
 * The learned examples, formatted as extra turns for the model's chat template. Newest
 * last so the most recent correction has the strongest influence.
 */
export function fewShotBlock(): string {
  const list = loadExamples()
  if (!list.length) return ''
  return list
    .map(
      (e) =>
        `<|im_start|>user\n${e.input}<|im_end|>\n` +
        `<|im_start|>assistant\n${e.output}<|im_end|>\n`
    )
    .join('')
}

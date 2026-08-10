// LLM-based interpretation of dental dictation, running fully offline.
//
// A small instruct model (Qwen1.5-0.5B-Chat) is bundled into the installer and executed
// in-process through the same ONNX/WebAssembly runtime and gsmodel:// protocol as the
// speech model. No Ollama, no second process, no network.
//
// SAFETY: an LLM can state a tooth number the doctor never said, fluently enough to look
// correct. Two guards apply to everything it returns:
//   1. Schema — the tooth must be 1-32 and the condition must be one of the chart's own
//      conditions; anything else is discarded.
//   2. Grounding — the tooth number must actually appear in the transcript in some form
//      (digits, number word, or spoken digit pair). A tooth the doctor never uttered is
//      never charted, however confident the model sounds.
// Whatever survives still goes through the existing review screen before it is applied.

import type { ScribeResult, ScribeToothFinding, ScribeTreatment } from '@shared/scribe'
import type { ToothConditionKey, SurfaceKey } from '@shared/types'

const MODEL_ID = 'Xenova/Qwen1.5-0.5B-Chat'

export type LlmProgress = (stage: string, pct?: number) => void

type Generator = (
  prompt: string,
  opts?: Record<string, unknown>
) => Promise<{ generated_text: string }[] | { generated_text: string }>

let generatorPromise: Promise<Generator> | null = null

function getGenerator(onProgress?: LlmProgress): Promise<Generator> {
  if (generatorPromise) return generatorPromise
  generatorPromise = (async () => {
    const { env, pipeline } = await import('@xenova/transformers')
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = 'gsmodel://m/'
    env.useBrowserCache = false
    env.useFS = false
    env.useFSCache = false
    if (!env.backends?.onnx?.wasm) throw new Error('ONNX WebAssembly backend unavailable')
    env.backends.onnx.wasm.wasmPaths = 'gsmodel://m/ort/'
    env.backends.onnx.wasm.numThreads = 1

    const pipe = await pipeline('text-generation', MODEL_ID, {
      quantized: true,
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p?.status === 'progress' && typeof p.progress === 'number') {
          onProgress?.('Loading language model', Math.round(p.progress))
        }
      }
    })
    return pipe as unknown as Generator
  })().catch((e) => {
    generatorPromise = null
    throw e instanceof Error ? e : new Error(String(e))
  })
  return generatorPromise
}

// ---------------------------------------------------------------------------
// Prompt — deliberately asks for a compact line format, not verbose JSON. Every
// generated token costs real time on single-threaded WebAssembly, so the output
// format is about as short as it can be while staying unambiguous.
// ---------------------------------------------------------------------------

const CONDITIONS = 'healthy|cavity|filled|missing|implant|treatment|extraction'
const SYSTEM = `You convert a dentist's spoken exam notes into chart entries.
Output ONLY lines, no prose, no JSON, no explanation.
One line per tooth actually mentioned:
T<universal tooth number 1-32>|<${CONDITIONS}>|<surfaces or ->|<procedure or ->|<when or ->
Surfaces from: occlusal,buccal,lingual,mesial,distal (MOD = mesial,occlusal,distal).
Procedure from: Filling,Crown,Root Canal,Extraction,Implant,Cleaning,Scaling & Polishing,Night Guard,Referral,Follow-up
When from: ASAP,Within 2 weeks,Within 1 month,Within 3 months,Within 6 months,Elective / monitor (use - if the dentist gave no timing)
Use "treatment" when the tooth needs work. Use the present-state condition otherwise.
If the dentist says every other tooth is healthy, add the single line: OTHERS|healthy
Never invent a tooth the dentist did not say. Spoken digit pairs like "two four" mean 24.
"to 19" means tooth 19. Ignore ages, millimetres, blood pressure, dates and x-ray counts.`

const EXAMPLE_IN = `Tooth two four needs some treatment, 15 and 16 both have cavities, to 19 needs a root canal ASAP, all the other teeth are healthy.`
const EXAMPLE_OUT = `T24|treatment|-|-|-
T15|cavity|-|-|-
T16|cavity|-|-|-
T19|treatment|-|Root Canal|ASAP
OTHERS|healthy`

function buildPrompt(text: string): string {
  // Qwen1.5 chat template.
  return (
    `<|im_start|>system\n${SYSTEM}<|im_end|>\n` +
    `<|im_start|>user\n${EXAMPLE_IN}<|im_end|>\n` +
    `<|im_start|>assistant\n${EXAMPLE_OUT}<|im_end|>\n` +
    `<|im_start|>user\n${text}<|im_end|>\n` +
    `<|im_start|>assistant\n`
  )
}

// ---------------------------------------------------------------------------
// Validation + grounding
// ---------------------------------------------------------------------------

const VALID_CONDITIONS = new Set<ToothConditionKey>([
  'healthy', 'cavity', 'filled', 'missing', 'implant', 'treatment', 'extraction'
])
const VALID_SURFACES = new Set<SurfaceKey>(['occlusal', 'buccal', 'lingual', 'mesial', 'distal'])
const VALID_PROCEDURES = new Set([
  'Filling', 'Crown', 'Root Canal', 'Extraction', 'Implant', 'Cleaning',
  'Scaling & Polishing', 'Night Guard', 'Referral', 'Follow-up', 'Other'
])
const VALID_TIMELINES = new Map<string, 'urgent' | 'important' | 'routine'>([
  ['ASAP', 'urgent'],
  ['Within 2 weeks', 'important'],
  ['Within 1 month', 'important'],
  ['Within 3 months', 'routine'],
  ['Within 6 months', 'routine'],
  ['Elective / monitor', 'routine']
])

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const TEENS = [
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen'
]

/**
 * Is tooth `n` actually referred to anywhere in the transcript? Accepts digits, number
 * words ("nineteen", "thirty two"), spoken digit pairs ("two four"), and the FDI form
 * that maps onto the same Universal tooth. This is the anti-hallucination gate.
 */
export function transcriptMentionsTooth(text: string, n: number): boolean {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  if (new RegExp(`\\b${n}\\b`).test(t)) return true

  // FDI equivalents that resolve to this Universal number.
  for (let q = 1; q <= 4; q++) {
    for (let p = 1; p <= 8; p++) {
      const u = q === 1 ? 9 - p : q === 2 ? 8 + p : q === 3 ? 25 - p : 24 + p
      if (u === n && new RegExp(`\\b${q}${p}\\b`).test(t)) return true
    }
  }

  const tens = Math.floor(n / 10)
  const ones = n % 10
  if (n < 10 && new RegExp(`\\b${ONES[n]}\\b`).test(t)) return true
  if (n >= 10 && n <= 19 && new RegExp(`\\b${TEENS[n - 10]}\\b`).test(t)) return true
  if (n >= 20 && tens <= 3) {
    const word = tens === 2 ? 'twenty' : 'thirty'
    if (ones === 0 && new RegExp(`\\b${word}\\b`).test(t)) return true
    if (ones > 0 && new RegExp(`\\b${word}\\s+${ONES[ones]}\\b`).test(t)) return true
  }
  // Spoken digit pair: "two four" = 24.
  if (n >= 10 && new RegExp(`\\b${ONES[tens]}\\s+${ONES[ones]}\\b`).test(t)) return true
  return false
}

export interface LlmParseOutcome {
  teeth: ScribeToothFinding[]
  treatments: ScribeTreatment[]
  markOthersHealthy: boolean
  rejected: string[] // lines dropped by validation/grounding, for the review panel
}

/** Parse the model's compact line output, dropping anything unsafe. */
export function parseLlmOutput(raw: string, transcript: string): LlmParseOutcome {
  const teeth: ScribeToothFinding[] = []
  const treatments: ScribeTreatment[] = []
  const rejected: string[] = []
  let markOthersHealthy = false
  const seen = new Set<number>()

  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim()
    if (!l) continue
    if (/^OTHERS\s*\|\s*healthy$/i.test(l)) {
      markOthersHealthy = true
      continue
    }
    const m = l.match(/^T\s*(\d{1,2})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|?(.*)$/i)
    if (!m) {
      if (/^T\s*\d/i.test(l)) rejected.push(l)
      continue
    }
    const tooth = parseInt(m[1], 10)
    const condition = m[2].trim().toLowerCase() as ToothConditionKey
    if (tooth < 1 || tooth > 32 || !VALID_CONDITIONS.has(condition)) {
      rejected.push(l)
      continue
    }
    // GROUNDING: refuse a tooth the dentist never actually said.
    if (!transcriptMentionsTooth(transcript, tooth)) {
      rejected.push(`${l}  (tooth ${tooth} was not heard in the dictation)`)
      continue
    }
    if (seen.has(tooth)) continue
    seen.add(tooth)

    const surfaces = m[3]
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is SurfaceKey => VALID_SURFACES.has(s as SurfaceKey))
    teeth.push({ tooth, condition, surfaces, text: l })

    const proc = m[4].trim()
    if (proc && proc !== '-' && VALID_PROCEDURES.has(proc)) {
      const when = (m[5] || '').trim()
      const priority = VALID_TIMELINES.get(when)
      treatments.push({
        tooth,
        treatment: proc,
        text: l,
        ...(priority ? { timeline: when, priority } : {})
      })
    }
  }

  return { teeth: teeth.sort((a, b) => a.tooth - b.tooth), treatments, markOthersHealthy, rejected }
}

/**
 * Interpret a dictation with the local model. Returns null when the model is unavailable
 * or produced nothing usable, so the caller can fall back to the deterministic parser
 * rather than leaving the doctor with no result at all.
 */
export async function analyzeWithLlm(
  text: string,
  base: ScribeResult,
  onProgress?: LlmProgress
): Promise<ScribeResult | null> {
  const generate = await getGenerator(onProgress)
  onProgress?.('Reading your notes')
  const out = await generate(buildPrompt(text), {
    max_new_tokens: 160,
    do_sample: false, // greedy: reproducible, and no creative invention
    temperature: 0,
    return_full_text: false
  })
  const generated = Array.isArray(out) ? out[0]?.generated_text : out?.generated_text
  if (!generated) return null

  const parsed = parseLlmOutput(String(generated), text)
  if (parsed.teeth.length === 0 && !parsed.markOthersHealthy) return null

  const flags = [...base.flags]
  for (const r of parsed.rejected) {
    flags.push({ term: r.slice(0, 60), note: 'The model suggested this but it could not be verified against your words — not charted.' })
  }
  return {
    ...base,
    teeth: parsed.teeth,
    treatments: parsed.treatments,
    markOthersHealthy: parsed.markOthersHealthy,
    flags
  }
}

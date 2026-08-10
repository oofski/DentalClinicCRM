/// <reference lib="webworker" />
//
// Dental Scribe inference worker.
//
// Speech recognition and the language model both run HERE, on a background thread,
// so the clinic app's window keeps repainting while they work. Running them on the
// UI thread made Windows show "Not Responding" for the whole of a transcription —
// and no timeout or Cancel button could help, because the thread itself was blocked
// inside WebAssembly.
//
// When the page is cross-origin isolated (the app is served over app:// with
// COOP/COEP headers) SharedArrayBuffer is available and ONNX Runtime is allowed to
// use several CPU threads. Otherwise it silently falls back to one thread.

import { env, pipeline } from '@xenova/transformers'

const WHISPER_ID = 'Xenova/whisper-tiny.en'
const LLM_ID = 'Xenova/Qwen1.5-0.5B-Chat'

type Task = 'transcribe' | 'generate'

interface Req {
  id: number
  kind: Task
  audio?: Float32Array
  prompt?: string
  opts?: Record<string, unknown>
}

let configured = false
function configure(): void {
  if (configured) return
  // Hard offline lock: only ever read the files bundled into the installer.
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = 'gsmodel://m/'
  env.useBrowserCache = false
  // The bundler resolves transformers.js's `fs` import to an empty stub, but be
  // explicit: with useFS on, a gsmodel:// URL would be treated as a disk path.
  env.useFS = false
  env.useFSCache = false

  const wasm = env.backends?.onnx?.wasm
  if (!wasm) throw new Error('ONNX WebAssembly backend unavailable')
  wasm.wasmPaths = 'gsmodel://m/ort/'

  const isolated = typeof SharedArrayBuffer !== 'undefined' && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
  const cores = self.navigator?.hardwareConcurrency || 2
  // Leave a core for the UI and the OS; more than 4 gives little back for these sizes.
  wasm.numThreads = isolated ? Math.min(4, Math.max(1, cores - 1)) : 1
  configured = true
}

let whisper: unknown = null
let llm: unknown = null

function progress(id: number, stage: string, pct?: number): void {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, type: 'progress', stage, pct })
}

async function getWhisper(id: number): Promise<(a: Float32Array, o?: Record<string, unknown>) => Promise<unknown>> {
  configure()
  if (!whisper) {
    whisper = await pipeline('automatic-speech-recognition', WHISPER_ID, {
      quantized: true,
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p?.status === 'progress' && typeof p.progress === 'number') {
          progress(id, 'Loading speech model', Math.round(p.progress))
        }
      }
    })
  }
  return whisper as (a: Float32Array, o?: Record<string, unknown>) => Promise<unknown>
}

async function getLlm(id: number): Promise<(p: string, o?: Record<string, unknown>) => Promise<unknown>> {
  configure()
  if (!llm) {
    llm = await pipeline('text-generation', LLM_ID, {
      quantized: true,
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p?.status === 'progress' && typeof p.progress === 'number') {
          progress(id, 'Loading language model', Math.round(p.progress))
        }
      }
    })
  }
  return llm as (p: string, o?: Record<string, unknown>) => Promise<unknown>
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, kind } = e.data || ({} as Req)
  const post = (msg: Record<string, unknown>) =>
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ...msg })
  try {
    if (kind === 'transcribe') {
      const run = await getWhisper(id)
      progress(id, 'Transcribing')
      const out = await run(e.data.audio as Float32Array, {
        chunk_length_s: 30,
        stride_length_s: 5
      })
      const text = Array.isArray(out)
        ? (out as { text: string }[]).map((o) => o.text).join(' ')
        : ((out as { text: string }).text ?? '')
      post({ type: 'result', data: String(text).trim() })
      return
    }
    if (kind === 'generate') {
      const run = await getLlm(id)
      progress(id, 'Reading your notes')
      const out = await run(e.data.prompt || '', e.data.opts || {})
      const gen = Array.isArray(out)
        ? (out as { generated_text: string }[])[0]?.generated_text
        : (out as { generated_text: string })?.generated_text
      post({ type: 'result', data: String(gen ?? '') })
      return
    }
    post({ type: 'error', message: `Unknown task: ${String(kind)}` })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

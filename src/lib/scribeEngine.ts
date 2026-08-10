// Main-thread client for the Dental Scribe inference worker.
//
// All heavy model work happens on the worker thread; this module only ships messages
// back and forth. Keeping it in one place means the UI never accidentally calls a
// model directly and freezes the window.

export type EngineProgress = (stage: string, pct?: number) => void

interface Pending {
  resolve: (v: string) => void
  reject: (e: Error) => void
  onProgress?: EngineProgress
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, Pending>()

function failAll(message: string): void {
  for (const [, p] of pending) p.reject(new Error(message))
  pending.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  // Vite compiles this to a separate chunk and rewrites the URL at build time.
  worker = new Worker(new URL('./scribeWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent) => {
    const { id, type, data, message, stage, pct } = e.data || {}
    const p = pending.get(id)
    if (!p) return
    if (type === 'progress') {
      p.onProgress?.(stage, pct)
      return
    }
    pending.delete(id)
    if (type === 'result') p.resolve(String(data ?? ''))
    else p.reject(new Error(message || 'The model failed.'))
  }
  worker.onerror = (e) => {
    // A worker-level failure kills every task it was running; don't leave callers hanging.
    const msg = (e as ErrorEvent).message || 'The background model thread stopped unexpectedly.'
    failAll(msg)
    try {
      worker?.terminate()
    } catch {
      /* noop */
    }
    worker = null
  }
  return worker
}

function send(
  msg: Record<string, unknown>,
  onProgress?: EngineProgress,
  transfer?: Transferable[]
): Promise<string> {
  let w: Worker
  try {
    w = getWorker()
  } catch (e) {
    return Promise.reject(
      new Error(
        `The background model thread could not be started (${e instanceof Error ? e.message : String(e)}).`
      )
    )
  }
  const id = ++seq
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    try {
      w.postMessage({ id, ...msg }, transfer || [])
    } catch (e) {
      pending.delete(id)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/** Transcribe 16 kHz mono samples. The buffer is transferred, not copied. */
export function runTranscribe(audio: Float32Array, onProgress?: EngineProgress): Promise<string> {
  return send({ kind: 'transcribe', audio }, onProgress, [audio.buffer])
}

/** Run the local language model on a prompt. */
export function runGenerate(
  prompt: string,
  opts: Record<string, unknown>,
  onProgress?: EngineProgress
): Promise<string> {
  return send({ kind: 'generate', prompt, opts }, onProgress)
}

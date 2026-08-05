// Offline speech-to-text for the Dental Scribe's built-in microphone.
//
// Runs Whisper (tiny.en) locally via WebAssembly — the model and the ONNX runtime are
// bundled into the installer and served over the app's own gsmodel:// protocol, so
// recording NEVER touches the network and no audio leaves the computer.
//
// transformers.js is imported dynamically so its ~40 MB of runtime stays out of the
// main app bundle and is only loaded the first time a doctor presses Record.

const MODEL_ID = 'Xenova/whisper-tiny.en'
const SAMPLE_RATE = 16000

export type SpeechProgress = (stage: string, pct?: number) => void

type Transcriber = (
  audio: Float32Array,
  opts?: Record<string, unknown>
) => Promise<{ text: string } | { text: string }[]>

let transcriberPromise: Promise<Transcriber> | null = null

/** Load (once) the local Whisper pipeline. Rejects with a readable message on failure. */
function getTranscriber(onProgress?: SpeechProgress): Promise<Transcriber> {
  if (transcriberPromise) return transcriberPromise
  transcriberPromise = (async () => {
    const tf = await import('@xenova/transformers')
    const { env, pipeline } = tf

    // Hard offline lock: only ever read the bundled files.
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = 'gsmodel://m/'
    env.useBrowserCache = false

    // Defence in depth. In our Vite production build `fs` already resolves to an empty
    // stub, so these are false anyway — but if the build ever switched to the prebuilt
    // UMD bundle or a nodeIntegration renderer, useFS=true would make getFile() treat
    // "gsmodel://..." as a filesystem path instead of fetching it.
    env.useFS = false
    env.useFSCache = false
    if (!env.backends?.onnx?.wasm) {
      // Never silently fall through to onnxruntime's CDN default — that would take the
      // clinic app online, which must never happen.
      throw new Error('ONNX WebAssembly backend unavailable')
    }
    env.backends.onnx.wasm.wasmPaths = 'gsmodel://m/ort/'
    // Single-threaded avoids needing SharedArrayBuffer / cross-origin isolation, which a
    // file:// page cannot have, and avoids blob: workers the CSP would block.
    env.backends.onnx.wasm.numThreads = 1

    const pipe = await pipeline('automatic-speech-recognition', MODEL_ID, {
      quantized: true,
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p?.status === 'progress' && typeof p.progress === 'number') {
          onProgress?.('Loading speech model', Math.round(p.progress))
        }
      }
    })
    return pipe as unknown as Transcriber
  })().catch((e) => {
    // Allow a later retry rather than caching the failure forever.
    transcriberPromise = null
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `The offline speech model could not be loaded (${msg}). You can still type or paste your notes.`
    )
  })
  return transcriberPromise
}

/** Decode a recorded blob to the 16 kHz mono float samples Whisper expects. */
async function toMono16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer()
  if (buf.byteLength === 0) throw new Error('Nothing was recorded — please try again.')
  // Decoding straight into a 16 kHz context lets the browser do a proper, filtered
  // resample. Hand-rolling the downsample aliases 8-24 kHz energy into the band the
  // Whisper mel filters actually read (max 8 kHz), which measurably hurts accuracy.
  const OfflineCtx: typeof OfflineAudioContext =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  const ctx = new OfflineCtx(1, 1, SAMPLE_RATE)
  const decoded = await ctx.decodeAudioData(buf)
  const chans = decoded.numberOfChannels
  const len = decoded.length
  if (chans === 1) return decoded.getChannelData(0)
  // Average channels down to mono.
  const mono = new Float32Array(len)
  for (let c = 0; c < chans; c++) {
    const data = decoded.getChannelData(c)
    for (let i = 0; i < len; i++) mono[i] += data[i] / chans
  }
  return mono
}

/** Transcribe a recorded audio blob into text, fully offline. */
export async function transcribeBlob(blob: Blob, onProgress?: SpeechProgress): Promise<string> {
  onProgress?.('Preparing audio')
  const audio = await toMono16k(blob)
  if (audio.length < SAMPLE_RATE * 0.4) {
    throw new Error("That recording was too short — hold Record and speak for at least a second.")
  }
  const transcribe = await getTranscriber(onProgress)
  onProgress?.('Transcribing')
  const out = await transcribe(audio, {
    // Whisper handles 30s windows; chunking lets longer dictations work.
    chunk_length_s: 30,
    stride_length_s: 5
  })
  const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text
  return (text || '').trim()
}

/** Records microphone audio until stopped. Throws a readable error if mic is unavailable. */
export class Recorder {
  private rec: MediaRecorder | null = null
  private chunks: BlobPart[] = []
  private stream: MediaStream | null = null

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      const name = (e as { name?: string })?.name || ''
      if (name === 'NotAllowedError') throw new Error('Microphone access was blocked. Allow the microphone for Giving Smiles in Windows Settings → Privacy → Microphone.')
      if (name === 'NotFoundError') throw new Error('No microphone was found on this computer.')
      throw new Error('The microphone could not be started.')
    }
    this.chunks = []
    try {
      this.rec = new MediaRecorder(this.stream)
      this.rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data)
      }
      this.rec.start()
    } catch (e) {
      // Never leave an acquired microphone running if the recorder failed to start.
      this.cancel()
      throw new Error('The microphone could not be started.')
    }
  }

  /** Stops recording and resolves with the captured audio. Always releases the mic. */
  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const rec = this.rec
      if (!rec) return reject(new Error('Nothing was recorded — please try again.'))

      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' })
        this.cancel()
        resolve(blob)
      }
      // If onstop never fires (device removed, driver hiccup) don't hang the UI forever.
      const timer = setTimeout(finish, 5000)

      rec.onstop = finish
      rec.onerror = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.cancel()
        reject(new Error('Recording failed — please try again.'))
      }
      // The recorder may already have stopped itself (e.g. the mic was unplugged),
      // in which case stop() throws InvalidStateError.
      if (rec.state === 'inactive') return finish()
      try {
        rec.stop()
      } catch {
        finish()
      }
    })
  }

  cancel(): void {
    try {
      this.rec?.stop()
    } catch {
      /* noop */
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.rec = null
  }
}

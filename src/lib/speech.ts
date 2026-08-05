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
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = 'gsmodel://m/ort/'
      // Single-threaded avoids needing SharedArrayBuffer / COOP-COEP headers.
      env.backends.onnx.wasm.numThreads = 1
    }

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
  const Ctx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  try {
    const decoded = await ctx.decodeAudioData(buf)
    // Average channels down to mono.
    const chans = decoded.numberOfChannels
    const len = decoded.length
    const mono = new Float32Array(len)
    for (let c = 0; c < chans; c++) {
      const data = decoded.getChannelData(c)
      for (let i = 0; i < len; i++) mono[i] += data[i] / chans
    }
    if (decoded.sampleRate === SAMPLE_RATE) return mono
    // Linear resample to 16 kHz.
    const ratio = decoded.sampleRate / SAMPLE_RATE
    const outLen = Math.floor(len / ratio)
    const out = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const src = i * ratio
      const i0 = Math.floor(src)
      const i1 = Math.min(i0 + 1, len - 1)
      const t = src - i0
      out[i] = mono[i0] * (1 - t) + mono[i1] * t
    }
    return out
  } finally {
    ctx.close().catch(() => {})
  }
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
    this.rec = new MediaRecorder(this.stream)
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data)
    }
    this.rec.start()
  }

  /** Stops recording and resolves with the captured audio. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.rec
      if (!rec) return resolve(new Blob())
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' })
        this.stream?.getTracks().forEach((t) => t.stop())
        this.stream = null
        this.rec = null
        resolve(blob)
      }
      rec.stop()
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

// Offline speech-to-text for the Dental Scribe's built-in microphone.
//
// Whisper (tiny.en) runs locally, bundled into the installer and served over the app's
// own gsmodel:// protocol, so recording NEVER touches the network and no audio leaves
// the computer. The model itself runs on a WORKER thread (src/lib/scribeWorker.ts) so
// transcription cannot freeze the clinic app's window.

import { runTranscribe, type EngineProgress } from './scribeEngine'

const SAMPLE_RATE = 16000
/** Anything longer risks a very long transcription and a large buffer. */
export const MAX_RECORDING_MS = 5 * 60 * 1000

export type SpeechProgress = EngineProgress

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
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(buf)
  } catch {
    // Almost always a zero-length or truncated capture rather than a codec problem.
    throw new Error('That recording could not be read. Please record again and speak for at least a second.')
  }
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
  // Runs on the worker thread; the window stays responsive throughout.
  return (await runTranscribe(audio, onProgress)).trim()
}

/** Records microphone audio until stopped. Throws a readable error if mic is unavailable. */
export class Recorder {
  private rec: MediaRecorder | null = null
  private chunks: BlobPart[] = []
  private stream: MediaStream | null = null
  private capTimer: ReturnType<typeof setTimeout> | null = null

  /** Pick a container the browser will both record AND decode. */
  private static pickMimeType(): string | undefined {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    for (const t of candidates) {
      try {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) return t
      } catch {
        /* isTypeSupported can throw on odd inputs */
      }
    }
    return undefined // let the browser choose
  }

  async start(): Promise<void> {
    try {
      // Mono at the model's own rate keeps the buffer small and avoids a resample.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
    } catch (e) {
      const name = (e as { name?: string })?.name || ''
      if (name === 'NotAllowedError') throw new Error('Microphone access was blocked. Allow the microphone for Giving Smiles in Windows Settings → Privacy → Microphone.')
      if (name === 'NotFoundError') throw new Error('No microphone was found on this computer.')
      throw new Error('The microphone could not be started.')
    }
    this.chunks = []
    try {
      const mimeType = Recorder.pickMimeType()
      this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
      this.rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data)
      }
      // A timeslice makes the recorder emit chunks as it goes, so a long dictation
      // isn't riding on a single final blob that can arrive empty.
      this.rec.start(1000)
      // Hard cap: a recorder left running by accident must not grow without bound.
      this.capTimer = setTimeout(() => {
        try {
          if (this.rec && this.rec.state === 'recording') this.rec.stop()
        } catch {
          /* noop */
        }
      }, MAX_RECORDING_MS)
    } catch {
      // Never leave an acquired microphone running if the recorder failed to start.
      this.cancel()
      throw new Error('This computer\'s microphone could not be recorded from.')
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
        if (this.capTimer) clearTimeout(this.capTimer)
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
    if (this.capTimer) {
      clearTimeout(this.capTimer)
      this.capTimer = null
    }
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

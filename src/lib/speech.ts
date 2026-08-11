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

// ---------------------------------------------------------------------------
// Microphone selection
//
// getUserMedia with no deviceId records from whatever Windows has set as the DEFAULT
// input. Plugging in a dedicated USB microphone does not change that default, so a
// clinic can buy a good microphone and still be recorded through the laptop's built-in
// one without any sign that it happened. The doctor picks the device explicitly here,
// the choice is remembered, and the device actually in use is reported back so it can
// be shown on screen rather than assumed.
// ---------------------------------------------------------------------------

export interface MicDevice {
  deviceId: string
  label: string
}

const MIC_KEY = 'gs-scribe-mic'

export function getPreferredMic(): string {
  try {
    return localStorage.getItem(MIC_KEY) || ''
  } catch {
    return ''
  }
}

export function setPreferredMic(deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(MIC_KEY, deviceId)
    else localStorage.removeItem(MIC_KEY)
  } catch {
    /* storage unavailable */
  }
}

/**
 * The microphones this computer can record from. Labels are only exposed once the user
 * has granted microphone access at least once, so an unlabelled device is named by
 * position rather than shown as a blank row.
 */
export async function listMicrophones(): Promise<MicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  let devices: MediaDeviceInfo[]
  try {
    devices = await navigator.mediaDevices.enumerateDevices()
  } catch {
    return []
  }
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
}

/** Fires when a microphone is plugged in or unplugged. Returns an unsubscribe function. */
export function watchMicrophones(onChange: () => void): () => void {
  const md = navigator.mediaDevices
  if (!md?.addEventListener) return () => {}
  md.addEventListener('devicechange', onChange)
  return () => md.removeEventListener('devicechange', onChange)
}

function micConstraints(deviceId?: string): MediaTrackConstraints {
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
  // exact, not ideal: a doctor who chose a microphone must not be silently recorded
  // through a different one. If it has been unplugged we say so instead.
  if (deviceId) audio.deviceId = { exact: deviceId }
  return audio
}

function micError(e: unknown): Error {
  const name = (e as { name?: string })?.name || ''
  if (name === 'NotAllowedError')
    return new Error('Microphone access was blocked. Allow the microphone for Giving Smiles in Windows Settings → Privacy → Microphone.')
  if (name === 'NotFoundError') return new Error('No microphone was found on this computer.')
  if (name === 'OverconstrainedError' || name === 'NotReadableError')
    return new Error('The selected microphone is not available — it may have been unplugged, or another program may be using it. Pick a different microphone.')
  return new Error('The microphone could not be started.')
}

/**
 * A live input-level reading, so the doctor can see the meter move while speaking and
 * know the microphone is really being heard BEFORE dictating a whole exam into silence.
 */
export class MicMeter {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  // Backed by a plain ArrayBuffer: getFloatTimeDomainData will not accept a view that
  // might sit on a SharedArrayBuffer, which this app does enable.
  private buf = new Float32Array(new ArrayBuffer(0))
  private stream: MediaStream | null = null
  /** The microphone actually in use, as the operating system names it. */
  label = ''

  static async open(deviceId?: string): Promise<MicMeter> {
    const m = new MicMeter()
    try {
      m.stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) })
    } catch (e) {
      throw micError(e)
    }
    m.attach(m.stream)
    return m
  }

  /** Meter an already-open recording stream instead of opening a second one. */
  attach(stream: MediaStream): void {
    this.label = stream.getAudioTracks()[0]?.label || ''
    try {
      const Ctx: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctx()
      const src = this.ctx.createMediaStreamSource(stream)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))
      src.connect(this.analyser) // analyser only — never routed to the speakers
    } catch {
      this.analyser = null // metering is a nicety; recording must still work without it
    }
  }

  /** Current loudness, 0..1, already curved so normal speech sits mid-scale. */
  level(): number {
    if (!this.analyser) return 0
    this.analyser.getFloatTimeDomainData(this.buf)
    let sum = 0
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i]
    const rms = Math.sqrt(sum / this.buf.length)
    return Math.max(0, Math.min(1, Math.sqrt(rms) * 3))
  }

  close(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.analyser = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}

/** Records microphone audio until stopped. Throws a readable error if mic is unavailable. */
export class Recorder {
  private rec: MediaRecorder | null = null
  private chunks: BlobPart[] = []
  private meter: MicMeter | null = null
  /** The microphone this recording is actually coming from. */
  deviceLabel = ''
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

  async start(deviceId?: string): Promise<void> {
    try {
      // Mono keeps the buffer small; the decode step resamples to the model's rate.
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) })
    } catch (e) {
      throw micError(e)
    }
    this.deviceLabel = this.stream.getAudioTracks()[0]?.label || ''
    // Meter the recording stream itself, so the level shown during dictation is the
    // audio actually being captured rather than a second, separately-opened stream.
    this.meter = new MicMeter()
    this.meter.attach(this.stream)
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

  /** Live input level while recording, 0..1. */
  level(): number {
    return this.meter?.level() ?? 0
  }

  cancel(): void {
    if (this.capTimer) {
      clearTimeout(this.capTimer)
      this.capTimer = null
    }
    this.meter?.close()
    this.meter = null
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

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, useToast } from '@/components/ui'
import { Icon } from '@/components/icons'
import { DictateButton } from '@/components/Dictate'
import { analyzeDictation, type ScribeResult, type ScribeToothFinding } from '@shared/scribe'
import { Recorder, transcribeBlob } from '@/lib/speech'
import { analyzeWithLlm } from '@/lib/scribeLlm'
import { CONDITION_LABELS, SURFACES, TEETH } from '@shared/dental'
import type { SurfaceKey, ToothChartData } from '@shared/types'

const labelByNumber = new Map(TEETH.map((t) => [t.number, t.label]))
const surfaceLabel = (k: SurfaceKey) => SURFACES.find((s) => s.key === k)?.label || k

// "Enhanced memory": the raw dictation buffer survives closing the modal, navigating
// away, or an accidental click — it is only cleared once the doctor applies it.
const BUFFER_KEY = 'gs-scribe-buffer'
const loadBuffer = () => {
  try {
    return localStorage.getItem(BUFFER_KEY) || ''
  } catch {
    return ''
  }
}
const saveBuffer = (v: string) => {
  try {
    v ? localStorage.setItem(BUFFER_KEY, v) : localStorage.removeItem(BUFFER_KEY)
  } catch {
    /* storage unavailable */
  }
}

const countWords = (v: string) => (v.trim() ? v.trim().split(/\s+/).length : 0)

export interface ScribeApply {
  findings: ScribeToothFinding[]
  treatments: { tooth: number | null; treatment: string; text: string }[]
  note: { text: string; teeth: number[] } | null
  markOthersHealthy: boolean
}

export function ScribeModal({
  open,
  onClose,
  onApply,
  chart
}: {
  open: boolean
  onClose: () => void
  onApply: (a: ScribeApply) => void
  chart: ToothChartData
}) {
  const toast = useToast()
  const [result, setResult] = useState<ScribeResult | null>(null)
  const [corrected, setCorrected] = useState('')
  const [pickTeeth, setPickTeeth] = useState<Record<number, boolean>>({})
  const [pickTx, setPickTx] = useState<Record<number, boolean>>({})
  const [addNote, setAddNote] = useState(true)
  const [markOthers, setMarkOthers] = useState(false)
  const [words, setWords] = useState(0)
  const [recording, setRecording] = useState(false)
  const [busyMsg, setBusyMsg] = useState('')
  const dictRef = useRef<HTMLTextAreaElement>(null)
  const recorderRef = useRef<Recorder | null>(null)
  const startingRef = useRef(false)

  // IMPORTANT: the dictation box is deliberately UNCONTROLLED (no React `value`).
  // Windows voice typing inserts text through the OS Text Services Framework, the same
  // pathway an IME uses. A React-controlled value rewrites the DOM node on every render
  // and cancels that in-flight insertion, which is why dictated words silently vanished.
  // Keeping React out of the typing path lets the box behave exactly like Notepad.
  const readText = () => dictRef.current?.value ?? ''

  // Restore any unfinished dictation when the modal opens, and put the caret in the box
  // so Win + H has somewhere to type.
  useEffect(() => {
    if (!open) return
    const el = dictRef.current
    if (!el) return
    const saved = loadBuffer()
    if (saved && !el.value) el.value = saved
    setWords(countWords(el.value))
    el.focus()
    const end = el.value.length
    try {
      el.setSelectionRange(end, end)
    } catch {
      /* noop */
    }
  }, [open])

  // Save on every input (typed or dictated). This only updates a counter — it never
  // rewrites the textarea — so it cannot disturb dictation.
  const onInput = () => {
    const v = readText()
    saveBuffer(v)
    setWords(countWords(v))
  }

  const reset = () => {
    if (dictRef.current) dictRef.current.value = ''
    setWords(0)
    setResult(null)
    setCorrected('')
    setPickTeeth({})
    setPickTx({})
    setAddNote(true)
    setMarkOthers(false)
    saveBuffer('')
  }

  const showResult = (r: ScribeResult) => {
    setResult(r)
    setCorrected(r.corrected)
    setPickTeeth(Object.fromEntries(r.teeth.map((_, i) => [i, true])))
    setPickTx(Object.fromEntries(r.treatments.map((_, i) => [i, true])))
    setAddNote(true)
    setMarkOthers(r.markOthersHealthy)
  }

  // The local language model interprets the dictation. The deterministic parser runs
  // first so there is always something on screen, and it remains the fallback if the
  // model is unavailable or returns nothing usable — the doctor is never left with a
  // blank review screen.
  const analyzeText = async (input: string) => {
    const text = (input || '').trim()
    if (!text) return
    const base = analyzeDictation(text)
    showResult(base)
    setBusyMsg('Reading your notes…')
    try {
      const better = await analyzeWithLlm(text, base, (stage, pct) =>
        setBusyMsg(pct != null ? `${stage}… ${pct}%` : `${stage}…`)
      )
      if (better) showResult(better)
    } catch (e) {
      toast.push(
        e instanceof Error && /model/i.test(e.message)
          ? 'The language model could not be loaded — showing the rule-based reading instead.'
          : 'Could not run the language model — showing the rule-based reading instead.',
        'info'
      )
    } finally {
      setBusyMsg('')
    }
  }

  const analyze = () => {
    const text = readText().trim()
    if (!text) {
      toast.push('Record, dictate, or type some text first', 'info')
      return
    }
    void analyzeText(text)
  }

  // ---- Built-in microphone (offline Whisper) --------------------------------
  const appendText = (t: string) => {
    if (!t) return
    const el = dictRef.current
    if (el) {
      el.value = el.value.trim() ? `${el.value.trim()} ${t}` : t
      onInput()
      return
    }
    // The modal was closed while transcribing — save to the buffer so the doctor's
    // words are never silently thrown away; they reappear next time it opens.
    const prev = loadBuffer().trim()
    saveBuffer(prev ? `${prev} ${t}` : t)
  }

  const startRec = async () => {
    // getUserMedia can take seconds on the first Windows permission prompt; without this
    // guard a second click would orphan the first MediaStream and leave the mic live.
    if (startingRef.current || recorderRef.current) return
    startingRef.current = true
    setBusyMsg('Starting microphone…')
    try {
      const r = new Recorder()
      await r.start()
      recorderRef.current = r
      setRecording(true)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Could not start the microphone', 'error')
    } finally {
      startingRef.current = false
      setBusyMsg('')
    }
  }

  const stopRec = async () => {
    const r = recorderRef.current
    if (!r) return
    setRecording(false)
    setBusyMsg('Preparing audio…')
    try {
      const blob = await r.stop()
      const text = await transcribeBlob(blob, (stage, pct) =>
        setBusyMsg(pct != null ? `${stage}… ${pct}%` : `${stage}…`)
      )
      if (!text) {
        toast.push("Nothing was heard — try again and speak a little closer to the microphone.", 'info')
        return
      }
      appendText(text)
      // Flow straight into analysis + formatting, which is the point of the button.
      await analyzeText(readText())
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Transcription failed', 'error')
    } finally {
      // Always release the recorder and clear the banner, even if stop/transcribe threw —
      // otherwise the modal is stuck with Record disabled.
      recorderRef.current?.cancel()
      recorderRef.current = null
      setBusyMsg('')
    }
  }

  // Stop the mic if the window is closed mid-recording.
  useEffect(() => {
    if (open) return
    recorderRef.current?.cancel()
    recorderRef.current = null
    setRecording(false)
    setBusyMsg('')
  }, [open])

  const selectedTeeth = useMemo(
    () => (result ? result.teeth.filter((_, i) => pickTeeth[i]) : []),
    [result, pickTeeth]
  )
  const selectedTx = useMemo(
    () => (result ? result.treatments.filter((_, i) => pickTx[i]) : []),
    [result, pickTx]
  )

  // Teeth that "all other teeth are healthy" would fill in: not called out in this
  // dictation and not already charted, so existing findings are never overwritten.
  const othersCount = useMemo(() => {
    if (!result) return 0
    const named = new Set(result.teeth.map((t) => t.tooth))
    let n = 0
    for (let i = 1; i <= 32; i++) {
      const cur = chart[i]
      if (!named.has(i) && (!cur || cur.condition === 'unexamined')) n++
    }
    return n
  }, [result, chart])

  const apply = () => {
    if (!result) return
    const noteTeeth = Array.from(
      new Set([...selectedTeeth.map((t) => t.tooth), ...result.teeth.map((t) => t.tooth)])
    ).sort((a, b) => a - b)
    onApply({
      findings: selectedTeeth,
      treatments: selectedTx,
      note: addNote && corrected.trim() ? { text: corrected.trim(), teeth: noteTeeth } : null,
      markOthersHealthy: markOthers
    })
    const parts: string[] = []
    if (selectedTeeth.length) parts.push(`${selectedTeeth.length} tooth finding(s)`)
    if (markOthers && othersCount) parts.push(`${othersCount} marked healthy`)
    if (selectedTx.length) parts.push(`${selectedTx.length} plan item(s)`)
    if (addNote && corrected.trim()) parts.push('a note')
    toast.push(parts.length ? `Applied ${parts.join(', ')}` : 'Nothing selected to apply', parts.length ? 'success' : 'info')
    reset()
    onClose()
  }

  const close = () => {
    // Deliberately does NOT reset: the dictation buffer is promised to survive closing
    // (a stray backdrop click or Escape must not destroy the doctor's words). Only a
    // successful apply() clears it. Just drop the transient analysis.
    setResult(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      title="🦷 Dental Scribe — dictation to chart"
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          {!result ? (
            <button className="btn btn-primary" onClick={analyze}>
              Analyze dictation
            </button>
          ) : (
            <button className="btn btn-primary" onClick={apply}>
              Apply to chart &amp; plan
            </button>
          )}
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
        Dictate or paste your exam narrative. The scribe corrects dental terms, reads tooth numbers
        (Universal / FDI / Palmer), and proposes chart tags and plan items — <b>nothing is saved
        until you review and apply</b>. Fully offline.
      </p>

      <div className="field">
        <div className="row between" style={{ alignItems: 'center' }}>
          <label style={{ margin: 0 }}>
            Dictation{' '}
            <span className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}>
              {words > 0 ? `· ${words} word${words === 1 ? '' : 's'} captured` : '· empty'}
            </span>
          </label>
          <div className="row" style={{ gap: 6 }}>
            {!recording ? (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!!busyMsg}
                onClick={startRec}
                title="Record with this computer's microphone and transcribe it here — fully offline"
              >
                🎙 Record
              </button>
            ) : (
              <button type="button" className="btn btn-sm btn-danger" onClick={stopRec}>
                ⏹ Stop &amp; transcribe
              </button>
            )}
            <DictateButton targetRef={dictRef} label="⌨ Type here" />
          </div>
        </div>

        {(recording || busyMsg) && (
          <div
            className="alert"
            style={{
              marginBottom: 8,
              fontSize: 12.5,
              background: recording ? 'rgba(224,82,74,0.08)' : undefined
            }}
          >
            {recording ? (
              <b style={{ color: 'var(--danger)' }}>● Recording — speak now, then press “Stop &amp; transcribe”.</b>
            ) : (
              <>
                {busyMsg} <span className="muted">(the first run of a session also loads the models — this takes a little longer)</span>
              </>
            )}
          </div>
        )}

        <textarea
          ref={dictRef}
          onInput={onInput}
          placeholder="e.g. Tooth 14 has a MOD cavity. Number 30 needs a crown. All other teeth are healthy."
          style={{ minHeight: 110 }}
        />
        <span className="muted" style={{ fontSize: 11.5 }}>
          Press <b>🎙 Record</b>, speak, then <b>Stop</b> — the app transcribes it here <b>on this
          computer</b> (no internet, no Windows dictation) and runs the analysis automatically. You
          can also just type or paste. Your text is remembered if you close this window.
        </span>
      </div>

      {result && (
        <div className="stack" style={{ gap: 14, marginTop: 6 }}>
          {result.corrections.length > 0 && (
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                Corrected {result.corrections.length} term(s):
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {result.corrections.map((c, i) => (
                  <span key={i} className="pill gray" style={{ fontSize: 11.5 }}>
                    {c.from} → <b>{c.to}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="field" style={{ margin: 0 }}>
            <label>Corrected transcript</label>
            <textarea value={corrected} onChange={(e) => setCorrected(e.target.value)} style={{ minHeight: 70 }} />
            <label className="row" style={{ gap: 8, alignItems: 'center', fontSize: 13, marginTop: 6 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={addNote} onChange={(e) => setAddNote(e.target.checked)} />
              Add this transcript as a clinical note
            </label>
          </div>

          <div>
            <div className="card-title" style={{ fontSize: 14 }}>
              Tooth findings → chart{' '}
              <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                ({result.teeth.length})
              </span>
            </div>
            {(result.markOthersHealthy || markOthers) && (
              <label
                className="row"
                style={{
                  gap: 10,
                  alignItems: 'center',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  marginBottom: 6,
                  background: 'rgba(70,178,106,0.08)'
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={markOthers}
                  onChange={(e) => setMarkOthers(e.target.checked)}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    Mark all other teeth Healthy{' '}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      ({othersCount} {othersCount === 1 ? 'tooth' : 'teeth'})
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    Applies to teeth not mentioned above and not already charted.
                  </div>
                </div>
              </label>
            )}

            {result.teeth.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No tooth findings detected.</div>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {result.teeth.map((f, i) => (
                  <label
                    key={i}
                    className="row"
                    style={{ gap: 10, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={!!pickTeeth[i]}
                      onChange={(e) => setPickTeeth((p) => ({ ...p, [i]: e.target.checked }))}
                    />
                    <span className="pill azure">#{f.tooth}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {f.condition ? CONDITION_LABELS[f.condition] : 'Surfaces only'}
                        {f.surfaces.length > 0 && (
                          <span className="muted" style={{ fontWeight: 400 }}>
                            {' '}
                            · {f.surfaces.map(surfaceLabel).join(', ')}
                          </span>
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {labelByNumber.get(f.tooth)}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {result.treatments.length > 0 && (
            <div>
              <div className="card-title" style={{ fontSize: 14 }}>
                Suggested treatment plan{' '}
                <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                  ({result.treatments.length})
                </span>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {result.treatments.map((t, i) => (
                  <label
                    key={i}
                    className="row"
                    style={{ gap: 10, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={!!pickTx[i]}
                      onChange={(e) => setPickTx((p) => ({ ...p, [i]: e.target.checked }))}
                    />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{t.treatment}</span>
                    {t.tooth != null && <span className="pill azure">#{t.tooth}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {result.notes.length > 0 && (
            <div>
              <div className="card-title" style={{ fontSize: 14 }}>
                Notes (not charted){' '}
                <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                  ({result.notes.length})
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                Kept as part of the clinical note, not applied to the tooth chart:
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {result.notes.map((n, i) => (
                    <li key={i}>{n.text}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {result.flags.length > 0 && (
            <div className="alert" style={{ fontSize: 12.5 }}>
              <b>Please review:</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {result.flags.map((fl, i) => (
                  <li key={i}>
                    {fl.note} <span className="muted">({fl.term})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setResult(null)}>
            <Icon name="back" size={14} /> Edit dictation
          </button>
        </div>
      )}
    </Modal>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, useToast } from '@/components/ui'
import { Icon } from '@/components/icons'
import { DictateButton } from '@/components/Dictate'
import { analyzeDictation, type ScribeResult, type ScribeToothFinding } from '@shared/scribe'
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
  const [raw, setRaw] = useState('')
  const [result, setResult] = useState<ScribeResult | null>(null)
  const [corrected, setCorrected] = useState('')
  const [pickTeeth, setPickTeeth] = useState<Record<number, boolean>>({})
  const [pickTx, setPickTx] = useState<Record<number, boolean>>({})
  const [addNote, setAddNote] = useState(true)
  const [markOthers, setMarkOthers] = useState(false)
  const [recording, setRecording] = useState(false)
  const dictRef = useRef<HTMLTextAreaElement>(null)

  // Restore any unfinished dictation when the modal opens.
  useEffect(() => {
    if (open) {
      const saved = loadBuffer()
      if (saved) setRaw((cur) => cur || saved)
    } else {
      setRecording(false)
    }
  }, [open])

  // Persist every keystroke/dictated word so nothing is ever lost.
  useEffect(() => {
    if (open) saveBuffer(raw)
  }, [raw, open])

  // While "recording", keep the caret pinned in the dictation box so Windows voice
  // typing always lands here — regardless of where the mouse happens to be.
  useEffect(() => {
    if (!recording || !open) return
    const keep = () => {
      const el = dictRef.current
      if (el && document.activeElement !== el) {
        el.focus()
        const end = el.value.length
        try {
          el.setSelectionRange(end, end)
        } catch {
          /* noop */
        }
      }
    }
    keep()
    const t = setInterval(keep, 400)
    return () => clearInterval(t)
  }, [recording, open])

  const reset = () => {
    setRaw('')
    setResult(null)
    setCorrected('')
    setPickTeeth({})
    setPickTx({})
    setAddNote(true)
    setMarkOthers(false)
    setRecording(false)
    saveBuffer('')
  }

  const analyze = () => {
    if (!raw.trim()) {
      toast.push('Dictate or paste some text first', 'info')
      return
    }
    setRecording(false)
    const r = analyzeDictation(raw)
    setResult(r)
    setCorrected(r.corrected)
    setPickTeeth(Object.fromEntries(r.teeth.map((_, i) => [i, true])))
    setPickTx(Object.fromEntries(r.treatments.map((_, i) => [i, true])))
    setAddNote(true)
    setMarkOthers(r.markOthersHealthy)
  }

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
    reset()
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
            {recording && (
              <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 12 }}>● capturing</span>
            )}
          </label>
          <div className="row" style={{ gap: 6 }}>
            <DictateButton targetRef={dictRef} />
            <button
              type="button"
              className={`btn btn-sm ${recording ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => setRecording((r) => !r)}
              title="Keeps the cursor locked in this box so dictation always lands here"
            >
              {recording ? 'Stop capture' : 'Start capture'}
            </button>
          </div>
        </div>
        <textarea
          ref={dictRef}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="e.g. Tooth 14 has a MOD cavity. Number 30 needs a crown. All other teeth are healthy."
          style={{ minHeight: 110 }}
        />
        <span className="muted" style={{ fontSize: 11.5 }}>
          Raw capture — <b>nothing is corrected while you speak</b>; dental terms are cleaned up only
          when you press <b>Analyze</b>. <b>Start capture</b> locks the cursor here so dictation can't
          land in another box. Your text is remembered even if you close this window.
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

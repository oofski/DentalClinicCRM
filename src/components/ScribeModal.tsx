import { useMemo, useState } from 'react'
import { Modal, useToast } from '@/components/ui'
import { Icon } from '@/components/icons'
import { DictateButton } from '@/components/Dictate'
import { analyzeDictation, type ScribeResult, type ScribeToothFinding } from '@shared/scribe'
import { CONDITION_LABELS, SURFACES, TEETH } from '@shared/dental'
import type { SurfaceKey } from '@shared/types'

const labelByNumber = new Map(TEETH.map((t) => [t.number, t.label]))
const surfaceLabel = (k: SurfaceKey) => SURFACES.find((s) => s.key === k)?.label || k

export interface ScribeApply {
  findings: ScribeToothFinding[]
  treatments: { tooth: number | null; treatment: string; text: string }[]
  note: { text: string; teeth: number[] } | null
}

export function ScribeModal({
  open,
  onClose,
  onApply
}: {
  open: boolean
  onClose: () => void
  onApply: (a: ScribeApply) => void
}) {
  const toast = useToast()
  const [raw, setRaw] = useState('')
  const [result, setResult] = useState<ScribeResult | null>(null)
  const [corrected, setCorrected] = useState('')
  const [pickTeeth, setPickTeeth] = useState<Record<number, boolean>>({})
  const [pickTx, setPickTx] = useState<Record<number, boolean>>({})
  const [addNote, setAddNote] = useState(true)

  const reset = () => {
    setRaw('')
    setResult(null)
    setCorrected('')
    setPickTeeth({})
    setPickTx({})
    setAddNote(true)
  }

  const analyze = () => {
    if (!raw.trim()) {
      toast.push('Dictate or paste some text first', 'info')
      return
    }
    const r = analyzeDictation(raw)
    setResult(r)
    setCorrected(r.corrected)
    setPickTeeth(Object.fromEntries(r.teeth.map((_, i) => [i, true])))
    setPickTx(Object.fromEntries(r.treatments.map((_, i) => [i, true])))
    setAddNote(true)
  }

  const selectedTeeth = useMemo(
    () => (result ? result.teeth.filter((_, i) => pickTeeth[i]) : []),
    [result, pickTeeth]
  )
  const selectedTx = useMemo(
    () => (result ? result.treatments.filter((_, i) => pickTx[i]) : []),
    [result, pickTx]
  )

  const apply = () => {
    if (!result) return
    const noteTeeth = Array.from(
      new Set([...selectedTeeth.map((t) => t.tooth), ...result.teeth.map((t) => t.tooth)])
    ).sort((a, b) => a - b)
    onApply({
      findings: selectedTeeth,
      treatments: selectedTx,
      note: addNote && corrected.trim() ? { text: corrected.trim(), teeth: noteTeeth } : null
    })
    const parts: string[] = []
    if (selectedTeeth.length) parts.push(`${selectedTeeth.length} tooth finding(s)`)
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
          <label style={{ margin: 0 }}>Dictation</label>
          <DictateButton />
        </div>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="e.g. Tooth 14 has a MOD cavity. Number 30 needs a crown. Upper right first molar looks healthy."
          style={{ minHeight: 90 }}
        />
        <span className="muted" style={{ fontSize: 11.5 }}>
          🎤 Dictate focuses this box for Windows voice typing (Win + H). Nothing leaves the computer.
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

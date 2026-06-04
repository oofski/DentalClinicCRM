import { useEffect, useRef } from 'react'
import SignaturePadLib from 'signature_pad'
import { COLORS } from '@shared/branding'

export function SignaturePad({
  onChange,
  height = 200
}: {
  onChange: (dataUrl: string | null) => void
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePadLib | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pad = new SignaturePadLib(canvas, {
      penColor: COLORS.navy,
      minWidth: 1,
      maxWidth: 2.6
    })
    padRef.current = pad

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight
      canvas.width = w * ratio
      canvas.height = h * ratio
      const ctx = canvas.getContext('2d')
      ctx?.scale(ratio, ratio)
      pad.clear()
      onChange(null)
    }
    resize()
    window.addEventListener('resize', resize)

    pad.addEventListener('endStroke', () => {
      onChange(pad.isEmpty() ? null : pad.toDataURL('image/png'))
    })

    return () => {
      window.removeEventListener('resize', resize)
      pad.off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clear = () => {
    padRef.current?.clear()
    onChange(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height,
          border: `2px dashed ${COLORS.border}`,
          borderRadius: 10,
          background: '#fff',
          touchAction: 'none',
          cursor: 'crosshair'
        }}
      />
      <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Sign above using your mouse, touchpad, or finger
        </span>
        <button type="button" className="btn btn-sm" onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  )
}

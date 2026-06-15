import { useState } from 'react'
import { api } from '@/lib/api'
import { Logo } from '@/components/Logo'
import { PRODUCT, COMPANY, COPYRIGHT_YEAR } from '@shared/legal'

export default function LicenseGate({ onActivated }: { onActivated: () => void }) {
  const [code, setCode] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await api.license.activate(code)
    setBusy(false)
    if (res.ok) onActivated()
    else setError(res.error || 'Activation failed')
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo">
          <Logo height={50} />
        </div>
        <h2 style={{ marginBottom: 4 }}>Activate this Computer</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
          Enter the clinic unlock code provided with your license. You only need to do this once on
          this computer.
        </p>

        <div className="field" style={{ textAlign: 'left' }}>
          <label>Unlock Code</label>
          <div style={{ position: 'relative' }}>
            <input
              autoFocus
              type={show ? 'text' : 'password'}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXXX-XXXXX-XXXX"
              style={{ paddingRight: 62 }}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide code' : 'Show code'}
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--azure)',
                cursor: 'pointer',
                fontSize: 12.5,
                fontWeight: 700,
                width: 'auto',
                padding: '4px 8px'
              }}
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {error && (
          <div className="alert" style={{ marginBottom: 14, textAlign: 'left' }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Activating…' : 'Activate'}
        </button>

        <div className="muted" style={{ fontSize: 11, marginTop: 18, textAlign: 'center' }}>
          {PRODUCT} — © {COPYRIGHT_YEAR} {COMPANY}™
        </div>
      </form>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/store/auth'
import { Logo } from '@/components/Logo'
import { PRODUCT, COMPANY, COPYRIGHT_YEAR } from '@shared/legal'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await login(username, password)
    setBusy(false)
    if (res.ok) navigate('/', { replace: true })
    else setError(res.error || 'Login failed')
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo">
          <Logo height={50} />
        </div>
        <h2 style={{ marginBottom: 4 }}>Clinic Sign In</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
          Dental Clinic Management
        </p>

        <div className="field" style={{ textAlign: 'left' }}>
          <label>Username</label>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
          />
        </div>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ paddingRight: 62 }}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
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
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {error && (
          <div className="alert" style={{ marginBottom: 14, textAlign: 'left' }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        <div className="muted" style={{ fontSize: 11, marginTop: 18, textAlign: 'center' }}>
          {PRODUCT}™ — © {COPYRIGHT_YEAR} {COMPANY}
        </div>
      </form>
    </div>
  )
}

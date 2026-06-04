import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/store/auth'
import { Logo } from '@/components/Logo'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
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
            placeholder="e.g. drseitz"
          />
        </div>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="alert" style={{ marginBottom: 14, textAlign: 'left' }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        <div className="login-hint">
          <b>Accounts for this clinic</b>
          <div style={{ marginTop: 4 }}>
            • <code>sidharthrane</code> — Admin
            <br />• <code>drseitz</code> — Dr. Seitz (Doctor)
            <br />• <code>frontend</code> — Front Desk
          </div>
          <div style={{ marginTop: 6 }}>
            Default password: <code>GivingSmiles2026</code> — please change it in Settings after first
            sign-in.
          </div>
        </div>
      </form>
    </div>
  )
}

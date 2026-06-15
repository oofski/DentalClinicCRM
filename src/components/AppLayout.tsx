import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/store/auth'
import { api } from '@/lib/api'
import type { Patient, ClinicEvent } from '@shared/types'
import { LogoPlate } from './Logo'
import { Icon } from './icons'
import { useToast } from './ui'

const INACTIVITY_MS = 30 * 60 * 1000

function GlobalSearch() {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Patient[]>([])
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!term.trim()) {
      setResults([])
      return
    }
    let active = true
    const t = setTimeout(async () => {
      const r = await api.patients.search(term)
      if (active) {
        setResults(r.slice(0, 7))
        setOpen(true)
      }
    }, 180)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [term])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={boxRef} style={{ position: 'relative', width: 340, maxWidth: '50vw' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 11, top: 10, color: 'var(--muted)' }}>
          <Icon name="search" size={17} />
        </span>
        <input
          style={{ paddingLeft: 36 }}
          placeholder="Search patients by name or ID…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
      </div>
      {open && results.length > 0 && (
        <div
          className="card"
          style={{ position: 'absolute', top: 46, left: 0, right: 0, padding: 6, zIndex: 30 }}
        >
          {results.map((p) => (
            <div
              key={p.id}
              className="nav-item"
              style={{ color: 'var(--text)', margin: 0 }}
              onClick={() => {
                setOpen(false)
                setTerm('')
                navigate(`/patients/${p.id}`)
              }}
            >
              <span style={{ fontWeight: 700 }}>
                {p.first_name} {p.last_name}
              </span>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
                {p.patient_id}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const [version, setVersion] = useState('')
  const [activeEvent, setActiveEvent] = useState<ClinicEvent | null>(null)

  useEffect(() => {
    api.app.info().then((i) => setVersion(i.version))
  }, [])

  // Refresh the active-event banner whenever the user navigates.
  useEffect(() => {
    api.events.getActive().then(setActiveEvent)
  }, [location.pathname])

  // Live toast when a patient checks in from a tablet on the local network.
  useEffect(() => {
    const off = api.live.onCheckin((p) => {
      toast.push(`✅ ${p.name} just checked in from the tablet (${p.patient_id})`, 'success')
    })
    return off
  }, [toast])

  // Tell the admin once when a software update is available.
  const notifiedVersion = useRef<string | null>(null)
  useEffect(() => {
    if (user?.role !== 'admin') return
    const off = api.updates.onStatus((s) => {
      if (s.state === 'available' && s.availableVersion && notifiedVersion.current !== s.availableVersion) {
        notifiedVersion.current = s.availableVersion
        toast.push(`⬆ Update v${s.availableVersion} is available — Settings → Software Updates`, 'info')
      }
    })
    return off
  }, [user?.role, toast])

  // Inactivity auto-logout (security requirement: 30 min).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        await logout()
        toast.push('Signed out due to inactivity', 'info')
        navigate('/login')
      }, INACTIVITY_MS)
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [logout, navigate, toast])

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  const navItem = (path: string, icon: Parameters<typeof Icon>[0]['name'], label: string) => (
    <div className={`nav-item ${isActive(path) ? 'active' : ''}`} onClick={() => navigate(path)}>
      <span className="ico">
        <Icon name={icon} />
      </span>
      {label}
    </div>
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <LogoPlate height={30} />
        </div>
        {navItem('/', 'home', 'Dashboard')}
        {navItem('/patients', 'users', 'Patients')}
        {navItem('/events', 'doc', 'Events')}
        {navItem('/settings', 'settings', 'Settings')}

        <div style={{ marginTop: 14 }}>
          <button
            className="btn btn-sm"
            style={{ width: '100%', background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'transparent' }}
            onClick={async () => {
              await api.kiosk.open()
              toast.push('Patient Check-In window opened', 'success')
            }}
          >
            <Icon name="kiosk" size={16} /> Patient Check-In
          </button>
        </div>

        <div className="spacer" />
        <div className="userbox">
          <div className="name">{user?.full_name}</div>
          <div className="role">{user?.role?.replace('_', ' ')}</div>
          <button
            className="btn btn-sm"
            style={{ width: '100%', marginTop: 10, background: 'transparent', color: '#cfe0f0', borderColor: 'rgba(255,255,255,0.2)' }}
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
          >
            <Icon name="logout" size={16} /> Sign Out
          </button>
        </div>
        <div
          style={{
            textAlign: 'center',
            fontSize: 11,
            marginTop: 10,
            color: 'rgba(255,255,255,0.45)'
          }}
        >
          Giving Smiles{version ? ` v${version}` : ''}
          <div style={{ fontSize: 10, marginTop: 2 }}>© 2026 Software Smiles™</div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <GlobalSearch />
          <div className="row" style={{ gap: 10 }}>
            {activeEvent && (
              <span
                className="pill azure clickable"
                title="Active event — new patients are tagged to it. Click to manage."
                onClick={() => navigate('/events')}
              >
                📍 {activeEvent.name}
              </span>
            )}
            <button className="btn btn-primary" onClick={() => navigate('/patients/new')}>
              <Icon name="plus" size={16} /> New Patient
            </button>
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  )
}

import { useEffect } from 'react'
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './store/auth'
import { AppLayout } from './components/AppLayout'
import { LogoMark } from './components/Logo'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Patients from './pages/Patients'
import PatientForm from './pages/PatientForm'
import PatientRecord from './pages/PatientRecord'
import Consent from './pages/Consent'
import Exam from './pages/Exam'
import Settings from './pages/Settings'
import Kiosk from './pages/Kiosk'

function Splash() {
  return (
    <div className="login-wrap">
      <div style={{ textAlign: 'center' }}>
        <LogoMark size={72} />
        <p className="muted" style={{ marginTop: 12 }}>
          Loading Giving Smiles…
        </p>
      </div>
    </div>
  )
}

function RequireAuth() {
  const user = useAuth((s) => s.user)
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  )
}

export default function App() {
  const { ready, init } = useAuth()
  useEffect(() => {
    init()
  }, [init])

  if (!ready) return <Splash />

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/kiosk" element={<Kiosk />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/patients" element={<Patients />} />
        <Route path="/patients/new" element={<PatientForm />} />
        <Route path="/patients/:id" element={<PatientRecord />} />
        <Route path="/patients/:id/edit" element={<PatientForm />} />
        <Route path="/patients/:id/consent" element={<Consent />} />
        <Route path="/exam/:examId" element={<Exam />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
